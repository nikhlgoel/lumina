import { create } from 'zustand';
import type { 
  MediaMetadata, 
  MediaFormat, 
  AudioFormatOption, 
  DownloadRequest, 
  DownloadProgress, 
  StorageDrive, 
  LuminaSettings, 
  MusicTrack,
  LyricsData,
  RepackPackage,
  RepackPart
} from '@shared/types';

interface LuminaState {
  // Navigation
  activeTab: 'downloader' | 'music' | 'library' | 'settings';
  setActiveTab: (tab: 'downloader' | 'music' | 'library' | 'settings') => void;
  isMobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  toggleMobileMenu: () => void;

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
  selectTorrentFile: () => Promise<void>;

  // Lumina 2.0 Repack & Multi-Link State
  isMultiLinkMode: boolean;
  isCrawlingRepack: boolean;
  repackPackage: RepackPackage | null;
  crawlMultiLinks: (rawText: string) => Promise<void>;
  startRepackDownload: (pkg: RepackPackage) => Promise<void>;
  clearRepackPackage: () => void;

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
  seekTarget: number | null;

  // Lyrics State & Actions
  isLyricsOpen: boolean;
  lyricsData: LyricsData | null;
  isLoadingLyrics: boolean;
  lyricsError: string | null;

  setMusicQuery: (q: string) => void;
  searchMusic: (query: string) => Promise<void>;
  playTrack: (track: MusicTrack) => Promise<void>;
  togglePlayPause: () => void;
  setVolume: (vol: number) => void;
  seekTime: (time: number) => void;
  clearSeekTarget: () => void;
  updatePlaybackTime: (currentTime: number, duration: number) => void;
  toggleLyrics: () => void;
  setLyricsOpen: (open: boolean) => void;
  fetchLyrics: (customQuery?: { title?: string; artist?: string }) => Promise<void>;
  quickDownloadTrack: (track: MusicTrack, format: 'flac' | 'mp3' | 'opus' | 'aac' | 'wav') => Promise<void>;

  // Settings
  settings: LuminaSettings | null;
  loadSettings: () => Promise<void>;
  saveSettings: (newSettings: Partial<LuminaSettings>) => Promise<void>;
  cycleTheme: () => Promise<void>;
  toggleColorMode: () => Promise<void>;
  applyThemeToDom: () => void;

  // App Initializer
  initialize: () => void;
}

function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {}
}

