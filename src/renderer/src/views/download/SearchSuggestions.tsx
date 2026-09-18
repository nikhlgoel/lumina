import { History, Search } from 'lucide-react';

/**
 * The menu that drops under the search bar when it's focused and empty: the person's recent searches, so the
 * bar always has something to offer instead of a blank box. Clicking one re-runs it; Clear empties the list.
 */
export function SearchSuggestions({ items, onPick, onClear }: { items: string[]; onPick: (query: string) => void; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="absolute inset-x-0 top-full z-[2] mt-2 overflow-hidden rounded-xl border border-line bg-overlay shadow-[0_16px_40px_-16px_rgb(0_0_0/0.4)] animate-rise">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
          <History className="size-3.5" /> Recent searches
        </span>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onClear(); }}
          className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          Clear
        </button>
      </div>
      <ul className="pb-1">
        {items.map((q) => (
          <li key={q}>
            {/* onMouseDown, not onClick: the input's blur fires first and would close the menu before a click lands. */}
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(q); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <Search className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate">{q}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
