// A torrent's detail panel: live speed graph, swarm and share numbers, and the file list with
// per-file selection. Polls while it is open — the queue's own job updates carry progress, but the
// file table and the swarm counts only exist while aria2 is actually running the torrent.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Users } from 'lucide-react';
import type { TorrentDetail as Detail } from '@shared/types';
import { formatBytes, formatSpeed } from '@core/format';
import { HISTORY_LENGTH, niceMax, sparklineArea, sparklinePath } from '@core/speedHistory';
import { selectedBytes } from '@core/torrentFiles';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Button, ProgressBar } from '@/components/ui';

const GRAPH_W = 560;
const GRAPH_H = 76;

export function TorrentDetail({ id }: { id: string }) {
  const toast = useApp((s) => s.toast);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [checked, setChecked] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Don't fight the user's tick-boxes with each poll: only adopt the engine's selection once.
  const adopted = useRef(false);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const d = await call('torrent:detail', { id });
        if (!live) return;
        setDetail(d);
        if (d && !adopted.current && d.files.length > 0) {
          adopted.current = true;
          setChecked(d.files.filter((f) => f.selected).map((f) => f.index));
        }
      } catch {
        // A finished or removed torrent simply has no detail; the panel says so.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => { live = false; clearInterval(timer); };
  }, [id]);

  if (!detail) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-3">Live details appear while the torrent is running.</p>;
  }

  const down = detail.history.map((s) => s.down);
  const up = detail.history.map((s) => s.up);
  const max = niceMax(Math.max(0, ...down, ...up));
  const selection = checked ?? detail.files.filter((f) => f.selected).map((f) => f.index);
  const changed = detail.files.length > 0
    && (selection.length !== detail.files.filter((f) => f.selected).length
      || selection.some((i) => !detail.files.find((f) => f.index === i)?.selected));
  const { total, remaining } = selectedBytes(detail.files, selection);

  const toggle = (index: number) => {
    setChecked((prev) => {
      const base = prev ?? detail.files.filter((f) => f.selected).map((f) => f.index);
      return base.includes(index) ? base.filter((i) => i !== index) : [...base, index];
    });
  };

  const apply = async () => {
    setBusy(true);
    try {
      await call('torrent:select-files', { id, indices: selection });
      toast(`Downloading ${selection.length} of ${detail.files.length} files`, 'success');
      setChecked(null);
      adopted.current = false;
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-line bg-sunken px-4 py-4">
      <div className="flex flex-wrap items-start gap-5">
        <figure className="min-w-0 flex-1">
          <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} preserveAspectRatio="none" className="h-[76px] w-full" role="img"
            aria-label={`Speed over the last ${detail.history.length} seconds: ${formatSpeed(detail.downloadSpeed)} down, ${formatSpeed(detail.uploadSpeed)} up`}>
            <path d={sparklineArea(down, GRAPH_W, GRAPH_H, max, HISTORY_LENGTH)} className="fill-accent/15" />
            <path d={sparklinePath(down, GRAPH_W, GRAPH_H, max, HISTORY_LENGTH)} className="stroke-accent" fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <path d={sparklinePath(up, GRAPH_W, GRAPH_H, max, HISTORY_LENGTH)} className="stroke-ink-3" fill="none" strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption className="mt-1 flex justify-between text-[11px] text-ink-3">
            <span>Down (solid) · up (dotted)</span>
            <span className="tabular">peak axis {formatSpeed(max)}</span>
          </figcaption>
        </figure>

        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
          <dt className="flex items-center gap-1.5 text-ink-3"><ArrowDown className="size-3.5" /> Down</dt>
          <dd className="text-right font-semibold tabular">{formatSpeed(detail.downloadSpeed)}</dd>
          <dt className="flex items-center gap-1.5 text-ink-3"><ArrowUp className="size-3.5" /> Up</dt>
          <dd className="text-right font-semibold tabular">{formatSpeed(detail.uploadSpeed)}</dd>
          <dt className="flex items-center gap-1.5 text-ink-3"><Users className="size-3.5" /> Swarm</dt>
          <dd className="text-right font-semibold tabular">{detail.seeds} seeds · {detail.peers} peers</dd>
          <dt className="text-ink-3">Shared</dt>
          <dd className="text-right font-semibold tabular">
            {formatBytes(detail.uploadedBytes)}{detail.ratio != null && ` · ${detail.ratio.toFixed(2)}×`}
          </dd>
        </dl>
      </div>

      {detail.files.length === 0 ? (
        <p className="text-[13px] text-ink-3">Waiting for the torrent’s file list…</p>
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">
              Files · {selection.length} of {detail.files.length} selected
            </h4>
            <span className="text-[13px] text-ink-3">{formatBytes(total)}{remaining > 0 && ` · ${formatBytes(remaining)} still to get`}</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setChecked(detail.files.map((f) => f.index))}>All</Button>
              <Button variant="ghost" size="sm" onClick={() => setChecked([])}>None</Button>
              <Button variant="primary" size="sm" disabled={busy || !changed || selection.length === 0} onClick={() => void apply()}>
                Apply
              </Button>
            </div>
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border border-line bg-panel">
            {detail.files.map((f) => {
              const on = selection.includes(f.index);
              return (
                <label key={f.index} className={cn('flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 transition-colors hover:bg-hover', !on && 'opacity-55')}>
                  <input type="checkbox" checked={on} onChange={() => toggle(f.index)} className="size-4 shrink-0 accent-[var(--accent)]" aria-label={f.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium" title={f.name}>{f.name}</span>
                    <ProgressBar className="mt-1" value={f.percent} tone={f.percent >= 100 ? 'success' : 'accent'} />
                  </span>
                  <span className="shrink-0 text-right text-[12px] text-ink-3 tabular">
                    {formatBytes(f.sizeBytes)}
                    <span className="block">{Math.floor(f.percent)}%</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            Unticking a file stops it downloading now; already-downloaded pieces stay on disk.
          </p>
        </div>
      )}
    </div>
  );
}
