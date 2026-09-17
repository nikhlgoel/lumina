import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Captions, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { PlayableItem } from '@shared/types';
import { formatDuration } from '@core/format';
import { cn } from '@/lib/cn';
import { usePlayer, type StageView } from '@/stores/player';
import { useApp } from '@/stores/app';

function SeekBar() {
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? time;
  const pct = duration ? Math.min(100, (shown / duration) * 100) : 0;
  const at = (x: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * duration;
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(at(e.clientX));
  };

  return (
    <div className="grid grid-cols-[48px_1fr_48px] items-center gap-3 text-xs text-[var(--p-ink-3)] tabular">
      <span className="text-right">{formatDuration(shown)}</span>
      <div
        ref={bar}
        className="p-bar"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatDuration(shown)} of ${formatDuration(duration)}`}
        data-drag={drag !== null || undefined}
        onPointerDown={down}
        onPointerMove={(e) => drag !== null && setDrag(at(e.clientX))}
        onPointerUp={() => { if (drag !== null) seek(drag); setDrag(null); }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); seek(time + 5); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); seek(time - 5); }
        }}
      >
        <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
        <span className="knob" style={{ left: `${pct}%` }} />
      </div>
      <span>{formatDuration(duration)}</span>
    </div>
  );
}

export function Dock({ item, stage, onStage, queueOpen, onQueue }: {
  item: PlayableItem; stage: StageView; onStage: (v: StageView) => void; queueOpen: boolean; onQueue: () => void;
}) {
  const p = usePlayer();
  const hints = useApp((s) => s.settings?.player.showKeyboardHints ?? true);
  const isVideo = item.kind === 'video';
  const tabs: { id: StageView; label: string }[] = [{ id: 'art', label: isVideo ? 'Video' : 'Art' }, { id: 'lyrics', label: 'Lyrics' }];

  return (
    <footer className="p-dock mx-auto grid w-full max-w-[1100px] gap-3.5 px-[clamp(16px,3vw,32px)] pb-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-[clamp(30px,4.2vw,46px)] leading-none tracking-[-0.01em]" data-selectable>{item.title}</h1>
          <p className="mt-1.5 truncate text-[15px] text-[var(--p-ink-2)]">{[item.artist, item.album].filter(Boolean).join(' · ') || (isVideo ? 'Video' : 'Unknown artist')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isVideo && (
            <div role="radiogroup" aria-label="Stage view" className="flex rounded-xl border border-white/8 bg-white/7 p-[3px]">
              {tabs.map((t) => (
                <button key={t.id} role="radio" aria-checked={stage === t.id} onClick={() => onStage(t.id)}
                  className={cn('rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors', stage === t.id ? 'bg-white/14 text-[var(--p-ink)]' : 'text-[var(--p-ink-3)] hover:text-[var(--p-ink-2)]')}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <button onClick={onQueue} aria-pressed={queueOpen} className="p-btn flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold" title="Queue (Q)">
            <ListMusic className="size-4" /> Queue
          </button>
        </div>
      </div>

      <SeekBar />

      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        {hints ? <span className="hidden text-xs text-[var(--p-ink-3)] lg:block">Space play · ←/→ seek · L lyrics · T theme · Esc exit</span> : <span />}
        {hints && <span className="lg:hidden" />}
        <div className="flex items-center gap-[clamp(6px,1.6vw,16px)]">
          <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label="Shuffle" title="Shuffle" aria-pressed={p.shuffle} onClick={p.toggleShuffle}><Shuffle className="size-5" /></button>
          <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label="Previous" title="Previous" onClick={p.previous}><SkipBack className="size-5 fill-current" /></button>
          <button
            onClick={p.toggle}
            aria-label={p.playing ? 'Pause' : 'Play'}
            className="grid size-[58px] place-items-center rounded-full bg-[var(--p-ink)] text-[#0b0a10] transition-transform duration-150 hover:scale-105 active:scale-95"
          >
            {p.playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
          </button>
          <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label="Next" title="Next" onClick={p.next}><SkipForward className="size-5 fill-current" /></button>
          <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label={`Repeat: ${p.repeat}`} title={`Repeat: ${p.repeat}`} aria-pressed={p.repeat !== 'off'} onClick={p.cycleRepeat}>
            {p.repeat === 'one' ? <Repeat1 className="size-5" /> : <Repeat className="size-5" />}
          </button>
        </div>
        <div className="flex items-center justify-end gap-1">
          {isVideo && (
            <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label="English subtitles" title="Subtitles (C)" aria-pressed={p.subtitles} onClick={p.toggleSubtitles}><Captions className="size-5" /></button>
          )}
          <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label={p.muted ? 'Unmute' : 'Mute'} title="Mute (M)" onClick={p.toggleMute}>
            {p.muted || p.volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <input className="p-range" type="range" min={0} max={1} step={0.01} value={p.muted ? 0 : p.volume} aria-label="Volume" onChange={(e) => p.setVolume(Number(e.target.value))} />
        </div>
      </div>
    </footer>
  );
}
