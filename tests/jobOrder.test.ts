import { describe, it, expect } from 'vitest';
import type { Job } from '@shared/types';
import { queuePosition } from '@core/jobOrder';

const job = (id: string, status: Job['status'], createdAt: number, engine: Job['engine'] = 'aria2'): Job =>
  ({ id, status, createdAt, engine } as Job);

const map = (...jobs: Job[]): Record<string, Job> => Object.fromEntries(jobs.map((j) => [j.id, j]));

describe('queuePosition', () => {
  it('numbers queued jobs oldest-first, matching the scheduler start order', () => {
    const byId = map(
      job('a', 'queued', 100),
      job('b', 'queued', 200),
      job('c', 'queued', 300),
    );
    expect(queuePosition(byId, 'a')).toBe(1);
    expect(queuePosition(byId, 'b')).toBe(2);
    expect(queuePosition(byId, 'c')).toBe(3);
  });

  it('returns 0 for jobs that are not queued', () => {
    const byId = map(job('r', 'running', 100), job('q', 'queued', 200));
    expect(queuePosition(byId, 'r')).toBe(0);
    expect(queuePosition(byId, 'q')).toBe(1); // running job ahead does not take a queue slot number
  });

  it('counts each engine as its own line (downloads vs conversions run in separate pools)', () => {
    const byId = map(
      job('d1', 'queued', 100, 'aria2'),
      job('d2', 'queued', 200, 'aria2'),
      job('c1', 'queued', 150, 'convert'),
    );
    expect(queuePosition(byId, 'd2')).toBe(2);
    expect(queuePosition(byId, 'c1')).toBe(1);
  });

  it('returns 0 for an unknown id', () => {
    expect(queuePosition(map(job('a', 'queued', 100)), 'missing')).toBe(0);
  });
});
