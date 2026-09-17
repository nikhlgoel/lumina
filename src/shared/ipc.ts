import { z } from 'zod';
import type {
  AppInfo, BrowserState, DownloadOptions, FormatChoice, HostChallenge, Job, LibraryItem, LibraryPlaylist, LibraryStats,
  Lyrics, MediaInfo, PlayableItem, Preset, RequestInfo, ToolStatus,
} from './types';
import type { Settings, SettingsPatch } from './settings';

/* ---------- Input schemas (validated in main for every call) ---------- */

const id = z.object({ id: z.string().min(1).max(200) });
const path = z.object({ path: z.string().min(1).max(4096) });

const videoFormat = z.object({
  kind: z.literal('video'),
  maxHeight: z.number().int().positive().max(4320).nullable(),
  codec: z.enum(['any', 'av1', 'vp9', 'hevc', 'h264', 'other']),
  container: z.enum(['mkv', 'mp4', 'webm']),
  maxFps: z.number().int().positive().max(240).nullable(),
  allowHdr: z.boolean(),
  tvSafe: z.boolean(),
});
const audioFormat = z.object({
  kind: z.literal('audio'),
  target: z.enum(['original', 'mp3', 'm4a', 'flac', 'opus', 'wav']),
  bitrateKbps: z.number().int().min(32).max(512).nullable(),
});
export const formatChoiceSchema = z.discriminatedUnion('kind', [videoFormat, audioFormat]);

export const downloadOptionsSchema = z.object({
  contentType: z.enum(['music', 'video', 'series']),
  format: formatChoiceSchema,
  englishSubtitles: z.boolean(),
  subtitleOutput: z.array(z.enum(['sidecar', 'embed', 'burn'])).max(3),
  embedMetadata: z.boolean(),
  embedLyrics: z.boolean(),
  sponsorBlock: z.boolean(),
  playlistItems: z.array(z.number().int().positive()).max(5000),
  series: z.object({ show: z.string().min(1).max(200), season: z.number().int().min(0).max(999) }).optional(),
  targetDir: z.string().max(4096).optional(),
  release: z.object({
    id: z.string().min(1).max(64), title: z.string().max(300), dir: z.string().min(1).max(4096),
    role: z.enum(['archive', 'optional', 'checksum', 'file']), set: z.string().max(600).optional(),
    part: z.number().int().min(0).max(100_000).optional(), parts: z.number().int().min(1).max(100_000).optional(),
    unpack: z.boolean(), deleteArchives: z.boolean(),
  }).optional(),
});

const cookieSchema = z.object({
  name: z.string().max(4096), value: z.string().max(16_384), domain: z.string().max(255), path: z.string().max(1024).catch('/'),
  secure: z.boolean().catch(false), httpOnly: z.boolean().catch(false), expirationDate: z.number().optional(),
});

/** How a browser fetched something; shared by IPC and the extension bridge. */
export const requestInfoSchema = z.object({
  pageUrl: z.string().max(8192).optional(),
  pageTitle: z.string().max(512).optional(),
  headers: z.record(z.string().max(64), z.string().max(4096)).catch({}),
  cookies: z.array(cookieSchema).max(400).catch([]),
});