export const useLuminaStore = create<LuminaState>((set, get) => ({
  activeTab: 'downloader',
  setActiveTab: (tab) => set({ activeTab: tab, isMobileMenuOpen: false }),
  isMobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ isMobileMenuOpen: open }),
  toggleMobileMenu: () => set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),

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

  isMultiLinkMode: false,
  isCrawlingRepack: false,
  repackPackage: null,

  crawlMultiLinks: async (rawText: string) => {
    set({ isCrawlingRepack: true, inspectError: null, isMultiLinkMode: true });
    try {
      const pkg = await window.luminaAPI.crawlMultiLinks(rawText);
      set({ repackPackage: pkg, isCrawlingRepack: false });
    } catch (err: any) {
      set({
        isCrawlingRepack: false,
        inspectError: err?.message || 'Failed to crawl multi-part repack links'
      });
    }
  },

  startRepackDownload: async (pkg: RepackPackage) => {
    try {
      const taskIds = await window.luminaAPI.startRepackDownload(pkg);
      const currentMeta = new Map(get().activeTasksMetadata);
      taskIds.forEach((id, idx) => {
        const allItems = [...pkg.parts, ...pkg.standaloneFiles];
        const part = allItems[idx];
        currentMeta.set(id, {
          title: part ? part.filename : `${pkg.title} - Part ${idx + 1}`,
          thumbnail: '',
          uploader: pkg.detectedHost,
          mode: 'IDM Turbo'
        });
      });
      set({ activeTasksMetadata: currentMeta, activeTab: 'downloader' });
    } catch (err: any) {
      set({ inspectError: err?.message || 'Failed to start repack batch download' });
    }
  },

  clearRepackPackage: () => set({ repackPackage: null, isMultiLinkMode: false }),

  inspectUrl: async (explicitUrl) => {
    const targetUrl = explicitUrl || get().urlInput;
    if (!targetUrl.trim()) return;

    // Autodetect multi-link pastes (e.g. FitGirl/DODI repacks or lists of URLs)
    const urlMatches = targetUrl.match(/(https?:\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+)/gi);
    if (urlMatches && urlMatches.length > 1) {
      return get().crawlMultiLinks(targetUrl);
    }

    set({ isInspecting: true, inspectError: null, isMultiLinkMode: false });
    try {
      const metadata = await window.luminaAPI.inspectUrl(targetUrl);
      const defaultFormat = metadata.formats[0] || null;
      const isAudioOnly = metadata.formats.length === 0;
      set({
        inspectedMedia: metadata,
        downloadMode: isAudioOnly ? 'audio' : get().downloadMode,
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
  clearInspectedMedia: () => set({ inspectedMedia: null, repackPackage: null, isMultiLinkMode: false, urlInput: '', inspectError: null }),

  selectTorrentFile: async () => {
    try {
      const filePath = await window.luminaAPI?.selectTorrentFile?.();
      if (filePath) {
        set({ urlInput: filePath });
        await get().inspectUrl(filePath);
      }
    } catch (e) {
      console.warn('Failed to select torrent file:', e);
    }
  },

  downloads: [],
  activeTasksMetadata: new Map(),

  startDownload: async () => {
    const { inspectedMedia, downloadMode, selectedFormat, selectedAudioFormat, includeSubtitles, selectedSubtitleLang, embedSubtitles, settings } = get();
    if (!inspectedMedia) return;

    const isTorrent = Boolean(inspectedMedia.isTorrent);
    const isDirect = Boolean(inspectedMedia.isDirectFile);
    const taskId = isTorrent ? `torrent_${Date.now()}` : isDirect ? `direct_${Date.now()}` : `task_${Date.now()}`;
    const effectiveMode = (inspectedMedia.formats.length === 0 || isTorrent || isDirect) ? 'audio' : downloadMode;

    const request: DownloadRequest = {
      id: taskId,
      url: inspectedMedia.url,
      title: inspectedMedia.title,
      thumbnail: inspectedMedia.thumbnail,
      mode: effectiveMode,
      videoFormatId: selectedFormat?.formatId,
      resolution: selectedFormat?.resolution,
      audioFormat: selectedAudioFormat,
      includeSubtitles,
      subtitleLang: selectedSubtitleLang,
      embedSubtitles,
      isPlaylist: inspectedMedia.isPlaylist,
      playlistTitle: inspectedMedia.playlistTitle || inspectedMedia.title,
      tracks: inspectedMedia.tracks,
      isTorrent,
      isDirectFile: isDirect,
      turboConnections: settings?.turboConnections || 16
    };

    let modeLabel = '';
    if (isTorrent) {
      modeLabel = 'BITTORRENT';
    } else if (isDirect) {
      modeLabel = `IDM TURBO (${settings?.turboConnections || 16}x)`;
    } else if (inspectedMedia.isPlaylist) {
      modeLabel = inspectedMedia.playlistType === 'spotify' ? 'SPOTIFY PLAYLIST' : 'YT PLAYLIST';
    } else {
      modeLabel = effectiveMode === 'video' ? (selectedFormat?.resolution || 'Video') : selectedAudioFormat.toUpperCase();
    }

    // Store metadata for the queue cards
    const newMap = new Map(get().activeTasksMetadata);
    newMap.set(taskId, {
      title: isTorrent 
        ? `[Torrent] ${inspectedMedia.title}` 
        : isDirect 
        ? `[Turbo File] ${inspectedMedia.title}` 
        : inspectedMedia.isPlaylist 
        ? `[Playlist] ${inspectedMedia.title}` 
        : inspectedMedia.title,
      thumbnail: inspectedMedia.thumbnail,
      uploader: isTorrent ? 'BitTorrent Swarm' : isDirect ? 'Direct Server' : inspectedMedia.uploader,
      mode: modeLabel
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
        const prev = state.downloads[index];
        if (prev.status !== 'completed' && progress.status === 'completed') {
          playCompletionChime();
        }
        const next = [...state.downloads];
        next[index] = progress;
        return { downloads: next };
      } else {
        if (progress.status === 'completed') {
          playCompletionChime();
        }
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
  seekTarget: null,

  isLyricsOpen: false,
  lyricsData: null,
  isLoadingLyrics: false,
  lyricsError: null,

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
    set({ 
      currentPlayingTrack: track, 
      isPlaying: true, 
      lyricsData: null, 
      lyricsError: null 
    });
    
    // Auto-fetch lyrics for the active track
    get().fetchLyrics({ title: track.title, artist: track.artist });

    try {
      const streamUrl = await window.luminaAPI.getStreamUrl(track.url);
      set({ audioStreamUrl: streamUrl });
    } catch (e) {
      console.error('Failed to get audio stream URL:', e);
    }
  },

  togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setVolume: (volume) => set({ volume }),
  seekTime: (target) => set({ seekTarget: target, currentTime: target }),
  clearSeekTarget: () => set({ seekTarget: null }),
  updatePlaybackTime: (currentTime, duration) => set({ currentTime, duration }),

  toggleLyrics: () => {
    const next = !get().isLyricsOpen;
    set({ isLyricsOpen: next });
    if (next && !get().lyricsData && get().currentPlayingTrack) {
      get().fetchLyrics();
    }
  },

  setLyricsOpen: (open) => {
    set({ isLyricsOpen: open });
    if (open && !get().lyricsData && get().currentPlayingTrack) {
      get().fetchLyrics();
    }
  },

  fetchLyrics: async (customQuery) => {
    const track = get().currentPlayingTrack;
    const title = customQuery?.title || track?.title;
    const artist = customQuery?.artist || track?.artist;
    if (!title) return;

    set({ isLoadingLyrics: true, lyricsError: null });
    try {
      const data = await window.luminaAPI.getLyrics({
        title,
        artist,
        duration: get().duration
      });
      set({
        lyricsData: data,
        isLoadingLyrics: false,
        lyricsError: data ? null : 'No lyrics found for this track'
      });
    } catch (e: any) {
      set({
        isLoadingLyrics: false,
        lyricsError: e?.message || 'Failed to fetch lyrics'
      });
    }
  },

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
      get().applyThemeToDom();
    } catch (e) {}
  },

  saveSettings: async (newSettings) => {
    try {
      const updated = await window.luminaAPI.saveSettings(newSettings);
      set({ settings: updated });
      get().applyThemeToDom();
    } catch (e) {}
  },

  cycleTheme: async () => {
    const current = get().settings?.theme || 'onyx';
    const themes: ('onyx' | 'cyber' | 'arctic' | 'teal' | 'sunset' | 'amethyst')[] = [
      'onyx', 'cyber', 'arctic', 'teal', 'sunset', 'amethyst'
    ];
    const next = themes[(themes.indexOf(current) + 1) % themes.length];
    await get().saveSettings({ theme: next });
  },

  toggleColorMode: async () => {
    const current = get().settings?.colorMode || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    await get().saveSettings({ colorMode: next });
  },

  applyThemeToDom: () => {
    const s = get().settings;
    const mode = s?.colorMode || 'dark';
    const theme = s?.theme || 'onyx';
    const root = document.documentElement;

    if (mode === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }

    root.setAttribute('data-theme', theme);
    root.setAttribute('data-color-mode', mode);
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
