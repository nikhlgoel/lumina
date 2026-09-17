import { useMemo } from 'react';
import { ArrowDownToLine, ListTodo } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '@/stores/app';
import { isFinished, useJobs } from '@/stores/jobs';
import { Button, EmptyState, PageHeader } from '@/components/ui';
import { TitleBar } from '@/components/Shell';
import { JobRow } from './JobRow';

export function QueueView() {
  const groups = useJobs(useShallow((s) => {
    const active: string[] = [];
    const done: string[] = [];
    for (const id of s.order) {
      const j = s.byId[id];
      if (!j) continue;
      (isFinished(j) ? done : active).push(id);
    }
    return { active: active.join('|'), done: done.join('|') };
  }));
  const clearFinished = useJobs((s) => s.clearFinished);
  const setView = useApp((s) => s.setView);

  const active = useMemo(() => (groups.active ? groups.active.split('|') : []), [groups.active]);
  const done = useMemo(() => (groups.done ? groups.done.split('|') : []), [groups.done]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[980px] px-8 pb-16">
          <PageHeader
            title="Queue"
            subtitle={active.length ? `${active.length} in progress or waiting` : 'Nothing downloading right now'}
            actions={done.length > 0 && <Button variant="ghost" size="sm" onClick={clearFinished}>Clear finished</Button>}
          />

          {active.length === 0 && done.length === 0 ? (
            <EmptyState icon={<ListTodo />} title="Your queue is empty" action={<Button variant="primary" icon={<ArrowDownToLine className="size-4" />} onClick={() => setView('download')}>Download something</Button>}>
              Downloads, conversions and subtitle jobs show up here. They keep running when you close the window.
            </EmptyState>
          ) : (
            <div className="space-y-8">
              {active.length > 0 && (
                <section aria-label="In progress" className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
                  {active.map((id) => <JobRow key={id} id={id} />)}
                </section>
              )}
              {done.length > 0 && (
                <section aria-label="Finished">
                  <h2 className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">Finished</h2>
                  <div className="overflow-hidden rounded-xl border border-line bg-panel">
                    {done.map((id) => <JobRow key={id} id={id} />)}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