export const inputSchemas = {
  'app:info': z.void(),
  'tools:status': z.void(),
  'tools:update-ytdlp': z.void(),
  'tools:supported-sites': z.void(),
  'settings:get': z.void(),
  'settings:update': z.record(z.string(), z.record(z.string(), z.unknown())),
  'presets:list': z.void(),
  'media:inspect': z.object({ url: z.string().min(1).max(8192), request: requestInfoSchema.optional() }),
  'jobs:list': z.void(),
  'jobs:add': z.object({ url: z.string().min(1).max(8192), info: z.unknown(), options: downloadOptionsSchema }),
  'jobs:pause': id,
  'jobs:resume': id,
  'jobs:cancel': id,
  'jobs:retry': id,
  'jobs:remove': id,
  'jobs:clear-finished': z.void(),
  'hosts:challenge-current': z.void(),
  'hosts:challenge-frame': z.object({
    id: z.string().min(1).max(64), x: z.number().min(-10_000).max(20_000), y: z.number().min(-10_000).max(20_000),
    width: z.number().min(0).max(20_000), height: z.number().min(0).max(20_000),
  }),
  'hosts:challenge-action': z.object({ id: z.string().min(1).max(64), action: z.enum(['reload', 'skip']) }),
  'browser:go': z.object({ url: z.string().max(4096) }),
  'browser:back': z.void(),
  'browser:forward': z.void(),
  'browser:reload': z.void(),
  'browser:stop': z.void(),
  'browser:show': z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  'browser:hide': z.void(),
  'browser:bounds': z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  'jobs:convert': z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(2000), format: formatChoiceSchema }),
  'subtitles:generate': path,
  'library:stats': z.void(),
  'library:items': z.object({
    kind: z.enum(['audio', 'video']).optional(),
    playlistId: z.string().max(200).optional(),
    query: z.string().max(200).optional(),
  }),
  'library:playlists': z.void(),
  'library:rescan': z.void(),
  'player:resolve': z.object({ ids: z.array(z.string().max(200)).max(5000) }),
  'player:resolve-path': path,
  'lyrics:get': z.object({
    title: z.string().min(1).max(500),
    artist: z.string().max(300).nullable(),
    durationSec: z.number().nullable(),
    path: z.string().max(4096).nullable(),
  }),
  'shell:open-path': path,
  'shell:show-in-folder': path,
  'dialog:pick-folder': z.object({ title: z.string().max(200).optional() }),
  'dialog:pick-torrents': z.void(),
  'window:set-mode': z.object({ mode: z.enum(['downloader', 'player']) }),
  'window:minimize': z.void(),
  'window:toggle-maximize': z.void(),
  'window:close': z.void(),
  'player:state': z.object({
    playing: z.boolean(),
    title: z.string().max(500).nullable(),
    artist: z.string().max(300).nullable(),
  }),
  'player:save-position': z.object({ id: z.string().min(1).max(200), positionSec: z.number().min(0).max(1e7) }),
  'audio:report-devices': z.object({
    devices: z.array(z.object({ deviceId: z.string().max(255), label: z.string().max(255) })).max(64),
  }),
  'accounts:list': z.void(),
  'accounts:sign-in': z.object({ target: z.string().min(1).max(2048) }),
  'accounts:sign-out': z.object({ domain: z.string().min(1).max(255) }),
  'accounts:import-cookies': z.void(),
  'spotify:status': z.void(),
  'spotify:connect': z.void(),
  'spotify:disconnect': z.void(),
  'extension:status': z.void(),
  'extension:revoke': id,
  'extension:open-folder': z.void(),
  'settings:export': z.void(),
  'settings:import': z.void(),
  'settings:reset': z.object({ section: z.string().max(40).optional() }),
  'app:open-logs': z.void(),
  'app:shortcut-status': z.void(),
  'storage:usage': z.void(),
  'cache:sizes': z.void(),
  'cache:clear': z.object({ what: z.enum(['artwork', 'lyrics']) }),
} as const;

export interface SiteAccountInfo { domain: string; cookies: number; signedIn: boolean }
export interface SpotifyStatus { connected: boolean; user: string | null; hasClientId: boolean; redirectUri: string }
export interface ExtensionStatus {
  running: boolean;
  port: number;
  folder: string;
  paired: { id: string; browser: string; createdAt: number; lastUsedAt: number }[];
}
export interface DiskUsage { label: string; path: string; freeBytes: number | null; totalBytes: number | null }
export interface AudioOutputDevice { deviceId: string; label: string }

/* ---------- Output types ---------- */

