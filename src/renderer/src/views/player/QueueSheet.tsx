import { useEffect, useState } from 'react';
import { Film, ListMusic, X } from 'lucide-react';
import { formatDuration } from '@core/format';
import { call } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { useLibrary } from '@/stores/library';
import { usePlayer } from '@/stores/player';
import { Artwork } from '@/components/Artwork';

export function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'queue' | 'playlists'>('queue');
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const jump = usePlayer((s) => s.jump);
  const playIds = usePlayer((s) => s.playIds);
  const toast = useApp((s) => s.toast);
  const { playlists, loaded, loadPlaylists } = useLibrary();

  useEffect(() => {
    if (open && tab === 'playlists' && !loaded.playlists) void loadPlaylists();
  }, [open, tab, loaded.playlists, loadPlaylists]);

  const playPlaylist = async (id: string, name: string) => {
    const items = await call('library:items', { playlistId: id });
    if (!items.length) return toast(`None of “${name}” could be found on disk.`, 'error');
    await playIds(items.map((i) => i.id));
    setTab('queue');
  };

  return (
    <aside aria-label="Queue and playlists" aria-hidden={!open} className="p-sheet fixed top-0 right-0 bottom-0 z-30 flex w-[min(380px,100%)] flex-col gap-3 px-4 pt-[18px] pb-4" data-closed={!open || undefined}>
      <div className="flex items-center justify-between px-1.5">
        <h2 className="text-[15px] font-semibold">Up next</h2>
        <button className="p-btn grid size-9 place-items-center rounded-xl" aria-label="Close queue" onClick={onClose} tabIndex={open ? 0 : -1}><X className="size-5" /></button>
      </div>
      <div className="flex gap-1 px-1.5">
        {(['queue', 'playlists'] as const).map((t) => (
          <button key={t} tabIndex={open ? 0 : -1} aria-pressed={tab === t} onClick={() => setTab(t)}
            className={cn('rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition-colors', tab === t ? 'bg-white/8 text-[var(--p-ink)]' : 'text-[var(--p-ink-3)] hover:text-[var(--p-ink-2)]')}>
            {t === 'queue' ? `Queue · ${queue.length}` : 'Playlists on this PC'}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 content-start gap-0.5 overflow-auto">
        {tab === 'queue' && queue.map((item, i) => (
          <button key={`${item.id}-${i}`} tabIndex={open ? 0 : -1} onClick={() => jump(i)} aria-current={i === index}
            className={cn('grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/6', i === index && 'bg-white/10')}>
            <Artwork src={item.artworkUrl} seed={item.album ?? item.title} kind={item.kind} className="size-11" rounded="rounded-lg" />
            <span className="min-w-0">
              <b className="block truncate text-sm font-semibold">{item.title}</b>
              <small className="block truncate text-xs text-[var(--p-ink-3)]">{item.artist ?? (item.kind === 'video' ? 'Video' : 'Unknown artist')}</small>
            </span>
            <span className="text-xs text-[var(--p-ink-3)] tabular">{formatDuration(item.durationSec)}</span>
          </button>
        ))}
        {tab === 'playlists' && !loaded.playlists && <p className="px-2 py-6 text-sm text-[var(--p-ink-3)]">Looking for playlists…</p>}
        {tab === 'playlists' && loaded.playlists && playlists.length === 0 && (
          <p className="px-2 py-6 text-sm leading-relaxed text-[var(--p-ink-3)]">No playlists found. Lumina looks for .m3u, .pls and .xspf files and folders of songs in your library folders.</p>
        )}
        {tab === 'playlists' && playlists.map((pl) => (
          <button key={pl.id} tabIndex={open ? 0 : -1} onClick={() => playPlaylist(pl.id, pl.name)} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/6">
            <span className="grid size-11 place-items-center rounded-lg bg-white/6 text-[var(--p-ink-2)]">{pl.kind === 'video' ? <Film className="size-5" /> : <ListMusic className="size-5" />}</span>
            <span className="min-w-0">
              <b className="block truncate text-sm font-semibold">{pl.name}</b>
              <small className="block truncate text-xs text-[var(--p-ink-3)]">{pl.location} · {pl.source === 'folder' ? 'folder' : `.${pl.path.split('.').pop()} file`}</small>
            </span>
            <span className="text-xs text-[var(--p-ink-3)] tabular">{pl.itemCount}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
