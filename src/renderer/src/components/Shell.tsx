import { withArtSize } from '@core/artwork';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ChevronUp, Code2, CircleCheck, CircleX, Globe, Info, Library, ListTodo, PanelLeftClose, PanelLeftOpen, Pause, Play, Settings, SkipForward, X } from 'lucide-react';
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
type NavItem = { view: View; label: string; icon: ReactNode; shortcut: string };
const NAV: NavItem[] = [
  { view: 'download', label: 'Download', icon: <ArrowDownToLine />, shortcut: `${mod}1` },
  { view: 'queue', label: 'Queue', icon: <ListTodo />, shortcut: `${mod}2` },
  { view: 'library', label: 'Library', icon: <Library />, shortcut: `${mod}3` },
  { view: 'browser', label: 'Browser', icon: <Globe />, shortcut: `${mod}4` },
  { view: 'ide', label: 'Code', icon: <Code2 />, shortcut: `${mod}5` },
  { view: 'settings', label: 'Settings', icon: <Settings />, shortcut: `${mod},` },
];
const ABOUT: NavItem = { view: 'about', label: 'About', icon: <Info />, shortcut: '' };

const COLLAPSE_KEY = 'lumina.sidebar.collapsed';
const WIDTH_KEY = 'lumina.sidebar.width';
// Auto-collapse sits above the window's 900px min width so the rail actually appears on smaller windows.
const NARROW_QUERY = '(max-width: 1024px)';
const COLLAPSED_W = 68;
const MIN_W = 190;
const MAX_W = 360;
const DEFAULT_W = 236;
// Dragging the edge narrower than this snaps the sidebar shut to the icon-only rail.
const SNAP_W = 150;
const clampW = (n: number) => Math.max(MIN_W, Math.min(MAX_W, n));

interface SidebarLayout {
  collapsed: boolean;
  /** Pixel width of the expanded sidebar (ignored while collapsed). */
  width: number;
  /** True during an active edge-drag, so width transitions are suspended for a 1:1 feel. */
  dragging: boolean;
  toggle: () => void;
  beginResize: (e: React.PointerEvent) => void;
}

/**
 * Sidebar sizing: collapses to an icon rail (pinned, or on 'auto' when the window is narrow), and its expanded
 * width is drag-adjustable from the right edge. Dragging below SNAP_W snaps it shut; dragging back out reopens it.
 * All state is per-viewer (localStorage), wrapped so private windows/cleared storage still render.
 */
