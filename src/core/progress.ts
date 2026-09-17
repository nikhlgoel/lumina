import { FILE_PREFIX, ITEM_PREFIX, POSTPROCESS_PREFIX, PROGRESS_PREFIX } from './ytdlpArgs';

export type YtdlpEvent =
  | { type: 'progress'; status: string; downloaded: number | null; total: number | null; speed: number | null; eta: number | null; fragment: [number, number] | null }
  | { type: 'postprocess'; status: string; name: string }
  | { type: 'item'; index: number | null; count: number | null; title: string }
  | { type: 'file'; path: string }
  | { type: 'error'; message: string };

const num = (v: string | undefined): number | null => {
  if (v == null || v === '' || v === 'NA' || v === 'None') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Parse one stdout/stderr line from a yt-dlp process started with buildDownloadArgs. */
export function parseYtdlpLine(line: string): YtdlpEvent | null {
  const text = line.trim();
  if (!text) return null;
  if (text.startsWith(PROGRESS_PREFIX)) {
    const [status = '', dl, total, estimate, speed, eta, fi, fc] = text.slice(PROGRESS_PREFIX.length).split('|');
    const fragIndex = num(fi);
    const fragCount = num(fc);
    return {
      type: 'progress', status, downloaded: num(dl), total: num(total) ?? num(estimate), speed: num(speed), eta: num(eta),
      fragment: fragIndex != null && fragCount ? [fragIndex, fragCount] : null,
    };
  }
  if (text.startsWith(POSTPROCESS_PREFIX)) {
    const [status = '', name = ''] = text.slice(POSTPROCESS_PREFIX.length).split('|');
    return { type: 'postprocess', status, name };
  }
  if (text.startsWith(ITEM_PREFIX)) {
    const [index, count, ...title] = text.slice(ITEM_PREFIX.length).split('|');
    return { type: 'item', index: num(index), count: num(count), title: title.join('|') };
  }
  if (text.startsWith(FILE_PREFIX)) {
    return { type: 'file', path: text.slice(FILE_PREFIX.length) };
  }
  if (text.startsWith('ERROR:')) {
    return { type: 'error', message: text.slice(6).trim() };
  }
  return null;
}

const POSTPROCESSOR_LABELS: Record<string, string> = {
  Merger: 'Merging video and audio',
  FFmpegMerger: 'Merging video and audio',
  FFmpegExtractAudio: 'Extracting audio',
  FFmpegVideoRemuxer: 'Remuxing',
  FFmpegVideoConvertor: 'Converting',
  FFmpegMetadata: 'Writing metadata',
  EmbedThumbnail: 'Embedding artwork',
  FFmpegThumbnailsConvertor: 'Preparing artwork',
  FFmpegSubtitlesConvertor: 'Converting subtitles',
  FFmpegEmbedSubtitle: 'Embedding subtitles',
  SponsorBlock: 'Checking SponsorBlock',
  ModifyChapters: 'Removing sponsor segments',
  MoveFiles: 'Moving files',
};

export const postprocessLabel = (name: string) => POSTPROCESSOR_LABELS[name] ?? 'Processing';

/** True when yt-dlp failed because it couldn't read a browser's cookie store (locked or encrypted). */
export function isCookieReadError(message: string): boolean {
  const m = message.toLowerCase();
  return (m.includes('cookie') && (m.includes('could not copy') || m.includes('database') || m.includes('decrypt') || m.includes('dpapi') || m.includes('app-bound') || m.includes('keyring')))
    || m.includes('failed to decrypt with dpapi');
}

/** Make yt-dlp's error text readable for people. */
export function friendlyYtdlpError(message: string): string {
  const m = message.toLowerCase();
  if (isCookieReadError(message)) return 'Lumina couldn’t read your browser’s sign-in cookies (the browser locks them while it’s open). Sign in inside Lumina under Settings › Accounts instead.';
  if (m.includes('sign in to confirm') || m.includes('not a bot')) return 'YouTube wants a sign-in check. Sign in under Settings › Accounts and try again.';
  if (m.includes('drm')) return 'This media is protected by DRM, so it can’t be downloaded.';
  if (m.includes('private video') || m.includes('private playlist')) return 'This is private. Sign in with the account that can see it under Settings › Accounts.';
  if (m.includes('members-only') || m.includes('join this channel')) return 'This video is for channel members only. Sign in with a member account under Settings › Accounts.';
  if (m.includes('age') && m.includes('restrict')) return 'This video is age-restricted. Sign in under Settings › Accounts to download it.';
  if (m.includes('premieres in') || m.includes('live event will begin')) return 'This hasn’t started yet. Try again once it’s live or finished.';
  if (m.includes('not available in your country') || m.includes('geo restrict')) return 'This isn’t available in your region. A proxy under Settings › Network may help.';
  if (m.includes('video unavailable')) return 'This video is unavailable.';
  if (m.includes('requested format is not available')) return 'The chosen quality isn’t offered for this item. Pick another format and try again.';
  if (m.includes('unsupported url')) return 'Lumina doesn’t recognise media on this page. Play it in your browser with the Lumina extension installed and it will catch the stream.';
  if (m.includes('http error 404')) return 'The file wasn’t found on the server (404). The link may have expired.';
  if (m.includes('http error 403')) return 'The server refused the download (403). Links that came from a browser may need the Lumina extension so the right headers are sent.';
  if (m.includes('http error 429') || m.includes('too many requests')) return 'The site is rate-limiting requests. Wait a few minutes and retry.';
  if (m.includes('no space left')) return 'The disk is full.';
  if (m.includes('getaddrinfo') || m.includes('name resolution') || m.includes('network is unreachable')) return 'No internet connection.';
  return message.replace(/^\[[^\]]+\]\s*/, '').replace(/\s*See\s+https?:\/\/\S+\s+for more info\.?/i, '').slice(0, 300);
}

export interface Aria2Status {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalLength: string;
  completedLength: string;
  downloadSpeed: string;
  connections?: string;
  numSeeders?: string;
  errorMessage?: string;
  files?: { path: string }[];
  bittorrent?: { info?: { name?: string } };
  followedBy?: string[];
}

export function aria2Progress(s: Aria2Status) {
  const total = Number(s.totalLength) || null;
  const done = Number(s.completedLength) || 0;
  const speed = Number(s.downloadSpeed) || null;
  return {
    percent: total ? Math.min(100, (done / total) * 100) : 0,
    downloadedBytes: done,
    totalBytes: total,
    speedBps: speed,
    etaSec: total && speed ? Math.round((total - done) / speed) : null,
  };
}
