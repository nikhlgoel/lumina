import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { defaultSettings, mergeSettings, parseExtraArgs, settingsSchema, speedLimitActive } from '@shared/settings';
import { assForceStyle } from '@core/subtitleStyle';
import { classifyUrl, cleanUrl, extractLinks, isMusicSite } from '@core/url';
import { parseStreams } from '@core/streams';
import { audioFormatArgs, buildDownloadArgs, outputTemplate, previewTemplate, SQUARE_ARTWORK_PPA, videoFormatArgs, type BuildArgsInput } from '@core/ytdlpArgs';
import { parseYtdlpLine, friendlyYtdlpError, friendlyAria2Error, isCookieReadError } from '@core/progress';
import { parsePlaylist, writeM3u8 } from '@core/playlists';
import { activeLineIndex, cleanTrackMetadata, parseCues, parseLrc, scoreLyricsMatch } from '@core/lyrics';
import { formatBytes, formatDuration, safeFileName } from '@core/format';
import { BUILT_IN_PRESETS, presetById, qualityNote } from '@core/presets';
import type { CapturedCookie, DownloadOptions, MediaInfo } from '@shared/types';
import { cookieHeaderFor } from '@core/cookies';

describe('settings', () => {
  it('fills every default from an empty object', () => {
    const s = defaultSettings();
    expect(s.downloads.concurrency).toBe(3);
    expect(s.subtitles.whisperModel).toBe('base');
    expect(s.subtitles.style.size).toBe(1);
    expect(s.general.closeToTray).toBe(true);
    expect(s.player.theme).toBe('aurora');
    expect(s.extension.port).toBe(17865);
  });

  it('repairs invalid values instead of failing', () => {
    const s = settingsSchema.parse({ downloads: { concurrency: 99, retries: 'x' }, player: { theme: 'neon-nope' }, subtitles: { style: { color: 'red' } } });
    expect(s.downloads.concurrency).toBe(3);
    expect(s.downloads.retries).toBe(5);
    expect(s.player.theme).toBe('aurora');
    expect(s.subtitles.style.color).toBe('#FFFFFF');
  });

  it('merges a partial patch without touching other sections', () => {
    const next = mergeSettings(defaultSettings(), { subtitles: { whisperModel: 'small' } });
    expect(next.subtitles.whisperModel).toBe('small');
    expect(next.subtitles.output).toEqual(['sidecar', 'embed']);
    expect(next.downloads.concurrency).toBe(3);
  });

  it('parses extra yt-dlp arguments and blocks dangerous ones', () => {
    expect(parseExtraArgs('--geo-bypass --add-header "X-Test:a b"')).toEqual({ args: ['--geo-bypass', '--add-header', 'X-Test:a b'], error: null });
    expect(parseExtraArgs('--exec "calc.exe"').error).toContain('--exec');
    expect(parseExtraArgs('-o C:/x').error).not.toBeNull();
    expect(parseExtraArgs('--config-location=evil.conf').error).not.toBeNull();
  });

  it('applies the speed limit only inside its schedule, including overnight windows', () => {
    const base = defaultSettings();
    const s = mergeSettings(base, { downloads: { speedLimitKbps: 500, speedLimitSchedule: { enabled: true, from: '22:00', to: '06:00' } } });
    expect(speedLimitActive(s, new Date(2026, 0, 1, 23, 30))).toBe(true);
    expect(speedLimitActive(s, new Date(2026, 0, 1, 5, 59))).toBe(true);
    expect(speedLimitActive(s, new Date(2026, 0, 1, 12, 0))).toBe(false);
    expect(speedLimitActive(base, new Date())).toBe(false);
  });
});

