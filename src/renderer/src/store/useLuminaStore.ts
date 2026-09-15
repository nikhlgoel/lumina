import { create } from 'zustand';
import type { 
  MediaMetadata, 
  MediaFormat, 
  AudioFormatOption, 
  DownloadRequest, 
  DownloadProgress, 
  StorageDrive, 
  LuminaSettings, 
  MusicTrack 
} from '@shared/types';

interface LuminaState {
  // Navigation
  activeTab: 'downloader' | 'music' | 'library' | 'settings';
  setActiveTab: (tab: 'downloader' | 'music' | 'library' | 'settings') => void;

  // Ingestion & Inspector
  urlInput: string;
  isInspecting: boolean;
  inspectError: string | null;
  inspectedMedia: MediaMetadata | null;
  downloadMode: 'video' | 'audio';
  selectedFormat: MediaFormat | null;
  selectedAudioFormat: 'flac' | 'mp3' | 'opus' | 'aac' | 'wav';
  includeSubtitles: boolean;
  selectedSubtitleLang: string;
  embedSubtitles: boolean;

  setUrlInput: (url: string) => void;
  inspectUrl: (url?: string) => Promise<void>;
  setDownloadMode: (mode: 'video' | 'audio') => void;
  setSelectedFormat: (format: MediaFormat | null) => void;
  setSelectedAudioFormat: (format: 'flac' | 'mp3' | 'opus' | 'aac' | 'wav') => void;
  setIncludeSubtitles: (include: boolean) => void;
  setSelectedSubtitleLang: (lang: string) => void;
  setEmbedSubtitles: (embed: boolean) => void;
  clearInspectedMedia: () => void;

  // Downloads Queue
  downloads: DownloadProgress[];
  activeTasksMetadata: Map<string, { title: string; thumbnail: string; uploader: string; mode: string }>;
  startDownload: () => Promise<void>;
  cancelDownload: (taskId: string) => Promise<void>;
  clearCompletedDownloads: () => void;
  updateDownloadProgress: (progress: DownloadProgress) => void;

  // Storage Drives
  drives: StorageDrive[];
  setDrives: (drives: StorageDrive[]) => void;
  fetchDrives: () => Promise<void>;

  // Music Discovery & Playback
  musicQuery: string;
  musicSearchResults: MusicTrack[];
  isSearchingMusic: boolean;
  currentPlayingTrack: MusicTrack | null;
  isPlaying: boolean;
  audioStreamUrl: string | null;
  volume: number;
  currentTime: number;
  duration: number;

  setMusicQuery: (q: string) => void;
  searchMusic: (query: string) => Promise<void>;
  playTrack: (track: MusicTrack) => Promise<void>;
  togglePlayPause: () => void;
  setVolume: (vol: number) => void;
  seekTime: (time: number) => void;
  quickDownloadTrack: (track: MusicTrack, format: 'flac' | 'mp3' | 'opus' | 'aac' | 'wav') => Promise<void>;

  // Settings
  settings: LuminaSettings | null;
  loadSettings: () => Promise<void>;
  saveSettings: (newSettings: Partial<LuminaSettings>) => Promise<void>;

  // App Initializer
  initialize: () => void;
}

