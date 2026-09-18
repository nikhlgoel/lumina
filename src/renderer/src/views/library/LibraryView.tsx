import { withArtSize } from '@core/artwork';
import { useEffect, useMemo, useState } from 'react';
import { Captions, Film, FolderOpen, LayoutGrid, ListMusic, Music, Play, Rows3, RefreshCw, Search, Tv } from 'lucide-react';
import type { LibraryItem } from '@shared/types';
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
import { AddToPlaylistButton, LikeButton, PlaylistDetail, PlaylistGrid } from './Collection';
import { FilesTab } from './FilesTab';

type Tab = 'music' | 'videos' | 'playlists' | 'files';
// Rows draw covers at 28–36px; asking for more would only fill GPU memory (see core/artwork).
const art = (id: string, cssPx = 36) => withArtSize(`lumina-media://art/${id}`, cssPx)!;

function qualityTag(item: LibraryItem): string | null {
  if (item.kind === 'video') return item.height ? `${item.height >= 2160 ? '4K' : `${item.height}p`}` : null;
  if (item.lossless) return item.bitDepth && item.bitDepth > 16 ? `Hi-Res ${item.bitDepth}-bit` : 'Lossless';
  return item.bitrateKbps ? `${item.bitrateKbps}k` : null;
}

type MusicView = 'details' | 'compact';
type VideoView = 'grid' | 'list';

export function LibraryView() {
  const [tab, setTab] = useState<Tab>('music');
  const [openPlaylist, setOpenPlaylist] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { items, playlists, loaded, load, loadPlaylists, rescan, stats } = useLibrary();
  const musicView = useApp((s) => s.settings?.library.musicView ?? 'details');
  const videoView = useApp((s) => s.settings?.library.videoView ?? 'grid');
  const updateSettings = useApp((s) => s.updateSettings);

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
          subtitle={stats ? `${plural(stats.audio, 'song')} · ${plural(stats.video, 'video')} · ${plural(stats.liked, 'like')}` : undefined}
          actions={<Button variant="ghost" size="sm" icon={<RefreshCw className={cn('size-3.5', stats?.scanning && 'animate-spin')} />} disabled={stats?.scanning} onClick={rescan}>{stats?.scanning ? 'Scanning' : 'Rescan'}</Button>}
        />
        <div className="mb-4 flex items-center gap-3">
          <Segmented label="Library section" value={tab} onChange={setTab} options={[
            { value: 'music', label: 'Music' }, { value: 'videos', label: 'Videos' },
            { value: 'playlists', label: 'Playlists' }, { value: 'files', label: 'Files' },
          ]} />
          {tab === 'music' && (
            <ViewToggle
              value={musicView}
              onChange={(v) => void updateSettings({ library: { musicView: v } })}
              options={[{ value: 'details', label: 'Details', icon: <Rows3 /> }, { value: 'compact', label: 'Compact', icon: <ListMusic /> }]}
            />
          )}
          {tab === 'videos' && (
            <ViewToggle
              value={videoView}
              onChange={(v) => void updateSettings({ library: { videoView: v } })}
              options={[{ value: 'grid', label: 'Grid', icon: <LayoutGrid /> }, { value: 'list', label: 'List', icon: <Rows3 /> }]}
            />
          )}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search library"
              className="h-9 w-64 rounded-lg border border-line-strong bg-raised pr-3 pl-8 text-sm outline-none placeholder:text-ink-3 focus:border-accent" />
          </div>
        </div>

        <div className="min-h-0 flex-1 pb-4">
          {tab === 'music' && <MusicList items={music} loaded={loaded.audio} searching={!!q} view={musicView} />}
          {tab === 'videos' && <VideoGrid items={videos} loaded={loaded.video} searching={!!q} view={videoView} />}
          {tab === 'playlists' && (openPlaylist
            ? <PlaylistDetail id={openPlaylist} onBack={() => setOpenPlaylist(null)} />
            : <PlaylistGrid lists={lists} loaded={loaded.playlists} searching={!!q} onOpen={setOpenPlaylist} />)}
          {tab === 'files' && <FilesTab query={query} />}
        </div>
      </div>
    </div>
  );
}

