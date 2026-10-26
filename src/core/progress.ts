import { FILE_PREFIX, ITEM_PREFIX, POSTPROCESS_PREFIX, PROGRESS_PREFIX } from './ytdlpArgs';

export type YtdlpEvent =
  | { type: 'progress'; status: string; downloaded: number | null; total: number | null; speed: number | null; eta: number | null; fragment: [number, number] | null }
  | { type: 'aria2'; downloaded: number | null; total: number | null; percent: number | null; speed: number | null; eta: number | null; connections: number }
  | { type: 'postprocess'; status: string; name: string }
  | { type: 'item'; index: number | null; count: number | null; title: string }
  | { type: 'file'; path: string }
  | { type: 'error'; message: string };

const num = (v: string | undefined): number | null => {
  if (v == null || v === '' || v === 'NA' || v === 'None') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const SIZE_UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };

/** aria2 prints sizes as `784KiB`, `2.6MiB`, `0B`. */
const ariaSize = (v: string): number => {
  const m = /^([\d.]+)([KMGT]?i?B)$/.exec(v);
  return m ? Number(m[1]) * (SIZE_UNITS[m[2]!] ?? 1) : 0;
};

/** aria2 prints an ETA as `36s`, `1m5s` or `1h2m3s`. */
const ariaEta = (v: string): number => {
  const m = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0) : 0;
};

