import fs from 'fs';
import path from 'path';
import os from 'os';
import type { LuminaSettings } from '../preload/types';

function resolveDefaultPlatformPaths() {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const isAndroid = process.platform === 'android' || fs.existsSync('/storage/emulated/0');

  let configDir: string;
  let videoPath: string;
  let musicPath: string;
  let downloadPath: string;

  if (isAndroid) {
    configDir = '/storage/emulated/0/Download/Lumina/.config';
    videoPath = '/storage/emulated/0/Movies/Lumina';
    musicPath = '/storage/emulated/0/Music/Lumina';
    downloadPath = '/storage/emulated/0/Download/Lumina';
  } else if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    configDir = path.join(appData, 'Lumina');
    videoPath = path.join(home, 'Videos', 'Lumina');
    musicPath = path.join(home, 'Music', 'Lumina');
    downloadPath = path.join(home, 'Downloads', 'Lumina');
  } else {
    // Linux / macOS
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    configDir = path.join(xdgConfig, 'lumina');
    const xdgVideos = process.env.XDG_VIDEOS_DIR || path.join(home, 'Videos');
    videoPath = path.join(xdgVideos, 'Lumina');
    const xdgMusic = process.env.XDG_MUSIC_DIR || path.join(home, 'Music');
    musicPath = path.join(xdgMusic, 'Lumina');
    const xdgDownloads = process.env.XDG_DOWNLOAD_DIR || path.join(home, 'Downloads');
    downloadPath = path.join(xdgDownloads, 'Lumina');
  }

  return { configDir, videoPath, musicPath, downloadPath };
}

const PLATFORM_PATHS = resolveDefaultPlatformPaths();
const CONFIG_DIR = PLATFORM_PATHS.configDir;
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');

const DEFAULT_SETTINGS: LuminaSettings = {
  theme: 'onyx',
  colorMode: 'dark',
  ambientShader: true,
  blurIntensity: 20,
  defaultVideoRes: 'max',
  defaultAudioFormat: 'mp3',
  autoSaveToUsb: true,
  usbFolderName: 'LuminaMedia',
  internalVideoPath: PLATFORM_PATHS.videoPath,
  internalMusicPath: PLATFORM_PATHS.musicPath,
  internalDownloadPath: PLATFORM_PATHS.downloadPath,
  maxConcurrentDownloads: 2,
  batchConcurrency: 3,
  speedLimit: 0,
  browserForCookies: 'none',
  turboConnections: 16,
  enableTurboMode: true,
  enableBitTorrent: true,
  anonymizeRequests: true
};

export class SettingsManager {
  private settings: LuminaSettings;

  constructor() {
    this.settings = this.load();
    this.ensureDirectories();
  }

  public get(): LuminaSettings {
    return { ...this.settings };
  }

  public save(newSettings: Partial<LuminaSettings>): LuminaSettings {
    this.settings = { ...this.settings, ...newSettings };
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf8');
      this.ensureDirectories();
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
    return this.get();
  }

  private load(): LuminaSettings {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      }
    } catch (err) {
      console.warn('Could not read settings file, using defaults', err);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private ensureDirectories() {
    try {
      if (!fs.existsSync(this.settings.internalVideoPath)) {
        fs.mkdirSync(this.settings.internalVideoPath, { recursive: true });
      }
      if (!fs.existsSync(this.settings.internalMusicPath)) {
        fs.mkdirSync(this.settings.internalMusicPath, { recursive: true });
      }
      if (!fs.existsSync(this.settings.internalDownloadPath)) {
        fs.mkdirSync(this.settings.internalDownloadPath, { recursive: true });
      }
    } catch (e) {
      console.warn('Could not create default media directories:', e);
    }
  }
}

export const settingsManager = new SettingsManager();