describe('urls', () => {
  it('strips tracking parameters but keeps the video id', () => {
    expect(cleanUrl('https://youtu.be/abc?si=XYZ&t=10')).toBe('https://youtu.be/abc?t=10');
  });
  it('classifies links', () => {
    expect(classifyUrl('magnet:?xt=urn:btih:abcdef')).toBe('magnet');
    expect(classifyUrl('https://x.com/file.part01.rar')).toBe('direct');
    expect(classifyUrl('https://example.com/a.torrent')).toBe('torrent-file');
    expect(classifyUrl('https://www.youtube.com/watch?v=1')).toBe('web');
    expect(classifyUrl('javascript:alert(1)')).toBe('invalid');
  });
  it('treats YouTube Music as music', () => {
    expect(isMusicSite('https://music.youtube.com/playlist?list=PL1')).toBe(true);
    expect(isMusicSite('https://www.youtube.com/playlist?list=PL1')).toBe(false);
  });
  it('extracts unique links from pasted text', () => {
    expect(extractLinks('a https://a.com/1.rar, b https://a.com/1.rar\nmagnet:?xt=urn:btih:1')).toHaveLength(2);
  });
});

describe('streams', () => {
  const formats = [
    { format_id: '140', acodec: 'mp4a.40.2', vcodec: 'none', abr: 129, asr: 44100, ext: 'm4a' },
    { format_id: '251', acodec: 'opus', vcodec: 'none', abr: 130, asr: 48000, ext: 'webm' },
    { format_id: '299', vcodec: 'avc1.64002a', acodec: 'none', height: 1080, width: 1920, fps: 60, vbr: 3248, ext: 'mp4' },
    { format_id: '401', vcodec: 'av01.0.13M.08', acodec: 'none', height: 2160, width: 3840, fps: 60, vbr: 8982, ext: 'mp4', dynamic_range: 'SDR' },
    { format_id: '701', vcodec: 'av01.0.13M.10', acodec: 'none', height: 2160, width: 3840, fps: 60, vbr: 12000, ext: 'mp4', dynamic_range: 'HDR10' },
    { format_id: 'sb0', protocol: 'mhtml', vcodec: 'none', acodec: 'none' },
  ];
  it('separates, normalizes and sorts streams', () => {
    const { video, audio } = parseStreams(formats, 60);
    expect(video[0]).toMatchObject({ height: 2160, codec: 'av1', hdr: true });
    expect(video.at(-1)).toMatchObject({ height: 1080, codec: 'h264' });
    expect(audio.map((a) => a.codec)).toEqual(['opus', 'aac']);
    expect(audio[0]!.sizeBytes).toBeGreaterThan(0);
  });
});

