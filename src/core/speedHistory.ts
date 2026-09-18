// The speed graph behind a torrent's detail page: a fixed-length ring of samples and the SVG path
// that draws them. Pure maths, so the shape of the curve is unit-tested rather than eyeballed.

export interface SpeedSample {
  /** Bytes per second down and up at that moment. */
  down: number;
  up: number;
}

export const HISTORY_LENGTH = 90;

/** Append a sample, keeping at most `limit` — oldest first, newest last. */
export function pushSample(history: SpeedSample[], sample: SpeedSample, limit = HISTORY_LENGTH): SpeedSample[] {
  const next = [...history, { down: Math.max(0, sample.down || 0), up: Math.max(0, sample.up || 0) }];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * A round-ish ceiling for the Y axis so the graph doesn't jitter on every sample: the next 1/2/5
 * step above the peak, with a floor so an idle torrent isn't drawn against a zero-height axis.
 */
export function niceMax(peak: number, floor = 128 * 1024): number {
  // At or below the floor, use the floor itself — rounding the floor up would move the axis for
  // an idle torrent, which is exactly the jitter this function exists to prevent.
  if (!(peak > floor)) return floor;
  const target = peak;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) {
    if (target <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * An SVG polyline path across `width` x `height`, oldest sample at the left. Samples are laid out
 * against `slots` positions so a graph that is still filling up grows from the left instead of
 * stretching. Returns '' when there is nothing to draw.
 */
export function sparklinePath(
  values: number[],
  width: number,
  height: number,
  max: number,
  slots = values.length,
): string {
  if (values.length === 0 || width <= 0 || height <= 0) return '';
  const span = Math.max(1, (slots || values.length) - 1);
  const scale = max > 0 ? max : 1;
  const points = values.map((v, i) => {
    const x = (i / span) * width;
    const y = height - (Math.min(Math.max(v, 0), scale) / scale) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  // A single sample still deserves a visible mark, so draw a flat 1px segment.
  if (points.length === 1) return `M${points[0]} L${points[0]}`;
  return `M${points.join(' L')}`;
}

/** The same path closed down to the baseline, for the soft fill under the line. */
export function sparklineArea(
  values: number[],
  width: number,
  height: number,
  max: number,
  slots = values.length,
): string {
  const line = sparklinePath(values, width, height, max, slots);
  if (!line) return '';
  const span = Math.max(1, (slots || values.length) - 1);
  const lastX = ((values.length - 1) / span) * width;
  const base = height.toFixed(2);
  return `${line} L${lastX.toFixed(2)},${base} L0.00,${base} Z`;
}

/** Upload ÷ download, the number torrent clients call "ratio". null until anything was downloaded. */
export function shareRatio(uploadedBytes: number, downloadedBytes: number): number | null {
  if (!downloadedBytes || downloadedBytes <= 0) return null;
  return uploadedBytes / downloadedBytes;
}
