// Domain types shared by main, preload and renderer. No runtime code here.

export type ContentType = 'music' | 'video' | 'series';
export type VideoCodec = 'av1' | 'vp9' | 'hevc' | 'h264' | 'other';
export type AudioCodec = 'opus' | 'aac' | 'mp3' | 'flac' | 'alac' | 'vorbis' | 'wav' | 'other';

export interface VideoStream {
  id: string;
  width: number;
  height: number;
  fps: number;
  codec: VideoCodec;
  codecRaw: string;
  hdr: boolean;
  bitrateKbps: number | null;
  sizeBytes: number | null;
  ext: string;
}

export interface AudioStream {
  id: string;
  codec: AudioCodec;
  codecRaw: string;
  bitrateKbps: number | null;
  sampleRate: number | null;
  sizeBytes: number | null;
  ext: string;
  lossless: boolean;
}

export interface SubtitleTrack {
  lang: string;
  name: string;
  auto: boolean;
}

export interface PlaylistEntry {
  index: number;
  id: string;
  title: string;
  uploader: string;
  durationSec: number | null;
  url: string;
  thumbnail: string | null;
  /** Tracks from services Lumina can't download directly (Spotify) are matched to YouTube Music at download time. */
  match?: { title: string; artist: string; album?: string; durationSec: number | null };
}

export type SourceKind = 'media' | 'playlist' | 'direct' | 'torrent';

export interface CapturedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

/** How the browser fetched a resource, so Lumina can make the same request (sent by the extension). */
export interface RequestInfo {
  pageUrl?: string;
  pageTitle?: string;
  headers: Record<string, string>;
  cookies: CapturedCookie[];
}

export interface MediaInfo {
  url: string;
  sourceKind: SourceKind;
  site: string;
  title: string;
  uploader: string;
  thumbnail: string | null;
  durationSec: number | null;
  isLive: boolean;
  /** True for music platforms and audio-only sources; decides the default preset. */
  isMusic: boolean;
  videoStreams: VideoStream[];
  audioStreams: AudioStream[];
  subtitles: SubtitleTrack[];
  entries: PlaylistEntry[];
  /** `hosted`: the URL is a file host's download page, resolved to the real file when the download starts. */
  direct?: { filename: string; sizeBytes: number | null; resumable: boolean; mime?: string; hosted?: boolean };
  torrent?: { name: string; files: string[]; infoHash: string | null };
  request?: RequestInfo;
  /** Set when the source is a stream manifest (HLS/DASH) rather than a web page. */
  stream?: { protocol: 'hls' | 'dash'; encrypted: boolean };
  /** Notes worth showing before downloading (e.g. "matched on YouTube Music"). */
  notes?: string[];
}

/* ---------- Formats ---------- */

export type VideoContainer = 'mkv' | 'mp4' | 'webm';
export type AudioTarget = 'original' | 'mp3' | 'm4a' | 'flac' | 'opus' | 'wav';

export interface VideoFormatChoice {
  kind: 'video';
  /** null = no limit (source max, up to 8K). */
  maxHeight: number | null;
  codec: 'any' | VideoCodec;
  container: VideoContainer;
  maxFps: number | null;
  allowHdr: boolean;
  /** Re-encode to H.264/AAC when the source has no compatible stream. */
  tvSafe: boolean;
}

export interface AudioFormatChoice {
  kind: 'audio';
  target: AudioTarget;
  /** kbps for lossy conversion targets; ignored for original/flac/wav. */
  bitrateKbps: number | null;
}

export type FormatChoice = VideoFormatChoice | AudioFormatChoice;

export interface Preset {
  id: string;
  name: string;
  description: string;
  appliesTo: ContentType[];
  format: FormatChoice;
  builtIn: boolean;
}

export type SubtitleOutput = 'sidecar' | 'embed' | 'burn';


/** Ties the downloads of one pasted release together so split archives can be unpacked and assembled. */
export interface ReleaseTag {
  id: string;
  title: string;
  /** Folder the release downloads into and unpacks in. */
  dir: string;
  role: 'archive' | 'optional' | 'checksum' | 'file';
  /** Split-archive set this file belongs to, with its volume number and the number of volumes selected. */
  set?: string;
  part?: number;
  parts?: number;
  unpack: boolean;
  deleteArchives: boolean;
}
export interface DownloadOptions {
  contentType: ContentType;
  format: FormatChoice;
  englishSubtitles: boolean;
  subtitleOutput: SubtitleOutput[];
  embedMetadata: boolean;
  embedLyrics: boolean;
  sponsorBlock: boolean;
  /** 1-based playlist indices; empty = all. */
  playlistItems: number[];
  series?: { show: string; season: number };
  targetDir?: string;
  release?: ReleaseTag;
}

/* ---------- Jobs ---------- */

export type JobStatus = 'queued' | 'running' | 'paused' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type JobEngine = 'ytdlp' | 'aria2' | 'convert' | 'subtitles' | 'extract';

export interface JobProgress {
  percent: number;
  speedBps: number | null;
  etaSec: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  stage: string;
  item?: { index: number; count: number; title: string };
}

export interface CompatReport {
  tvSafe: boolean;
  summary: string;
  video?: { codec: string; width: number; height: number; fps: number };
  audio?: { codec: string; bitrateKbps: number | null; sampleRate: number | null };
}