describe('yt-dlp arguments', () => {
  const tv = presetById('video-tv-1080')!.format;
  it('TV-safe prefers H.264 + AAC in MP4 with fallbacks', () => {
    const args = videoFormatArgs(tv as never);
    const f = args[args.indexOf('-f') + 1]!;
    expect(f.startsWith("bv*[vcodec~='^(avc|h264)'][height<=?1080][fps<=?60][dynamic_range=?SDR]+ba[acodec~='^(mp4a|aac)']")).toBe(true);
    expect(f.endsWith('/bv*+ba/b')).toBe(true);
    expect(args).toContain('mp4');
    expect(args[args.indexOf('-S') + 1]).toContain('+codec:avc:m4a');
  });
  it('Source max has no height limit and keeps HDR preference', () => {
    const args = videoFormatArgs(presetById('video-source-max')!.format as never);
    expect(args[args.indexOf('-f') + 1]).not.toContain('height');
    expect(args[args.indexOf('-S') + 1]).toBe('res,fps,hdr:12');
  });
  it('Original audio never re-encodes', () => {
    expect(audioFormatArgs({ kind: 'audio', target: 'original', bitrateKbps: null })).not.toContain('--audio-format');
    expect(audioFormatArgs({ kind: 'audio', target: 'mp3', bitrateKbps: 320 })).toEqual(expect.arrayContaining(['--audio-format', 'mp3', '--audio-quality', '320K']));
  });
  const baseInput = (options: DownloadOptions, over: Partial<BuildArgsInput> = {}): BuildArgsInput => ({
    url: 'u', options, outputDir: 'o', tempDir: 't', outputTemplate: 'x', ffmpegDir: 'b', jsRuntime: null, archiveFile: null,
    isPlaylist: false, speedLimitKbps: 0, retries: 1, concurrentFragments: 8,
    request: { headers: {}, userAgent: '', proxy: '', forceIpv4: false, cookies: {} },
    sponsorBlock: 'off', sponsorCategories: [], embedThumbnail: true, squareMusicArtwork: true, includeAutoSubs: true,
    windowsFilenames: false, extraArgs: [], ...over,
  });
  const music: DownloadOptions = {
    contentType: 'music', format: presetById('audio-original')!.format, englishSubtitles: false, subtitleOutput: [],
    embedMetadata: true, embedLyrics: false, sponsorBlock: false, playlistItems: [2, 5],
  };

  it('builds a full command ending with the url after --', () => {
    const args = buildDownloadArgs(baseInput(music, { url: '-danger', jsRuntime: 'node:electron.exe', isPlaylist: true, extraArgs: ['--geo-bypass'] }));
    expect(args.slice(-3)).toEqual(['--geo-bypass', '--', '-danger']);
    expect(args).toEqual(expect.arrayContaining(['--playlist-items', '2,5', '--yes-playlist', '--js-runtimes', '--concurrent-fragments', '8']));
  });
  it('crops music artwork to a square but leaves video thumbnails alone', () => {
    expect(buildDownloadArgs(baseInput(music))).toContain(SQUARE_ARTWORK_PPA);
    const video = { ...music, contentType: 'video' as const, format: presetById('video-1080')!.format };
    expect(buildDownloadArgs(baseInput(video))).not.toContain(SQUARE_ARTWORK_PPA);
  });
  it('sends captured headers and refuses header injection', () => {
    const args = buildDownloadArgs(baseInput(music, {
      request: { headers: { Referer: 'https://site.example/watch', 'Bad Header': 'x', Origin: 'a\r\nX-Evil: 1' }, userAgent: 'UA/1', proxy: '', forceIpv4: true, cookies: { file: 'c.txt' } },
    }));
    expect(args).toEqual(expect.arrayContaining(['--add-headers', 'Referer:https://site.example/watch', '--user-agent', 'UA/1', '--force-ipv4', '--cookies', 'c.txt']));
    expect(args.join(' ')).not.toContain('X-Evil');
    expect(args.join(' ')).not.toContain('Bad Header');
  });
  it('requests only real English subtitle tracks and tolerates subtitle errors', () => {
    const options: DownloadOptions = {
      contentType: 'video', format: presetById('video-1080')!.format, englishSubtitles: true, subtitleOutput: ['sidecar'],
      embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [],
    };
    const args = buildDownloadArgs(baseInput(options));
    const langs = args[args.indexOf('--sub-langs') + 1]!;
    expect(langs.split(',')).not.toContain('en.*');
    expect(langs.split(',')).toContain('en');
    expect(args).toContain('--ignore-errors');
    expect(buildDownloadArgs(baseInput(options, { includeAutoSubs: false }))).not.toContain('--write-auto-subs');
  });
  it('names series episodes by season', () => {
    const t = outputTemplate({ contentType: 'series', series: { show: 'My: Show', season: 2 } } as DownloadOptions, true, true, '%(title)s');
    expect(t).toBe('My_ Show/Season 02/My_ Show - S02E%(playlist_index|autonumber)02d - %(title)s.%(ext)s');
  });
  it('organizes music by artist and album and previews templates', () => {
    const t = outputTemplate(music, false, true, '%(title)s', { music: 'artist-album', video: 'flat' });
    expect(t).toBe('%(artist,creator,uploader|Unknown Artist)s/%(album|Singles)s/%(title)s.%(ext)s');
    expect(previewTemplate(t, { uploader: 'Daft Punk - Topic', artist: 'Daft Punk', title: 'One More Time', ext: 'opus' })).toBe('Daft Punk/Singles/One More Time.opus');
    expect(previewTemplate('%(playlist_index)02d - %(title)s', { playlist_index: 3, title: 'Song' })).toBe('03 - Song');
  });
});

