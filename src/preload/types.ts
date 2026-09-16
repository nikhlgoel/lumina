export interface MediaFormat {
  formatId: string;
  resolution: string;
  fps: number;
  vcodec: string;
  acodec: string;
  filesize: number;
  filesizeStr: string;
  ext: string;
  quality: string;
}

export interface AudioFormatOption {
  format: 'flac' | 'mp3' | 'opus' | 'aac' | 'wav';
  label: string;
  bitrate: string;
  approxSizeStr?: string;
}

export interface SubtitleOption {
  lang: string;
  label: string;
  isAuto: boolean;
}

export interface PlaylistTrack {
  id: string;
  title: string;
  artist: string;
  durationStr: string;
  thumbnail?: string;
  url?: string;
}

export interface MediaMetadata {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  duration: number;
  durationStr: string;
  uploader: string;
  uploaderUrl?: string;
  viewCount: number;
  isLive: boolean;
  formats: MediaFormat[];
  audioFormats: AudioFormatOption[];
  subtitles: SubtitleOption[];
  isPlaylist?: boolean;
  playlistType?: 'spotify' | 'youtube' | 'generic';
  playlistTitle?: string;
  trackCount?: number;
  tracks?: PlaylistTrack[];
  isTorrent?: boolean;
  torrentInfo?: {
    infoHash: string;
    name: string;
    totalLengthStr?: string;
    trackersCount: number;
    files?: string[];
  };
  isDirectFile?: boolean;
  directFileInfo?: {
    filename: string;
    sizeStr: string;
    acceptRanges: boolean;
  };
}

export interface DownloadRequest {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  mode: 'video' | 'audio';
  videoFormatId?: string;
  resolution?: string;
  audioFormat: 'flac' | 'mp3' | 'opus' | 'aac' | 'wav';
  includeSubtitles: boolean;
  subtitleLang?: string;
  embedSubtitles: boolean;
  targetDir?: string;
  isPlaylist?: boolean;
  playlistTitle?: string;
  tracks?: PlaylistTrack[];
  isTorrent?: boolean;
  torrentType?: 'magnet' | 'torrent_file';
  magnetUri?: string;
  torrentPath?: string;
  isDirectFile?: boolean;
  turboConnections?: number;
}

export interface DownloadProgress {
  taskId: string;
  status: 'queued' | 'downloading' | 'muxing' | 'transferring' | 'completed' | 'error' | 'cancelled';
  percent: number;
  speed: string;
  eta: string;
  downloadedBytes: number;
  totalBytes: number;
  stage: string;
  outputPath?: string;
  error?: string;
  currentTrackIndex?: number;
  totalTracks?: number;
  currentTrackTitle?: string;
  peers?: number;
  seeders?: number;
  connections?: number;
}

export interface StorageDrive {
  id: string;
  name: string;
  label: string;
  mountpoint: string;
  totalSpace: string;
  freeSpace: string;
  freeBytes: number;
  isRemovable: boolean;
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string;
  url: string;
  album?: string;
}

export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsData {
  trackName: string;
  artistName: string;
  plainLyrics?: string;
  syncedLyrics?: string;
  lines: LyricLine[];
  isSynced: boolean;
  source: string;
}

export interface LuminaSettings {
  theme: 'onyx' | 'cyber' | 'arctic' | 'teal';
  ambientShader: boolean;
  blurIntensity: number;
  defaultVideoRes: string;
  defaultAudioFormat: 'mp3' | 'flac' | 'opus' | 'aac' | 'wav';
  autoSaveToUsb: boolean;
  usbFolderName: string;
  internalVideoPath: string;
  internalMusicPath: string;
  maxConcurrentDownloads: number;
  speedLimit: number;
  browserForCookies: 'none' | 'firefox' | 'chrome' | 'brave' | 'edge';
  turboConnections: number;
  enableTurboMode: boolean;
  enableBitTorrent: boolean;
}

export interface LuminaAPI {
  // Media Inspection & Ingestion
  inspectUrl: (url: string) => Promise<MediaMetadata>;
  
  // Download Control
  startDownload: (request: DownloadRequest) => Promise<string>;
  pauseDownload: (taskId: string) => Promise<boolean>;
  resumeDownload: (taskId: string) => Promise<boolean>;
  cancelDownload: (taskId: string) => Promise<boolean>;
  
  // Storage & Hardware Detection
  getStorageDrives: () => Promise<StorageDrive[]>;
  
  // Music Discovery & Streaming
  searchMusic: (query: string) => Promise<MusicTrack[]>;
  getStreamUrl: (videoId: string) => Promise<string>;
  getLyrics: (query: { title: string; artist?: string; duration?: number }) => Promise<LyricsData | null>;
  
  // Local Media Library
  getDownloadedMedia: () => Promise<{ videos: string[]; music: string[] }>;
  
  // Settings Management
  getSettings: () => Promise<LuminaSettings>;
  saveSettings: (settings: Partial<LuminaSettings>) => Promise<LuminaSettings>;
  
  // Shell Actions
  openFile: (filePath: string) => Promise<void>;
  openDirectory: (filePath: string) => Promise<void>;
  selectDirectory: () => Promise<string | null>;
  selectTorrentFile: () => Promise<string | null>;
  
  // Window Controls
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  isMaximized: () => Promise<boolean>;
  
  // Listeners
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  onDrivesChanged: (callback: (drives: StorageDrive[]) => void) => () => void;
}
