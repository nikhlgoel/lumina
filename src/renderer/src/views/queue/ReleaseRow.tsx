import { memo, useState } from 'react';
import { ChevronDown, CircleCheck, CirclePause, FolderOpen, Layers, Play, RotateCw, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Job, JobStatus } from '@shared/types';
import { formatBytes, formatEta, formatSpeed } from '@core/format';
import { groupActionTargets, summarizeGroup } from '@core/jobGroups';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { useJobs } from '@/stores/jobs';
import { Artwork } from '@/components/Artwork';
import { IconButton, ProgressBar } from '@/components/ui';
import { JobRow } from './JobRow';

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Waiting', running: 'Downloading', paused: 'Paused', processing: 'Unpacking', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled',
};

/**
 * One pasted release — its split-archive parts and the unpack job that follows them — shown as a
 * single download with one progress bar and one set of controls. Expand to see the individual parts.
 */
export const ReleaseRow = memo(function ReleaseRow({ ids, compact }: { ids: string[]; compact?: boolean }) {
  const members = useJobs(useShallow((s) => ids.map((id) => s.byId[id]).filter((j): j is Job => Boolean(j))));
  const act = useJobs((s) => s.act);
  const toast = useApp((s) => s.toast);
  const [expanded, setExpanded] = useState(false);
  if (members.length === 0) return null;

  const s = summarizeGroup(members);
  const active = s.status === 'running' || s.status === 'processing';
  const tone = s.status === 'failed' ? 'danger' : s.status === 'completed' ? 'success' : s.status === 'paused' || s.status === 'cancelled' ? 'muted' : 'accent';
  const lead = members[0]!;
  const title = lead.options.release?.title || lead.title;

  const run = (action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove') => {
    const ids = groupActionTargets(members, action);
    void Promise.all(ids.map((id) => act(id, action)));
  };

  // Point at the unpacked result when there is one, otherwise at whatever part did land.
  const done = members.find((j) => j.engine === 'extract' && j.status === 'completed') ?? members.find((j) => j.status === 'completed');
  const revealTarget = done?.outputPaths[0] ?? done?.outputDir ?? lead.outputDir;
  const reveal = () => {
    if (revealTarget) void call('shell:show-in-folder', { path: revealTarget }).catch((err) => toast(errorMessage(err), 'error'));
  };

  const parts = `${s.counts.total} files`;
  const meta: string[] = [];
  if (active || s.status === 'queued' || s.status === 'paused') meta.push(`${s.counts.completed} of ${s.counts.total} done`);
  if (s.speedBps) meta.push(formatSpeed(s.speedBps));
  if (s.etaSec != null) meta.push(`${formatEta(s.etaSec)} left`);
  if (s.totalBytes) meta.push(`${formatBytes(s.downloadedBytes)} of ${formatBytes(s.totalBytes)}`);

  const status = s.status === 'failed'
    ? `${s.counts.failed} of ${s.counts.total} files failed`
    : s.status === 'completed'
      ? `Complete · ${parts}`
      : STATUS_LABEL[s.status];

  const canPause = groupActionTargets(members, 'pause').length > 0;
  const canResume = groupActionTargets(members, 'resume').length > 0;
  const canCancel = groupActionTargets(members, 'cancel').length > 0;
  const canRetry = groupActionTargets(members, 'retry').length > 0;

  return (
    <div className="border-b border-line last:border-b-0">
      <div className={cn('group', compact ? 'px-3 py-2.5' : 'px-4 py-3.5')}>
        <div className="flex items-center gap-3.5">
          <div className="relative">
            {lead.thumbnail
              ? <img src={lead.thumbnail} alt="" className={cn('shrink-0 rounded-md object-cover', compact ? 'h-9 w-12' : 'h-12 w-[72px]')} />
              : <Artwork src={null} seed={title} kind="video" className={compact ? 'h-9 w-12' : 'h-12 w-[72px]'} rounded="rounded-md" />}
            {s.status === 'completed' && <CircleCheck className="absolute -right-1.5 -bottom-1.5 size-[18px] rounded-full bg-panel fill-success text-panel" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold" title={title}>{title}</p>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sunken px-1.5 py-0.5 text-[11px] font-semibold text-ink-3">
                <Layers className="size-3" /> {parts}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-3">
              <span className={cn('font-medium', s.status === 'failed' && 'text-danger', active && 'text-ink-2')}>{status}</span>
              {meta.length > 0 && <span className="truncate tabular">· {meta.join(' · ')}</span>}
            </div>
            {(active || s.status === 'queued' || s.status === 'paused') && (
              <ProgressBar className="mt-2" value={s.percent} tone={tone} indeterminate={active && s.percent === 0} />
            )}
          </div>

          {!compact && active && <span className="w-11 text-right text-sm font-semibold text-ink-2 tabular">{Math.floor(s.percent)}%</span>}

          <div className={cn('flex items-center gap-0.5', compact && 'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100')}>
            {canPause && <IconButton label="Pause all files" onClick={() => run('pause')}><CirclePause /></IconButton>}
            {canResume && <IconButton label="Resume all files" onClick={() => run('resume')}><Play /></IconButton>}
            {canRetry && <IconButton label="Retry failed files" onClick={() => run('retry')}><RotateCw /></IconButton>}
            {!compact && canCancel && <IconButton label="Cancel all files" onClick={() => run('cancel')}><X /></IconButton>}
            {revealTarget && s.counts.completed > 0 && !canCancel && <IconButton label="Show in folder" onClick={reveal}><FolderOpen /></IconButton>}
            {!compact && !canCancel && <IconButton label="Remove from list" onClick={() => run('remove')}><Trash2 /></IconButton>}
            <IconButton label={expanded ? `Hide the ${s.counts.total} files` : `Show the ${s.counts.total} files`} onClick={() => setExpanded(!expanded)}>
              <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
            </IconButton>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line bg-sunken pl-6 animate-rise">
          {ids.map((id) => <JobRow key={id} id={id} compact />)}
        </div>
      )}
    </div>
  );
});
