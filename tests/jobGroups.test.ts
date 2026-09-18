import { describe, it, expect } from 'vitest';
import type { Job, JobProgress, ReleaseTag } from '@shared/types';
import { groupActionTargets, groupJobs, summarizeGroup } from '@core/jobGroups';

const progress = (p: Partial<JobProgress> = {}): JobProgress =>
  ({ percent: 0, speedBps: null, etaSec: null, downloadedBytes: null, totalBytes: null, stage: '', ...p });

const job = (
  id: string,
  status: Job['status'],
  opts: { release?: Partial<ReleaseTag> & { id: string }; progress?: Partial<JobProgress>; title?: string; engine?: Job['engine'] } = {},
): Job =>
  ({
    id,
    title: opts.title ?? id,
    status,
    engine: opts.engine ?? 'aria2',
    progress: progress(opts.progress),
    options: { release: opts.release ? { title: 'Release', dir: 'd', role: 'archive', unpack: true, deleteArchives: false, ...opts.release } : undefined },
  } as unknown as Job);

const rel = (id: string, extra: Partial<ReleaseTag> = {}) => ({ id, ...extra });

describe('groupJobs', () => {
  it('collapses the parts of one release into a single group', () => {
    const jobs = [
      job('p1', 'running', { release: rel('r1', { set: 's', part: 1, parts: 3 }) }),
      job('p2', 'queued', { release: rel('r1', { set: 's', part: 2, parts: 3 }) }),
      job('p3', 'queued', { release: rel('r1', { set: 's', part: 3, parts: 3 }) }),
    ];
    const groups = groupJobs(jobs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.releaseId).toBe('r1');
    expect(groups[0]!.ids).toEqual(['p1', 'p2', 'p3']);
    expect(groups[0]!.leadId).toBe('p1');
    expect(groups[0]!.title).toBe('Release');
  });

  it('includes the unpack job that the release spawns, so one release is still one row', () => {
    const jobs = [
      job('x', 'running', { engine: 'extract', release: rel('r1') }),
      job('p1', 'completed', { release: rel('r1', { set: 's', part: 1 }) }),
      job('p2', 'completed', { release: rel('r1', { set: 's', part: 2 }) }),
    ];
    const groups = groupJobs(jobs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids).toEqual(['x', 'p1', 'p2']);
  });

  it('leaves standalone jobs alone and keeps the given order', () => {
    const jobs = [
      job('solo1', 'running'),
      job('p1', 'running', { release: rel('r1') }),
      job('solo2', 'completed'),
      job('p2', 'queued', { release: rel('r1') }),
    ];
    const groups = groupJobs(jobs);
    expect(groups.map((g) => g.key)).toEqual(['job:solo1', 'r1', 'job:solo2']);
    expect(groups[1]!.ids).toEqual(['p1', 'p2']);
  });

  it('does not collapse a release that only has one job', () => {
    const groups = groupJobs([job('only', 'running', { release: rel('r1') })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.releaseId).toBeNull();
    expect(groups[0]!.key).toBe('job:only');
  });

  it('separates two different releases', () => {
    const groups = groupJobs([
      job('a1', 'running', { release: rel('r1') }),
      job('b1', 'running', { release: rel('r2') }),
      job('a2', 'queued', { release: rel('r1') }),
      job('b2', 'queued', { release: rel('r2') }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['r1', 'r2']);
    expect(groups[0]!.ids).toEqual(['a1', 'a2']);
    expect(groups[1]!.ids).toEqual(['b1', 'b2']);
  });

  it('returns nothing for no jobs', () => {
    expect(groupJobs([])).toEqual([]);
  });
});

describe('summarizeGroup', () => {
  it('weights progress by bytes, not by part count', () => {
    const s = summarizeGroup([
      job('big', 'running', { progress: { percent: 50, downloadedBytes: 500, totalBytes: 1000 } }),
      job('small', 'queued', { progress: { percent: 0, downloadedBytes: 0, totalBytes: 100 } }),
    ]);
    expect(s.percent).toBeCloseTo((500 / 1100) * 100);
    expect(s.downloadedBytes).toBe(500);
    expect(s.totalBytes).toBe(1100);
  });

  it('falls back to the average percent when a member has no known size', () => {
    const s = summarizeGroup([
      job('a', 'running', { progress: { percent: 60, downloadedBytes: 6, totalBytes: 10 } }),
      job('b', 'running', { progress: { percent: 20 } }),
    ]);
    expect(s.percent).toBe(40);
    expect(s.totalBytes).toBeNull();
    expect(s.downloadedBytes).toBeNull();
  });

  it('counts a completed part as fully done even if its last tick lagged', () => {
    const s = summarizeGroup([
      job('a', 'completed', { progress: { percent: 98, downloadedBytes: 980, totalBytes: 1000 } }),
      job('b', 'completed', { progress: { percent: 100, downloadedBytes: 1000, totalBytes: 1000 } }),
    ]);
    expect(s.percent).toBe(100);
    expect(s.downloadedBytes).toBe(2000);
    expect(s.status).toBe('completed');
  });

  it('adds up the speed of the parts running right now and derives one ETA', () => {
    const s = summarizeGroup([
      job('a', 'running', { progress: { percent: 50, speedBps: 1000, downloadedBytes: 500, totalBytes: 1000 } }),
      job('b', 'running', { progress: { percent: 0, speedBps: 1000, downloadedBytes: 0, totalBytes: 1000 } }),
      job('c', 'completed', { progress: { percent: 100, speedBps: 4000, downloadedBytes: 1000, totalBytes: 1000 } }),
    ]);
    expect(s.speedBps).toBe(2000); // the finished part's stale speed is not counted
    expect(s.etaSec).toBe(Math.round(1500 / 2000));
  });

  it('reports no speed or ETA when nothing is running', () => {
    const s = summarizeGroup([job('a', 'queued', { progress: { totalBytes: 100 } }), job('b', 'paused', { progress: { totalBytes: 100 } })]);
    expect(s.speedBps).toBeNull();
    expect(s.etaSec).toBeNull();
  });

  describe('status rollup', () => {
    it('is running while any part downloads, even with failures behind it', () => {
      expect(summarizeGroup([job('a', 'failed'), job('b', 'running'), job('c', 'completed')]).status).toBe('running');
    });

    it('is queued when parts wait and none are live', () => {
      expect(summarizeGroup([job('a', 'completed'), job('b', 'queued')]).status).toBe('queued');
    });

    it('is paused when the rest are finished and one is held', () => {
      expect(summarizeGroup([job('a', 'completed'), job('b', 'paused')]).status).toBe('paused');
    });

    it('surfaces a failure once nothing is in flight', () => {
      expect(summarizeGroup([job('a', 'completed'), job('b', 'failed'), job('c', 'cancelled')]).status).toBe('failed');
    });

    it('is completed only when every part is', () => {
      const s = summarizeGroup([job('a', 'completed'), job('b', 'completed')]);
      expect(s.status).toBe('completed');
      expect(s.counts).toMatchObject({ total: 2, completed: 2, failed: 0 });
    });

    it('shows the unpack stage rather than the queue once a part is processing', () => {
      expect(summarizeGroup([job('a', 'processing'), job('b', 'queued')]).status).toBe('processing');
      expect(summarizeGroup([job('a', 'processing'), job('b', 'completed')]).status).toBe('processing');
      // ...but a still-downloading part outranks it.
      expect(summarizeGroup([job('a', 'processing'), job('b', 'running')]).status).toBe('running');
    });
  });

  it('handles an empty member list without dividing by zero', () => {
    const s = summarizeGroup([]);
    expect(s.percent).toBe(0);
    expect(s.counts.total).toBe(0);
  });
});

describe('groupActionTargets', () => {
  const members = [
    job('run', 'running'),
    job('q', 'queued'),
    job('pause', 'paused'),
    job('fail', 'failed'),
    job('done', 'completed'),
    job('cancel', 'cancelled'),
  ];

  it('pauses what is live or waiting', () => {
    expect(groupActionTargets(members, 'pause')).toEqual(['run', 'q']);
  });

  it('resumes only what is paused', () => {
    expect(groupActionTargets(members, 'resume')).toEqual(['pause']);
  });

  it('cancels everything unfinished', () => {
    expect(groupActionTargets(members, 'cancel')).toEqual(['run', 'q', 'pause']);
  });

  it('retries what broke or was cancelled', () => {
    expect(groupActionTargets(members, 'retry')).toEqual(['fail', 'cancel']);
  });

  it('removes only finished rows, never a live download', () => {
    expect(groupActionTargets(members, 'remove')).toEqual(['fail', 'done', 'cancel']);
  });
});
