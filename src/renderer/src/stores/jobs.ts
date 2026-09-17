import { create } from 'zustand';
import type { Job } from '@shared/types';
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
export const isFinished = (j: Job) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled';

/** Selector: counts for the sidebar badge. */
export const selectActiveCount = (s: JobsState) =>
  s.order.reduce((n, id) => (s.byId[id] && (isActive(s.byId[id]!) || s.byId[id]!.status === 'queued') ? n + 1 : n), 0);
