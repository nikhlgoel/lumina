import { create } from 'zustand';
import type { LibraryItem, LibraryPlaylist, LibraryStats, MediaKind } from '@shared/types';
import { call, on } from '@/lib/bridge';

interface LibraryState {
  stats: LibraryStats | null;
  items: Record<MediaKind, LibraryItem[]>;
  playlists: LibraryPlaylist[];
  loaded: Record<MediaKind | 'playlists', boolean>;
  init: () => Promise<void>;
  load: (kind: MediaKind) => Promise<void>;
  loadPlaylists: () => Promise<void>;
  rescan: () => Promise<void>;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useLibrary = create<LibraryState>((set, get) => ({
  stats: null,
  items: { audio: [], video: [] },
  playlists: [],
  loaded: { audio: false, video: false, playlists: false },

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

  rescan: async () => {
    await call('library:rescan');
  },
}));
