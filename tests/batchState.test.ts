import { describe, expect, it } from 'vitest';
import { batchStateOf, batchSummary } from '@core/batchState';
import type { Job } from '@shared/types';

const job = (status: Job['status'], release: string | null, extra: Partial<Job['progress']> = {}, engine: Job['engine'] = 'aria2') =>
  ({ status, engine, title: 'f', progress: { activity: null, ...extra }, options: { release: release ? { id: release, title: 'My batch' } : undefined } }) as unknown as Job;

describe('whether a finished download was the last of its batch', () => {
  it('is nothing for a download on its own, or alone in its release', () => {
    const alone = job('completed', null);
    expect(batchStateOf(alone, [alone])).toBeNull();
    const one = job('completed', 'r');
    expect(batchStateOf(one, [one])).toBeNull();
  });

  it('counts only the files of its own batch', () => {
    const a = job('completed', 'r');
    const all = [a, job('queued', 'r'), job('running', 'other'), job('completed', null)];
    expect(batchStateOf(a, all)).toMatchObject({ total: 2, completed: 1, pending: 1, failed: 0, title: 'My batch' });
  });

  it('keeps waiting while files are queued, running, unpacking or paused, or a failed one is waiting for the network', () => {
    const a = job('completed', 'r');
    for (const other of [job('queued', 'r'), job('running', 'r'), job('processing', 'r'), job('paused', 'r'), job('failed', 'r', { activity: 'waiting' })]) {
      const state = batchStateOf(a, [a, other])!;
      expect(state.pending, other.status).toBe(1);
      expect(batchSummary(state)).toBeNull();
    }
  });

  it('speaks once when the last file ends, saying how it came out', () => {
    const done = (n: number) => Array.from({ length: n }, () => job('completed', 'r'));
    const all = [...done(12)];
    expect(batchSummary(batchStateOf(all[0]!, all)!)).toEqual({ text: '12 files downloaded', ok: true });
    const mixed = [...done(9), job('failed', 'r'), job('failed', 'r'), job('failed', 'r')];
    expect(batchSummary(batchStateOf(mixed[0]!, mixed)!)).toEqual({ text: '9 of 12 files downloaded, 3 did not', ok: false });
    const none = [job('failed', 'r'), job('failed', 'r')];
    expect(batchSummary(batchStateOf(none[0]!, none)!)).toEqual({ text: 'None of the 2 files could be downloaded', ok: false });
  });

  it('does not count the unpack job as one of the files, and does not announce it as a batch', () => {
    const parts = [job('completed', 'r'), job('completed', 'r')];
    const unpack = job('running', 'r', {}, 'extract');
    expect(batchSummary(batchStateOf(parts[0]!, [...parts, unpack])!)).toEqual({ text: '2 files downloaded', ok: true });
    expect(batchStateOf(unpack, [...parts, unpack])).toBeNull();
  });

  it('leaves out files the person cancelled, and waits for a failed file whose retry is on a timer', () => {
    const a = job('completed', 'r');
    const all = [a, job('completed', 'r'), job('cancelled', 'r'), job('cancelled', 'r')];
    expect(batchSummary(batchStateOf(a, all)!)).toEqual({ text: '2 files downloaded', ok: true });
    const retrying = [a, job('failed', 'r', { stage: 'Retrying in 30 s' })];
    expect(batchSummary(batchStateOf(a, retrying)!)).toBeNull();
    const gaveUp = [a, job('failed', 'r', { stage: 'Failed' })];
    expect(batchSummary(batchStateOf(a, gaveUp)!)).toEqual({ text: '1 of 2 files downloaded, 1 did not', ok: false });
  });
});
