// The numbers behind the player's "Stats for nerds" panel.
//
// Everything here takes plain values so it can be tested; the panel reads them off the media element.

export interface Range { start: number; end: number }

/**
 * Seconds of media already buffered ahead of `at`. Zero when `at` falls in a gap, which is exactly
 * the situation in which playback is about to stall — so a wrong answer here would hide the very
 * thing the panel exists to show.
 */
export function bufferedAhead(ranges: readonly Range[], at: number): number {
  for (const r of ranges) {
    if (at >= r.start && at <= r.end) return Math.max(0, r.end - at);
  }
  return 0;
}

/** Percentage of frames dropped; 0 when nothing has been shown yet. */
export function droppedPercent(dropped: number, total: number): number {
  if (!(total > 0) || !(dropped > 0)) return 0;
  return Math.min(100, (dropped / total) * 100);
}

export function formatKbps(kbps: number | null | undefined): string {
  if (!kbps || kbps <= 0) return 'unknown';
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`;
}

export function formatResolution(width: number | null | undefined, height: number | null | undefined): string {
  return width && height && width > 0 && height > 0 ? `${width}×${height}` : 'unknown';
}

/** A gain applied by loudness matching or the volume boost, as the decibels a listener would read. */
export function gainDb(linear: number): string {
  if (!(linear > 0)) return '—';
  const db = 20 * Math.log10(linear);
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}
