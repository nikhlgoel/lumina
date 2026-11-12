import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BadgeCheck, ChevronDown, Disc3, LayoutGrid, List, ListMusic, Music2, Play, RotateCw, Video } from 'lucide-react';
import type { SearchHit, SearchPart } from '@shared/types';
import { formatDuration, plural } from '@core/format';
import { visibleHits, withoutDuplicates } from '@core/searchResults';
import { call } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { Segmented } from '@/components/ui';

/**
 * Search results for the link bar: Songs and Albums and Playlists (YouTube Music) and Videos (YouTube). Each is asked for on its own and shown the moment it
 * answers, so nothing waits for the slowest. Two ways to look: a list (a picture beside each result) and a grid (big pictures); a row of choices narrows it to
 * one kind. Each section shows its first few results with "Show more", and "Load more" asks the source for further ones.
 *
 * Every result can be played without downloading (the round button) or opened to download: a song or video goes to the normal download screen, an album or
 * playlist opens its track list to pick from.
 */

type View = 'list' | 'grid';
type Kind = 'songs' | 'albums' | 'playlists' | 'videos';
type Filter = 'all' | Kind;
interface Part extends SearchPart { loading: boolean; loadingMore: boolean; limit: number }

const KINDS: Kind[] = ['songs', 'albums', 'playlists', 'videos'];
const FIRST_LIMIT = 12;
const NEXT_LIMIT = (n: number) => Math.min(40, n < 24 ? 24 : 40);
const VIEW_KEY = 'lumina.search.view';
const LOADING: Part = { hits: [], failed: false, more: false, loading: true, loadingMore: false, limit: FIRST_LIMIT };
const CHANNEL = { songs: 'search:songs', albums: 'search:albums', playlists: 'search:playlists', videos: 'search:videos' } as const;

const META: Record<Kind, { title: string; hint: string; icon: ReactNode; wide: boolean; none: string }> = {
  songs: { title: 'Songs', hint: 'YouTube Music', icon: <Music2 className="size-3.5" />, wide: false, none: 'songs' },
  albums: { title: 'Albums', hint: 'YouTube Music', icon: <Disc3 className="size-3.5" />, wide: false, none: 'albums' },
  playlists: { title: 'Playlists', hint: 'YouTube Music', icon: <ListMusic className="size-3.5" />, wide: false, none: 'playlists' },
  videos: { title: 'Videos', hint: 'YouTube', icon: <Video className="size-3.5" />, wide: true, none: 'videos' },
};

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

