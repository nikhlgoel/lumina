import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, CircleCheck, FileArchive, FileCheck2, File as FileIcon, FolderOpen, Layers, PackagePlus, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { MediaInfo, RequestInfo } from '@shared/types';
import { releaseTagFor, type BatchGroup, type BatchPlan } from '@core/batch';
import { safeFileName } from '@core/format';
import { stampedBatchTitle, type ExistingMode } from '@core/existingFiles';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Badge, Button, ProgressBar, Segmented, Switch } from '@/components/ui';
import { Checkbox } from './PlaylistPicker';
import { quickOptions } from './quickOptions';

/** Links read at once; probes are tiny ranged requests, so a few in parallel is safe for any host. */
const PROBE_CONCURRENCY = 6;

type ItemState = { state: 'added' } | { state: 'failed'; message: string };

function joinPath(dir: string, name: string) {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

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

const KIND_META: Record<BatchGroup['kind'], { badge: string; tone: 'neutral' | 'accent' | 'success' | 'warning' }> = {
  'archive-set': { badge: 'Main', tone: 'accent' },
  file: { badge: 'File', tone: 'neutral' },
  optional: { badge: 'Optional', tone: 'warning' },
  checksum: { badge: 'Checksums', tone: 'success' },
};

export function BatchPicker({ plan, request, onDone, onCancel }: { plan: BatchPlan; /** The page the links were picked on, when they came from the browser. */ request?: RequestInfo; onDone: () => void; onCancel: () => void }) {
  const settings = useApp((s) => s.settings)!;
  const toast = useApp((s) => s.toast);
  const setView = useApp((s) => s.setView);
  const [selected, setSelected] = useState(() => new Set(plan.groups.filter((g) => g.defaultSelected).map((g) => g.key)));
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Several files go in a folder of their own, whatever their shape: twelve parts of one archive are as much a batch as twelve different files.
  const [ownFolder, setOwnFolder] = useState(plan.groups.reduce((n, g) => n + g.items.length, 0) > 1);
  const hasArchives = plan.groups.some((g) => g.items.some((i) => i.part !== null));
  const [unpack, setUnpack] = useState(hasArchives);
  const [deleteArchives, setDeleteArchives] = useState(true);
  const [baseDir, setBaseDir] = useState(settings.storage.otherDir);
  const [results, setResults] = useState<Map<string, ItemState>>(() => new Map());
  const [running, setRunning] = useState(false);
  const [probed, setProbed] = useState(0);

  const chosen = plan.groups.filter((g) => selected.has(g.key));
  const fileCount = chosen.reduce((n, g) => n + g.items.length, 0);
  const optionalCount = plan.groups.filter((g) => g.kind === 'optional').length;
  const mainParts = plan.groups.filter((g) => g.kind === 'archive-set').reduce((n, g) => n + g.items.length, 0);
  const brokenSets = chosen.filter((g) => g.missingParts.length > 0);
  // A batch whose links do not name their files has no title worth a folder name ("Batch download" for every one of them): the day and time do.
  const [folderTitle] = useState(() => safeFileName(plan.title === 'Batch download' ? stampedBatchTitle(new Date()) : plan.title, 'Batch download'));
  // What the disk says: which folder this batch goes into (its own, never another batch's), and which of its files are already complete there.
  const [folder, setFolder] = useState<{ dir: string; sameBatch: boolean; existing: { filename: string; size: number }[] } | null>(null);
  const [existingMode, setExistingMode] = useState<ExistingMode>('skip');
  const chosenNames = chosen.flatMap((g) => g.items.map((i) => i.filename).filter(Boolean));
  const chosenKey = chosenNames.join('\n');
  const [folderFailed, setFolderFailed] = useState(false);
  useEffect(() => {
    let current = true;
    // What was worked out for the last choices no longer applies: until the disk has answered for these, there is no folder to go to (and the
    // Download button waits), so a click cannot queue the batch into the folder of the previous choice.
    setFolder(null);
    setFolderFailed(false);
    const timer = setTimeout(() => {
      void call('batch:folder', { base: baseDir, title: folderTitle, filenames: chosenNames, flat: !ownFolder })
        .then((r) => { if (current) setFolder(r); })
        .catch(() => { if (current) setFolderFailed(true); });
    }, 150);
    return () => { current = false; clearTimeout(timer); };
    // chosenNames is read through chosenKey, which changes exactly when it does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDir, ownFolder, folderTitle, chosenKey]);
  const targetDir = folder?.dir ?? (ownFolder ? joinPath(baseDir, folderTitle) : baseDir);
  const existing = folder?.existing ?? [];
  const started = running || results.size > 0;
  const failed = [...results.entries()].filter((e): e is [string, Extract<ItemState, { state: 'failed' }>] => e[1].state === 'failed');

  const subtitle = useMemo(() => {
    const bits: string[] = [];
    if (mainParts) bits.push(`${mainParts} archive part${mainParts === 1 ? '' : 's'}`);
    if (optionalCount) bits.push(`${optionalCount} optional extra${optionalCount === 1 ? '' : 's'}`);
    bits.push(`${plan.groups.reduce((n, g) => n + g.items.length, 0)} links`);
    return bits.join(' · ');
  }, [plan, mainParts, optionalCount]);

  const toggle = (key: string) => {
    if (started) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const toggleOpen = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };

  const pickFolder = async () => {
    const dir = await call('dialog:pick-folder', { title: 'Save these downloads to' });
    if (dir) setBaseDir(dir);
  };

  const start = async () => {
    const items = chosen.flatMap((g) => g.items.map((item) => ({ item, group: g })));
    setRunning(true);
    setProbed(0);
    const infos: (MediaInfo | null)[] = new Array(items.length).fill(null);
    const next = new Map<string, ItemState>();
    const releaseId = crypto.randomUUID();

    // Read every link first (in parallel), then queue in plan order so parts download in sequence
    // and checksum files land before the files they cover.
    await pool(items, PROBE_CONCURRENCY, async ({ item }, i) => {
      try {
        infos[i] = await call('media:inspect', { url: item.url, request });
      } catch (err) {
        next.set(item.url, { state: 'failed', message: `${item.filename || item.url}: ${errorMessage(err)}` });
      }
      setProbed((n) => n + 1);
    });

    for (const [i, { item, group }] of items.entries()) {
      const info = infos[i];
      if (!info) continue;
      const release = releaseTagFor(group, item, { id: releaseId, title: plan.title === 'Batch download' ? folderTitle : plan.title, dir: targetDir, unpack: unpack && hasArchives, deleteArchives: unpack && deleteArchives });
      try {
        await call('jobs:add', { url: item.url, info, options: { ...quickOptions(info, settings), targetDir, release, ...(existing.length ? { existingFiles: existingMode, existingNames: existing.map((e) => e.filename) } : {}) } });
        next.set(item.url, { state: 'added' });
      } catch (err) {
        next.set(item.url, { state: 'failed', message: errorMessage(err) });
      }
    }
    setResults(next);
    setRunning(false);

    const added = [...next.values()].filter((r) => r.state === 'added').length;
    if (added) toast(`Queued ${added} download${added === 1 ? '' : 's'} · each is verified when it finishes`, 'success', { label: 'View', run: () => setView('queue') });
    if (added === items.length) onDone();
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm animate-rise" aria-label="Batch download">
      <header className="flex items-center gap-3 border-b border-line p-5">
        <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent"><Layers className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight" data-selectable>{plan.title}</h2>
          <p className="text-sm text-ink-3">{subtitle}</p>
        </div>
        {!started && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(plan.groups.filter((g) => g.kind !== 'optional').map((g) => g.key)))}>Required only</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(plan.groups.map((g) => g.key)))}>Everything</Button>
          </div>
        )}
      </header>

      {running && (
        <div className="px-5 pt-4">
          <ProgressBar value={(probed / Math.max(1, fileCount)) * 100} />
          <p className="mt-1.5 text-xs text-ink-3 tabular">Checking links · {probed} of {fileCount}</p>
        </div>
      )}

      <ul className="max-h-[380px] overflow-auto px-2 py-2">
        {plan.groups.map((g, gi) => {
          const on = selected.has(g.key);
          const multi = g.items.length > 1;
          const expanded = open.has(g.key);
          const groupFailed = g.items.filter((i) => results.get(i.url)?.state === 'failed').length;
          const groupAdded = g.items.filter((i) => results.get(i.url)?.state === 'added').length;
          const Icon = g.kind === 'checksum' ? FileCheck2 : g.kind === 'file' ? FileIcon : g.kind === 'optional' && !multi ? PackagePlus : FileArchive;
          return (
            <li key={g.key} style={{ animation: `rise .25s ${Math.min(gi, 12) * 25}ms var(--ease) both` }}>
              <div className={cn('group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover', !on && !started && 'opacity-70')}>
                <button
                  onClick={() => toggle(g.key)}
                  disabled={started}
                  aria-pressed={on}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
                >
                  <Checkbox state={on ? 'on' : 'off'} />
                  <Icon className="size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium" data-selectable>{g.label}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {multi ? `${g.items.length} parts` : g.kind === 'checksum' ? 'Downloaded first, used to verify the other files' : g.items[0]!.filename || g.items[0]!.url}
                      {started && on && ` · ${groupAdded} queued${groupFailed ? ` · ${groupFailed} failed` : ''}`}
                    </span>
                  </span>
                </button>
                {g.missingParts.length > 0 && (
                  <span title="The archive can’t be extracted without every part. Paste the missing links too.">
                    <Badge tone="danger"><TriangleAlert className="size-3" /> Missing part{g.missingParts.length > 1 ? 's' : ''} {g.missingParts.slice(0, 4).join(', ')}{g.missingParts.length > 4 ? '…' : ''}</Badge>
                  </span>
                )}
                <Badge tone={KIND_META[g.kind].tone}>{KIND_META[g.kind].badge}</Badge>
                {multi && (
                  <button
                    onClick={() => toggleOpen(g.key)}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide parts' : 'Show parts'}
                    className="rounded-md p-1 text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent outline-none"
                  >
                    <ChevronRight className={cn('size-4 transition-transform duration-200 ease-out', expanded && 'rotate-90')} />
                  </button>
                )}
              </div>
              {multi && expanded && (
                <ul className="mb-1 ml-[46px] border-l border-line pl-3">
                  {g.items.map((item) => {
                    const r = results.get(item.url);
                    return (
                      <li key={item.url} className="flex items-center gap-2 py-0.5 text-xs">
                        <span className={cn('size-1.5 shrink-0 rounded-full', r?.state === 'failed' ? 'bg-danger' : r?.state === 'added' ? 'bg-success' : 'bg-line-strong')} />
                        <span className={cn('min-w-0 flex-1 truncate text-ink-2', r?.state === 'failed' && 'text-danger')} title={r?.state === 'failed' ? r.message : item.url} data-selectable>{item.filename || item.url}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {brokenSets.length > 0 && !started && (
        <p className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-danger/8 px-3 py-2 text-[13px] leading-relaxed text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {brokenSets.length === 1 ? `“${brokenSets[0]!.label}” is` : `${brokenSets.length} archives are`} missing parts. You can still download, but extracting will fail until every part is there.
        </p>
      )}

      {existing.length > 0 && !started && (
        <div className="mx-5 mb-3 rounded-lg border border-line bg-sunken px-3 py-2.5">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <CircleCheck className="size-4 shrink-0 text-success" />
            {existing.length === 1 ? '1 file has' : `${existing.length} files have`} the same name as one already in this folder
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-3" title={existing.map((e) => e.filename).join('\n')} data-selectable>
            {existing.slice(0, 3).map((e) => e.filename).join(', ')}{existing.length > 3 ? ` and ${existing.length - 3} more` : ''}
          </p>
          <Segmented
            className="mt-2.5"
            label="What to do with files already here"
            value={existingMode}
            onChange={setExistingMode}
            options={[
              { value: 'skip', label: `Skip them · download ${Math.max(0, fileCount - existing.length)}` },
              { value: 'replace', label: `Download all ${fileCount} again and replace` },
            ]}
          />
          <p className="mt-1.5 text-xs text-ink-3">
            {existingMode === 'skip'
              ? 'A file is skipped only if it is the same size as the one being downloaded; a different one is kept and the new one saved beside it.'
              : 'The old copies go to the Recycle Bin first, so you can still get them back.'}
          </p>
        </div>
      )}

      {failed.length > 0 && !running && (
        <div className="mx-5 mb-3 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2">
          <p className="text-[13px] font-semibold text-danger">{failed.length} link{failed.length === 1 ? '' : 's'} couldn’t be queued</p>
          <ul className="mt-1 max-h-[96px] space-y-0.5 overflow-auto text-xs text-ink-2">
            {failed.slice(0, 50).map(([url, r]) => <li key={url} className="truncate" title={url} data-selectable>{r.message}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3 text-[13px]">
        <label className="flex items-center gap-2.5 text-ink-2">
          <Switch checked={ownFolder} onChange={setOwnFolder} label="Keep together in one folder" disabled={started} />
          <span>Own folder</span>
        </label>
        <button
          onClick={pickFolder}
          disabled={started}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-ink-2 transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent outline-none disabled:pointer-events-none"
          title={`${targetDir} (click to change)`}
        >
          <FolderOpen className="size-4 shrink-0" />
          {/* Clip from the left so the folder name that matters stays visible. */}
          <span className="truncate [direction:rtl]" data-selectable><bdi>{targetDir}</bdi></span>
        </button>
      </div>
      {ownFolder && folder && !started && (folder.sameBatch || /\(\d+\)$/.test(folder.dir)) && (
        <p className="-mt-1 px-5 pb-2.5 text-xs text-ink-3">
          {folder.sameBatch ? 'This folder already holds files from this batch.' : 'A folder with that name already holds something else, so this batch gets its own.'}
        </p>
      )}

      {hasArchives && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-5 py-3 text-[13px] text-ink-2">
          <label className="flex items-center gap-2.5">
            <Switch checked={unpack} onChange={setUnpack} label="Unpack archives when every part is downloaded" disabled={started} />
            <span>Unpack when complete</span>
          </label>
          <label className={cn('flex items-center gap-2.5 transition-opacity', !unpack && 'opacity-50')}>
            <Switch checked={deleteArchives && unpack} onChange={setDeleteArchives} label="Delete the archive parts after a verified unpack" disabled={started || !unpack} />
            <span>Delete parts after a verified unpack</span>
          </label>
          {unpack && <span className="text-xs text-ink-3">Optional extras are placed next to the installer.</span>}
        </div>
      )}

      <footer className="flex items-center justify-end gap-2 border-t border-line bg-sunken/60 px-5 py-3.5">
        <p className="mr-auto flex items-center gap-1.5 text-[13px] text-ink-3">
          <ShieldCheck className="size-4 text-success" />
          Checked for corruption as each file finishes
        </p>
        <Button variant="ghost" onClick={started && !running ? onDone : onCancel} disabled={running}>{started && !running ? 'Close' : 'Cancel'}</Button>
        {!started && (
          <Button variant="primary" size="lg" onClick={() => void start()} disabled={fileCount === 0 || (!folder && !folderFailed)}>
            {existing.length > 0 && existingMode === 'skip'
              ? `Download ${Math.max(0, fileCount - existing.length)} new file${fileCount - existing.length === 1 ? '' : 's'}`
              : `Download ${fileCount} file${fileCount === 1 ? '' : 's'}`}
          </Button>
        )}
        {started && !running && failed.length > 0 && (
          <Button variant="secondary" onClick={() => setView('queue')}>Open queue</Button>
        )}
      </footer>
    </section>
  );
}