export interface InvokeOutputs {
  'app:info': AppInfo;
  'tools:status': ToolStatus[];
  'tools:update-ytdlp': ToolStatus;
  'tools:supported-sites': string[];
  'settings:get': Settings;
  'settings:update': Settings;
  'presets:list': Preset[];
  'media:inspect': MediaInfo;
  'jobs:list': Job[];
  'jobs:add': Job;
  'jobs:pause': void;
  'jobs:resume': void;
  'jobs:cancel': void;
  'jobs:retry': void;
  'jobs:remove': void;
  'jobs:clear-finished': void;
  'hosts:challenge-current': HostChallenge | null;
  'hosts:challenge-frame': void;
  'browser:go': void;
  'browser:back': void;
  'browser:forward': void;
  'browser:reload': void;
  'browser:stop': void;
  'browser:show': void;
  'browser:hide': void;
  'browser:bounds': void;
  'hosts:challenge-action': void;
  'jobs:convert': Job[];
  'subtitles:generate': Job;
  'library:stats': LibraryStats;
  'library:items': LibraryItem[];
  'library:playlists': LibraryPlaylist[];
  'library:rescan': void;
  'player:resolve': PlayableItem[];
  'player:resolve-path': PlayableItem;
  'lyrics:get': Lyrics | null;
  'shell:open-path': void;
  'shell:show-in-folder': void;
  'dialog:pick-folder': string | null;
  'dialog:pick-torrents': string[];
  'window:set-mode': void;
  'window:minimize': void;
  'window:toggle-maximize': void;
  'window:close': void;
  'player:state': void;
  'player:save-position': void;
  'audio:report-devices': void;
  'accounts:list': SiteAccountInfo[];
  'accounts:sign-in': SiteAccountInfo[];
  'accounts:sign-out': SiteAccountInfo[];
  'accounts:import-cookies': string | null;
  'spotify:status': SpotifyStatus;
  'spotify:connect': SpotifyStatus;
  'spotify:disconnect': SpotifyStatus;
  'extension:status': ExtensionStatus;
  'extension:revoke': ExtensionStatus;
  'extension:open-folder': void;
  'settings:export': string | null;
  'settings:import': Settings | null;
  'settings:reset': Settings;
  'app:open-logs': void;
  'app:shortcut-status': { ok: boolean; accelerator: string; error: string | null };
  'storage:usage': DiskUsage[];
  'cache:sizes': { artworkBytes: number; lyricsEntries: number };
  'cache:clear': void;
}

export type InvokeChannel = keyof typeof inputSchemas;

/** Renderer-side input types (settings:update and jobs:add are narrowed for callers). */
export type InvokeInputs = {
  [K in InvokeChannel]: K extends 'settings:update'
    ? SettingsPatch
    : K extends 'jobs:add'
      ? { url: string; info: MediaInfo; options: DownloadOptions }
      : K extends 'jobs:convert'
        ? { paths: string[]; format: FormatChoice }
        : K extends 'media:inspect'
          ? { url: string; request?: RequestInfo }
          : z.input<(typeof inputSchemas)[K]>;
};

/* ---------- Events pushed from main ---------- */

export interface EventPayloads {
  'jobs:updated': Job;
  'jobs:removed': { id: string };
  'settings:changed': Settings;
  'library:changed': LibraryStats;
  'tools:changed': ToolStatus[];
  'app:mode': { mode: 'downloader' | 'player' };
  'app:open-url': { url: string; request?: RequestInfo; source?: 'extension' | 'clipboard' | 'system' };
  'app:clipboard-link': { url: string };
  'app:navigate': { view: 'download' | 'queue' | 'library' | 'settings'; section?: string };
  'player:command': { command: 'toggle' | 'next' | 'previous' };
  'extension:changed': ExtensionStatus;
  'hosts:challenge': HostChallenge;
  'hosts:challenge-done': { id: string };
  'browser:state': BrowserState;
}

export type EventChannel = keyof EventPayloads;

export { EVENT_CHANNELS } from './channels';

export interface LuminaBridge {
  invoke<K extends InvokeChannel>(channel: K, ...args: InvokeInputs[K] extends void ? [] : [InvokeInputs[K]]): Promise<InvokeOutputs[K]>;
  on<K extends EventChannel>(channel: K, listener: (payload: EventPayloads[K]) => void): () => void;
  /** Full path of a file dropped onto the window (empty for files that don't exist on disk). */
  pathForFile(file: File): string;
  platform: NodeJS.Platform;
}
