import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ChevronUp, CircleCheck, CircleX, Info, Library, ListTodo, Pause, Play, Settings, SkipForward, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { formatSpeed, plural } from '@core/format';
import { cn } from '@/lib/cn';
import { useApp, type View } from '@/stores/app';
import { useJobs } from '@/stores/jobs';
import { usePlayer } from '@/stores/player';
import { useLibrary } from '@/stores/library';
import { Artwork } from './Artwork';
import { IconButton } from './ui';

const mod = window.lumina.platform === 'darwin' ? '⌘' : 'Ctrl+';
const NAV: { view: View; label: string; icon: ReactNode; shortcut: string }[] = [
  { view: 'download', label: 'Download', icon: <ArrowDownToLine />, shortcut: `${mod}1` },
  { view: 'queue', label: 'Queue', icon: <ListTodo />, shortcut: `${mod}2` },
  { view: 'library', label: 'Library', icon: <Library />, shortcut: `${mod}3` },
  { view: 'settings', label: 'Settings', icon: <Settings />, shortcut: `${mod},` },
];

/** Live totals for the sidebar: active jobs and combined speed. */
function useQueueSummary() {
  return useJobs(useShallow((s) => {
    let active = 0;
    let waiting = 0;
    let speed = 0;
    for (const id of s.order) {
      const j = s.byId[id];
      if (!j) continue;
      if (j.status === 'running' || j.status === 'processing') {
        active++;
        speed += j.progress.speedBps ?? 0;
      } else if (j.status === 'queued') waiting++;
    }
    return { active, waiting, speed: Math.round(speed / 10_000) * 10_000 };
  }));
}

