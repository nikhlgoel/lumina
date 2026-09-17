import type { AudioFormatChoice, DownloadOptions, VideoFormatChoice } from '../shared/types';

export const PROGRESS_PREFIX = 'LUMINA_DL|';
export const POSTPROCESS_PREFIX = 'LUMINA_PP|';
export const ITEM_PREFIX = 'LUMINA_ITEM|';
export const FILE_PREFIX = 'LUMINA_FILE|';
export const ENGLISH_SUB_LANGS = 'en,en-orig,en-US,en-GB';

const CODEC_FILTER: Record<string, string> = {
  av1: '[vcodec^=av01]',
  vp9: "[vcodec~='^vp0?9']",
  hevc: "[vcodec~='^(hev|hvc|h265)']",
  h264: "[vcodec~='^(avc|h264)']",
};

function videoFilters(f: VideoFormatChoice): string {
  let s = '';
  if (f.maxHeight) s += `[height<=?${f.maxHeight}]`;
  if (f.maxFps) s += `[fps<=?${f.maxFps}]`;
  if (!f.allowHdr) s += '[dynamic_range=?SDR]';
  return s;
}

/** yt-dlp arguments that select streams for a video format choice. */
export function videoFormatArgs(f: VideoFormatChoice): string[] {
  const base = videoFilters(f);
  const codec = f.codec !== 'any' ? CODEC_FILTER[f.codec] ?? '' : '';
  const selectors: string[] = [];

  if (f.tvSafe) {
    selectors.push(`bv*${CODEC_FILTER.h264}${base}+ba[acodec~='^(mp4a|aac)']`);
    selectors.push(`b${CODEC_FILTER.h264}${base}`);
  } else if (f.container === 'webm') {
    selectors.push(`bv*[ext=webm]${codec}${base}+ba[ext=webm]`);
  } else if (codec) {
    selectors.push(`bv*${codec}${base}+ba`);
  }
  // Always fall back to the best that fits, then to anything, so a download never fails on selection.
  selectors.push(`bv*${base}+ba`, `b${base}`, 'bv*+ba', 'b');

  const sort = ['res', 'fps'];
  if (f.allowHdr) sort.push('hdr:12');
  if (f.tvSafe || f.container === 'mp4') sort.push('+codec:avc:m4a');
  if (f.maxHeight) sort[0] = `res:${f.maxHeight}`;

  return ['-f', selectors.join('/'), '-S', sort.join(','), '--merge-output-format', f.container, '--remux-video', f.container];
}

/** yt-dlp arguments for an audio format choice. */
export function audioFormatArgs(f: AudioFormatChoice): string[] {
  const args = ['-f', 'ba/b', '-S', 'acodec,abr,asr', '-x'];
  if (f.target !== 'original') {
    args.push('--audio-format', f.target);
    if (f.target === 'mp3' || f.target === 'm4a' || f.target === 'opus') {
      args.push('--audio-quality', `${f.bitrateKbps ?? (f.target === 'mp3' ? 320 : 256)}K`);
    }
  }
  return args;
}

/** Crop YouTube Music's 16:9 thumbnails to the square album art music players expect. */
export const SQUARE_ARTWORK_PPA =
  "ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -qmin 1 -qscale:v 1 -vf crop=\"'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'\"";

export interface RequestContext {
  /** Extra HTTP headers, e.g. Referer/Origin captured by the browser extension. */
  headers: Record<string, string>;
  userAgent: string;
  proxy: string;
  forceIpv4: boolean;
  cookies: { browser?: string; file?: string };
}

export interface BuildArgsInput {
  url: string;
  /** File with one URL/search per line; used instead of url for matched playlists (e.g. Spotify). */
  batchFile?: string;
  options: DownloadOptions;
  outputDir: string;
  tempDir: string;
  outputTemplate: string;
  ffmpegDir: string;
  jsRuntime: string | null;
  archiveFile: string | null;
  isPlaylist: boolean;
  request: RequestContext;
  speedLimitKbps: number;
  retries: number;
  concurrentFragments: number;
  sponsorBlock: 'off' | 'mark' | 'remove';
  sponsorCategories: string[];
  embedThumbnail: boolean;
  squareMusicArtwork: boolean;
  includeAutoSubs: boolean;
  windowsFilenames: boolean;
  extraArgs: string[];
}

/** Network and identity options shared by inspect and download runs. */
export function requestArgs(r: RequestContext): string[] {
  const args: string[] = [];
  if (r.proxy) args.push('--proxy', r.proxy);
  if (r.forceIpv4) args.push('--force-ipv4');
  if (r.userAgent) args.push('--user-agent', r.userAgent);
  for (const [name, value] of Object.entries(r.headers)) {
    // Header values come from the browser; refuse anything that could smuggle a second header or option.
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || /[\r\n]/.test(value)) continue;
    args.push('--add-headers', `${name}:${value}`);
  }
  if (r.cookies.file) args.push('--cookies', r.cookies.file);
  else if (r.cookies.browser) args.push('--cookies-from-browser', r.cookies.browser);
  return args;
}

