// The two overlays every editor needs: Quick Open (Ctrl+P, jump to a file) and the Command Palette
// (Ctrl+Shift+P, run a command), plus the Find-in-Files panel (Ctrl+Shift+F).
//
// Both overlays share one list widget because they behave identically — type to filter, arrows to
// move, Enter to pick, Escape to dismiss. Ranking is the pure `fuzzyRank` from @core/ide, so the
// scoring is unit-tested rather than tuned by eye.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import type { CodeSearchHit } from '@shared/types';
import { fuzzyRank } from '@core/ide';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';

export interface Command {
  id: string;
  /** What the palette shows and matches against. */
  label: string;
  /** Right-aligned hint, usually the keyboard shortcut. */
  hint?: string;
  run: () => void;
}

/** Highlight the characters the fuzzy matcher actually matched. */
function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} className={set.has(i) ? 'font-semibold text-accent' : undefined}>{ch}</span>
      ))}
    </>
  );
}

/** Shared overlay: a filter box over a ranked list. */
function Overlay<T>({ placeholder, items, textOf, render, onPick, onClose }: {
  placeholder: string;
  items: T[];
  textOf: (item: T) => string;
  render: (item: T, positions: number[]) => ReactNode;
  onPick: (item: T) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const ranked = useMemo(() => fuzzyRank(items, query, textOf, 200), [items, query, textOf]);

  // A new query invalidates the old highlight position.
  useEffect(() => { setIndex(0); }, [query]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  // Escape must close the overlay even if focus has wandered off the input — otherwise a stray
  // click leaves a modal that only the backdrop can dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, ranked.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = ranked[index];
      if (picked) onPick(picked.item);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/30 pt-[12vh]" role="dialog" aria-modal="true" aria-label={placeholder}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[60vh] w-[min(620px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <input
          autoFocus
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-11 shrink-0 border-b border-line bg-transparent px-4 text-sm outline-none placeholder:text-ink-3"
        />
        {ranked.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-ink-3">No matches.</p>
        ) : (
          <ul ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
            {ranked.map((r, i) => (
              <li key={textOf(r.item)}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); onPick(r.item); }}
                  onMouseEnter={() => setIndex(i)}
                  className={cn('flex w-full items-center gap-2 px-4 py-1.5 text-left text-[13px]', i === index && 'bg-accent-soft')}
                >
                  {render(r.item, r.positions)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="shrink-0 border-t border-line px-4 py-1.5 text-[11px] text-ink-3">
          ↑↓ to move · <CornerDownLeft className="inline size-3" /> to open · Esc to close
        </p>
      </div>
    </div>
  );
}

/** Ctrl+P — jump to any file in the workspace by name. */
export function QuickOpen({ onOpen, onClose }: { onOpen: (path: string) => void; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void call('ide:files')
      .then((list) => { if (live) setFiles(list); })
      .catch((err) => { if (live) toast(errorMessage(err), 'error'); });
    return () => { live = false; };
  }, [toast]);

  return (
    <Overlay
      placeholder="Go to file…"
      items={files}
      textOf={(f) => f}
      onPick={(f) => { onOpen(f); onClose(); }}
      onClose={onClose}
      render={(f, positions) => {
        const slash = f.lastIndexOf('/');
        return (
          <>
            <span className="truncate"><Highlight text={f} positions={positions} /></span>
            {slash > 0 && <span className="ml-auto shrink-0 truncate pl-3 text-ink-3">{f.slice(0, slash)}</span>}
          </>
        );
      }}
    />
  );
}

/** Ctrl+Shift+P — run any registered command. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  return (
    <Overlay
      placeholder="Run a command…"
      items={commands}
      textOf={(c) => c.label}
      onPick={(c) => { onClose(); c.run(); }}
      onClose={onClose}
      render={(c, positions) => (
        <>
          <span className="truncate"><Highlight text={c.label} positions={positions} /></span>
          {c.hint && <span className="ml-auto shrink-0 pl-3 font-mono text-[11px] text-ink-3">{c.hint}</span>}
        </>
      )}
    />
  );
}

/** Ctrl+Shift+F — search every text file in the workspace and jump to a hit. */
export function SearchPanel({ onOpen, onClose }: {
  onOpen: (path: string, line: number, column: number) => void;
  onClose: () => void;
}) {
  const toast = useApp((s) => s.toast);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hits, setHits] = useState<CodeSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      setHits(await call('ide:search', { query, caseSensitive }));
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Group by file so the results read like a file list, not a flat wall of lines.
  const byFile = useMemo(() => {
    const map = new Map<string, CodeSearchHit[]>();
    for (const h of hits ?? []) map.set(h.path, [...(map.get(h.path) ?? []), h]);
    return [...map.entries()];
  }, [hits]);

  return (
    // Fills whichever sidebar hosts it — left or right is the layout's decision, not this panel's.
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <Search className="size-3.5 shrink-0 text-ink-3" />
        <span className="flex-1 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Search</span>
        <button onClick={onClose} className="rounded px-1.5 text-[12px] text-ink-3 hover:bg-hover hover:text-ink" aria-label="Close search">Esc</button>
      </div>
      <div className="space-y-2 border-b border-line p-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(); if (e.key === 'Escape') onClose(); }}
          placeholder="Search…"
          aria-label="Search in files"
          className="h-8 w-full rounded-lg border border-line-strong bg-raised px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <label className="flex items-center gap-2 text-[12px] text-ink-3">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
          Match case
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {busy && <p className="px-3 py-2 text-[12px] text-ink-3">Searching…</p>}
        {!busy && hits && hits.length === 0 && <p className="px-3 py-2 text-[12px] text-ink-3">No matches.</p>}
        {!busy && byFile.map(([file, list]) => (
          <div key={file} className="border-b border-line last:border-b-0">
            <p className="truncate px-3 py-1.5 text-[12px] font-semibold" title={file}>
              {file} <span className="font-normal text-ink-3">· {list.length}</span>
            </p>
            {list.map((h, i) => (
              <button
                key={`${h.line}-${h.column}-${i}`}
                onClick={() => onOpen(h.path, h.line, h.column)}
                className="flex w-full gap-2 px-3 py-1 text-left text-[12px] hover:bg-hover"
              >
                <span className="shrink-0 tabular text-ink-3">{h.line}</span>
                <span className="truncate font-mono">{h.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
