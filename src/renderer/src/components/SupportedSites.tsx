import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Search } from 'lucide-react';
import { call } from '@/lib/bridge';
import { Dialog } from './ui';

const SITES_URL = 'https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md';

/** Every site the bundled yt-dlp can handle, read live from `yt-dlp --list-extractors`, searchable. */
export function SupportedSites({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sites, setSites] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || sites) return;
    call('tools:supported-sites').then(setSites).catch(() => setFailed(true));
  }, [open, sites]);

  const filtered = useMemo(() => {
    if (!sites) return [];
    const needle = query.trim().toLowerCase();
    return needle ? sites.filter((s) => s.toLowerCase().includes(needle)) : sites;
  }, [sites, query]);

  return (
    <Dialog open={open} onClose={onClose} title="Supported sites" width={620}>
      <div className="flex h-[62vh] flex-col">
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a site — youtube, vimeo, soundcloud…"
            aria-label="Search supported sites"
            spellCheck={false}
            className="h-10 w-full rounded-lg border border-line-strong bg-raised pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
          />
        </div>

        <p className="mt-2.5 shrink-0 text-xs text-ink-3">
          {failed ? (
            'Couldn’t read the list from yt-dlp.'
          ) : !sites ? (
            'Reading the list from yt-dlp…'
          ) : query.trim() ? (
            `${filtered.length} of ${sites.length} match “${query.trim()}”`
          ) : (
            `${sites.length} sites and services, from the bundled yt-dlp`
          )}
        </p>

        <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-sunken/40">
          {!sites && !failed ? (
            <div className="grid h-full place-items-center text-ink-3">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-ink-3">
              {failed ? 'Open Settings to repair yt-dlp, or view the full list on GitHub below.' : `No site matches “${query.trim()}”. It may still work — Lumina always tries.`}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 p-2 sm:grid-cols-3">
              {filtered.map((name) => (
                <li key={name} className="truncate px-2 py-1 font-mono text-[12px] text-ink-2" title={name}>{name}</li>
              ))}
            </ul>
          )}
        </div>

        <a
          href={SITES_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex shrink-0 items-center gap-1.5 self-start text-[13px] font-semibold text-accent transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent rounded outline-none"
        >
          Open the full, always-current list on GitHub
          <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </Dialog>
  );
}
