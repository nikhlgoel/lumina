// The terminal panel under the editor: xterm.js in front, a real pty behind it.
//
// Terminals are arranged in groups (see @core/ideLayout): every terminal in the active group is on
// screen at once, side by side, and the tab strip picks the group. Each session gets its own
// permanent host element and its xterm is opened into it exactly once — xterm cannot be re-opened
// into a different element, so switching groups hides hosts rather than moving terminals around.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Columns2, Maximize2, Minimize2, Plus, Trash2, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ShellChoice, TerminalSession } from '@shared/types';
import {
  addTerminal, adoptTerminals, allTerminalIds, emptyGroups, focusTerminal, removeTerminal, resizeBetween, splitTerminal,
  type TerminalGroups,
} from '@core/ideLayout';
import { Sash } from './IdeChrome';
import { call, errorMessage, on } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { toXtermTheme } from '@core/theme';
import { activeTheme, onThemeChange } from '@/lib/editorTheme';

interface Attached {
  term: Terminal;
  fit: FitAddon;
}


/** Fit a terminal to its host, unless the host is hidden (display:none reports a zero size). */
function fitIfVisible(entry: Attached | undefined, host: HTMLElement | null | undefined) {
  if (!entry || !host || host.clientWidth === 0 || host.clientHeight === 0) return;
  try {
    entry.fit.fit();
  } catch {
    // Mid-layout; the next resize settles it.
  }
}

function Tool({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="grid size-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 [&_svg]:size-3.5">
      {children}
    </button>
  );
}