describe('cookie header', () => {
  const c = (over: Partial<CapturedCookie>): CapturedCookie => ({ name: 'n', value: 'v', domain: 'example.com', path: '/', secure: false, httpOnly: false, ...over });
  it('sends only cookies that match host, path, scheme and expiry', () => {
    const cookies = [
      c({ name: 'host', value: '1' }),
      c({ name: 'sub', value: '2', domain: '.example.com' }),
      c({ name: 'other', value: '3', domain: 'evil.com' }),
      c({ name: 'deep', value: '4', path: '/files/' }),
      c({ name: 'wrongpath', value: '5', path: '/admin' }),
      c({ name: 'secure', value: '6', secure: true }),
      c({ name: 'old', value: '7', expirationDate: 1 }),
    ];
    expect(cookieHeaderFor('http://example.com/files/a.zip', cookies)).toBe('deep=4; host=1; sub=2');
    // Host-only cookies stay on example.com; domain cookies reach subdomains; secure ones need https.
    expect(cookieHeaderFor('https://cdn.example.com/a.zip', cookies)).toBe('sub=2');
    expect(cookieHeaderFor('https://example.com/a.zip', cookies)).toBe('host=1; sub=2; secure=6');
    expect(cookieHeaderFor('https://example.com/administrator', cookies)).not.toContain('wrongpath');
    expect(cookieHeaderFor('not a url', cookies)).toBe('');
  });
});

describe('subtitle style', () => {
  it('produces libass colours in &HAABBGGRR order and top alignment', () => {
    const style = { ...defaultSettings().subtitles.style, color: '#FFCC00', position: 'top' as const, background: 'box' as const, backgroundOpacity: 0.5 };
    const s = assForceStyle(style);
    expect(s).toContain('PrimaryColour=&H0000CCFF');
    expect(s).toContain('Alignment=8');
    expect(s).toContain('BorderStyle=3');
    expect(s).toContain('BackColour=&H80000000');
  });
});

describe('progress parsing', () => {
  it('reads download progress', () => {
    expect(parseYtdlpLine('LUMINA_DL|downloading|1048576|NA|10485760|204800.5|42|NA|NA')).toMatchObject({
      type: 'progress', downloaded: 1048576, total: 10485760, speed: 204800.5, eta: 42, fragment: null,
    });
  });
  it('reads final file path and items', () => {
    expect(parseYtdlpLine('LUMINA_FILE|C:\\Music\\a|b.mp3')).toEqual({ type: 'file', path: 'C:\\Music\\a|b.mp3' });
    expect(parseYtdlpLine('LUMINA_ITEM|3|12|Song | Live')).toEqual({ type: 'item', index: 3, count: 12, title: 'Song | Live' });
  });
  it('explains common errors', () => {
    expect(friendlyYtdlpError('[youtube] x: Sign in to confirm you’re not a bot')).toContain('Accounts');
    expect(friendlyYtdlpError('ERROR: This video is DRM protected')).toContain('DRM');
  });
  it('explains aria2 disk-write failures in plain words', () => {
    expect(friendlyAria2Error('write disk cache flush failure index=13934')).toMatch(/disk/i);
    expect(friendlyAria2Error('Cannot write to file')).toMatch(/disk/i);
    expect(friendlyAria2Error('No space left on device')).toMatch(/full/i);
    expect(friendlyAria2Error('errorCode=3 404 Not Found')).toMatch(/404/);
    expect(friendlyAria2Error(undefined)).toBe('Download stopped unexpectedly.');
  });
  it('recognises unreadable browser cookie stores', () => {
    const msg = 'Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info';
    expect(isCookieReadError(msg)).toBe(true);
    expect(isCookieReadError('Failed to decrypt with DPAPI')).toBe(true);
    expect(isCookieReadError('HTTP Error 403: Forbidden')).toBe(false);
    expect(friendlyYtdlpError(msg)).not.toContain('github.com');
  });
});

