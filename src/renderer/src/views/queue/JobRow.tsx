import { memo, useState } from 'react';
import { ChevronDown, CircleCheck, CirclePause, FolderOpen, PackageOpen, Play, RotateCw, Trash2, TriangleAlert, Tv, X } from 'lucide-react';
import type { Job } from '@shared/types';
import { formatBytes, formatEta, formatSpeed } from '@core/format';
import { mediaKindOf } from '@core/mediaKind';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { queuePosition, useJobs } from '@/stores/jobs';
import { usePlayer } from '@/stores/player';
import { Artwork } from '@/components/Artwork';
import { Badge, IconButton, ProgressBar } from '@/components/ui';

const STATUS_LABEL: Record<Job['status'], string> = {
  queued: 'Queued', running: 'Downloading', paused: 'Paused', processing: 'Processing', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled',
};

function playablePath(job: Job): string | null {
  return job.outputPaths.find((p) => mediaKindOf(p)) ?? null;
}

export const JobRow = memo(function JobRow({ id, compact }: { id: string; compact?: boolean }) {
  const job = useJobs((s) => s.byId[id]);
  const position = useJobs((s) => queuePosition(s.byId, id));
  const act = useJobs((s) => s.act);
  const toast = useApp((s) => s.toast);
  const setMode = useApp((s) => s.setMode);
  const playQueue = usePlayer((s) => s.playQueue);
  const [showDetail, setShowDetail] = useState(false);
  if (!job) return null;

  const active = job.status === 'running' || job.status === 'processing';
  const p = job.progress;
  const playable = job.status === 'completed' ? playablePath(job) : null;
  const tone = job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'success' : job.status === 'paused' || job.status === 'cancelled' ? 'muted' : 'accent';

  const play = async () => {
    if (!playable) return;
    try {
      const item = await call('player:resolve-path', { path: playable });
      playQueue([item]);
      if (!compact) setMode('player');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const reveal = () => {
    const target = job.outputPaths[0] ?? job.outputDir;
    if (target) void call('shell:show-in-folder', { path: target }).catch((err) => toast(errorMessage(err), 'error'));
  };

  const installer = job.engine === 'extract' && job.status === 'completed' ? job.outputPaths.find((f) => /\.exe$/i.test(f)) ?? null : null;
  const runSetup = () => {
    if (installer) void call('shell:open-path', { path: installer }).catch((err) => toast(errorMessage(err), 'error'));
  };

  const doneSummary = job.engine === 'subtitles'
    ? 'English subtitles added'
    : job.engine === 'convert'
      ? `Converted · ${job.compat?.summary ?? 'ready'}`
      : job.engine === 'extract'
        ? installer ? 'Unpacked and verified · ready to install' : 'Unpacked and verified'
        : job.compat?.summary ?? STATUS_LABEL[job.status];

  const meta: string[] = [];
  if (job.status === 'running' && p.item) meta.push(`${p.item.index} of ${p.item.count}`);
  if (job.status === 'running' && p.speedBps) meta.push(formatSpeed(p.speedBps));
  if (job.status === 'running' && p.etaSec != null) meta.push(`${formatEta(p.etaSec)} left`);
  if (job.status === 'running' && p.totalBytes) meta.push(`${formatBytes(p.downloadedBytes)} of ${formatBytes(p.totalBytes)}`);

  // A queued download waits its turn and starts on its own when a slot frees — say so, so there's
  // no need to babysit it or pause others by hand.
  const queuedLabel = job.status === 'queued'
    ? position <= 1 ? 'Up next — starts automatically' : `Queued · ${position} in line — starts automatically`
    : null;

  return (
    <div className={cn('group border-b border-line last:border-b-0', compact ? 'px-3 py-2.5' : 'px-4 py-3.5')}>
      <div className="flex items-center gap-3.5">
        <div className="relative">
          {job.thumbnail
            ? <img src={job.thumbnail} alt="" className={cn('shrink-0 rounded-md object-cover', compact ? 'h-9 w-12' : 'h-12 w-[72px]')} />
            : <Artwork src={null} seed={job.title} kind={job.options.contentType === 'music' ? 'audio' : 'video'} className={compact ? 'h-9 w-12' : 'h-12 w-[72px]'} rounded="rounded-md" />}
          {job.status === 'completed' && <CircleCheck className="absolute -right-1.5 -bottom-1.5 size-[18px] rounded-full bg-panel fill-success text-panel" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold" title={job.title}>{job.title}</p>
            {job.compat && job.options.format.kind === 'video' && job.status === 'completed' && (
              job.compat.tvSafe ? <Badge tone="success"><Tv className="size-3" /> TV-ready</Badge> : null
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-3">
            <span className={cn('font-medium', job.status === 'failed' && 'text-danger', active && 'text-ink-2')}>
              {job.status === 'failed' ? job.error?.message ?? 'Failed' : queuedLabel ? queuedLabel : active || job.status === 'paused' ? p.stage || STATUS_LABEL[job.status] : job.status === 'completed' ? doneSummary : STATUS_LABEL[job.status]}
            </span>
            {meta.length > 0 && <span className="truncate tabular">· {meta.join(' · ')}</span>}
          </div>
          {(active || job.status === 'paused' || job.status === 'queued') && (
            <ProgressBar className="mt-2" value={p.percent} tone={tone} indeterminate={active && p.percent === 0} />
          )}
        </div>

        {!compact && active && <span className="w-11 text-right text-sm font-semibold text-ink-2 tabular">{Math.floor(p.percent)}%</span>}

        <div className={cn('flex items-center gap-0.5', compact && 'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100')}>
          {playable && <IconButton label="Play" onClick={play}><Play /></IconButton>}
          {installer && (
            <button
              onClick={runSetup}
              className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-accent-ink transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel outline-none"
            >
              <PackageOpen className="size-4" /> Run setup
            </button>
          )}
          {(active || job.status === 'queued') && <IconButton label="Pause" onClick={() => act(id, 'pause')}><CirclePause /></IconButton>}
          {job.status === 'paused' && <IconButton label="Resume" onClick={() => act(id, 'resume')}><Play /></IconButton>}
          {(job.status === 'failed' || job.status === 'cancelled') && <IconButton label="Retry" onClick={() => act(id, 'retry')}><RotateCw /></IconButton>}
          {(job.outputPaths.length > 0 || job.outputDir) && job.status === 'completed' && <IconButton label="Show in folder" onClick={reveal}><FolderOpen /></IconButton>}
          {!compact && (active || job.status === 'queued' || job.status === 'paused') && <IconButton label="Cancel" onClick={() => act(id, 'cancel')}><X /></IconButton>}
          {!compact && !(active || job.status === 'queued') && <IconButton label="Remove from list" onClick={() => act(id, 'remove')}><Trash2 /></IconButton>}
          {!compact && (job.error?.detail || (job.compat && !job.compat.tvSafe && job.compat.summary.includes('—'))) && (
            <IconButton label={showDetail ? 'Hide details' : 'Show details'} onClick={() => setShowDetail(!showDetail)}>
              <ChevronDown className={cn('transition-transform', showDetail && 'rotate-180')} />
            </IconButton>
          )}
        </div>
      </div>

      {showDetail && !compact && (
        <div className="mt-3 ml-[86px] rounded-lg border border-line bg-sunken p-3 text-xs leading-relaxed text-ink-2 animate-rise">
          {job.compat && <p className="flex items-start gap-2"><TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />{job.compat.summary}</p>}
          {job.error?.detail && <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-ink-3" data-selectable>{job.error.detail.trim()}</pre>}
        </div>
      )}
    </div>
  );
});
