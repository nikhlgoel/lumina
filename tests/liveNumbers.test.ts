import { describe, it, expect } from 'vitest';
import { coarseSpeed, formatSpeed } from '@core/format';
import { overallPercent } from '@core/jobGroups';
import { etaFromSpeed, smoothSpeed } from '@core/progress';

describe('the speed shown in the sidebar', () => {
  it('never reads as nothing while a download is moving', () => {
    // The old 10 KB/s step turned anything under 5 KB/s into "—".
    for (const bps of [1, 300, 2_000, 4_999, 5_000]) {
      expect(coarseSpeed(bps), `${bps} B/s`).toBeGreaterThan(0);
      expect(formatSpeed(coarseSpeed(bps)), `${bps} B/s`).not.toBe('—');
    }
  });

  it('is zero only when nothing is moving', () => {
    expect(coarseSpeed(0)).toBe(0);
    expect(coarseSpeed(-5)).toBe(0);
    expect(coarseSpeed(Number.NaN)).toBe(0);
  });

  it('steps coarsely when fast, so the label does not redraw on every few bytes', () => {
    expect(coarseSpeed(12_345_678)).toBe(Math.round(12_345_678 / 102_400) * 102_400);
    expect(coarseSpeed(12_345_678)).toBe(coarseSpeed(12_345_900));
  });
});

describe('one progress figure for the taskbar', () => {
  it('weights by bytes when every size is known, not by averaging percentages', () => {
    const tiny = { percent: 100, downloadedBytes: 1_000, totalBytes: 1_000 };
    const huge = { percent: 1, downloadedBytes: 500_000_000, totalBytes: 50_000_000_000 };
    expect(overallPercent([tiny, huge])).toBeCloseTo(1, 1);
    // The old calculation:
    expect((tiny.percent + huge.percent) / 2).toBe(50.5);
  });

  it('falls back to the average when a size is unknown, and never leaves 0..100', () => {
    const sized = { percent: 50, downloadedBytes: 50, totalBytes: 100 };
    const unknown = { percent: 20, downloadedBytes: 7_000, totalBytes: null };
    expect(overallPercent([sized, unknown])).toBe(35);
    expect(overallPercent([{ percent: 250, downloadedBytes: null, totalBytes: null }])).toBe(100);
    expect(overallPercent([{ percent: -4, downloadedBytes: null, totalBytes: null }])).toBe(0);
  });

  it('uses the percent when the byte count is missing but the size is known, and is 0 for nothing', () => {
    expect(overallPercent([{ percent: 40, downloadedBytes: null, totalBytes: 1_000 }])).toBe(40);
    expect(overallPercent([])).toBe(0);
  });

  it('does not count more than the whole file', () => {
    expect(overallPercent([{ percent: 100, downloadedBytes: 5_000, totalBytes: 1_000 }])).toBe(100);
  });
});

describe('the time left', () => {
  it('does not swing with every burst: the average moves a quarter of the way each time', () => {
    let avg = smoothSpeed(null, 1_000_000);
    expect(avg).toBe(1_000_000);
    avg = smoothSpeed(avg, 5_000_000);
    expect(avg).toBe(2_000_000);
    avg = smoothSpeed(avg, 1_000_000);
    expect(avg).toBe(1_750_000);
  });

  it('has no average, and so no ETA, once the transfer stops', () => {
    expect(smoothSpeed(2_000_000, 0)).toBeNull();
    expect(smoothSpeed(2_000_000, null)).toBeNull();
    expect(etaFromSpeed(10_000_000, null)).toBeNull();
  });

  it('divides what is left by the average, and refuses nonsense', () => {
    expect(etaFromSpeed(10_000_000, 2_000_000)).toBe(5);
    expect(etaFromSpeed(-1, 2_000_000)).toBeNull();
    expect(etaFromSpeed(1_000, 0)).toBeNull();
  });

  it('is steadier than the raw speed over a run of bursts', () => {
    const samples = [8, 1, 9, 1, 8, 2, 9, 1, 8, 2].map((m) => m * 1_000_000);
    const remaining = 600_000_000;
    let avg: number | null = null;
    const smooth: number[] = [];
    const raw: number[] = [];
    for (const s of samples) {
      avg = smoothSpeed(avg, s);
      smooth.push(etaFromSpeed(remaining, avg)!);
      raw.push(etaFromSpeed(remaining, s)!);
    }
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(spread(smooth.slice(3))).toBeLessThan(spread(raw.slice(3)) / 2);
  });
});
