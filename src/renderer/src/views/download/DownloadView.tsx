import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ClipboardPaste, FileDown, FileUp, Link2, Puzzle, TriangleAlert, X } from 'lucide-react';
import type { MediaInfo, RequestInfo } from '@shared/types';
import { extractLinks } from '@core/url';
import { planBatch, type BatchPlan } from '@core/batch';
import { call, errorMessage, pathForFile } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp, type PendingLink } from '@/stores/app';
import { useJobs } from '@/stores/jobs';
import { Button } from '@/components/ui';
import { TitleBar } from '@/components/Shell';
import { InspectResult } from './InspectResult';
import { RecentStrip } from './RecentStrip';
import { BatchPicker } from './BatchPicker';
import { quickOptions } from './quickOptions';

type Phase =
  | { kind: 'idle' }
  | { kind: 'inspecting'; url: string; source?: PendingLink['source'] }
  | { kind: 'ready'; url: string; info: MediaInfo; source?: PendingLink['source'] }
  | { kind: 'error'; url: string; message: string; request?: RequestInfo }
  | { kind: 'batch'; plan: BatchPlan };

const SOURCE_LABEL: Record<NonNullable<PendingLink['source']>, string> = {
  extension: 'Sent from your browser',
  clipboard: 'From your clipboard',
  system: 'Opened with Lumina',
};