export const useLuminaStore = create<LuminaState>((set, get) => ({
  activeTab: 'downloader',
  setActiveTab: (tab) => set({ activeTab: tab }),

  urlInput: '',
  isInspecting: false,
  inspectError: null,
  inspectedMedia: null,
  downloadMode: 'video',
  selectedFormat: null,
  selectedAudioFormat: 'mp3',
  includeSubtitles: false,
  selectedSubtitleLang: 'en',
  embedSubtitles: true,

  setUrlInput: (url) => set({ urlInput: url, inspectError: null }),

  inspectUrl: async (explicitUrl) => {
    const targetUrl = explicitUrl || get().urlInput;
    if (!targetUrl.trim()) return;

    set({ isInspecting: true, inspectError: null });
    try {
      const metadata = await window.luminaAPI.inspectUrl(targetUrl);
      const defaultFormat = metadata.formats[0] || null;
      set({
        inspectedMedia: metadata,
        selectedFormat: defaultFormat,
        isInspecting: false,
        selectedSubtitleLang: metadata.subtitles[0]?.lang || 'en'
      });
    } catch (err: any) {
      set({
        isInspecting: false,
        inspectError: err?.message || 'Failed to inspect media link'
      });
    }
  },

  setDownloadMode: (mode) => set({ downloadMode: mode }),
  setSelectedFormat: (format) => set({ selectedFormat: format }),
  setSelectedAudioFormat: (format) => set({ selectedAudioFormat: format }),
  setIncludeSubtitles: (include) => set({ includeSubtitles: include }),
  setSelectedSubtitleLang: (lang) => set({ selectedSubtitleLang: lang }),
  setEmbedSubtitles: (embed) => set({ embedSubtitles: embed }),
  clearInspectedMedia: () => set({ inspectedMedia: null, urlInput: '', inspectError: null }),

  downloads: [],
  activeTasksMetadata: new Map(),

  startDownload: async () => {
    const { inspectedMedia, downloadMode, selectedFormat, selectedAudioFormat, includeSubtitles, selectedSubtitleLang, embedSubtitles } = get();
    if (!inspectedMedia) return;

    const taskId = `task_${Date.now()}`;
    const request: DownloadRequest = {
      id: taskId,
      url: inspectedMedia.url,
      title: inspectedMedia.title,
      thumbnail: inspectedMedia.thumbnail,
      mode: downloadMode,
      videoFormatId: selectedFormat?.formatId,
      resolution: selectedFormat?.resolution,
      audioFormat: selectedAudioFormat,
      includeSubtitles,
      subtitleLang: selectedSubtitleLang,
      embedSubtitles
    };

    // Store metadata for the queue cards
    const newMap = new Map(get().activeTasksMetadata);
    newMap.set(taskId, {
      title: inspectedMedia.title,
      thumbnail: inspectedMedia.thumbnail,
      uploader: inspectedMedia.uploader,
      mode: downloadMode === 'video' ? (selectedFormat?.resolution || 'Video') : selectedAudioFormat.toUpperCase()
    });

    set({ activeTasksMetadata: newMap });

    try {
      await window.luminaAPI.startDownload(request);
    } catch (e) {
      console.error('Download launch failed:', e);
    }
  },

  cancelDownload: async (taskId) => {
    await window.luminaAPI.cancelDownload(taskId);
  },

  clearCompletedDownloads: () => {
    set((state) => ({
      downloads: state.downloads.filter(
        (d) => d.status !== 'completed' && d.status !== 'cancelled' && d.status !== 'error'
      )
    }));
  },

  updateDownloadProgress: (progress) => {
    set((state) => {
      const index = state.downloads.findIndex((d) => d.taskId === progress.taskId);
      if (index >= 0) {
        const next = [...state.downloads];
        next[index] = progress;
        return { downloads: next };
      } else {
        return { downloads: [progress, ...state.downloads] };
      }
    });
  },

  drives: [],
  setDrives: (drives) => set({ drives }),
  fetchDrives: async () => {
    try {
      const drives = await window.luminaAPI.getStorageDrives();
      set({ drives });
    } catch (e) {
      console.warn('Failed to fetch drives:', e);
    }
  },

  musicQuery: '',
  musicSearchResults: [],
  isSearchingMusic: false,
  currentPlayingTrack: null,
  isPlaying: false,
  audioStreamUrl: null,
  volume: 0.85,
  currentTime: 0,
  duration: 0,

  setMusicQuery: (q) => set({ musicQuery: q }),
  searchMusic: async (query) => {
    const q = query.trim();
    if (!q) return;
    set({ isSearchingMusic: true });
    try {
      const results = await window.luminaAPI.searchMusic(q);
      set({ musicSearchResults: results, isSearchingMusic: false });
    } catch (e) {
      set({ isSearchingMusic: false });
    }
  },

  playTrack: async (track) => {
    set({ currentPlayingTrack: track, isPlaying: true });
    try {
      const streamUrl = await window.luminaAPI.getStreamUrl(track.url);
      set({ audioStreamUrl: streamUrl });
    } catch (e) {
      console.error('Failed to get audio stream URL:', e);
    }
  },

  togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setVolume: (volume) => set({ volume }),
  seekTime: (currentTime) => set({ currentTime }),

  quickDownloadTrack: async (track, format) => {
    const taskId = `music_${Date.now()}`;
    const request: DownloadRequest = {
      id: taskId,
      url: track.url,
      title: track.title,
      thumbnail: track.thumbnail,
      mode: 'audio',
      audioFormat: format,
      includeSubtitles: false,
      embedSubtitles: false
    };

    const newMap = new Map(get().activeTasksMetadata);
    newMap.set(taskId, {
      title: track.title,
      thumbnail: track.thumbnail,
      uploader: track.artist,
      mode: format.toUpperCase()
    });

    set({ activeTasksMetadata: newMap, activeTab: 'downloader' });
    await window.luminaAPI.startDownload(request);
  },

  settings: null,
  loadSettings: async () => {
    try {
      const s = await window.luminaAPI.getSettings();
      set({ settings: s });
    } catch (e) {}
  },

  saveSettings: async (newSettings) => {
    try {
      const updated = await window.luminaAPI.saveSettings(newSettings);
      set({ settings: updated });
    } catch (e) {}
  },

  initialize: () => {
    get().loadSettings();
    get().fetchDrives();

    // Listen to real-time progress events
    window.luminaAPI.onDownloadProgress((progress) => {
      get().updateDownloadProgress(progress);
    });

    // Listen to storage device hotplug events
    window.luminaAPI.onDrivesChanged((drives) => {
      set({ drives });
    });
  }
}));
