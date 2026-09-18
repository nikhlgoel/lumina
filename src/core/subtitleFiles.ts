// Pick the best sidecar subtitle file for a media file (pure — takes a directory listing, does no I/O).
// The player's subtitle route uses this to find a track regardless of how it was named: yt-dlp writes
// "<name>.en.srt" / "<name>.en-US.srt", some sites hand back ".vtt", and Whisper writes "<name>.en.srt".
// English is preferred and ranked (official > regional > auto/original), then any subtitle sidecar as a fallback.

const SUB_EXT = /\.(srt|vtt)$/i;
const ENGLISH = /\.(en|eng|english)([.-][\w-]+)?\.(srt|vtt)$/i;

function rank(name: string): number {
  if (/\.en\.(srt|vtt)$/i.test(name)) return 0; // plain English
  if (/\.en-(us|gb)\.(srt|vtt)$/i.test(name)) return 1; // common regional
  if (/orig/i.test(name)) return 4; // auto/original transcript — least preferred English
  if (ENGLISH.test(name)) return 2; // other English variant
  return 5; // non-English subtitle sidecar (last resort)
}

/**
 * Choose the subtitle sidecar for `stem` from `files` (the media's folder listing), or null if none.
 * Ties prefer `.srt` (our canonical format) over `.vtt`. Returns the file name, not a full path.
 */
export function pickSubtitleSidecar(stem: string, files: readonly string[]): string | null {
  const prefix = `${stem}.`;
  const candidates = files.filter((f) => f.startsWith(prefix) && SUB_EXT.test(f));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => rank(a) - rank(b) || Number(/\.vtt$/i.test(a)) - Number(/\.vtt$/i.test(b)) || a.localeCompare(b));
  return candidates[0] ?? null;
}