function useSidebar(): SidebarLayout {
  const [pref, setPref] = useState<'auto' | 'expanded' | 'collapsed'>(() => {
    try {
      const v = localStorage.getItem(COLLAPSE_KEY);
      return v === 'expanded' || v === 'collapsed' ? v : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW_QUERY).matches);
  const [width, setWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY));
      return v >= MIN_W && v <= MAX_W ? v : DEFAULT_W;
    } catch {
      return DEFAULT_W;
    }
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const mq = matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const collapsed = pref === 'collapsed' || (pref === 'auto' && narrow);
  const setPrefPersist = (next: 'expanded' | 'collapsed') => {
    setPref(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next);
    } catch {
      // per-viewer convenience only
    }
  };
  const toggle = () => setPrefPersist(collapsed ? 'expanded' : 'collapsed');

  const beginResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    let last = width;
    // The sidebar is flush with the window's left edge, so the pointer's x is the target width.
    const onMove = (ev: PointerEvent) => {
      if (ev.clientX < SNAP_W) {
        setPrefPersist('collapsed');
        return;
      }
      setPrefPersist('expanded');
      last = clampW(ev.clientX);
      setWidth(last);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try {
        localStorage.setItem(WIDTH_KEY, String(last));
      } catch {
        // per-viewer convenience only
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return { collapsed, width, dragging, toggle, beginResize };
}

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
  const { collapsed, width, dragging, toggle: toggleCollapsed, beginResize } = useSidebar();

  useLayoutEffect(() => {
    const el = refs.current[view];
    if (el) setPill({ top: el.offsetTop, height: el.offsetHeight });
  }, [view, collapsed]);

  const renderNavItem = (item: NavItem) => {
    const selected = view === item.view;
    const badge = item.view === 'queue' ? active + waiting : 0;
    return (
      <button
        key={item.view}
        ref={(el) => { refs.current[item.view] = el; }}
        onClick={() => setView(item.view)}
        aria-current={selected ? 'page' : undefined}
        title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
        className={cn(
          'group relative flex h-9 items-center rounded-lg text-sm font-semibold transition-colors duration-150 active:scale-[0.99] [&_svg]:size-[18px]',
          collapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
          selected ? 'text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink',
        )}
      >
        <span className={cn('relative transition-colors duration-200', selected ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')}>
          {item.icon}
          {collapsed && badge > 0 && <span className="absolute -top-1 -right-1.5 size-2 rounded-full bg-accent ring-2 ring-panel" />}
        </span>
        {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
        {!collapsed && badge > 0 && (
          <span key={badge} className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink tabular animate-pop">{badge}</span>
        )}
      </button>
    );
  };

  return (
    <aside
      style={{ width: collapsed ? COLLAPSED_W : width }}
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-panel ease-out-soft',
        !dragging && 'transition-[width] duration-300',
      )}
    >
      {/* Brand — divided from the pages below so the app mark reads as a header, not a nav item. */}
      {/* The collapse toggle lives up here beside the brand, where people look for it — it used to sit
          at the very bottom of the sidebar, under the library stats, and was easy to miss. */}
      <div className={cn('drag flex h-[var(--titlebar)] shrink-0 items-center border-b border-line', collapsed ? 'justify-center px-0' : 'gap-2 px-4', isMac && !collapsed && 'pl-[84px]')}>
        {!collapsed && !isMac && <Brand collapsed={false} />}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn('no-drag grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink [&_svg]:size-[18px]', !collapsed && 'ml-auto')}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>
      {isMac && !collapsed && <div className="border-b border-line px-4 py-2"><Brand collapsed={false} /></div>}

      <nav aria-label="Main" className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pt-3">
        {pill && (
          <span
            aria-hidden="true"
            className="absolute right-2.5 left-2.5 rounded-lg bg-raised shadow-sm ring-1 ring-line transition-[top] duration-300 ease-out-soft"
            style={{ top: pill.top, height: pill.height }}
          />
        )}
        {NAV.map(renderNavItem)}

        {/* About sits at the bottom, set apart from the working pages. */}
        <div className={cn('mt-auto border-t border-line pt-2', collapsed ? '-mx-2.5 px-2.5' : '')}>
          {renderNavItem(ABOUT)}
        </div>
      </nav>

      <div className={cn('shrink-0 border-t border-line pb-3 text-xs text-ink-3', collapsed ? 'px-2 pt-2' : 'space-y-3 px-4 pt-3')}>
        {!collapsed && brokenTools.length > 0 && (
          <button onClick={() => setView('settings', 'advanced')} className="flex w-full items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-left text-warning transition-colors hover:bg-warning/15">
            <Info className="mt-px size-4 shrink-0" />
            <span><b className="font-semibold">{brokenTools.map((t) => t.name).join(', ')}</b> unavailable. Open Settings to repair.</span>
          </button>
        )}
        {!collapsed && active > 0 && (
          <button onClick={() => setView('queue')} className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:text-ink tabular animate-rise">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
            </span>
            {plural(active, 'download')} · {formatSpeed(speed)}
          </button>
        )}
        {!collapsed && showStats && stats && (
          <div className="flex items-center gap-2 px-1 tabular">
            <span className={cn('size-1.5 rounded-full', stats.scanning ? 'animate-pulse bg-accent' : 'bg-success')} />
            {stats.scanning ? 'Scanning library…' : `${plural(stats.audio, 'song')} · ${plural(stats.video, 'video')}`}
          </div>
        )}
      </div>

      {/* Drag the right edge to resize; drag it narrow enough and it snaps to the icon rail. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={beginResize}
        onDoubleClick={toggleCollapsed}
        className="group absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize"
      >
        <span className={cn('absolute inset-y-0 right-0 w-px bg-transparent transition-colors duration-150 group-hover:bg-accent', dragging && 'bg-accent')} />
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
        <g fill="#C4531B" stroke="#C4531B" strokeWidth="0.8" strokeLinejoin="round">
          <rect x="14.7" y="11.3" width="2.6" height="6.1" rx="1.1" stroke="none" />
          <path d="M12.2 15.9 L19.8 15.9 L16 21.2 Z" />
        </g>
      </svg>
    </span>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark className="size-7 shrink-0" />
      {!collapsed && <span className="font-serif text-[20px] leading-none tracking-tight">Lumina</span>}
    </div>
  );
}

/** Top drag strip above page content; leaves room for Windows/Linux caption buttons. */
/**
 * The draggable strip across the top of a view. `right` sits at the far end, clear of the window
 * controls on Windows/Linux (the 150px reserve) — the IDE puts its layout toggles there.
 */
export function TitleBar({ children, right, className }: { children?: ReactNode; right?: ReactNode; className?: string }) {
  const isMac = window.lumina.platform === 'darwin';
  return (
    <div className={cn('drag flex h-[var(--titlebar)] shrink-0 items-center gap-2 px-6', !isMac && 'pr-[150px]', className)}>
      <div className="no-drag flex min-w-0 items-center gap-2">{children}</div>
      {right && <div className="no-drag ml-auto flex shrink-0 items-center gap-2">{right}</div>}
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
        <Artwork src={withArtSize(item.artworkUrl, 44)} seed={item.album ?? item.title} kind={item.kind} className="size-11 shadow-sm transition-transform duration-200 group-hover:scale-[1.04]" rounded="rounded-md" />
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
  return (
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed z-[60] flex w-[360px] flex-col gap-2',
        // Top-right, below the title bar's caption buttons; in the player, top-centre clear of the controls.
        inPlayer ? 'top-16 left-1/2 -translate-x-1/2' : 'right-5 top-[calc(var(--titlebar)_+_12px)]',
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
