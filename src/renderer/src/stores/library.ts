import { create } from 'zustand';
import type { LibraryItem, LibraryPlaylist, LibraryStats, MediaKind } from '@shared/types';
import { call, on } from '@/lib/bridge';

interface LibraryState {
  stats: LibraryStats | null;
  items: Record<MediaKind, LibraryItem[]>;
  liked: LibraryItem[];
  playlists: LibraryPlaylist[];
  loaded: Record<MediaKind | 'playlists' | 'liked', boolean>;
  init: () => Promise<void>;
  load: (kind: MediaKind) => Promise<void>;
  loadPlaylists: () => Promise<void>;
  loadLiked: () => Promise<void>;
  /** Flip a song's like and patch it in place, so the heart responds without a full reload. */
  toggleLike: (item: LibraryItem) => Promise<void>;
  rescan: () => Promise<void>;
}

/** Only user playlists can be renamed, reordered or deleted; scanned .m3u files are read-only. */
export const isUserPlaylist = (pl: LibraryPlaylist) => pl.source === 'user';

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useLibrary = create<LibraryState>((set, get) => ({
  stats: null,
  items: { audio: [], video: [] },
  liked: [],
  playlists: [],
  loaded: { audio: false, video: false, playlists: false, liked: false },

  init: async () => {
    set({ stats: await call('library:stats') });
    on('library:changed', (stats) => {
      set({ stats });
      // Coalesce bursts of change events during scans.
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        const { loaded } = get();
        if (loaded.audio) void get().load('audio');
        if (loaded.video) void get().load('video');
        if (loaded.playlists && !stats.scanning) void get().loadPlaylists();
        if (loaded.liked) void get().loadLiked();
      }, stats.scanning ? 1500 : 200);
    });
  },

  load: async (kind) => {
    const list = await call('library:items', { kind });
    set((s) => ({ items: { ...s.items, [kind]: list }, loaded: { ...s.loaded, [kind]: true } }));
  },

  loadPlaylists: async () => {
    const playlists = await call('library:playlists');
    set((s) => ({ playlists, loaded: { ...s.loaded, playlists: true } }));
  },

  loadLiked: async () => {
    const liked = await call('library:items', { liked: true });
    set((s) => ({ liked, loaded: { ...s.loaded, liked: true } }));
  },

  toggleLike: async (item) => {
    const liked = !item.liked;
    await call('library:like', { path: item.path, liked });
    set((s) => {
      const patch = (list: LibraryItem[]) => list.map((i) => (i.id === item.id ? { ...i, liked } : i));
      return {
        items: { audio: patch(s.items.audio), video: patch(s.items.video) },
        // Drop it from Liked songs immediately on unlike; a like refreshes the list from the top.
        liked: liked ? s.liked : s.liked.filter((i) => i.id !== item.id),
        stats: s.stats ? { ...s.stats, liked: Math.max(0, s.stats.liked + (liked ? 1 : -1)) } : s.stats,
      };
    });
    if (liked && get().loaded.liked) await get().loadLiked();
  },

  rescan: async () => {
    await call('library:rescan');
  },
}));