export function DownloadView() {
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const pending = useApp((s) => s.pending);
  const consumePending = useApp((s) => s.consumePending);
  const clipboardLink = useApp((s) => s.clipboardLink);
  const dismissClipboardLink = useApp((s) => s.dismissClipboardLink);
  const pasteRequest = useApp((s) => s.pasteRequest);
  const setView = useApp((s) => s.setView);
  const toast = useApp((s) => s.toast);
  const [dragging, setDragging] = useState(false);
  const hasJobs = useJobs((s) => s.order.length > 0);

  const inspect = async (url: string, opts: { request?: RequestInfo; source?: PendingLink['source'] } = {}) => {
    setInput(url);
    const token = ++request.current;
    setPhase({ kind: 'inspecting', url, source: opts.source });
    try {
      const info = await call('media:inspect', { url, request: opts.request });
      if (token === request.current) setPhase({ kind: 'ready', url, info, source: opts.source });
    } catch (err) {
      if (token === request.current) setPhase({ kind: 'error', url, message: errorMessage(err), request: opts.request });
    }
  };

  /** One link inspects; several links become a batch grouped into archive sets and optional extras. */
  const handleText = (raw: string) => {
    const links = extractLinks(raw);
    if (links.length > 1) {
      request.current++;
      setInput('');
      setPhase({ kind: 'batch', plan: planBatch(links) });
      return;
    }
    const url = links[0] ?? raw.trim();
    if (url) void inspect(url);
  };

  useEffect(() => {
    const link = consumePending();
    if (link) void inspect(link.url, { request: link.request, source: link.source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  useEffect(() => {
    if (pasteRequest) void pasteFromClipboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteRequest]);

  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    addEventListener('keydown', focus);
    return () => removeEventListener('keydown', focus);
  }, []);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) handleText(text);
      else inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    handleText(input);
  };

  const reset = () => {
    request.current++;
    setPhase({ kind: 'idle' });
    setInput('');
    inputRef.current?.focus();
  };

  /** One torrent opens its details; several go straight to the queue with your defaults. */
  const openTorrents = async (paths: string[]) => {
    const torrents = paths.filter((p) => /\.torrent$/i.test(p));
    if (!torrents.length) {
      if (paths.length) toast('Only .torrent files can be dropped here. Links and magnets can be pasted or dropped as text.', 'error');
      return;
    }
    if (torrents.length === 1) {
      void inspect(torrents[0]!);
      return;
    }
    const settings = useApp.getState().settings!;
    let added = 0;
    for (const p of torrents) {
      try {
        const info = await call('media:inspect', { url: p });
        await call('jobs:add', { url: p, info, options: quickOptions(info, settings) });
        added++;
      } catch (err) {
        toast(`${p.split(/[\\/]/).pop()}: ${errorMessage(err)}`, 'error');
      }
    }
    if (added) toast(`Added ${added} torrent${added === 1 ? '' : 's'}`, 'success', { label: 'View', run: () => setView('queue') });
  };

  const pickTorrents = async () => openTorrents(await call('dialog:pick-torrents'));

  // Drag and drop anywhere on this screen: .torrent files, or links/magnets dragged from a browser.
  const dragDepth = useRef(0);
  const acceptsDrop = (e: React.DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain');
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!acceptsDrop(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!acceptsDrop(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = [...e.dataTransfer.files].map((f) => pathForFile(f)).filter(Boolean);
      if (files.length) {
        void openTorrents(files);
        return;
      }
      const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (text.trim()) handleText(text);
    },
  };

  const compact = phase.kind !== 'idle';

  return (
    <div className="relative flex h-full flex-col" {...dropHandlers}>
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-ground/85 backdrop-blur-[2px] animate-rise">
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"><FileDown className="size-7" /></span>
            <p className="mt-4 text-lg font-semibold tracking-tight">Drop to download</p>
            <p className="mt-1 text-sm text-ink-2">.torrent files, magnet links or any download link</p>
          </div>
        </div>
      )}
      <TitleBar />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn('mx-auto w-full max-w-[860px] px-[var(--page-x)] pb-16 transition-[padding] duration-500 ease-out-soft', compact ? 'pt-2' : 'pt-[12vh]')}>
          {!compact && (
            <div className="mb-8 animate-rise">
              <h1 className="font-serif text-[56px] leading-[0.95] tracking-[-0.015em]">
                Paste a link.<br /><span className="text-ink-3 italic">Keep it forever.</span>
              </h1>
              <p className="mt-4 max-w-[54ch] text-[15px] leading-relaxed text-ink-2">
                Videos and music from 1,300+ sites, Spotify playlists, direct files and torrents. Lumina picks the best quality and tells you exactly what you’re getting.
              </p>
            </div>
          )}

          {clipboardLink && phase.kind === 'idle' && (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-3.5 py-2.5 animate-rise">
              <ClipboardPaste className="size-4 shrink-0 text-accent" />
              <p className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold">You copied a link</span> <span className="text-ink-3">· {clipboardLink}</span></p>
              <Button size="sm" variant="primary" onClick={() => { void inspect(clipboardLink, { source: 'clipboard' }); dismissClipboardLink(); }}>Open</Button>
              <button aria-label="Dismiss" onClick={dismissClipboardLink} className="rounded-md p-1 text-ink-3 transition-colors hover:bg-hover hover:text-ink"><X className="size-4" /></button>
            </div>
          )}

          <form onSubmit={submit} className="group relative">
            <Link2 className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-3 transition-colors group-focus-within:text-accent" />
            <input
              ref={inputRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (extractLinks(text).length) {
                  e.preventDefault();
                  handleText(text);
                }
              }}
              placeholder="https://…  or  magnet:?xt=…"
              aria-label="Link to download"
              spellCheck={false}
              className="h-14 w-full rounded-2xl border border-line-strong bg-raised pr-[322px] pl-12 text-[15px] shadow-md outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_4px_var(--accent-soft)]"
            />
            <div className="absolute top-1/2 right-2 flex -translate-y-1/2 gap-1.5">
              <Button type="button" variant="ghost" icon={<FileUp className="size-4" />} onClick={() => void pickTorrents()} title="Open .torrent files">Torrent</Button>
              <Button type="button" variant="ghost" icon={<ClipboardPaste className="size-4" />} onClick={pasteFromClipboard}>Paste</Button>
              <Button type="submit" variant="primary" loading={phase.kind === 'inspecting'} disabled={!input.trim()} icon={phase.kind === 'inspecting' ? undefined : <ArrowRight className="size-4" />}>
                {phase.kind === 'inspecting' ? 'Reading' : 'Go'}
              </Button>
            </div>
          </form>
          {!compact && (
            <button
              type="button"
              onClick={() => void pickTorrents()}
              className="group/drop mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong bg-sunken/40 px-4 py-3 text-left transition-[background-color,border-color] duration-150 hover:border-accent hover:bg-accent-soft/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground outline-none"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised text-ink-3 shadow-sm transition-colors group-hover/drop:text-accent"><FileUp className="size-[18px]" /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">Have a .torrent file? Drop it here</span>
                <span className="block text-xs text-ink-3">Drag it anywhere onto this window, or click to browse. Magnet links go in the box above.</span>
              </span>
            </button>
          )}
          {!compact && (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
              <span>Press <kbd className="rounded border border-line bg-sunken px-1 font-sans">Ctrl</kbd> <kbd className="rounded border border-line bg-sunken px-1 font-sans">L</kbd> to jump here</span>
              <span aria-hidden="true">·</span>
              <span>Press <kbd className="rounded border border-line bg-sunken px-1 font-sans">?</kbd> for shortcuts</span>
              <span aria-hidden="true">·</span>
              <button onClick={() => setView('settings', 'extension')} className="inline-flex items-center gap-1 transition-colors hover:text-accent"><Puzzle className="size-3.5" /> Catch videos from any page with the browser extension</button>
            </p>
          )}

          <div className="mt-6">
            {'source' in phase && phase.source && (
              <p className="mb-2 text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase animate-rise">{SOURCE_LABEL[phase.source]}</p>
            )}
            {phase.kind === 'inspecting' && <InspectSkeleton />}
            {phase.kind === 'error' && (
              <div className="flex items-start gap-3 rounded-xl border border-danger/25 bg-danger/8 p-4 animate-rise">
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Lumina couldn’t read that link</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2" data-selectable>{phase.message}</p>
                </div>
                <Button size="sm" onClick={() => void inspect(phase.url, { request: phase.request })}>Try again</Button>
              </div>
            )}
            {phase.kind === 'ready' && <InspectResult key={phase.url} url={phase.url} info={phase.info} onDone={reset} />}
            {phase.kind === 'batch' && <BatchPicker plan={phase.plan} onDone={reset} onCancel={reset} />}
          </div>

          {!compact && hasJobs && <RecentStrip />}
        </div>
      </div>
    </div>
  );
}

function InspectSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5" aria-busy="true" aria-label="Reading link">
      <div className="flex gap-4">
        <div className="skeleton h-[90px] w-[160px] rounded-lg" />
        <div className="flex-1 space-y-2.5 pt-1">
          <div className="skeleton h-5 w-3/4 rounded" />
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton h-4 w-1/2 rounded" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[74px] rounded-xl" />)}
      </div>
    </div>
  );
}
