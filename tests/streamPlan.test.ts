import { describe, it, expect } from 'vitest';
import { cleanHeaders, ffmpegHeaderText, hasVideo, isHttpUrl, pipeArgs, planFromDirect, planFromYtdlp, playFormatSelector } from '@core/streamPlan';

describe('whether a resolved link has a picture', () => {
  it('says no only when the site says "no video codec", so a manifest that reports nothing is shown as video', () => {
    expect(hasVideo({ url: 'https://x/a.m4a', vcodec: 'none' })).toBe(false);
    expect(hasVideo({ url: 'https://x/index.m3u8' })).toBe(true);
    expect(hasVideo({ url: 'https://x/v.mp4', vcodec: 'avc1.64001f' })).toBe(true);
  });

  it('counts a video part among separate files, and an all-audio set as audio', () => {
    expect(hasVideo({ requested_formats: [{ url: 'https://x/v', vcodec: 'vp9' }, { url: 'https://x/a', vcodec: 'none' }] })).toBe(true);
    expect(hasVideo({ requested_formats: [{ url: 'https://x/a', vcodec: 'none' }] })).toBe(false);
  });
});

describe('which way a resolved link is played', () => {
  it('passes a single progressive mp4 straight through, so the server does the seeking', () => {
    const plan = planFromYtdlp({ url: 'https://cdn.example.com/v.mp4', ext: 'mp4', protocol: 'https', http_headers: { Referer: 'https://example.com/' } });
    expect(plan).toEqual({ mode: 'proxy', mime: 'video/mp4', source: { url: 'https://cdn.example.com/v.mp4', headers: { Referer: 'https://example.com/' } } });
  });

  it('pipes video and audio that arrive as two files, in that order', () => {
    const plan = planFromYtdlp({
      requested_formats: [
        { url: 'https://cdn.example.com/v.mp4', ext: 'mp4', protocol: 'https' },
        { url: 'https://cdn.example.com/a.m4a', ext: 'm4a', protocol: 'https' },
      ],
    });
    expect(plan.mode).toBe('pipe');
    if (plan.mode === 'pipe') expect(plan.sources.map((s) => s.url)).toEqual(['https://cdn.example.com/v.mp4', 'https://cdn.example.com/a.m4a']);
  });

  it('pipes a manifest even when its extension says mp4', () => {
    expect(planFromYtdlp({ url: 'https://cdn.example.com/master.m3u8', ext: 'mp4', protocol: 'm3u8_native' }).mode).toBe('pipe');
    expect(planFromYtdlp({ url: 'https://cdn.example.com/manifest.mpd', ext: 'mp4', protocol: 'http_dash_segments' }).mode).toBe('pipe');
  });

  it('pipes a container the browser cannot open', () => {
    expect(planFromYtdlp({ url: 'https://cdn.example.com/v.mkv', ext: 'mkv', protocol: 'https' }).mode).toBe('pipe');
  });

  it('refuses a live stream and a result with no address, in words', () => {
    expect(() => planFromYtdlp({ url: 'https://x/y.mp4', ext: 'mp4', is_live: true })).toThrow(/Live streams/);
    expect(() => planFromYtdlp({ ext: 'mp4' })).toThrow(/nothing Lumina can play/);
    expect(() => planFromYtdlp({ url: 'file:///C:/secret.mp4', ext: 'mp4' })).toThrow(/nothing Lumina can play/);
  });

  it('lets the player add its own headers, which win over the site’s', () => {
    const plan = planFromYtdlp({ url: 'https://x/y.mp4', ext: 'mp4', http_headers: { Referer: 'a' } }, { Referer: 'b' });
    expect(plan.mode === 'proxy' && plan.source.headers.Referer).toBe('b');
  });
});

