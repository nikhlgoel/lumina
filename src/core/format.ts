export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  // Show whole numbers from 100 up, one decimal below. Decide on the figure as it will be PRINTED:
  // 99.95 prints as "100.0" and 1023.9 rounds to "1024", and a number is not allowed to reach 1024
  // of one unit when it is 1.0 of the next (1,048,500 bytes used to read "1024 KB").
  const shown = (v: number, unit: number) => (unit === 0 || Number(v.toFixed(1)) >= 100 ? Math.round(v) : Number(v.toFixed(1)));
  if (i < units.length - 1 && shown(bytes / 1024 ** i, i) >= 1024) i += 1;
  const n = shown(bytes / 1024 ** i, i);
  return `${i > 0 && n < 100 ? n.toFixed(1) : n} ${units[i]}`;
}

/** "1 song", "3 songs". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function formatSpeed(bps: number | null | undefined): string {
  return bps && bps > 0 ? `${formatBytes(bps)}/s` : '—';
}

/**
 * A speed rounded for a figure that is shown live, so it does not re-render on every few bytes. The step gets finer as the
 * speed gets slower: a fixed 10 KB/s step printed "—" for anything under 5 KB/s, so a slow download that was moving looked
 * dead. Never returns 0 for a download that is moving.
 */
export function coarseSpeed(bps: number): number {
  if (!(bps > 0)) return 0;
  const step = bps < 100 * 1024 ? 1024 : bps < 1024 * 1024 ? 10 * 1024 : 100 * 1024;
  return Math.max(step, Math.round(bps / step) * step);
}

export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec) || totalSec < 0) return '—';
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatEta(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  // Round once, then split: rounding the seconds part on its own printed "2m 60s" for 179.6.
  const total = Math.round(sec);
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  // A download that has all but stopped has an ETA of years; a figure like "277777h" helps nobody.
  if (total >= 30 * 86400) return '> 30 days';
  if (total >= 86400) return `${Math.floor(total / 86400)}d ${Math.floor((total % 86400) / 3600)}h`;
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

/** Human label for a video height, e.g. 2160 → "4K". */
export function resolutionLabel(height: number): string {
  if (height >= 4320) return '8K';
  if (height >= 2880) return '5K';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  return `${height}p`;
}

/** Make a string safe as a single path segment on every OS. */
export function safeFileName(name: string, fallback = 'Untitled'): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 150)
    .trim();
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  if (!cleaned || reserved.test(cleaned)) return fallback;
  return cleaned;
}
