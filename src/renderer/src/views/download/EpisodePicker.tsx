import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, FolderOpen, Tv, TriangleAlert } from 'lucide-react';
import type { EpisodeBatch, EpisodeItem, MediaInfo, RequestInfo } from '@shared/types';
import { alreadyHave, episodeFileBase, orderedEpisodes, safeName } from '@core/episodes';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Badge, Button, ProgressBar } from '@/components/ui';
import { Checkbox } from './PlaylistPicker';
import { quickOptions } from './quickOptions';

/** Streams are read a few at a time: each read is a small request, and a site that sees twelve at once may refuse some of them. */
const PROBE_CONCURRENCY = 3;

type RowState = { state: 'added' } | { state: 'failed'; message: string };

async function pool<T>(items: T[], limit: number, run: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await run(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const key = (e: Pick<EpisodeItem, 'season' | 'number'>) => `${e.season}:${e.number}`;
const label = (e: EpisodeItem) => `S${String(e.season).padStart(2, '0')}E${String(e.number).padStart(2, '0')}`;

/** The request to read one episode's video with: what the browser asked for it with, and the cookies of the page it was found on. */
function requestFor(batch: EpisodeBatch, item: EpisodeItem): RequestInfo {
  return { ...batch.request, headers: item.headers, pageUrl: item.pageUrl ?? batch.request.pageUrl, fromLink: false };
}

/**
 * The episodes of a series sent from the browser: each one already has the address of its own video (the extension found it by opening the
 * episode), so what is left to decide is the name of the series and where it goes. Episodes go to `Series/<Show>/Season NN/`, named
 * "Show - S01E03", and one that is already there is not fetched again.
 */
export function EpisodePicker({ batch, onDone, onCancel }: { batch: EpisodeBatch; onDone: () => void; onCancel: () => void }) {
  const settings = useApp((s) => s.settings)!;
  const toast = useApp((s) => s.toast);
  const setView = useApp((s) => s.setView);
  const episodes = useMemo(() => orderedEpisodes(batch.items), [batch]);
  const [show, setShow] = useState(() => safeName(batch.show, 100) || 'Series');
  const [baseDir, setBaseDir] = useState(settings.storage.seriesDir);
  const [folders, setFolders] = useState<Map<number, { dir: string; have: Set<string> }>>(() => new Map());
  const [selected, setSelected] = useState<Set<string>>(() => new Set(episodes.map(key)));
  const [results, setResults] = useState<Map<string, RowState>>(() => new Map());
  const [running, setRunning] = useState(false);
  const [probed, setProbed] = useState(0);
  const [folderFailed, setFolderFailed] = useState(false);
  const seasons = useMemo(() => [...new Set(episodes.map((e) => e.season))], [episodes]);

  // What the disk says, per season: the folder, and which episodes are already in it. Asked again when the name or the folder changes.
  useEffect(() => {
    let current = true;
    setFolders(new Map());
    setFolderFailed(false);
    const timer = setTimeout(() => {
      void Promise.all(seasons.map(async (season) => [season, await call('series:folder', { base: baseDir, show: show || 'Series', season })] as const))
        .then((all) => {
          if (current) setFolders(new Map(all.map(([season, f]) => [season, { dir: f.dir, have: new Set(f.have) }])));
        })
        .catch(() => { if (current) setFolderFailed(true); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [baseDir, show, seasons]);

  const have = (e: EpisodeItem) => Boolean(folders.get(e.season) && alreadyHave(folders.get(e.season)!.have, show, e));
  // An episode that is already there starts unticked, once the disk has said so.
  useEffect(() => {
    if (!folders.size) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of episodes) if (have(e)) next.delete(key(e));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders]);

  const chosen = episodes.filter((e) => selected.has(key(e)));
  const ready = folders.size === seasons.length && !folderFailed;
  const toggle = (e: EpisodeItem) => {
    const next = new Set(selected);
    if (next.has(key(e))) next.delete(key(e));
    else next.add(key(e));
    setSelected(next);
  };

  const pickFolder = async () => {
    const dir = await call('dialog:pick-folder', { title: 'Save this series to' });
    if (dir) setBaseDir(dir);
  };

  const start = async () => {
    if (!ready || !chosen.length) return;
    setRunning(true);
    setProbed(0);
    const infos: (MediaInfo | null)[] = new Array(chosen.length).fill(null);
    const next = new Map<string, RowState>();
    // Read every video's address first (a few at a time), then queue in episode order so they are fetched in that order.
    await pool(chosen, PROBE_CONCURRENCY, async (e, i) => {
      try {
        infos[i] = await call('media:inspect', { url: e.url, request: requestFor(batch, e) });
      } catch (err) {
        next.set(key(e), { state: 'failed', message: `${label(e)}: ${errorMessage(err)}` });
      }
      setProbed((n) => n + 1);
    });
    for (const [i, e] of chosen.entries()) {
      const info = infos[i];
      if (!info) continue;
      const base = episodeFileBase(show, e.season, e.number, e.title);
      const dir = folders.get(e.season)!.dir;
      // A plain file takes its name from the server, a stream from the options: the name is set where each one looks for it.
      const named: MediaInfo = { ...info, title: base, ...(info.direct ? { direct: { ...info.direct, filename: `${base}${/\.[A-Za-z0-9]{1,5}$/.exec(info.direct.filename)?.[0] ?? '.mp4'}` } } : {}) };
      try {
        await call('jobs:add', { url: e.url, info: named, options: { ...quickOptions(named, settings), targetDir: dir, fileName: base } });
        next.set(key(e), { state: 'added' });
      } catch (err) {
        next.set(key(e), { state: 'failed', message: errorMessage(err) });
      }
    }
    setResults(next);
    setRunning(false);
    const added = [...next.values()].filter((r) => r.state === 'added').length;
    if (added) toast(`Queued ${added} episode${added === 1 ? '' : 's'} of ${show}`, 'success', { label: 'View', run: () => setView('queue') });
    if (added === chosen.length) onDone();
  };

  const started = results.size > 0;
  const failed = [...results.values()].filter((r) => r.state === 'failed').length;
  const already = episodes.filter(have).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm animate-rise" aria-label="Series download">
      <header className="flex items-center gap-3 border-b border-line p-5">
        <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent"><Tv className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <input
            value={show}
            onChange={(e) => setShow(e.target.value)}
            disabled={running || started}
            aria-label="Series name"
            className="w-full truncate rounded-md bg-transparent text-lg font-semibold tracking-tight outline-none focus:bg-sunken focus-visible:ring-2 focus-visible:ring-accent"
          />
          <p className="text-sm text-ink-3">
            {episodes.length} episode{episodes.length === 1 ? '' : 's'} with a video, found by opening each one in your browser
            {already > 0 && ` · ${already} already in the folder`}
          </p>
        </div>
        {!started && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(episodes.filter((e) => !have(e)).map(key)))}>New only</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(episodes.map(key)))}>All</Button>
          </div>
        )}
      </header>

      {running && (
        <div className="px-5 pt-4">
          <ProgressBar value={(probed / Math.max(1, chosen.length)) * 100} />
          <p className="mt-1.5 text-xs text-ink-3 tabular">Reading the videos · {probed} of {chosen.length}</p>
        </div>
      )}

      <ul className="max-h-[380px] overflow-auto px-2 py-2">
        {episodes.map((e) => {
          const on = selected.has(key(e));
          const result = results.get(key(e));
          const there = have(e);
          return (
            <li key={key(e)}>
              <button
                onClick={() => toggle(e)}
                disabled={started || running}
                aria-pressed={on}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default', !on && !started && 'opacity-70')}
              >
                <Checkbox state={on ? 'on' : 'off'} />
                <span className="w-16 shrink-0 text-sm font-semibold tabular text-ink-2">{label(e)}</span>
                <span className="min-w-0 flex-1 truncate text-sm" data-selectable>{e.title || `Episode ${e.number}`}</span>
                {there && !result && <Badge tone="neutral">Already downloaded</Badge>}
                {result?.state === 'added' && <span className="flex items-center gap-1 text-xs text-success"><CircleCheck className="size-3.5" />Queued</span>}
                {result?.state === 'failed' && <span className="flex items-center gap-1 text-xs text-danger" title={result.message}><TriangleAlert className="size-3.5" />Failed</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {failed > 0 && (
        <ul className="mx-5 mb-3 space-y-1 rounded-lg bg-sunken p-3 text-xs text-ink-2">
          {[...results.values()].flatMap((r) => (r.state === 'failed' ? [r.message] : [])).map((m, i) => <li key={i} data-selectable>{m}</li>)}
        </ul>
      )}

      <footer className="flex flex-wrap items-center gap-3 border-t border-line p-4">
        <button onClick={() => void pickFolder()} disabled={running || started} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-sm text-ink-2 hover:bg-hover disabled:cursor-default" title="Choose where the series goes">
          <FolderOpen className="size-4 shrink-0 text-ink-3" />
          <span className="min-w-0 truncate" data-selectable>{folderFailed ? 'That folder cannot be used' : folders.get(seasons[0]!)?.dir ?? baseDir}</span>
        </button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={running}>{started ? 'Close' : 'Cancel'}</Button>
          {!started && (
            <Button onClick={() => void start()} disabled={running || !ready || chosen.length === 0}>
              {chosen.length ? `Download ${chosen.length} episode${chosen.length === 1 ? '' : 's'}` : 'Pick at least one episode'}
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}