function useItemActions() {
  const toast = useApp((s) => s.toast);
  const setView = useApp((s) => s.setView);
  // With on-device AI off no model is ever loaded, so the action shouldn't be offered at all.
  const localAi = useApp((s) => s.settings?.subtitles.localAi ?? true);
  return {
    localAi,
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

function ViewToggle<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; icon: React.ReactNode }[];
}) {
  return (
    <div role="radiogroup" aria-label="View mode" className="flex rounded-lg border border-line-strong bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={cn('grid size-8 place-items-center rounded-md transition-colors [&_svg]:size-[18px]',
            value === o.value ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-hover hover:text-ink-2')}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

function MusicList({ items, loaded, searching, view }: { items: LibraryItem[]; loaded: boolean; searching: boolean; view: MusicView }) {
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
  const compact = view === 'compact';
  const cols = compact ? 'grid-cols-[32px_1fr_52px_104px]' : 'grid-cols-[44px_1fr_1fr_110px_64px_112px]';
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-panel">
      {!compact && (
        <div className="grid grid-cols-[44px_1fr_1fr_110px_64px_112px] items-center gap-3 border-b border-line px-3 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
          <span /><span>Title</span><span>Album</span><span>Quality</span><span className="text-right">Time</span><span />
        </div>
      )}
      <VirtualList
        className="min-h-0 flex-1"
        items={items}
        rowHeight={compact ? 40 : 52}
        render={(item, index) => {
          const isCurrent = item.id === currentId;
          const tag = qualityTag(item);
          return (
            <div
              role="button"
              tabIndex={0}
              onDoubleClick={() => play(index)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && play(index)}
              className={cn('group grid h-full items-center gap-3 px-3 transition-colors hover:bg-hover', cols, isCurrent && 'bg-accent-soft')}
            >
              <button data-play aria-label={`Play ${item.title}`} className="relative" onClick={(e) => { e.stopPropagation(); play(index); }}>
                <Artwork src={item.hasArtwork ? art(item.id) : null} seed={item.album ?? item.title} className={compact ? 'size-7' : 'size-9'} rounded="rounded-md" />
                {isCurrent && playing
                  ? <span className="absolute inset-0 grid place-items-center rounded-md bg-black/45"><EqBars /></span>
                  : <span className="absolute inset-0 grid place-items-center rounded-md bg-black/45 opacity-0 transition-opacity group-hover:opacity-100"><Play className="size-4 fill-white text-white" /></span>}
              </button>
              {compact ? (
                <p className="truncate text-[13px]">
                  <span className={cn('font-semibold', isCurrent && 'text-accent')}>{item.title}</span>
                  <span className="text-ink-3"> · {item.artist ?? 'Unknown artist'}</span>
                </p>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className={cn('truncate text-sm font-semibold', isCurrent && 'text-accent')}>{item.title}</p>
                    <p className="truncate text-[13px] text-ink-3">{item.artist ?? 'Unknown artist'}</p>
                  </div>
                  <p className="truncate text-[13px] text-ink-3">{item.album ?? '—'}</p>
                  <span>{tag && <Badge tone={item.lossless ? 'accent' : 'neutral'}>{tag}</Badge>}</span>
                </>
              )}
              <span className="text-right text-[13px] text-ink-3 tabular">{formatDuration(item.durationSec)}</span>
              <div className="flex items-center">
                <LikeButton item={item} />
                <AddToPlaylistButton item={item} />
                <IconButton label="Show in folder" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => reveal(item.path)}><FolderOpen /></IconButton>
              </div>
            </div>
          );
        }}
      />
      {!compact && <p className="border-t border-line px-3 py-1.5 text-xs text-ink-3">Double-click a song to play it. The rest of the list plays after it.</p>}
    </div>
  );
}

