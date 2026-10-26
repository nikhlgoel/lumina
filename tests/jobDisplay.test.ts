import { describe, it, expect } from 'vitest';
import type { Job, JobProgress } from '@shared/types';
import { connectionsLabel, finishedSummary, formatTook, pausedWord, rowChip, rowDetail } from '@core/jobDisplay';

const progress = (p: Partial<JobProgress> = {}): JobProgress => ({
  percent: 0, speedBps: null, etaSec: null, downloadedBytes: null, totalBytes: null, stage: 'Downloading', ...p,
});
const job = (status: Job['status'], p: Partial<JobProgress> = {}, engine: Job['engine'] = 'aria2', summary: Job['summary'] = null) =>
  ({ status, engine, progress: progress(p), summary });

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('a download whose server never announces its size (mockup case 1)', () => {
  const j = job('running', { downloadedBytes: 28.4 * MB, speedBps: 2 * MB, connections: 16 });

  it('shows the bytes received instead of a false 0%, and says why', () => {
    const d = rowDetail(j, 0, false);
    expect(d.right).toEqual({ text: '28.4 MB', muted: false });
    expect(d.meta).toEqual(['2.0 MB/s', 'size not announced']);
  });

  it('loops the bar instead of leaving it at 0%', () => {
    expect(rowDetail(j, 0, false).indeterminate).toBe(true);
  });

  it('has a "16 connections" chip', () => {
    expect(rowDetail(j, 0, false).chip).toEqual({ label: '16 connections', tone: 'neutral' });
  });

  it('shows no number at all before the first byte arrives', () => {
    const d = rowDetail(job('running', {}), 0, false);
    expect(d.right).toBeNull();
    expect(d.indeterminate).toBe(true);
  });
});

describe('a download whose size is known', () => {
  it('keeps the percentage, the speed, the time left and the bytes, as before', () => {
    const d = rowDetail(job('running', { percent: 41.6, downloadedBytes: 400 * MB, totalBytes: 960 * MB, speedBps: 6.2 * MB, etaSec: 90 }), 41.6, false);
    expect(d.right).toEqual({ text: '41%', muted: false });
    expect(d.meta).toEqual(['6.2 MB/s', '1m 30s left', '400 MB of 960 MB']);
    expect(d.indeterminate).toBe(false);
  });

  it('labels the byte counts of a playlist as belonging to the file in hand', () => {
    const d = rowDetail(job('running', { percent: 12, downloadedBytes: 3 * MB, totalBytes: 30 * MB, item: { index: 5, count: 40, title: 'x' } }), 10, true);
    expect(d.meta).toEqual(['5 of 40', 'this file 3.0 MB of 30.0 MB']);
    expect(d.right?.text).toBe('10%');
  });

  it('does not call a yt-dlp download of unknown size "unannounced" once its percentage moves', () => {
    const d = rowDetail(job('running', { percent: 33 }, 'ytdlp'), 33, false);
    expect(d.meta).toEqual([]);
    expect(d.right).toEqual({ text: '33%', muted: false });
    expect(d.indeterminate).toBe(false);
  });
});

describe('a paused download (mockup case 2)', () => {
  it('says where it stopped and how much is left, with the percentage in muted type', () => {
    const d = rowDetail(job('paused', { percent: 62, downloadedBytes: 1.2 * GB, totalBytes: 1.9 * GB }), 62, false);
    expect(d.meta).toEqual(['1.2 GB of 1.9 GB']);
    expect(d.right).toEqual({ text: '62%', muted: true });
    expect(d.indeterminate).toBe(false);
  });

  it('says what it has when the size is unknown, and nothing when nothing was received', () => {
    expect(rowDetail(job('paused', { downloadedBytes: 5 * MB }), 0, false).meta).toEqual(['5.0 MB downloaded']);
    const none = rowDetail(job('paused', {}), 0, false);
    expect(none.meta).toEqual([]);
    expect(none.right).toBeNull();
  });

  it('does not put one file’s bytes on a whole playlist', () => {
    const d = rowDetail(job('paused', { percent: 30, downloadedBytes: 3 * MB, totalBytes: 30 * MB, item: { index: 3, count: 10, title: 'x' } }), 30, true);
    expect(d.meta).toEqual([]);
    expect(d.right?.text).toBe('30%');
  });

  it('keeps "Paused when Lumina closed", and otherwise says "Paused"', () => {
    expect(pausedWord('Paused when Lumina closed')).toBe('Paused when Lumina closed');
    expect(pausedWord('16 connections')).toBe('Paused');
    expect(pausedWord('')).toBe('Paused');
  });
});

