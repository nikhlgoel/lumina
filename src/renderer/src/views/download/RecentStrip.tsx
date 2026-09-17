import { ArrowRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '@/stores/app';
import { useJobs } from '@/stores/jobs';
import { JobRow } from '@/views/queue/JobRow';

export function RecentStrip() {
  const ids = useJobs(useShallow((s) => s.order.slice(0, 3)));
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
        {ids.map((id) => <JobRow key={id} id={id} compact />)}
      </div>
    </section>
  );
}