function VideoGrid({ items, loaded, searching, view }: { items: LibraryItem[]; loaded: boolean; searching: boolean; view: VideoView }) {
  const playIds = usePlayer((s) => s.playIds);
  const setMode = useApp((s) => s.setMode);
  const { reveal, makeTvSafe, generateSubs, localAi } = useItemActions();

  if (!loaded) return <ListSkeleton />;
  if (!items.length) return <EmptyState icon={<Film />} title={searching ? 'No videos match' : 'No videos yet'}>{searching ? 'Try a different search.' : 'Downloaded videos and anything in your Videos folder shows up here.'}</EmptyState>;

  if (view === 'list') {
    const openAt = (i: number) => { void playIds(items.map((x) => x.id), i); setMode('player'); };
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-panel">
        <VirtualList
          className="min-h-0 flex-1"
          items={items}
          rowHeight={64}
          render={(item, i) => {
            const tag = qualityTag(item);
            return (
              <div
                role="button"
                tabIndex={0}
                onDoubleClick={() => openAt(i)}
                onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && openAt(i)}
                className="group grid h-full grid-cols-[96px_1fr_auto] items-center gap-3 px-3 transition-colors hover:bg-hover"
              >
                <button aria-label={`Play ${item.title}`} className="relative overflow-hidden rounded-md" onClick={(e) => { e.stopPropagation(); openAt(i); }}>
                  <Artwork src={art(item.id, 96)} seed={item.title} kind="video" className="aspect-video w-24" rounded="rounded-md" />
                  <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"><Play className="size-4 fill-white text-white" /></span>
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold" title={item.title}>{item.title}</p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-3">{[item.codec?.toUpperCase(), tag].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="mr-1 text-[13px] text-ink-3 tabular">{formatDuration(item.durationSec)}</span>
                  <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {localAi && <IconButton label="Generate English subtitles" size="sm" onClick={() => generateSubs(item.path)}><Captions /></IconButton>}
                    {item.codec !== 'h264' && <IconButton label="Make a TV-ready copy" size="sm" onClick={() => makeTvSafe(item.path)}><Tv /></IconButton>}
                    <IconButton label="Show in folder" size="sm" onClick={() => reveal(item.path)}><FolderOpen /></IconButton>
                  </div>
                </div>
              </div>
            );
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid h-full auto-rows-min grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 overflow-auto pr-1 pb-4">
      {items.slice(0, 600).map((item, i) => (
        <article key={item.id} className="group">
          <button onClick={() => { void playIds(items.map((x) => x.id), i); setMode('player'); }} className="relative block w-full overflow-hidden rounded-xl border border-line bg-sunken shadow-sm transition-transform duration-200 hover:-translate-y-0.5" aria-label={`Play ${item.title}`}>
            <Artwork src={art(item.id, 256)} seed={item.title} kind="video" className="aspect-video w-full" rounded="rounded-none" />
            <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular">{formatDuration(item.durationSec)}</span>
            {qualityTag(item) && <span className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">{qualityTag(item)}</span>}
          </button>
          <div className="mt-2 flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm leading-snug font-semibold" title={item.title}>{item.title}</p>
              <p className="mt-0.5 text-xs text-ink-3">{item.codec?.toUpperCase()}</p>
            </div>
            <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {localAi && <IconButton label="Generate English subtitles" size="sm" onClick={() => generateSubs(item.path)}><Captions /></IconButton>}
              {item.codec !== 'h264' && <IconButton label="Make a TV-ready copy" size="sm" onClick={() => makeTvSafe(item.path)}><Tv /></IconButton>}
              <IconButton label="Show in folder" size="sm" onClick={() => reveal(item.path)}><FolderOpen /></IconButton>
            </div>
          </div>
        </article>
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