describe('playlists', () => {
  const dir = path.resolve('/music/lists');
  it('parses m3u with relative and file:// entries, ignoring remote urls', () => {
    const p = parsePlaylist(path.join(dir, 'a.m3u8'), '#EXTM3U\n#PLAYLIST:Road\n#EXTINF:1,x\n../a.mp3\nhttps://x/y.mp3\n');
    expect(p.name).toBe('Road');
    expect(p.entries).toEqual([path.resolve(dir, '../a.mp3')]);
  });
  it('parses pls and xspf', () => {
    expect(parsePlaylist(path.join(dir, 'b.pls'), '[playlist]\nFile1=song.flac\nNumberOfEntries=1').entries).toHaveLength(1);
    const x = parsePlaylist(path.join(dir, 'c.xspf'), '<playlist><title>Mix &amp; Match</title><trackList><track><location>d.mp3</location></track></trackList></playlist>');
    expect(x.name).toBe('Mix & Match');
    expect(x.entries).toHaveLength(1);
  });
  it('writes relative m3u8 paths', () => {
    const out = writeM3u8(path.join(dir, 'x.m3u8'), 'X', [{ path: path.join(dir, 'sub', 'a.mp3'), title: 'A', durationSec: 61.4 }]);
    expect(out).toContain('#EXTINF:61,A\nsub/a.mp3');
  });
});

describe('lyrics and captions', () => {
  it('parses LRC with multiple stamps and offset', () => {
    const lines = parseLrc('[ar:x]\n[offset:+500]\n[00:10.00][00:30.50]Chorus\n[00:05.1]Intro');
    expect(lines.map((l) => [Math.round(l.timeSec * 10) / 10, l.text])).toEqual([[4.6, 'Intro'], [9.5, 'Chorus'], [30, 'Chorus']]);
  });
  it('finds the active line', () => {
    const lines = parseLrc('[00:01.00]a\n[00:05.00]b\n[00:09.00]c');
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 5)).toBe(1);
    expect(activeLineIndex(lines, 99)).toBe(2);
  });
  it('parses SRT cues', () => {
    const cues = parseCues('1\n00:00:01,000 --> 00:00:02,500\n<i>Hello</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld');
    expect(cues).toEqual([{ startSec: 1, endSec: 2.5, text: 'Hello' }, { startSec: 3, endSec: 4, text: 'World' }]);
  });
  it('rejects lyrics for a different song', () => {
    const zoo = { title: 'Me at the zoo', artist: 'jawed', durationSec: 19 };
    expect(scoreLyricsMatch({ trackName: 'Stay With Me', artistName: 'Sam Smith', duration: 172, syncedLyrics: 'x' }, zoo)).toBeNull();
    expect(scoreLyricsMatch({ trackName: 'Zoo', artistName: 'Someone', duration: 19 }, zoo)).toBeNull();
  });
  it('accepts a real match even with small title differences', () => {
    const track = { title: 'Harder Better Faster Stronger', artist: 'Daft Punk', durationSec: 224 };
    expect(scoreLyricsMatch({ trackName: 'Harder, Better, Faster, Stronger', artistName: 'Daft Punk', duration: 226 }, track)).toBeGreaterThan(5);
    // Artist spelled differently, but the duration confirms it.
    expect(scoreLyricsMatch({ trackName: 'Harder Better Faster Stronger', artistName: 'Daft-Punk Official', duration: 224 }, track)).not.toBeNull();
    // Right title, wrong artist, no duration to confirm: rejected.
    expect(scoreLyricsMatch({ trackName: 'Harder Better Faster Stronger', artistName: 'Cover Band' }, { ...track, durationSec: null })).toBeNull();
  });
  it('cleans YouTube titles', () => {
    expect(cleanTrackMetadata('Daft Punk - Harder (Official Video) [HD]', 'DaftPunkVEVO')).toEqual({ title: 'Harder', artist: 'Daft Punk' });
  });
});

describe('formatting and presets', () => {
  it('formats sizes and durations', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(safeFileName('CON')).toBe('Untitled');
    expect(safeFileName('a/b:c?.')).toBe('a_b_c_');
  });
  it('has unique preset ids and warns about fake lossless', () => {
    expect(new Set(BUILT_IN_PRESETS.map((p) => p.id)).size).toBe(BUILT_IN_PRESETS.length);
    const info = { audioStreams: [{ codec: 'opus', bitrateKbps: 130, lossless: false }], videoStreams: [] } as unknown as MediaInfo;
    expect(qualityNote(presetById('audio-flac')!.format, info)).toContain('cannot add quality');
  });
});
