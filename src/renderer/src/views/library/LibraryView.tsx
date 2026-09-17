import { useEffect, useMemo, useState } from 'react';
import { Captions, Film, FolderOpen, ListMusic, Music, Play, RefreshCw, Search, Tv } from 'lucide-react';
import type { LibraryItem, LibraryPlaylist } from '@shared/types';
import { formatDuration, plural } from '@core/format';
import { presetById } from '@core/presets';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { useLibrary } from '@/stores/library';
import { usePlayer } from '@/stores/player';
import { Artwork } from '@/components/Artwork';
import { Badge, Button, EmptyState, IconButton, PageHeader, Segmented } from '@/components/ui';
import { TitleBar } from '@/components/Shell';
import { VirtualList } from '@/components/VirtualList';

type Tab = 'music' | 'videos' | 'playlists';
const art = (id: string) => `lumina-media://art/${id}`;

function qualityTag(item: LibraryItem): string | null {
  if (item.kind === 'video') return item.height ? `${item.height >= 2160 ? '4K' : `${item.height}p`}` : null;
  if (item.lossless) return item.bitDepth && item.bitDepth > 16 ? `Hi-Res ${item.bitDepth}-bit` : 'Lossless';
  return item.bitrateKbps ? `${item.bitrateKbps}k` : null;
}