export function TerminalPanel({ onClose, maximized = false, onToggleMaximize, tabs }: {
  onClose: () => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  /** Panel-level tabs (Terminal / Run), rendered at the start of this panel's own header. */
  tabs?: ReactNode;
}) {
  const toast = useApp((s) => s.toast);
  const [sessions, setSessions] = useState<Record<string, TerminalSession>>({});
  const [groups, setGroups] = useState<TerminalGroups>(emptyGroups);
  const [shells, setShells] = useState<ShellChoice[]>([]);
  const [menu, setMenu] = useState(false);
  /**
   * Each terminal's share of its split (flex-grow). Keyed by id rather than position so a pane keeps
   * exactly the width the user gave it when others are added, closed or reordered around it.
   */
  const [weights, setWeights] = useState<Record<string, number>>({});
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const splitRef = useRef<HTMLDivElement | null>(null);
  /** Weights of the active group when a sash drag began; the drag is applied relative to them. */
  const dragStart = useRef<{ ids: string[]; weights: number[]; total: number } | null>(null);

  const attached = useRef(new Map<string, Attached>());
  const hosts = useRef(new Map<string, HTMLDivElement>());
  // A shell prints its prompt within milliseconds of spawning — before React has rendered its host
  // and built the xterm. Anything that arrives early is held here and replayed when the xterm exists.
  const pending = useRef(new Map<string, string[]>());

  /** Called by each session's host element: build its xterm the first time the element appears. */
  const hostRef = useCallback((id: string) => (node: HTMLDivElement | null) => {
    if (!node) { hosts.current.delete(id); return; }
    hosts.current.set(id, node);
    if (attached.current.has(id)) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: toXtermTheme(activeTheme()),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Keystrokes go straight to the pty; nothing here interprets them.
    term.onData((data) => void call('ide:term-write', { id, data }).catch(() => {}));
    term.onResize(({ cols, rows }) => void call('ide:term-resize', { id, cols, rows }).catch(() => {}));
    term.textarea?.addEventListener('focus', () => setGroups((g) => focusTerminal(g, id)));
    term.open(node);
    const entry = { term, fit };
    attached.current.set(id, entry);

    for (const chunk of pending.current.get(id) ?? []) term.write(chunk);
    pending.current.delete(id);

    // The host is often still zero-sized in the frame it is attached.
    requestAnimationFrame(() => { fitIfVisible(entry, node); term.focus(); });
  }, []);

  const start = useCallback(async (mode: 'new' | 'split', shellId?: string) => {
    try {
      const session = await call('ide:term-start', { shellId });
      setSessions((s) => ({ ...s, [session.id]: session }));
      // A split takes half of the focused terminal's width and leaves every other pane alone.
      const beside = mode === 'split' ? groupsRef.current.focused : null;
      setWeights((w) => {
        if (!beside) return { ...w, [session.id]: 1 };
        const half = (w[beside] ?? 1) / 2;
        return { ...w, [beside]: half, [session.id]: half };
      });
      setGroups((g) => (mode === 'split' ? splitTerminal(g, session.id) : addTerminal(g, session.id)));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }, [toast]);

  // Adopt terminals that already exist (the panel can be closed and reopened — the shells keep
  // running) and learn which shells this computer actually has.
  useEffect(() => {
    let live = true;
    void Promise.all([call('ide:term-list'), call('ide:term-shells')])
      .then(([list, choices]) => {
        if (!live) return;
        setShells(choices);
        setSessions(Object.fromEntries(list.map((s) => [s.id, s])));
        setGroups(adoptTerminals(list.map((s) => s.id)));
        if (list.length === 0) void start('new');
      })
      .catch((err) => { if (live) toast(errorMessage(err), 'error'); });
    return () => { live = false; };
  }, [start, toast]);

  // Output arrives as events, which is the only sane shape for a firehose of bytes.
  useEffect(() => on('ide:term-data', ({ id, chunk }) => {
    const entry = attached.current.get(id);
    if (entry) { entry.term.write(chunk); return; }
    const held = pending.current.get(id) ?? [];
    // Cap the hold: if a terminal is never mounted we must not grow without bound.
    if (held.length < 500) held.push(chunk);
    pending.current.set(id, held);
  }), []);

  const forget = useCallback((id: string) => {
    attached.current.get(id)?.term.dispose();
    attached.current.delete(id);
    pending.current.delete(id);
    setSessions((s) => { const next = { ...s }; delete next[id]; return next; });
    // Hand the closed pane's width to its neighbour so the rest of the split does not jump.
    const group = groupsRef.current.groups.find((g) => g.includes(id)) ?? [];
    const at = group.indexOf(id);
    const heir = group[at > 0 ? at - 1 : 1];
    setWeights((w) => {
      const next = { ...w };
      if (heir) next[heir] = (next[heir] ?? 1) + (next[id] ?? 1);
      delete next[id];
      return next;
    });
    setGroups((g) => removeTerminal(g, id));
  }, []);

  // A shell that exits (the user typed `exit`) leaves its split, like in any other editor.
  useEffect(() => on('ide:term-exit', ({ id }) => forget(id)), [forget]);

  const kill = async (id: string) => {
    await call('ide:term-stop', { id }).catch(() => {});
    forget(id);
  };

  // Keep every visible terminal fitted to its host as the panel, window or split changes size.
  useEffect(() => {
    const fitAll = () => { for (const [id, host] of hosts.current) fitIfVisible(attached.current.get(id), host); };
    const observer = new ResizeObserver(fitAll);
    for (const host of hosts.current.values()) observer.observe(host);
    window.addEventListener('resize', fitAll);
    requestAnimationFrame(fitAll);
    return () => { observer.disconnect(); window.removeEventListener('resize', fitAll); };
  }, [groups]);

  // Follow the app's light/dark switch. xterm reads its colours once, at creation, so without this a
  // terminal opened in dark mode stays a black box after the app goes light. Watching the attribute
  // (rather than the setting) also catches the OS flipping when colour mode is "system".
  useEffect(() => {
    const apply = () => {
      const theme = toXtermTheme(activeTheme());
      for (const { term } of attached.current.values()) term.options.theme = theme;
    };
    // Two triggers: the user picking a different editor theme, and the app flipping light/dark
    // (which "auto" follows, and which also fires when the OS changes under colour mode "system").
    const unsubscribe = onThemeChange(apply);
    const observer = new MutationObserver(() => requestAnimationFrame(apply));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { unsubscribe(); observer.disconnect(); };
  }, []);

  // Dispose every xterm when the panel unmounts. The ptys keep running; reopening reattaches.
  useEffect(() => {
    const map = attached.current;
    return () => { for (const { term } of map.values()) term.dispose(); map.clear(); };
  }, []);

  const activeIds = groups.groups[groups.active] ?? [];

  const sashHandlers = (index: number) => ({
    onDragStart: () => {
      const ids = groupsRef.current.groups[groupsRef.current.active] ?? [];
      dragStart.current = { ids, weights: ids.map((id) => weights[id] ?? 1), total: splitRef.current?.clientWidth ?? 0 };
    },
    onDrag: (delta: number) => {
      const start = dragStart.current;
      if (!start) return;
      const next = resizeBetween(start.weights, index, delta, start.total);
      setWeights((w) => ({ ...w, ...Object.fromEntries(start.ids.map((id, i) => [id, next[i]!])) }));
    },
    onDragEnd: () => { dragStart.current = null; },
    // Double-click evens out the whole split — a quick way back from any arrangement.
    onDoubleClick: () => setWeights((w) => ({ ...w, ...Object.fromEntries(activeIds.map((id) => [id, 1])) })),
  });

  const focusedShell = groups.focused ? sessions[groups.focused]?.shellId : undefined;
  const groupLabel = (g: string[]) => g.map((id) => sessions[id]?.label ?? '…').join(' | ');

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
        {tabs}
        <span className="mr-1 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Terminal</span>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {groups.groups.map((g, i) => (
            <button
              key={g.join()}
              onClick={() => setGroups((s) => focusTerminal(s, g[0]!))}
              className={cn('flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-[12px]', i === groups.active ? 'bg-hover text-ink' : 'text-ink-3 hover:text-ink')}
            >
              {g.length > 1 && <Columns2 className="size-3" />}
              {groupLabel(g)}
            </button>
          ))}
        </div>

        <div className="relative flex items-center">
          <Tool label="New terminal" onClick={() => void start('new', focusedShell)}><Plus /></Tool>
          <Tool label="Choose a shell" onClick={() => setMenu((v) => !v)}><ChevronDown /></Tool>
          {menu && (
            <ul className="absolute top-full right-0 z-20 mt-1 min-w-44 rounded-lg border border-line bg-overlay py-1 shadow-lg">
              {shells.map((s) => (
                <li key={s.id}>
                  <button onClick={() => { setMenu(false); void start('new', s.id); }} className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-hover">
                    New {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Tool label="Split terminal (side by side)" onClick={() => void start('split', focusedShell)} disabled={groups.groups.length === 0}><Columns2 /></Tool>
        <Tool label="Kill the focused terminal" onClick={() => groups.focused && void kill(groups.focused)} disabled={!groups.focused}><Trash2 /></Tool>
        {onToggleMaximize && (
          <Tool label={maximized ? 'Restore panel size' : 'Maximize panel'} onClick={onToggleMaximize}>
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </Tool>
        )}
        <Tool label="Hide panel (Ctrl+J)" onClick={onClose}><X /></Tool>
      </div>

      {groups.groups.length === 0 && (
        <p className="grid flex-1 place-items-center text-[12px] text-ink-3">No terminal running.</p>
      )}

      {/* One flat list keyed by session id, so a host element is never remounted: xterm is opened
          into it exactly once and cannot move. Which group is on screen, and the order inside a
          split, are expressed purely in CSS (display + order). */}
      {groups.groups.length > 0 && (
        <div ref={splitRef} className="flex min-h-0 flex-1">
          {allTerminalIds(groups).map((id) => {
            const at = activeIds.indexOf(id);
            const split = activeIds.length > 1;
            return (
              <div
                key={id}
                // Panes sit at even positions and sashes at odd ones, so a sash always lands between them.
                style={{ order: at * 2, flex: `${weights[id] ?? 1} 1 0px` }}
                onMouseDown={() => setGroups((s) => focusTerminal(s, id))}
                className={cn(
                  'relative min-w-0 px-2 py-1',
                  at === -1 && 'hidden',
                  split && groups.focused === id && 'shadow-[inset_0_2px_0_var(--accent)]',
                )}
              >
                <div ref={hostRef(id)} className="absolute inset-x-2 top-1 bottom-1" />
              </div>
            );
          })}
          {activeIds.slice(1).map((id, i) => (
            <div key={`sash-${id}`} style={{ order: i * 2 + 1 }} className="flex shrink-0 border-l border-line">
              <Sash orientation="vertical" label={`Resize terminals ${i + 1} and ${i + 2}`} {...sashHandlers(i)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
