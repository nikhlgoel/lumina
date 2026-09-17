import { useMemo, useState } from 'react';
import { Check, Minus, Search } from 'lucide-react';
import type { PlaylistEntry } from '@shared/types';
import { formatDuration } from '@core/format';
import { cn } from '@/lib/cn';

export function Checkbox({ state }: { state: 'on' | 'off' | 'mixed' }) {
  return (
    <span className={cn('grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors', state === 'off' ? 'border-line-strong bg-raised' : 'border-accent bg-accent text-accent-ink')}>
      {state === 'on' && <Check className="size-3" strokeWidth={3} />}
      {state === 'mixed' && <Minus className="size-3" strokeWidth={3} />}
    </span>
  );
}

/** `selected` holds the 1-based indices to download. */
export function PlaylistPicker({ entries, selected, onChange }: { entries: PlaylistEntry[]; selected: Set<number>; onChange: (s: Set<number>) => void }) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? entries.filter((e) => e.title.toLowerCase().includes(q) || e.uploader.toLowerCase().includes(q)) : entries;
  }, [entries, filter]);

  const headState = selected.size === 0 ? 'off' : selected.size === entries.length ? 'on' : 'mixed';

  const toggle = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onChange(next);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-raised">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        <button
          onClick={() => onChange(headState === 'on' ? new Set() : new Set(entries.map((e) => e.index)))}
          className="flex items-center gap-2.5 rounded-md px-1 py-1 text-[13px] font-semibold hover:bg-hover"
        >
          <Checkbox state={headState} />
          <span className="tabular">{selected.size} of {entries.length} selected</span>
        </button>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            aria-label="Filter playlist items"
            className="h-7 w-44 rounded-md border border-line bg-sunken pr-2 pl-7 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent"
          />
        </div>
      </div>
      <ul className="max-h-[300px] overflow-auto py-1">
        {shown.map((e) => (
          <li key={`${e.index}-${e.id}`}>
            <button onClick={() => toggle(e.index)} className="flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors hover:bg-hover">
              <Checkbox state={selected.has(e.index) ? 'on' : 'off'} />
              <span className="w-7 shrink-0 text-right text-xs text-ink-3 tabular">{e.index}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{e.title}</span>
                {e.uploader && <span className="block truncate text-xs text-ink-3">{e.uploader}</span>}
              </span>
              <span className="text-xs text-ink-3 tabular">{formatDuration(e.durationSec)}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-ink-3">No items match “{filter}”.</li>}
      </ul>
    </div>
  );
}