const ARIA2_READOUT = /\[#\w+ ([\d.]+[KMGT]?i?B)\/([\d.]+[KMGT]?i?B)(?:\((\d+)%\))? CN:(\d+)(?: DL:([\d.]+[KMGT]?i?B))?(?: ETA:(\w+))?\]/g;

/**
 * aria2's own readout, e.g. `[#be47bb 7.3MiB/29MiB(25%) CN:16 DL:5.1MiB ETA:4s]`.
 *
 * When yt-dlp hands a plain http(s) download to aria2c it stops printing its own progress lines
 * (one `finished` at the very end), so this is the only live figure there is. Several downloads can
 * share a line; their figures add. Sizes are rounded by aria2 to three digits, so the bytes are
 * approximate and the printed percentage is the better fraction.
 */
function parseAria2Readout(text: string): YtdlpEvent | null {
  const rows = [...text.matchAll(ARIA2_READOUT)];
  if (!rows.length) return null;
  let downloaded = 0, total = 0, speed = 0, eta = 0, connections = 0;
  for (const [, done, size, , cn, dl, left] of rows) {
    downloaded += ariaSize(done!);
    total += ariaSize(size!);
    connections += Number(cn);
    speed += dl ? ariaSize(dl) : 0;
    eta = Math.max(eta, left ? ariaEta(left) : 0);
  }
  const printed = rows.length === 1 ? rows[0]![3] : undefined;
  return {
    type: 'aria2',
    downloaded: total ? downloaded : null,
    total: total || null,
    percent: printed != null ? Number(printed) : total ? (100 * downloaded) / total : null,
    speed,
    // aria2 drops the ETA entirely when it cannot estimate one; that is "unknown", not the last value.
    eta: rows.some(([, , , , , , left]) => left) ? eta : null,
    connections,
  };
}

const OWN_LINE_START = new RegExp(`(?=(?:${[PROGRESS_PREFIX, POSTPROCESS_PREFIX, ITEM_PREFIX, FILE_PREFIX].map((p) => p.replace('|', '\\|')).join('|')}))`);

/**
 * Break a line where yt-dlp's own output was glued onto aria2's.
 *
 * aria2 ends its final readout without a newline, so the next thing yt-dlp prints — the stream's
 * `finished`, or the `LUMINA_FILE` path — arrives on the same line. Read as one line it starts with
 * `[#` and the yt-dlp half is lost: a video's audio stream never started, as far as the progress
 * model knew, and the bar fell from 49% to 5%. Seen in the app, never in the shell.
 */
export const splitYtdlpLine = (line: string): string[] => line.split(OWN_LINE_START).filter(Boolean);

/** Parse one stdout/stderr line from a yt-dlp process started with buildDownloadArgs. */
export function parseYtdlpLine(line: string): YtdlpEvent | null {
  const text = line.trim();
  if (!text) return null;
  if (text.startsWith('[#')) return parseAria2Readout(text);
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

/**
 * What `%(progress.postprocessor)s` actually contains.
 *
 * yt-dlp reports a postprocessor by its `pp_key()`, which is the class name with the trailing `PP`
 * removed *and the leading `FFmpeg` removed*: `FFmpegExtractAudioPP` arrives as `ExtractAudio`.
 * Seven of the thirteen names here were written with that prefix still attached, so they matched
 * nothing and every music download said a flat "Processing" where it should have said "Extracting
 * audio". Captured from the bundled binary: `ExtractAudio`, `Metadata`, `MoveFiles`,
 * `ThumbnailsConvertor`, `VideoRemuxer`. A test forbids the prefixed form coming back.
 */
const POSTPROCESSOR_LABELS: Record<string, string> = {
  Merger: 'Merging video and audio',
  ExtractAudio: 'Extracting audio',
  VideoRemuxer: 'Remuxing',
  VideoConvertor: 'Converting',
  Metadata: 'Writing metadata',
  EmbedThumbnail: 'Embedding artwork',
  ThumbnailsConvertor: 'Preparing artwork',
  SubtitlesConvertor: 'Converting subtitles',
  EmbedSubtitle: 'Embedding subtitles',
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
  // Vimeo: "The web client only works when logged-in"; other sites say "login required" or "log in to".
  if (m.includes('only works when logged-in') || m.includes('login required') || m.includes('logged-in') || m.includes('requires login')) return 'This site wants you signed in to see this. Sign in under Settings › Accounts and try again.';
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
  // yt-dlp hands a file to the bundled aria2c for speed, and reports its failure as the bare exit code (seen in the log as
  // "aria2c exited with code 22").
  const external = /aria2c exited with code (\d+)/i.exec(message);
  if (external) return aria2ExitMessage(Number(external[1]));
  const curl = plainCurlError(message);
  if (curl) return curl;
  return tidyYtdlpMessage(message).slice(0, 300);
}

/**
 * yt-dlp's text with its own scaffolding taken off: the "[site]" prefix, the video id it puts in front ("abc123def45: Unable to
 * download webpage"), the "See https://… for more info" pointer, and the "(caused by TransportError(…))" tail that repeats the
 * message in Python's words and used to be cut off mid-sentence in the error card.
 */
export function tidyYtdlpMessage(message: string): string {
  return message
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^[\w-]{6,}:\s+(?=Unable to|Unsupported|Video|This|No video|Sign in|Failed)/, '')
    .replace(/\s*\(caused by [\s\S]*$/i, '')
    .replace(/\s*;?\s*please report this issue on[\s\S]*$/i, '')
    .replace(/\s*See\s+https?:\/\/\S+\s+(?:first\s+)?for more (?:info|details)\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * curl's errors, which yt-dlp prints for sites it fetches through its curl backend, in words a person can act on. "Connection reset"
 * and "timed out" before any page arrives are what a network or ISP block usually looks like (the log of 2026-10-26 had both from the
 * same link), so those say so and point at the proxy setting; the wording keeps "timed out" and "connection … reset", which the retry
 * rules (core/networkRetry) read, so a passing glitch is still waited out.
 */
export function plainCurlError(message: string): string | null {
  const m = /curl: \((\d+)\)/i.exec(message);
  if (!m) return null;
  const code = Number(m[1]);
  const ms = /after (\d+) milliseconds/i.exec(message);
  const afterS = ms ? ` after ${Math.round(Number(ms[1]) / 1000)} s` : '';
  const block = 'If other sites work, this one may be blocked on your network: a proxy or VPN under Settings › Network can get through.';
  switch (code) {
    case 28: return `The site timed out${afterS} without answering. It may be slow or down. ${block}`;
    case 35: case 52: case 55: case 56: return `The connection was reset before the page arrived. ${block} It can also be a passing glitch, so try once more.`;
    case 6: return 'That site’s address couldn’t be looked up. Check the link, your internet connection and your DNS.';
    case 7: return 'The site refused the connection. It may be down, or blocking this network.';
    case 51: case 58: case 60: case 77: case 83: return 'The site’s security certificate couldn’t be verified, so Lumina stopped.';
    default: return `The connection to the site failed (curl error ${code}). Try again, or check Settings › Network.`;
  }
}

/**
 * A write/flush failure rather than a network one — worth retrying with aria2's RAM write cache
 * turned off before giving up, because an over-large cache is the usual cause on a slow stick, a
 * network share, or a nearly-full disk. A genuinely full disk is excluded: no cache size fixes that.
 */
export function isDiskCacheFailure(message?: string): boolean {
  const m = (message ?? '').toLowerCase();
  if (!m) return false;
  if (m.includes('no space') || m.includes('disk full')) return false;
  return m.includes('flush') || m.includes('disk cache') || m.includes('cannot write')
    || m.includes('write to file') || m.includes('file i/o');
}

/** Make aria2's error text readable for people. */
export function friendlyAria2Error(message?: string): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('403')) return 'The server refused the download (403). If this came from a website, download it through the Lumina browser extension.';
  if (m.includes('404')) return 'The file wasn’t found on the server (404). The link may have expired.';
  // Windows says "There is not enough space on the disk." (captured from a real full NTFS volume),
  // POSIX says "No space left on device" / ENOSPC; the old check knew only the second.
  if (m.includes('no space') || m.includes('not enough space') || m.includes('enospc') || m.includes('disk full') || m.includes('disk is full')) return 'The disk is full. Free up space or choose another download folder, then press Retry.';
  if (m.includes('flush') || m.includes('disk cache') || m.includes('cannot write') || m.includes('write to file') || m.includes('file i/o'))
    return 'Couldn’t write to the disk — it may be full or disconnected. Free up space (or pick another folder) and press Retry to resume.';
  // aria2's own wording for a refused or dropped connection, captured from a server that went away.
  if (m.includes('network problem') || m.includes('no connection could be made') || m.includes('actively refused')) return 'The connection to the server was lost.';
  if (m.includes('name resolution') || m.includes('could not resolve')) return 'No internet connection, or the server name is wrong.';
  // aria2 refuses to continue into a file it has no control file for, rather than risk truncating it (seen in the log).
  if (isControlFileMissing(message)) return 'A different file with this name is already in the download folder, so this download was not started over it. Press Retry to save it under a new name.';
  if (m.includes('file already exists') || m.includes('already exists')) return 'A file with this name already exists in the download folder.';
  // "The response status is not successful. status=503": the code is the only useful part.
  const status = /status=(\d{3})/.exec(m);
  if (status) return httpStatusMessage(Number(status[1])) ?? `The server answered with an error (${status[1]}).`;
  return message?.trim() || 'Download stopped unexpectedly.';
}

/** What an HTTP error status means to a person, for the ones aria2 and yt-dlp report as a bare number. */
export function httpStatusMessage(code: number): string | null {
  if (code === 401 || code === 407) return `The server wants a sign-in for this file (${code}).`;
  if (code === 403) return 'The server refused the download (403). If this came from a website, download it through the Lumina browser extension.';
  if (code === 404 || code === 410) return `The file wasn’t found on the server (${code}). The link may have expired.`;
  if (code === 416) return 'The server can’t continue from where this download stopped (416). Press Retry to start it again.';
  if (code === 429) return 'The site is rate-limiting requests (429). Wait a few minutes and retry.';
  if (code >= 500 && code <= 599) return `The server had a problem (${code}). Try again in a little while.`;
  return null;
}

/**
 * What aria2's exit codes mean (its manual, "EXIT STATUS"): the ones a person can understand or act on. The wording keeps
 * the words core/networkRetry looks for ("timed out", "network problem", "name resolution"), so the right ones still wait
 * for the network and the rest are not retried blindly.
 */
const ARIA2_EXIT: Record<number, string> = {
  2: 'The server took too long to answer (timed out).',
  3: 'The file wasn’t found on the server (404). The link may have expired.',
  5: 'The download was too slow and was dropped.',
  6: 'A network problem interrupted the download.',
  8: 'The server can’t resume this download, so it has to start again.',
  9: 'The disk is full. Free up space or choose another download folder, then press Retry.',
  13: 'A file with this name already exists in the download folder.',
  16: 'Couldn’t create the file in the download folder. Check that the folder is writable.',
  17: 'Couldn’t write to the disk — it may be full or disconnected. Free up space (or pick another folder) and press Retry to resume.',
  18: 'Couldn’t create the download folder.',
  19: 'No internet connection, or the server name is wrong (name resolution failed).',
  22: 'The server answered the fast download (several parallel requests) with an unexpected reply.',
  23: 'The link redirects too many times.',
  24: 'The server wants a sign-in for this file.',
  29: 'The server is temporarily overloaded. Try again in a little while.',
};

export function aria2ExitMessage(code: number): string {
  return ARIA2_EXIT[code] ?? `The download engine stopped unexpectedly (code ${code}).`;
}

/**
 * Did yt-dlp's built-in aria2c accelerator fail (as opposed to the download itself)? The same file usually downloads fine
 * over yt-dlp's own single connection, so this is worth one automatic retry without the accelerator.
 */
export const isAcceleratorFailure = (message: string): boolean => /aria2c exited with code \d+/i.test(message);

/** aria2's "File X exists, but a control file(*.aria2) does not exist. Download was canceled in order to prevent your file from being truncated." */
export const isControlFileMissing = (message?: string): boolean => /control file.*does not exist/i.test(message ?? '');

/**
 * Raw errors thrown by the network layer, in words: "fetch failed" and "The operation was aborted due to timeout" were what
 * a failed download said in the log. The wording keeps the keywords core/networkRetry classifies on, so these still count as
 * a lost or slow connection and are waited out. Anything else (already readable, or not a network error) is returned as is.
 */
export function plainFailure(message: string): string {
  const m = message.trim().toLowerCase();
  if (!m) return message;
  if (/aborted due to timeout|^timeouterror|\betimedout\b|\bund_err_(headers|body|connect)_timeout\b/.test(m)) {
    return 'The server took too long to answer (the connection timed out).';
  }
  // The specific codes first: Node's "fetch failed" is only the wrapper, and the code beside it says what actually happened.
  if (/\benotfound\b|\beai_again\b|\bgetaddrinfo\b/.test(m)) return 'No internet connection, or the server name is wrong.';
  if (/\beconnrefused\b/.test(m)) return 'The server refused the connection.';
  if (/^(?:\w*error:?\s+)?(?:fetch failed|terminated)$/.test(m) || /^fetch failed\b/.test(m) || /\beconnreset\b|\bepipe\b|socket hang up|other side closed|\bund_err_socket\b/.test(m)) {
    return 'The connection to the server was interrupted (connection reset).';
  }
  const external = /aria2c exited with code (\d+)/i.exec(message);
  if (external) return aria2ExitMessage(Number(external[1]));
  return message;
}

/**
 * A running average of a download speed, for the ETA. aria2 reports the speed of the last moment, which swings (a burst, then a
 * pause), and the ETA built straight from it flickered between minutes and hours. Each sample moves the average a quarter of the
 * way; a sample of nothing means the transfer has stopped, so there is no average (and no ETA) rather than a stale one.
 */
export function smoothSpeed(previous: number | null, sample: number | null, alpha = 0.25): number | null {
  if (!sample || sample <= 0) return null;
  if (!previous || previous <= 0) return sample;
  return previous * (1 - alpha) + sample * alpha;
}

/** Seconds left at a given speed, or null when it cannot be said. */
export function etaFromSpeed(remainingBytes: number, speedBps: number | null): number | null {
  return speedBps && speedBps > 0 && remainingBytes >= 0 ? Math.round(remainingBytes / speedBps) : null;
}

export interface Aria2Status {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalLength: string;
  completedLength: string;
  downloadSpeed: string;
  connections?: string;
  numSeeders?: string;
  uploadSpeed?: string;
  uploadLength?: string;
  errorMessage?: string;
  files?: { index: string; path: string; length: string; completedLength: string; selected: string }[];
  bittorrent?: { info?: { name?: string } };
  followedBy?: string[];
  infoHash?: string;
}

/**
 * Is this the download of a magnet link's metadata rather than of the files themselves?
 *
 * aria2 runs the two as separate downloads and reports the first with a pseudo-file called
 * "[METADATA]<name>". Its size is the few KB of the .torrent, so it climbs to 100% in a moment and the
 * row read "100%" for a download that had not started (measured). It is not progress on the real thing.
 */
export const isMetadataPhase = (s: Aria2Status): boolean => Boolean(s.files?.some((f) => f.path.startsWith('[METADATA]')));

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

/* ---------- What the person actually sees ---------- */

/**
 * Is there genuinely nothing to show yet?
 *
 * Reserved for the moments before any figure exists — resolving a URL, contacting a tracker. Once a
 * percentage, a byte count or a position in a playlist is known, a real bar is always more honest
 * than a looping one, which reads as "stuck" however fast it slides.
 */
export function progressIndeterminate(p: {
  percent: number;
  downloadedBytes?: number | null;
  item?: { index: number; count: number } | undefined;
}): boolean {
  if (Number.isFinite(p.percent) && p.percent > 0) return false;
  if (p.downloadedBytes != null && p.downloadedBytes > 0) return false;
  return !p.item;
}
