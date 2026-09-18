import { useMemo } from 'react';
import { ArrowDownToLine, ListTodo } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '@/stores/app';
import { parseQueueRows, selectQueueRows, useJobs, type QueueRow } from '@/stores/jobs';
import { Button, EmptyState, PageHeader } from '@/components/ui';
import { TitleBar } from '@/components/Shell';
import { JobRow } from './JobRow';
import { ReleaseRow } from './ReleaseRow';

/** A collapsed release gets one row with one progress bar; everything else stays a plain job row. */
const renderRow = (row: QueueRow) =>
  row.ids.length > 1
    ? <ReleaseRow key={row.key} ids={row.ids} />
    : <JobRow key={row.key} id={row.ids[0]!} />;

export function QueueView() {
  const groups = useJobs(useShallow(selectQueueRows));
  const clearFinished = useJobs((s) => s.clearFinished);
  const setView = useApp((s) => s.setView);

  const active = useMemo(() => parseQueueRows(groups.active), [groups.active]);
  const done = useMemo(() => parseQueueRows(groups.done), [groups.done]);

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
                  {active.map(renderRow)}
                </section>
              )}
              {done.length > 0 && (
                <section aria-label="Finished">
                  <h2 className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">Finished</h2>
                  <div className="overflow-hidden rounded-xl border border-line bg-panel">
                    {done.map(renderRow)}
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
