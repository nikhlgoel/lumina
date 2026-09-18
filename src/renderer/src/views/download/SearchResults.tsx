import { useState } from 'react';
import { Music2, Video } from 'lucide-react';
import type { SearchHit, SearchResults as Results } from '@shared/types';
import { formatDuration } from '@core/format';

/**
 * Search results split by intent: Songs (YouTube Music, download as audio) and Videos (YouTube). One query like
 * "animal" surfaces both, clearly labelled, so the person picks what they meant. Clicking a result hands its URL
 * back to the normal inspect→download flow, which already defaults to the right format for each source.
 */
export function SearchResults({ results, onPick }: { results: Results; onPick: (hit: SearchHit) => void }) {
  const { songs, videos } = results;
  if (!songs.length && !videos.length) {
    return <p className="rounded-xl border border-line bg-panel p-6 text-center text-sm text-ink-3 animate-rise">No results for “{results.query}”. Try different words, or paste a link.</p>;
  }
  return (
    <div className="space-y-7 animate-rise">
      {songs.length > 0 && <Section title="Songs" hint="YouTube Music" icon={<Music2 className="size-3.5" />} hits={songs} onPick={onPick} art="square" />}
      {videos.length > 0 && <Section title="Videos" hint="YouTube" icon={<Video className="size-3.5" />} hits={videos} onPick={onPick} art="wide" />}
    </div>
  );
}

function Section({ title, hint, icon, hits, onPick, art }: {
  title: string; hint: string; icon: React.ReactNode; hits: SearchHit[]; onPick: (hit: SearchHit) => void; art: 'square' | 'wide';
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">{title}</h2>
        <span className="flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-3">{icon}{hint}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
        {hits.map((hit) => <HitRow key={hit.url} hit={hit} onPick={onPick} art={art} />)}
      </div>
    </section>
  );
}

function HitRow({ hit, onPick, art }: { hit: SearchHit; onPick: (hit: SearchHit) => void; art: 'square' | 'wide' }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onPick(hit)}
      className="group flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
    >
      <span className={art === 'wide' ? 'relative aspect-video w-[92px] shrink-0 overflow-hidden rounded-md bg-sunken' : 'relative size-12 shrink-0 overflow-hidden rounded-md bg-sunken'}>
        {hit.thumbnail && !broken ? (
          <img src={hit.thumbnail} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-ink-3">{hit.kind === 'audio' ? <Music2 className="size-5" /> : <Video className="size-5" />}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{hit.title}</span>
        {hit.subtitle && <span className="block truncate text-[13px] text-ink-3">{hit.subtitle}</span>}
      </span>
      {hit.durationSec != null && <span className="shrink-0 text-xs text-ink-3 tabular">{formatDuration(hit.durationSec)}</span>}
      <span className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors group-hover:border-accent group-hover:text-accent">
        {hit.kind === 'audio' ? 'Get song' : 'Get video'}
      </span>
    </button>
  );
}
