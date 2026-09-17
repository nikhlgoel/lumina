import type { Job } from '@shared/types';

/**
 * 1-based place of a queued job in the waiting line — the order the engine will start them in
 * (same engine, oldest first, matching the main-process scheduler in {@link file://./../main/jobs/queue.ts}).
 * Returns 0 when the job isn't queued. A queued job auto-starts the moment a download slot frees,
 * so this doubles as a live "starts next" hint for the UI.
 */
export function queuePosition(byId: Record<string, Job>, id: string): number {
  const job = byId[id];
  if (!job || job.status !== 'queued') return 0;
  let ahead = 0;
  for (const other of Object.values(byId)) {
    if (other.status === 'queued' && other.engine === job.engine && other.createdAt < job.createdAt) ahead++;
  }
  return ahead + 1;
}
