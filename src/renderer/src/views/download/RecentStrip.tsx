import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { useApp } from '@/stores/app';
import { parseQueueRows, selectRecentRows, useJobs } from '@/stores/jobs';
import { JobRow } from '@/views/queue/JobRow';
import { ReleaseRow } from '@/views/queue/ReleaseRow';

const recentRows = selectRecentRows(3);

export function RecentStrip() {
  const encoded = useJobs(recentRows);
  const rows = useMemo(() => parseQueueRows(encoded), [encoded]);
  const setView = useApp((s) => s.setView);
  return (
    <section className="mt-14 animate-rise" aria-label="Recent downloads">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">Recent</h2>
        <button onClick={() => setView('queue')} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] font-semibold text-ink-3 hover:bg-hover hover:text-ink">
          All downloads <ArrowRight className="size-3.5" />
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-panel">
        {rows.map((row) => (row.ids.length > 1
          ? <ReleaseRow key={row.key} ids={row.ids} compact />
          : <JobRow key={row.key} id={row.ids[0]!} compact />))}
      </div>
    </section>
  );
}
