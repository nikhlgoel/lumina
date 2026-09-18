// The offline collection: Liked songs and playlists made here, alongside the .m3u files and folders
// the scanner finds. Scanned playlists stay read-only; only user playlists can be edited.
import { withArtSize } from '@core/artwork';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Film, Heart, ListMusic, ListPlus, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { LibraryItem, LibraryPlaylist } from '@shared/types';
import { formatDuration, plural } from '@core/format';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { isUserPlaylist, useLibrary } from '@/stores/library';
import { usePlayer } from '@/stores/player';
import { Artwork } from '@/components/Artwork';
import { Badge, Button, Dialog, EmptyState, IconButton } from '@/components/ui';

const art = (id: string) => withArtSize(`lumina-media://art/${id}`, 36)!;
/** The Liked-songs list isn't a row in the playlists table; this id selects it in the UI. */
export const LIKED_ID = '__liked__';

/** Heart toggle used in the song lists and the playlist detail. */
export function LikeButton({ item, size = 'sm' }: { item: LibraryItem; size?: 'sm' | 'md' }) {
  const toggleLike = useLibrary((s) => s.toggleLike);
  const toast = useApp((s) => s.toast);
  return (
    <IconButton
      label={item.liked ? `Remove ${item.title} from Liked songs` : `Like ${item.title}`}
      size={size}
      className={cn(item.liked ? 'text-accent' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
      onClick={(e) => {
        e.stopPropagation();
        void toggleLike(item).catch((err) => toast(errorMessage(err), 'error'));
      }}
    >
      <Heart className={cn(item.liked && 'fill-current')} />
    </IconButton>
  );
}

/** "Add to playlist" — pick an existing user playlist or make a new one from the selection. */
export function AddToPlaylistDialog({ paths, title, onClose }: { paths: string[]; title: string; onClose: () => void }) {
  const { playlists, loadPlaylists, loaded } = useLibrary();
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loaded.playlists) void loadPlaylists(); }, [loaded.playlists, loadPlaylists]);

  const mine = playlists.filter(isUserPlaylist);

  const addTo = async (pl: LibraryPlaylist) => {
    setBusy(true);
    try {
      const added = await call('library:playlist-add', { id: pl.id, paths });
      await loadPlaylists();
      toast(added === 0 ? `Already in “${pl.name}”` : `Added ${plural(added, 'song')} to “${pl.name}”`, added === 0 ? 'info' : 'success');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const createWith = async () => {
    setBusy(true);
    try {
      const pl = await call('library:playlist-create', { name: name || title, paths });
      await loadPlaylists();
      toast(`Created “${pl.name}”`, 'success');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={paths.length > 1 ? `Add ${plural(paths.length, 'song')} to a playlist` : 'Add to a playlist'}>
      <div className="space-y-4">
        {mine.length > 0 && (
          <div className="max-h-64 space-y-1 overflow-auto">
            {mine.map((pl) => (
              <button
                key={pl.id}
                disabled={busy}
                onClick={() => void addTo(pl)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover disabled:opacity-50"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-sunken text-ink-3"><ListMusic className="size-4" /></span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{pl.name}</span>
                <span className="text-xs text-ink-3 tabular">{pl.itemCount}</span>
              </button>
            ))}
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">New playlist</p>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && void createWith()}
              placeholder={title}
              aria-label="New playlist name"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
            />
            <Button variant="primary" size="sm" disabled={busy} icon={<Plus className="size-4" />} onClick={() => void createWith()}>Create</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Cards for Liked songs, the user's own playlists, and the scanned ones. */
export function PlaylistGrid({ lists, loaded, searching, onOpen }: {
  lists: LibraryPlaylist[]; loaded: boolean; searching: boolean; onOpen: (id: string) => void;
}) {
  const likedCount = useLibrary((s) => s.stats?.liked ?? 0);
  const loadPlaylists = useLibrary((s) => s.loadPlaylists);
  const toast = useApp((s) => s.toast);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const create = async () => {
    try {
      const pl = await call('library:playlist-create', { name });
      await loadPlaylists();
      setCreating(false);
      setName('');
      toast(`Created “${pl.name}”`, 'success');
      onOpen(pl.id);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const mine = lists.filter(isUserPlaylist);
  const found = lists.filter((pl) => !isUserPlaylist(pl));

  return (
    <div className="h-full overflow-auto pb-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">Your collection</h3>
        <Button variant="ghost" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>New playlist</Button>
      </div>

      <div className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        <button
          onClick={() => onOpen(LIKED_ID)}
          className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left shadow-sm transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-raised active:scale-[0.99]"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent/60 text-accent-ink">
            <Heart className="size-5 fill-current" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">Liked songs</span>
            <span className="block truncate text-xs text-ink-3">Everything you hearted</span>
          </span>
          <span className="text-xs font-semibold text-ink-3 tabular">{likedCount}</span>
        </button>

        {mine.map((pl) => <PlaylistCard key={pl.id} pl={pl} onOpen={onOpen} />)}
      </div>

      {(found.length > 0 || loaded) && (
        <h3 className="mt-6 mb-3 text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">Found on this PC</h3>
      )}
      {!loaded ? (
        <div className="space-y-2" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-16 rounded-xl" style={{ opacity: 1 - i * 0.15 }} />)}</div>
      ) : found.length === 0 ? (
        <EmptyState icon={<ListMusic />} title={searching ? 'No playlists match' : 'No playlist files found'}>
          {searching ? 'Try a different search.' : 'Lumina finds .m3u, .pls and .xspf playlists and any folder of songs in your library folders.'}
        </EmptyState>
      ) : (
        <div className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {found.map((pl) => <PlaylistCard key={pl.id} pl={pl} onOpen={onOpen} />)}
        </div>
      )}

      {creating && (
        <Dialog open onClose={() => setCreating(false)} title="New playlist" width={420}>
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder="Playlist name"
              aria-label="Playlist name"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
            />
            <Button variant="primary" size="sm" onClick={() => void create()}>Create</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PlaylistCard({ pl, onOpen }: { pl: LibraryPlaylist; onOpen: (id: string) => void }) {
  const mine = isUserPlaylist(pl);
  return (
    <button
      onClick={() => onOpen(pl.id)}
      className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left shadow-sm transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-raised active:scale-[0.99]"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-lg text-white/85" style={{ background: `linear-gradient(135deg, oklch(58% 0.11 ${(pl.name.length * 47) % 360}), oklch(36% 0.08 ${(pl.name.length * 47 + 50) % 360}))` }}>
        {pl.kind === 'video' ? <Film className="size-5" /> : <ListMusic className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{pl.name}</span>
          {mine && <Badge tone="accent">Yours</Badge>}
        </span>
        <span className="block truncate text-xs text-ink-3">
          {mine ? plural(pl.itemCount, 'song') : `${pl.location} · ${pl.source === 'folder' ? 'folder' : `.${pl.path.split('.').pop()} file`}`}
        </span>
      </span>
      {!mine && <span className="text-xs font-semibold text-ink-3 tabular">{pl.itemCount}</span>}
    </button>
  );
}

/** Open playlist: its songs, with play / reorder / remove for the ones the user owns. */
export function PlaylistDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { playlists, liked, loadLiked, loadPlaylists } = useLibrary();
  const playIds = usePlayer((s) => s.playIds);
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const setMode = useApp((s) => s.setMode);
  const toast = useApp((s) => s.toast);
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isLiked = id === LIKED_ID;
  const pl = useMemo(() => playlists.find((p) => p.id === id) ?? null, [playlists, id]);
  const mine = pl ? isUserPlaylist(pl) : false;

  const reload = useMemo(() => async () => {
    if (isLiked) {
      await loadLiked();
      return;
    }
    setItems(await call('library:items', { playlistId: id }));
  }, [id, isLiked, loadLiked]);

  useEffect(() => { void reload(); }, [reload]);

  const list = isLiked ? liked : items;
  const heading = isLiked ? 'Liked songs' : pl?.name ?? 'Playlist';

  // A playlist that vanished (deleted elsewhere, or a rescan dropped the file) shouldn't strand the view.
  useEffect(() => { if (!isLiked && playlists.length > 0 && !pl) onBack(); }, [isLiked, playlists, pl, onBack]);

  const playAt = async (index: number) => {
    if (!list?.length) return;
    await playIds(list.map((i) => i.id), index);
    if (useApp.getState().settings?.player.openPlayerOnPlay) setMode('player');
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await Promise.all([reload(), loadPlaylists()]);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const rename = async () => {
    setRenaming(false);
    if (!pl || !name.trim()) return;
    await act(() => call('library:playlist-rename', { id: pl.id, name }));
  };

  const remove = async () => {
    if (!pl) return;
    setConfirmDelete(false);
    try {
      await call('library:playlist-delete', { id: pl.id });
      await loadPlaylists();
      toast(`Deleted “${pl.name}”`, 'success');
      onBack();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
        <IconButton label="Back to playlists" onClick={onBack}><ArrowLeft /></IconButton>
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', isLiked ? 'bg-gradient-to-br from-accent to-accent/60 text-accent-ink' : 'bg-sunken text-ink-3')}>
          {isLiked ? <Heart className="size-4 fill-current" /> : <ListMusic className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{heading}</p>
          <p className="truncate text-[13px] text-ink-3">
            {list == null ? 'Loading…' : plural(list.length, 'song')}
            {!isLiked && pl && !mine && ` · ${pl.location}`}
          </p>
        </div>
        <Button variant="primary" size="sm" icon={<Play className="size-4" />} disabled={!list?.length} onClick={() => void playAt(0)}>Play all</Button>
        {mine && pl && (
          <>
            <IconButton label="Rename playlist" onClick={() => { setName(pl.name); setRenaming(true); }}><Pencil /></IconButton>
            <IconButton label="Delete playlist" onClick={() => setConfirmDelete(true)}><Trash2 /></IconButton>
          </>
        )}
      </div>

      {list == null ? (
        <div className="space-y-2 p-3" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-11 rounded-lg" style={{ opacity: 1 - i * 0.14 }} />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={isLiked ? <Heart /> : <ListMusic />} title={isLiked ? 'Nothing liked yet' : 'This playlist is empty'}>
          {isLiked ? 'Tap the heart on any song and it lands here.' : 'Use “Add to playlist” on a song to fill it.'}
        </EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {list.map((item, index) => (
            <div
              key={`${item.id}-${index}`}
              role="button"
              tabIndex={0}
              onDoubleClick={() => void playAt(index)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && void playAt(index)}
              className={cn('group grid grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 transition-colors hover:bg-hover',
                item.id === currentId && 'bg-accent-soft')}
            >
              <button aria-label={`Play ${item.title}`} className="relative" onClick={() => void playAt(index)}>
                <Artwork src={item.hasArtwork ? art(item.id) : null} seed={item.album ?? item.title} className="size-9" rounded="rounded-md" />
                <span className="absolute inset-0 grid place-items-center rounded-md bg-black/45 opacity-0 transition-opacity group-hover:opacity-100"><Play className="size-4 fill-white text-white" /></span>
              </button>
              <div className="min-w-0">
                <p className={cn('truncate text-sm font-semibold', item.id === currentId && 'text-accent')}>{item.title}</p>
                <p className="truncate text-[13px] text-ink-3">{item.artist ?? 'Unknown artist'}</p>
              </div>
              <div className="flex items-center gap-0.5">
                <span className="mr-1 text-[13px] text-ink-3 tabular">{formatDuration(item.durationSec)}</span>
                <LikeButton item={item} />
                {mine && pl && (
                  <>
                    <IconButton label="Move up" size="sm" className="opacity-0 group-hover:opacity-100" disabled={index === 0}
                      onClick={() => void act(() => call('library:playlist-move', { id: pl.id, from: index, to: index - 1 }))}><ChevronUp /></IconButton>
                    <IconButton label="Move down" size="sm" className="opacity-0 group-hover:opacity-100" disabled={index === list.length - 1}
                      onClick={() => void act(() => call('library:playlist-move', { id: pl.id, from: index, to: index + 1 }))}><ChevronDown /></IconButton>
                    <IconButton label={`Remove ${item.title} from ${pl.name}`} size="sm" className="opacity-0 group-hover:opacity-100"
                      onClick={() => void act(() => call('library:playlist-remove', { id: pl.id, index }))}><Trash2 /></IconButton>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {renaming && pl && (
        <Dialog open onClose={() => setRenaming(false)} title="Rename playlist" width={420}>
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void rename()}
              aria-label="Playlist name"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-sm outline-none focus:border-accent"
            />
            <Button variant="primary" size="sm" onClick={() => void rename()}>Rename</Button>
          </div>
        </Dialog>
      )}

      {confirmDelete && pl && (
        <Dialog
          open
          onClose={() => setConfirmDelete(false)}
          title={`Delete “${pl.name}”?`}
          width={420}
          footer={<>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="danger" size="sm" onClick={() => void remove()}>Delete playlist</Button>
          </>}
        >
          <p className="text-sm text-ink-2">This removes the playlist only. The songs stay on your PC.</p>
        </Dialog>
      )}
    </div>
  );
}

/** Toolbar button that opens the add-to-playlist dialog for one song. */
export function AddToPlaylistButton({ item }: { item: LibraryItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={`Add ${item.title} to a playlist`} size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setOpen(true)}>
        <ListPlus />
      </IconButton>
      {open && <AddToPlaylistDialog paths={[item.path]} title={item.title} onClose={() => setOpen(false)} />}
    </>
  );
}
