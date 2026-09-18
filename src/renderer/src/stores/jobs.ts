import { create } from 'zustand';
import type { Job } from '@shared/types';
import { groupJobs, summarizeGroup } from '@core/jobGroups';
import { queuePosition } from '@core/jobOrder';
import { call, errorMessage, on } from '@/lib/bridge';
import { useApp } from './app';

export { queuePosition };

type JobAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove';

interface JobsState {
  byId: Record<string, Job>;
  order: string[];
  init: () => Promise<void>;
  act: (id: string, action: JobAction) => Promise<void>;
  clearFinished: () => Promise<void>;
}

const sortIds = (byId: Record<string, Job>) =>
  Object.values(byId).sort((a, b) => b.createdAt - a.createdAt).map((j) => j.id);

export const useJobs = create<JobsState>((set) => ({
  byId: {},
  order: [],

  init: async () => {
    const list = await call('jobs:list');
    const byId = Object.fromEntries(list.map((j) => [j.id, j]));
    set({ byId, order: sortIds(byId) });

    on('jobs:updated', (job) => set((s) => {
      const isNew = !s.byId[job.id];
      const prev = s.byId[job.id];
      if (prev && prev.status !== 'completed' && job.status === 'completed') {
        useApp.getState().toast(`Downloaded “${job.title}”`, 'success');
      }
      if (prev && prev.status !== 'failed' && job.status === 'failed') {
        useApp.getState().toast(`“${job.title}” failed: ${job.error?.message ?? 'unknown error'}`, 'error');
      }
      const byId = { ...s.byId, [job.id]: job };
      return { byId, order: isNew ? sortIds(byId) : s.order };
    }));

    on('jobs:removed', ({ id }) => set((s) => {
      const { [id]: _removed, ...byId } = s.byId;
      return { byId, order: s.order.filter((x) => x !== id) };
    }));
  },

  act: async (id, action) => {
    try {
      await call(`jobs:${action}`, { id });
    } catch (err) {
      useApp.getState().toast(errorMessage(err), 'error');
    }
  },

  clearFinished: async () => {
    await call('jobs:clear-finished');
  },
}));

export const isActive = (j: Job) => j.status === 'running' || j.status === 'processing';
export const isFinishedStatus = (s: Job['status']) => s === 'completed' || s === 'failed' || s === 'cancelled';
export const isFinished = (j: Job) => isFinishedStatus(j.status);

/** One row of the Queue: either a single job, or a pasted release collapsed into one download. */
export interface QueueRow { key: string; ids: string[] }

/**
 * Selector: the Queue's rows, split into in-progress and finished. Encoded as strings ("key»id,id"
 * joined by "|") so the selector only re-renders the list when its *shape* changes — progress ticks
 * flow straight to the individual rows, as they did before grouping. Ids are UUIDs, so the
 * separators can't collide with them.
 */
export const selectQueueRows = (s: JobsState): { active: string; done: string } => {
  const jobs = s.order.map((id) => s.byId[id]).filter((j): j is Job => Boolean(j));
  const active: string[] = [];
  const done: string[] = [];
  for (const group of groupJobs(jobs)) {
    const members = group.ids.map((id) => s.byId[id]).filter((j): j is Job => Boolean(j));
    const entry = `${group.key}»${group.ids.join(',')}`;
    (isFinishedStatus(summarizeGroup(members).status) ? done : active).push(entry);
  }
  return { active: active.join('|'), done: done.join('|') };
};

/** Selector: the newest `n` Recent rows, grouped the same way — a repack counts as one entry, not n. */
export const selectRecentRows = (n: number) => (s: JobsState): string => {
  const jobs = s.order.map((id) => s.byId[id]).filter((j): j is Job => Boolean(j));
  return groupJobs(jobs).slice(0, n).map((g) => `${g.key}»${g.ids.join(',')}`).join('|');
};

/** Decode what {@link selectQueueRows} encoded. */
export const parseQueueRows = (encoded: string): QueueRow[] =>
  encoded ? encoded.split('|').map((entry) => {
    const [key = '', ids = ''] = entry.split('»');
    return { key, ids: ids.split(',') };
  }) : [];

/** Selector: counts for the sidebar badge. */
export const selectActiveCount = (s: JobsState) =>
  s.order.reduce((n, id) => (s.byId[id] && (isActive(s.byId[id]!) || s.byId[id]!.status === 'queued') ? n + 1 : n), 0);