export interface Job {
  id: string;
  createdAt: number;
  updatedAt: number;
  engine: JobEngine;
  url: string;
  title: string;
  thumbnail: string | null;
  uploader: string;
  options: DownloadOptions;
  status: JobStatus;
  progress: JobProgress;
  outputPaths: string[];
  outputDir: string | null;
  error: { message: string; detail?: string } | null;
  compat: CompatReport | null;
  /** Engine bookkeeping that survives restarts (e.g. items already finished). */
  engineState: { finishedItems: number; autoRetries?: number; cookieFallback?: boolean };
  /** Where the job came from; browser downloads are quieter (no notification for small files). */
  origin?: 'app' | 'browser';
  /** Source info used to (re)start: playlist entries, direct file name, captured request, etc. */
  source: Pick<MediaInfo, 'sourceKind' | 'site' | 'entries' | 'direct' | 'torrent' | 'request' | 'stream'>;
}

/* ---------- Tools ---------- */

export type ToolName = 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'aria2c' | 'whisper-cli' | '7z';

export interface ToolStatus {
  name: ToolName;
  ok: boolean;
  path: string | null;
  version: string | null;
  source: 'bundled' | 'updated' | 'custom' | 'system' | 'missing';
  error?: string;
}

/* ---------- Library ---------- */

export type MediaKind = 'audio' | 'video';

export interface LibraryItem {
  id: string;
  path: string;
  kind: MediaKind;
  title: string;
  artist: string | null;
  album: string | null;
  trackNo: number | null;
  durationSec: number | null;
  codec: string | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  lossless: boolean;
  width: number | null;
  height: number | null;
  hasArtwork: boolean;
  sizeBytes: number;
  mtimeMs: number;
  addedAt: number;
}

export type PlaylistSource = 'file' | 'folder' | 'user';

export interface LibraryPlaylist {
  id: string;
  name: string;
  source: PlaylistSource;
  path: string;
  kind: MediaKind | 'mixed';
  itemCount: number;
  location: string;
}

export interface LibraryStats {
  audio: number;
  video: number;
  playlists: number;
  scanning: boolean;
  lastScanAt: number | null;
}

/* ---------- Lyrics ---------- */

export interface LyricLine {
  timeSec: number;
  text: string;
}

export interface Lyrics {
  title: string;
  artist: string;
  synced: boolean;
  lines: LyricLine[];
  plain: string | null;
  source: 'embedded' | 'lrc-file' | 'lrclib' | 'lyrics.ovh';
}

/* ---------- Player ---------- */

export interface PlayableItem {
  id: string;
  kind: MediaKind;
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number | null;
  /** lumina-media:// URL for local files or proxied streams. */
  src: string;
  artworkUrl: string | null;
  path: string | null;
  /** Where to continue from (saved position), in seconds. */
  resumeAtSec?: number;
}

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  startMode: 'downloader' | 'player';
}

/* ---------- In-app browser ---------- */

export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/* ---------- Multi-source search ---------- */

export interface SearchHit {
  /** Where it came from — drives the section it's shown in and its default download format. */
  source: 'ytmusic' | 'youtube';
  kind: 'audio' | 'video';
  /** The URL to inspect/download (music.youtube.com for songs → audio defaults; youtube.com for videos). */
  url: string;
  title: string;
  /** Artist(s) for songs, uploader/channel for videos. */
  subtitle: string;
  durationSec: number | null;
  thumbnail: string | null;
}

export interface SearchResults {
  query: string;
  songs: SearchHit[];
  videos: SearchHit[];
}

/* ---------- Sync (Lumina chain) ---------- */

export interface Bookmark {
  /** Stable id — the URL itself, so saving the same page twice updates rather than duplicates. */
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

export interface SyncStatus {
  /** Whether a chain seed exists on this device. */
  hasChain: boolean;
  /** Whether the OS can securely store the seed (safeStorage/DPAPI). If false, sync can't be enabled here. */
  encryptionAvailable: boolean;
  /** The chain's recovery code to show/enter on other devices — only present when hasChain. */
  recoveryCode: string | null;
  deviceId: string;
  deviceLabel: string;
  folder: string;
  bookmarkCount: number;
  /** Epoch ms of the last successful sync this session, or 0. */
  lastSyncedAt: number;
}

/* ---------- Windows Firewall access for bundled tools ---------- */

export interface FirewallTool {
  key: string;
  label: string;
  /** True when Lumina's allow rule is in place for this tool. */
  granted: boolean;
}

export interface FirewallStatus {
  /** False off Windows, or when no bundled tool needs inbound access — the UI hides the section. */
  supported: boolean;
  tools: FirewallTool[];
}

/* ---------- File-host pages that need a person ---------- */

export interface HostChallenge {
  id: string;
  /** File the page is for. */
  label: string;
  host: string;
  reason: 'captcha' | 'stalled';
  /** Name of the check when it's a captcha (e.g. "reCAPTCHA"), so the person knows what they're solving. */
  check: string | null;
  /** Address the page is on right now, and what Lumina is doing with it. */
  url: string;
  stage: string;
  /** Pages waiting behind this one. */
  waiting: number;
}