export function LibraryView() {
  const [tab, setTab] = useState<Tab>('music');
  const [query, setQuery] = useState('');
  const { items, playlists, loaded, load, loadPlaylists, rescan, stats } = useLibrary();

  useEffect(() => {
    if (tab === 'music' && !loaded.audio) void load('audio');
    if (tab === 'videos' && !loaded.video) void load('video');
    if (tab === 'playlists' && !loaded.playlists) void loadPlaylists();
  }, [tab, loaded, load, loadPlaylists]);

  const q = query.trim().toLowerCase();
  const filter = <T extends { title?: string; name?: string; artist?: string | null; album?: string | null }>(list: T[]) =>
    q ? list.filter((i) => [i.title, i.name, i.artist, i.album].some((v) => v?.toLowerCase().includes(q))) : list;

  const music = useMemo(() => filter(items.audio), [items.audio, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const videos = useMemo(() => filter(items.video), [items.video, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const lists = useMemo(() => filter(playlists), [playlists, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col px-8">
        <PageHeader
          title="Library"
          subtitle={stats ? `${plural(stats.audio, 'song')} · ${plural(stats.video, 'video')} · ${plural(stats.playlists, 'playlist')}` : undefined}
          actions={<Button variant="ghost" size="sm" icon={<RefreshCw className={cn('size-3.5', stats?.scanning && 'animate-spin')} />} disabled={stats?.scanning} onClick={rescan}>{stats?.scanning ? 'Scanning' : 'Rescan'}</Button>}
        />
        <div className="mb-4 flex items-center gap-3">
          <Segmented label="Library section" value={tab} onChange={setTab} options={[
            { value: 'music', label: 'Music' }, { value: 'videos', label: 'Videos' }, { value: 'playlists', label: 'Playlists on this PC' },
          ]} />
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search library"
              className="h-9 w-64 rounded-lg border border-line-strong bg-raised pr-3 pl-8 text-sm outline-none placeholder:text-ink-3 focus:border-accent" />
          </div>
        </div>

        <div className="min-h-0 flex-1 pb-4">
          {tab === 'music' && <MusicList items={music} loaded={loaded.audio} searching={!!q} />}
          {tab === 'videos' && <VideoGrid items={videos} loaded={loaded.video} searching={!!q} />}
          {tab === 'playlists' && <PlaylistGrid lists={lists} loaded={loaded.playlists} searching={!!q} />}
        </div>
      </div>
    </div>
  );
}

function useItemActions() {
  const toast = useApp((s) => s.toast);
  const setView = useApp((s) => s.setView);
  return {
    reveal: (p: string) => void call('shell:show-in-folder', { path: p }).catch((e) => toast(errorMessage(e), 'error')),
    makeTvSafe: async (p: string) => {
      try {
        await call('jobs:convert', { paths: [p], format: presetById('video-tv-1080')!.format });
        toast('Converting a TV-ready copy', 'success', { label: 'View', run: () => setView('queue') });
      } catch (e) { toast(errorMessage(e), 'error'); }
    },
    generateSubs: async (p: string) => {
      try {
        await call('subtitles:generate', { path: p });
        toast('Generating English subtitles', 'success', { label: 'View', run: () => setView('queue') });
      } catch (e) { toast(errorMessage(e), 'error'); }
    },
  };
}

function MusicList({ items, loaded, searching }: { items: LibraryItem[]; loaded: boolean; searching: boolean }) {
  const playIds = usePlayer((s) => s.playIds);
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const setMode = useApp((s) => s.setMode);
  const { reveal } = useItemActions();

  if (!loaded) return <ListSkeleton />;
  if (!items.length) return <EmptyState icon={<Music />} title={searching ? 'No songs match' : 'No music yet'}>{searching ? 'Try a different search.' : 'Downloaded music and anything in your Music folder shows up here.'}</EmptyState>;

  const ids = items.map((i) => i.id);
  const play = (index: number) => {
    void playIds(ids, index).then(() => {
      if (useApp.getState().settings?.player.openPlayerOnPlay) setMode('player');
    });
  };
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="grid grid-cols-[44px_1fr_1fr_110px_64px_40px] items-center gap-3 border-b border-line px-3 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
        <span /><span>Title</span><span>Album</span><span>Quality</span><span className="text-right">Time</span><span />
      </div>
      <VirtualList
        className="min-h-0 flex-1"
        items={items}
        rowHeight={52}
        render={(item, index) => {
          const isCurrent = item.id === currentId;
          const tag = qualityTag(item);
          return (
            <div
              role="button"
              tabIndex={0}
              onDoubleClick={() => play(index)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && play(index)}
              className={cn('group grid h-full grid-cols-[44px_1fr_1fr_110px_64px_40px] items-center gap-3 px-3 transition-colors hover:bg-hover', isCurrent && 'bg-accent-soft')}
            >
              <button data-play aria-label={`Play ${item.title}`} className="relative" onClick={(e) => { e.stopPropagation(); play(index); }}>
                <Artwork src={item.hasArtwork ? art(item.id) : null} seed={item.album ?? item.title} className="size-9" rounded="rounded-md" />
                {isCurrent && playing
                  ? <span className="absolute inset-0 grid place-items-center rounded-md bg-black/45"><EqBars /></span>
                  : <span className="absolute inset-0 grid place-items-center rounded-md bg-black/45 opacity-0 transition-opacity group-hover:opacity-100"><Play className="size-4 fill-white text-white" /></span>}
              </button>
              <div className="min-w-0">
                <p className={cn('truncate text-sm font-semibold', isCurrent && 'text-accent')}>{item.title}</p>
                <p className="truncate text-[13px] text-ink-3">{item.artist ?? 'Unknown artist'}</p>
              </div>
              <p className="truncate text-[13px] text-ink-3">{item.album ?? '—'}</p>
              <span>{tag && <Badge tone={item.lossless ? 'accent' : 'neutral'}>{tag}</Badge>}</span>
              <span className="text-right text-[13px] text-ink-3 tabular">{formatDuration(item.durationSec)}</span>
              <IconButton label="Show in folder" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => reveal(item.path)}><FolderOpen /></IconButton>
            </div>
          );
        }}
      />
      <p className="border-t border-line px-3 py-1.5 text-xs text-ink-3">Double-click a song to play it. The rest of the list plays after it.</p>
    </div>
  );
}

function VideoGrid({ items, loaded, searching }: { items: LibraryItem[]; loaded: boolean; searching: boolean }) {
  const playIds = usePlayer((s) => s.playIds);
  const setMode = useApp((s) => s.setMode);
  const { reveal, makeTvSafe, generateSubs } = useItemActions();

  if (!loaded) return <ListSkeleton />;
  if (!items.length) return <EmptyState icon={<Film />} title={searching ? 'No videos match' : 'No videos yet'}>{searching ? 'Try a different search.' : 'Downloaded videos and anything in your Videos folder shows up here.'}</EmptyState>;

  return (
    <div className="grid h-full auto-rows-min grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 overflow-auto pr-1 pb-4">
      {items.slice(0, 600).map((item, i) => (
        <article key={item.id} className="group">
          <button onClick={() => { void playIds(items.map((x) => x.id), i); setMode('player'); }} className="relative block w-full overflow-hidden rounded-xl border border-line bg-sunken shadow-sm transition-transform duration-200 hover:-translate-y-0.5" aria-label={`Play ${item.title}`}>
            <Artwork src={art(item.id)} seed={item.title} kind="video" className="aspect-video w-full" rounded="rounded-none" />
            <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular">{formatDuration(item.durationSec)}</span>
            {qualityTag(item) && <span className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">{qualityTag(item)}</span>}
          </button>
          <div className="mt-2 flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm leading-snug font-semibold" title={item.title}>{item.title}</p>
              <p className="mt-0.5 text-xs text-ink-3">{item.codec?.toUpperCase()}</p>
            </div>
            <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <IconButton label="Generate English subtitles" size="sm" onClick={() => generateSubs(item.path)}><Captions /></IconButton>
              {item.codec !== 'h264' && <IconButton label="Make a TV-ready copy" size="sm" onClick={() => makeTvSafe(item.path)}><Tv /></IconButton>}
              <IconButton label="Show in folder" size="sm" onClick={() => reveal(item.path)}><FolderOpen /></IconButton>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function PlaylistGrid({ lists, loaded, searching }: { lists: LibraryPlaylist[]; loaded: boolean; searching: boolean }) {
  const playIds = usePlayer((s) => s.playIds);
  const setMode = useApp((s) => s.setMode);
  const toast = useApp((s) => s.toast);

  if (!loaded) return <ListSkeleton />;
  if (!lists.length) return <EmptyState icon={<ListMusic />} title={searching ? 'No playlists match' : 'No playlists found'}>{searching ? 'Try a different search.' : 'Lumina finds .m3u, .pls and .xspf playlists and any folder of songs in your library folders.'}</EmptyState>;

  const play = async (pl: LibraryPlaylist) => {
    const items = await call('library:items', { playlistId: pl.id });
    if (!items.length) return toast('None of this playlist’s files could be found.', 'error');
    await playIds(items.map((i) => i.id));
    setMode('player');
  };

  return (
    <div className="grid h-full auto-rows-min grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 overflow-auto pb-4">
      {lists.map((pl) => (
        <button key={pl.id} onClick={() => play(pl)} className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left shadow-sm transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-raised active:scale-[0.99]">
          <span className="grid size-12 shrink-0 place-items-center rounded-lg text-white/85" style={{ background: `linear-gradient(135deg, oklch(58% 0.11 ${(pl.name.length * 47) % 360}), oklch(36% 0.08 ${(pl.name.length * 47 + 50) % 360}))` }}>
            {pl.kind === 'video' ? <Film className="size-5" /> : <ListMusic className="size-5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{pl.name}</span>
            <span className="block truncate text-xs text-ink-3">{pl.location} · {pl.source === 'folder' ? 'folder' : `.${pl.path.split('.').pop()} file`}</span>
          </span>
          <span className="text-xs font-semibold text-ink-3 tabular">{pl.itemCount}</span>
        </button>
      ))}
    </div>
  );
}

function EqBars() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-[3px] rounded-sm bg-white" style={{ height: '100%', animation: `eq 0.9s ${i * 0.15}s ease-in-out infinite alternate`, transformOrigin: 'bottom' }} />
      ))}
      <style>{'@keyframes eq{from{transform:scaleY(.25)}to{transform:scaleY(1)}}'}</style>
    </span>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton h-12 rounded-lg" style={{ opacity: 1 - i * 0.12 }} />)}
    </div>
  );
}