describe('a finished download (mockup case 3)', () => {
  it('says the size, the time taken and the average speed', () => {
    const d = rowDetail(job('completed', {}, 'aria2', { bytes: 1.9 * GB, tookMs: 125_000 }), 100, false);
    expect(d.meta).toEqual(['1.9 GB', '2 min 05 s', '15.6 MB/s average']);
    expect(d.right).toBeNull();
  });

  it('leaves out what it does not know', () => {
    expect(rowDetail(job('completed', {}, 'ytdlp', { bytes: null, tookMs: 45_000 }), 100, false).meta).toEqual(['45 s']);
    expect(rowDetail(job('completed', {}, 'ytdlp', { bytes: 3 * MB, tookMs: 800 }), 100, false).meta).toEqual(['3.0 MB']);
    expect(rowDetail(job('completed', {}, 'aria2', null), 100, false).meta).toEqual([]);
  });

  it('gives no average for a download that took under two seconds, which would be a wild figure', () => {
    expect(rowDetail(job('completed', {}, 'aria2', { bytes: 50 * MB, tookMs: 1500 }), 100, false).meta).toEqual(['50.0 MB', '2 s']);
  });

  it('adds nothing to a conversion, an unpack or a subtitle job', () => {
    for (const engine of ['convert', 'extract', 'subtitles'] as const) {
      expect(rowDetail(job('completed', {}, engine, { bytes: 5 * MB, tookMs: 60_000 }), 100, false).meta, engine).toEqual([]);
    }
  });

  it('writes a time the way the mockup does', () => {
    expect([30_000, 125_000, 3_725_000, 59_600].map(formatTook)).toEqual(['30 s', '2 min 05 s', '1 h 02 min', '1 min 00 s']);
    expect(formatTook(999)).toBeNull();
    expect(formatTook(null)).toBeNull();
    expect(formatTook(Number.NaN)).toBeNull();
  });

  it('stores a summary only from sensible numbers', () => {
    expect(finishedSummary(1.9 * GB, 125_000)).toEqual({ bytes: 1.9 * GB, tookMs: 125_000 });
    expect(finishedSummary(0, 5000)).toEqual({ bytes: null, tookMs: 5000 });
    expect(finishedSummary(100, Number.NaN)).toEqual({ bytes: 100, tookMs: null });
    expect(finishedSummary(Number.NaN, -3)).toEqual({ bytes: null, tookMs: null });
  });
});

describe('the status chips (mockup case 4)', () => {
  it('shows the number of open connections while a download is running, singular for one', () => {
    expect(rowChip(job('running', { connections: 16 }))).toEqual({ label: '16 connections', tone: 'neutral' });
    expect(connectionsLabel(1)).toBe('1 connection');
  });

  it('says when the engine has gone quiet saving a block, which is not a warning', () => {
    expect(rowChip(job('running', { connections: 16, activity: 'writing' }))).toEqual({ label: 'Writing to disk', tone: 'neutral' });
  });

  it('warns, in the warning tone, while it reconnects or waits for the network', () => {
    expect(rowChip(job('running', { activity: 'reconnecting' }))).toEqual({ label: 'Reconnecting', tone: 'warning' });
    // A dropped connection is a failed attempt, and the chip must still show on that failed row.
    expect(rowChip(job('failed', { activity: 'waiting' }))).toEqual({ label: 'Waiting for network', tone: 'warning' });
  });

  it('shows only one chip, the most important, and none when nothing is going on', () => {
    expect(rowChip(job('running', { connections: 8, activity: 'waiting' }))?.label).toBe('Waiting for network');
    expect(rowChip(job('running', { connections: 8, activity: 'reconnecting' }))?.label).toBe('Reconnecting');
    expect(rowChip(job('running', {}))).toBeNull();
    expect(rowChip(job('paused', { connections: 16 }))).toBeNull();
    expect(rowChip(job('completed', { connections: 16 }))).toBeNull();
    expect(rowChip(job('queued', { activity: 'reconnecting' }))).toBeNull();
  });

  it('does not show a stale connection count once the job is only post-processing', () => {
    expect(rowChip(job('processing', { connections: 16 }))).toBeNull();
    expect(rowChip(job('processing', { activity: 'writing' }))?.label).toBe('Writing to disk');
  });
});