export function Sidebar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const tools = useApp((s) => s.tools);
  const showStats = useApp((s) => s.settings?.appearance.showSidebarStats ?? true);
  const { active, waiting, speed } = useQueueSummary();
  const stats = useLibrary((s) => s.stats);
  const isMac = window.lumina.platform === 'darwin';
  const brokenTools = tools.filter((t) => !t.ok && t.name !== 'aria2c');
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current[view];
    if (el) setPill({ top: el.offsetTop, height: el.offsetHeight });
  }, [view]);

  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-line bg-panel">
      <div className={cn('drag flex h-[var(--titlebar)] items-center px-4', isMac && 'pl-[84px]')}>
        {!isMac && <Wordmark />}
      </div>
      {isMac && <div className="px-4 pb-2"><Wordmark /></div>}

      <nav aria-label="Main" className="relative flex flex-col gap-0.5 px-2.5 pt-2">
        {pill && (
          <span
            aria-hidden="true"
            className="absolute right-2.5 left-2.5 rounded-lg bg-raised shadow-sm ring-1 ring-line transition-[top] duration-300 ease-out-soft"
            style={{ top: pill.top, height: pill.height }}
          />
        )}
        {NAV.map((item) => {
          const selected = view === item.view;
          return (
            <button
              key={item.view}
              ref={(el) => { refs.current[item.view] = el; }}
              onClick={() => setView(item.view)}
              aria-current={selected ? 'page' : undefined}
              title={`${item.label} (${item.shortcut})`}
              className={cn(
                'group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-semibold transition-colors duration-150 active:scale-[0.99] [&_svg]:size-[18px]',
                selected ? 'text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink',
              )}
            >
              <span className={cn('transition-colors duration-200', selected ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')}>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.view === 'queue' && active + waiting > 0 && (
                <span key={active + waiting} className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink tabular animate-pop">{active + waiting}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3 px-4 pb-4 text-xs text-ink-3">
        {brokenTools.length > 0 && (
          <button onClick={() => setView('settings', 'advanced')} className="flex w-full items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-left text-warning transition-colors hover:bg-warning/15">
            <Info className="mt-px size-4 shrink-0" />
            <span><b className="font-semibold">{brokenTools.map((t) => t.name).join(', ')}</b> unavailable. Open Settings to repair.</span>
          </button>
        )}
        {active > 0 && (
          <button onClick={() => setView('queue')} className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:text-ink tabular animate-rise">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
            </span>
            {plural(active, 'download')} · {formatSpeed(speed)}
          </button>
        )}
        {showStats && stats && (
          <div className="flex items-center gap-2 px-1 tabular">
            <span className={cn('size-1.5 rounded-full', stats.scanning ? 'animate-pulse bg-accent' : 'bg-success')} />
            {stats.scanning ? 'Scanning library…' : `${plural(stats.audio, 'song')} · ${plural(stats.video, 'video')}`}
          </div>
        )}
      </div>
    </aside>
  );
}


/** The crystal from the app icon, so the window and the taskbar match. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid place-items-center', className)}>
      <svg viewBox="0 0 32 32" className="size-full" aria-hidden="true">
        <polygon points="16,1 29,8.5 16,16 3,8.5" fill="#FFC27F" />
        <polygon points="3,8.5 16,16 16,31 3,23.5" fill="#E8752F" />
        <polygon points="29,8.5 29,23.5 16,31 16,16" fill="#A8441A" />
        <polygon points="16,1.8 28.3,8.9 28.3,23.1 16,30.2 3.7,23.1 3.7,8.9" fill="none" stroke="#FFE9CC" strokeOpacity="0.9" strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="16" cy="16" r="6.6" fill="#FFF1DE" />
        <path d="M14.3 12.9 L19.9 16 L14.3 19.1 Z" fill="#C4531B" stroke="#C4531B" strokeWidth="0.9" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <BrandMark className="size-6" />
      <span className="font-serif text-[22px] leading-none tracking-tight">Lumina</span>
    </div>
  );
}

/** Top drag strip above page content; leaves room for Windows/Linux caption buttons. */
export function TitleBar({ children }: { children?: ReactNode }) {
  const isMac = window.lumina.platform === 'darwin';
  return (
    <div className={cn('drag flex h-[var(--titlebar)] shrink-0 items-center gap-2 px-6', !isMac && 'pr-[150px]')}>
      <div className="no-drag flex items-center gap-2">{children}</div>
    </div>
  );
}

export function MiniBar() {
  const item = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const setMode = useApp((s) => s.setMode);
  const inPlayer = useApp((s) => s.mode === 'player');
  if (!item) return null;

  const open = () => setMode('player');
  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open player: ${item.title}`}
      title="Open player"
      onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-mini-control]')) open(); }}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open(); } }}
      className="group relative flex h-[68px] shrink-0 cursor-pointer items-center gap-3 border-t border-line bg-panel px-4 transition-colors duration-200 hover:bg-raised animate-rise"
    >
      <span className="absolute top-0 left-0 h-px bg-accent transition-[width] duration-500 ease-linear" style={{ width: `${pct}%` }} />
      <div style={{ viewTransitionName: inPlayer ? undefined : 'now-playing-art' }} className="rounded-md">
        <Artwork src={item.artworkUrl} seed={item.album ?? item.title} kind={item.kind} className="size-11 shadow-sm transition-transform duration-200 group-hover:scale-[1.04]" rounded="rounded-md" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{item.title}</div>
        <div className="truncate text-[13px] text-ink-3">{item.artist ?? (item.kind === 'video' ? 'Video' : 'Unknown artist')}</div>
      </div>
      <div data-mini-control className="flex items-center gap-1">
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid size-10 place-items-center rounded-full bg-ink text-ink-inverse transition-transform duration-150 hover:scale-105 active:scale-95"
        >
          {playing ? <Pause className="size-[18px] fill-current" /> : <Play className="ml-0.5 size-[18px] fill-current" />}
        </button>
        <IconButton label="Next" onClick={next}><SkipForward /></IconButton>
      </div>
      <ChevronUp className="size-5 text-ink-3 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:text-ink" aria-hidden="true" />
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  const inPlayer = useApp((s) => s.mode === 'player');
  const hasMiniBar = usePlayer((s) => s.queue.length > 0);
  return (
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed z-[60] flex w-[360px] flex-col gap-2',
        // In the player, stay clear of the controls at the bottom.
        inPlayer ? 'top-16 left-1/2 -translate-x-1/2' : hasMiniBar ? 'right-5 bottom-[84px]' : 'right-5 bottom-5',
      )}
    >
      {toasts.map((t) => (
        <div key={t.id} className={cn('pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-overlay p-3 pr-2 text-sm shadow-lg', t.leaving ? 'animate-leave' : 'animate-rise')}>
          <span className={cn('mt-px [&_svg]:size-[18px]', t.tone === 'success' ? 'text-success' : t.tone === 'error' ? 'text-danger' : 'text-ink-3')}>
            {t.tone === 'success' ? <CircleCheck /> : t.tone === 'error' ? <CircleX /> : <Info />}
          </span>
          <p className="min-w-0 flex-1 leading-snug text-ink-2">{t.message}</p>
          {t.action && (
            <button onClick={() => { t.action!.run(); dismiss(t.id); }} className="rounded-md px-2 py-0.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent-soft">
              {t.action.label}
            </button>
          )}
          <IconButton label="Dismiss" size="sm" onClick={() => dismiss(t.id)}><X /></IconButton>
        </div>
      ))}
    </div>
  );
}