describe('a link that is the file itself', () => {
  it('plays mp3, mp4 and webm as they are, by name or by the type the server gave', () => {
    expect(planFromDirect('https://x.test/a/song.mp3').mode).toBe('proxy');
    expect(planFromDirect('https://x.test/dl?id=4', { filename: 'clip.webm' })).toMatchObject({ mode: 'proxy', mime: 'video/webm' });
    expect(planFromDirect('https://x.test/dl?id=4', { mime: 'audio/mpeg' })).toMatchObject({ mode: 'proxy', mime: 'audio/mpeg' });
  });

  it('pipes what the browser cannot decode, even if the server calls it video', () => {
    expect(planFromDirect('https://x.test/film.mkv', { mime: 'video/x-matroska' }).mode).toBe('pipe');
    expect(planFromDirect('https://x.test/old.avi').mode).toBe('pipe');
    expect(planFromDirect('https://x.test/dl?id=4', { mime: 'application/octet-stream' }).mode).toBe('pipe');
  });

  it('only plays web links', () => {
    expect(() => planFromDirect('file:///C:/a.mp3')).toThrow(/web links/);
    expect(isHttpUrl('ftp://x/y')).toBe(false);
    expect(isHttpUrl('HTTPS://x/y')).toBe(true);
  });
});

describe('what is asked of yt-dlp', () => {
  it('prefers one progressive mp4 with sound, then separate video and audio, then anything', () => {
    const s = playFormatSelector({ audioOnly: false, maxHeight: 1080 });
    const [muxed, split, , any] = s.split('/');
    expect(muxed).toMatch(/^b\[ext=mp4\]/);
    expect(muxed).toContain('[height<=?1080]');
    expect(split).toBe('bv*[height<=?1080]+ba');
    expect(any).toBe('b');
  });

  it('asks for no height limit when there is none, and for audio only when the source is music', () => {
    expect(playFormatSelector({ audioOnly: false, maxHeight: null })).not.toContain('<=?');
    expect(playFormatSelector({ audioOnly: true, maxHeight: 1080 })).toMatch(/^ba/);
  });
});

describe('headers handed to ffmpeg', () => {
  it('drops a header that could start another one', () => {
    expect(cleanHeaders({ 'User-Agent': 'ok', Bad: 'x\r\nHost: evil', 'X\nY': 'z' })).toEqual({ 'User-Agent': 'ok' });
  });

  it('adds a cookie only when the site gave none of its own', () => {
    expect(cleanHeaders({}, 'a=1')).toEqual({ Cookie: 'a=1' });
    expect(cleanHeaders({ cookie: 'b=2' }, 'a=1')).toEqual({ cookie: 'b=2' });
    expect(cleanHeaders({}, 'a=1\r\nHost: evil')).toEqual({});
  });

  it('writes one CRLF-terminated line per header', () => {
    expect(ffmpegHeaderText({ A: '1', B: '2' })).toBe('A: 1\r\nB: 2\r\n');
  });
});

describe('the ffmpeg command for a piped plan', () => {
  const v = { url: 'https://x/v.mp4', headers: { Referer: 'https://x/' } };
  const a = { url: 'https://x/a.m4a', headers: {} };

  it('maps video from the first input and audio from the second when they are separate', () => {
    const args = pipeArgs([v, a], 0);
    expect(args.filter((x) => x === '-i')).toHaveLength(2);
    expect(args.join(' ')).toContain('-map 0:v:0 -map 1:a:0');
    expect(args).not.toContain('-ss');
  });

  it('puts the start time before each input, which makes ffmpeg seek on the server', () => {
    const args = pipeArgs([v, a], 125.9);
    const ss = args.reduce<number[]>((at, x, i) => (x === '-ss' ? [...at, i] : at), []);
    expect(ss).toHaveLength(2);
    for (const i of ss) {
      expect(args[i + 1]).toBe('125');
      expect(args[i + 2]).toBe('-i');
    }
  });

  it('copies video, makes audio AAC, and writes a fragmented mp4 to stdout', () => {
    const args = pipeArgs([v], 0).join(' ');
    expect(args).toContain('-c:v copy -c:a aac');
    expect(args).toContain('frag_keyframe+empty_moov');
    expect(args.endsWith('pipe:1')).toBe(true);
    expect(args).toContain('-headers Referer: https://x/');
  });
});