export function SearchPanel({ query, onPick, onPlay }: { query: string; onPick: (hit: SearchHit) => void; onPlay: (hit: SearchHit) => void }) {
  const [parts, setParts] = useState<Record<Kind, Part>>({ songs: LOADING, albums: LOADING, playlists: LOADING, videos: LOADING });
  const [view, setView] = useState<View>(savedView);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Record<Kind, boolean>>({ songs: false, albums: false, playlists: false, videos: false });
  const token = useRef(0);

  const ask = useCallback(async (kind: Kind, limit: number): Promise<SearchPart> => {
    try {
      return await call(CHANNEL[kind], { query, limit });
    } catch {
      return { hits: [], failed: true, more: false };
    }
  }, [query]);

  const load = useCallback(async (kind: Kind, limit: number, more: boolean) => {
    const mine = token.current;
    setParts((all) => ({ ...all, [kind]: { ...all[kind], loading: !more, loadingMore: more, failed: more ? all[kind].failed : false } }));
    const part = await ask(kind, limit);
    if (mine !== token.current) return; // another search has begun since
    // Asking for more that failed keeps what is already on screen.
    setParts((all) => ({ ...all, [kind]: more && part.failed ? { ...all[kind], loading: false, loadingMore: false } : { ...part, loading: false, loadingMore: false, limit } }));
  }, [ask]);

  useEffect(() => {
    token.current += 1;
    setParts({ songs: LOADING, albums: LOADING, playlists: LOADING, videos: LOADING });
    setOpen({ songs: false, albums: false, playlists: false, videos: false });
    setFilter('all');
    for (const kind of KINDS) void load(kind, FIRST_LIMIT, false);
  }, [query, load]);

  const chooseView = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* remembering the choice is a convenience */ }
  };

  // A track already listed as a song is not listed again as a video.
  const videoHits = useMemo(() => withoutDuplicates(parts.songs.hits, parts.videos.hits), [parts.songs.hits, parts.videos.hits]);
  const hitsOf = (kind: Kind) => (kind === 'videos' ? videoHits : parts[kind].hits);
  const settled = KINDS.every((k) => !parts[k].loading);
  const nothing = settled && KINDS.every((k) => !hitsOf(k).length && !parts[k].failed);
  const shown = filter === 'all' ? KINDS : [filter];

  return (
    <div className="animate-rise">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <Segmented<Filter>
          label="What to show"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            ...KINDS.map((k) => ({ value: k as Filter, label: META[k].title })),
          ]}
        />
        <Segmented<View>
          label="How to show the results"
          size="sm"
          value={view}
          onChange={chooseView}
          options={[
            { value: 'list', label: <span className="inline-flex items-center gap-1.5"><List className="size-3.5" />List</span> },
            { value: 'grid', label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" />Grid</span> },
          ]}
        />
      </div>

      {nothing ? (
        <p className="rounded-xl border border-line bg-panel p-6 text-center text-sm text-ink-3">No results for “{query}”. Try different words, or paste a link.</p>
      ) : (
        <div className="space-y-8">
          {shown.map((kind) => (
            <Section
              key={kind} kind={kind} part={parts[kind]} hits={hitsOf(kind)} view={view}
              expanded={open[kind] || filter !== 'all'} showFewer={filter === 'all'}
              onExpand={(v) => setOpen((o) => ({ ...o, [kind]: v }))} onPick={onPick} onPlay={onPlay}
              onMore={() => void load(kind, NEXT_LIMIT(parts[kind].limit), true)} onRetry={() => void load(kind, FIRST_LIMIT, false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** How many a section shows before "Show more": a grid fits a row or two of cards, a list a handful of rows. */
const FIRST_SHOWN: Record<View, number> = { list: 5, grid: 6 };

function Section({ kind, part, hits, view, expanded, showFewer, onExpand, onPick, onPlay, onMore, onRetry }: {
  kind: Kind; part: Part; hits: SearchHit[]; view: View; expanded: boolean; showFewer: boolean;
  onExpand: (open: boolean) => void; onPick: (hit: SearchHit) => void; onPlay: (hit: SearchHit) => void; onMore: () => void; onRetry: () => void;
}) {
  const meta = META[kind];
  const { shown, hidden } = visibleHits(hits, expanded, FIRST_SHOWN[view]);
  const wide = meta.wide;
  // Nothing at all and not an error: this section has nothing to say (the others may).
  if (!part.loading && !hits.length && !part.failed) return null;

  return (
    <section aria-label={meta.title} aria-busy={part.loading}>
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">{meta.title}</h2>
        <span className="flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-3">{meta.icon}{meta.hint}</span>
        {hits.length > 0 && <span className="text-[11px] text-ink-3 tabular">{hits.length}{part.more ? '+' : ''}</span>}
      </div>

      {part.loading ? (
        <Skeleton view={view} wide={wide} />
      ) : part.failed && !hits.length ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 text-sm text-ink-3">
          <span>Couldn’t reach {meta.hint} just now.</span>
          <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent outline-none">
            <RotateCw className="size-3.5" /> Try again
          </button>
        </div>
      ) : view === 'list' ? (
        <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
          {shown.map((hit) => <ListRow key={hit.url} hit={hit} wide={wide} onPick={onPick} onPlay={onPlay} />)}
        </div>
      ) : (
        <div className={cn('grid gap-3', wide ? 'grid-cols-[repeat(auto-fill,minmax(210px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]')}>
          {shown.map((hit) => <Card key={hit.url} hit={hit} wide={wide} onPick={onPick} onPlay={onPlay} />)}
        </div>
      )}

      {!part.loading && hits.length > 0 && ((showFewer && (hidden > 0 || expanded)) || (expanded && hidden === 0 && part.more)) && (
        <div className="mt-2.5 flex items-center gap-2">
          {showFewer && (hidden > 0 || expanded) && (
            <button
              onClick={() => onExpand(!expanded)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent outline-none"
            >
              <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
              {expanded ? 'Show fewer' : `Show ${hidden} more`}
            </button>
          )}
          {expanded && hidden === 0 && part.more && (
            <button
              onClick={onMore}
              disabled={part.loadingMore}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent outline-none disabled:opacity-60"
            >
              {part.loadingMore ? 'Loading…' : `Load more ${meta.none}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Skeleton({ view, wide }: { view: View; wide: boolean }) {
  if (view === 'grid') {
    return (
      <div className={cn('grid gap-3', wide ? 'grid-cols-[repeat(auto-fill,minmax(210px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]')}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-2">
            <div className={cn('skeleton rounded-xl', wide ? 'aspect-video' : 'aspect-square')} style={{ opacity: 1 - i * 0.1 }} />
            <div className="skeleton h-3.5 w-4/5 rounded" />
            <div className="skeleton h-3 w-1/2 rounded" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-3 py-3 last:border-b-0">
          <div className={cn('skeleton shrink-0 rounded-lg', wide ? 'aspect-video w-[168px]' : 'size-16')} />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-3/5 rounded" />
            <div className="skeleton h-3 w-2/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

const isCollection = (hit: SearchHit) => hit.kind === 'album' || hit.kind === 'playlist';

/** The picture of a result, with the length laid over its corner; a plain tile when there is no picture or it will not load. */
function Art({ hit, className }: { hit: SearchHit; className: string }) {
  const [broken, setBroken] = useState(false);
  const Fallback = hit.kind === 'video' ? Video : hit.kind === 'album' ? Disc3 : hit.kind === 'playlist' ? ListMusic : Music2;
  return (
    <span className={cn('relative block shrink-0 overflow-hidden bg-sunken', className)}>
      {hit.thumbnail && !broken ? (
        <img src={hit.thumbnail} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-ink-3"><Fallback className="size-6" /></span>
      )}
      {hit.kind === 'video' && hit.durationSec != null && (
        <span className="absolute right-1 bottom-1 rounded bg-black/80 px-1 py-px text-[11px] font-semibold text-white tabular">{formatDuration(hit.durationSec)}</span>
      )}
    </span>
  );
}

/** "Channel ✓", with a tick when the channel is verified. */
function Byline({ hit }: { hit: SearchHit }) {
  const line = hit.kind === 'audio' ? [hit.subtitle, hit.album].filter(Boolean).join(' · ') : hit.subtitle;
  if (!line) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[13px] text-ink-3">
      <span className="truncate">{line}</span>
      {hit.verified && <BadgeCheck className="size-3.5 shrink-0 text-ink-3" aria-label="Verified channel" />}
    </span>
  );
}

const facts = (hit: SearchHit): string => {
  if (hit.kind === 'album') return [hit.albumType && hit.albumType !== 'Album' ? hit.albumType : null, hit.year].filter(Boolean).join(' · ');
  if (hit.kind === 'playlist') return hit.trackCount ? plural(hit.trackCount, 'song') : '';
  return [hit.views, hit.published].filter(Boolean).join(' · ');
};
const actionWord = (hit: SearchHit): string => (hit.kind === 'audio' ? 'Get song' : hit.kind === 'album' ? 'Open album' : hit.kind === 'playlist' ? 'Open playlist' : 'Get video');
const playLabel = (hit: SearchHit): string => (isCollection(hit) ? `Play ${hit.title} from the first track` : `Play ${hit.title}`);

/** The round play button: plays the result in Lumina, without downloading it. */
function PlayButton({ hit, onPlay, className }: { hit: SearchHit; onPlay: (hit: SearchHit) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onPlay(hit)}
      aria-label={playLabel(hit)}
      title={isCollection(hit) ? 'Play from the first track' : 'Play'}
      className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-ink shadow-sm transition-[filter,transform] hover:brightness-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel outline-none', className)}
    >
      <Play className="ml-0.5 size-4 fill-current" />
    </button>
  );
}

function ListRow({ hit, wide, onPick, onPlay }: { hit: SearchHit; wide: boolean; onPick: (hit: SearchHit) => void; onPlay: (hit: SearchHit) => void }) {
  return (
    <div className="group flex w-full items-center gap-3 border-b border-line pr-3 transition-colors last:border-b-0 hover:bg-hover focus-within:bg-hover">
      <button type="button" onClick={() => onPick(hit)} className="flex min-w-0 flex-1 items-center gap-3.5 py-3 pl-3 text-left outline-none focus-visible:underline">
        <Art hit={hit} className={wide ? 'aspect-video w-[168px] rounded-lg' : 'size-16 rounded-lg'} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] leading-snug font-semibold text-ink" title={hit.title}>{hit.title}</span>
          <Byline hit={hit} />
          {facts(hit) && <span className="mt-0.5 block truncate text-xs text-ink-3">{facts(hit)}</span>}
        </span>
        {!wide && !isCollection(hit) && hit.durationSec != null && <span className="shrink-0 text-xs text-ink-3 tabular">{formatDuration(hit.durationSec)}</span>}
        <span className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-semibold text-ink-2 transition-colors group-hover:border-accent group-hover:text-accent">
          {actionWord(hit)}
        </span>
      </button>
      <PlayButton hit={hit} onPlay={onPlay} />
    </div>
  );
}

function Card({ hit, wide, onPick, onPlay }: { hit: SearchHit; wide: boolean; onPick: (hit: SearchHit) => void; onPlay: (hit: SearchHit) => void }) {
  return (
    <div className="group flex flex-col gap-2 rounded-xl p-1.5 transition-colors hover:bg-hover focus-within:bg-hover">
      <div className="relative">
        {/* The picture opens it too (the title below is the one keyboard users reach); the play button sits on its corner. */}
        <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => onPick(hit)} className="block w-full">
          <Art hit={hit} className={cn('w-full rounded-lg shadow-sm transition-transform duration-200 group-hover:scale-[1.015]', wide ? 'aspect-video' : 'aspect-square')} />
        </button>
        <PlayButton hit={hit} onPlay={onPlay} className="absolute right-2 bottom-2 size-10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100" />
      </div>
      <button type="button" onClick={() => onPick(hit)} className="min-w-0 px-0.5 text-left outline-none focus-visible:underline">
        <span className="line-clamp-2 text-sm leading-snug font-semibold text-ink" title={hit.title}>{hit.title}</span>
        <Byline hit={hit} />
        {(facts(hit) || (!wide && !isCollection(hit) && hit.durationSec != null)) && (
          <span className="mt-0.5 block truncate text-xs text-ink-3">{facts(hit) || (hit.durationSec != null ? formatDuration(hit.durationSec) : '')}</span>
        )}
        <span className="sr-only">{actionWord(hit)}</span>
      </button>
    </div>
  );
}
