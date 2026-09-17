export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** "1 song", "3 songs". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function formatSpeed(bps: number | null | undefined): string {
  return bps && bps > 0 ? `${formatBytes(bps)}/s` : '—';
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
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
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