export function buildDownloadArgs(i: BuildArgsInput): string[] {
  const o = i.options;
  const args: string[] = [
    '--newline', '--progress', '--quiet', '--no-warnings', '--ignore-config',
    '--progress-template', `download:${PROGRESS_PREFIX}%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s`,
    '--progress-template', `postprocess:${POSTPROCESS_PREFIX}%(progress.status)s|%(progress.postprocessor)s`,
    '--print', `before_dl:${ITEM_PREFIX}%(playlist_index)s|%(n_entries)s|%(title)s`,
    '--print', `after_move:${FILE_PREFIX}%(filepath)s`,
    '-P', i.outputDir, '-P', `temp:${i.tempDir}`, '-o', i.outputTemplate,
    '--ffmpeg-location', i.ffmpegDir,
    '--continue',
    '--retries', String(i.retries), '--fragment-retries', String(i.retries),
    '--concurrent-fragments', String(i.concurrentFragments),
  ];

  if (i.jsRuntime) args.push('--js-runtimes', i.jsRuntime);
  if (i.windowsFilenames) args.push('--windows-filenames');
  if (i.speedLimitKbps > 0) args.push('--limit-rate', `${i.speedLimitKbps}K`);
  args.push(...requestArgs(i.request));
  if (i.archiveFile) args.push('--download-archive', i.archiveFile);

  if (i.isPlaylist) {
    args.push('--yes-playlist');
    if (o.playlistItems.length) args.push('--playlist-items', o.playlistItems.join(','));
  } else {
    args.push('--no-playlist');
  }

  args.push(...(o.format.kind === 'video' ? videoFormatArgs(o.format) : audioFormatArgs(o.format)));

  if (o.embedMetadata) {
    args.push('--embed-metadata');
    if (o.format.kind === 'video') args.push('--embed-chapters');
  }
  if (i.embedThumbnail) {
    args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
    if (o.format.kind === 'audio' && i.squareMusicArtwork) args.push('--postprocessor-args', SQUARE_ARTWORK_PPA);
  }

  // Subtitles are written as sidecar .srt files; embedding or burning happens in Lumina's
  // own post-processing so fetched and Whisper-generated subtitles are handled the same way.
  if (o.englishSubtitles && o.format.kind === 'video') {
    // Only genuine English tracks: 'en.*' also matches auto-translations like 'en-de', which YouTube rate-limits.
    // --ignore-errors keeps a subtitle failure from failing the video; Lumina generates subtitles instead.
    args.push('--write-subs');
    if (i.includeAutoSubs) args.push('--write-auto-subs');
    args.push('--sub-langs', ENGLISH_SUB_LANGS, '--sub-format', 'srt/vtt/best', '--convert-subs', 'srt', '--ignore-errors');
  }

  if (o.sponsorBlock && i.sponsorBlock !== 'off' && i.sponsorCategories.length) {
    args.push(i.sponsorBlock === 'remove' ? '--sponsorblock-remove' : '--sponsorblock-mark', i.sponsorCategories.join(','));
  }

  args.push(...i.extraArgs);

  if (i.batchFile) args.push('--batch-file', i.batchFile);
  else args.push('--', i.url);
  return args;
}

export type MusicLayout = 'flat' | 'artist' | 'artist-album';
export type VideoLayout = 'flat' | 'channel';

/** Output template for a job relative to its output dir. */
export function outputTemplate(
  options: DownloadOptions, isPlaylist: boolean, numbering: boolean, base: string,
  layout: { music: MusicLayout; video: VideoLayout } = { music: 'flat', video: 'flat' },
): string {
  if (options.contentType === 'series' && options.series) {
    const season = String(options.series.season).padStart(2, '0');
    const show = options.series.show.replace(/[\\/:*?"<>|%]/g, '_');
    return `${show}/Season ${season}/${show} - S${season}E%(playlist_index|autonumber)02d - %(title)s.%(ext)s`;
  }
  if (isPlaylist) {
    return `%(playlist_title|Playlist)s/${numbering ? '%(playlist_index)02d - ' : ''}${base}.%(ext)s`;
  }
  let folder = '';
  if (options.contentType === 'music') {
    if (layout.music !== 'flat') folder += '%(artist,creator,uploader|Unknown Artist)s/';
    if (layout.music === 'artist-album') folder += '%(album|Singles)s/';
  } else if (layout.video === 'channel') {
    folder = '%(channel,uploader|Unknown Channel)s/';
  }
  return `${folder}${base}.%(ext)s`;
}

/** Fill a filename template with sample values so settings can show a live preview. */
export function previewTemplate(template: string, sample: Record<string, string | number>): string {
  return template.replace(/%\(([^)]+)\)(\d*)([sd])/g, (_m, expr: string, pad: string, type: string) => {
    const [fields = '', fallback = ''] = expr.split('|');
    const value = fields.split(',').map((f) => sample[f.trim()]).find((v) => v !== undefined && v !== '') ?? fallback;
    return type === 'd' && pad ? String(value).padStart(Number(pad.replace(/^0/, '')) || 0, '0') : String(value);
  });
}
