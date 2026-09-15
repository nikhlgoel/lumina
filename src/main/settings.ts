import fs from 'fs';
import path from 'path';
import os from 'os';
import type { LuminaSettings } from '../preload/types';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'lumina');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');

const DEFAULT_SETTINGS: LuminaSettings = {
  theme: 'onyx',
  ambientShader: true,
  blurIntensity: 20,
  defaultVideoRes: 'max',
  defaultAudioFormat: 'mp3',
  autoSaveToUsb: true,
  usbFolderName: 'LuminaMedia',
  internalVideoPath: path.join(os.homedir(), 'Videos', 'Lumina'),
  internalMusicPath: path.join(os.homedir(), 'Music', 'Lumina'),
  maxConcurrentDownloads: 2,
  speedLimit: 0,
  browserForCookies: 'none',
  turboConnections: 16,
  enableTurboMode: true,
  enableBitTorrent: true
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
    } catch (e) {
      console.warn('Could not create default media directories:', e);
    }
  }
}

export const settingsManager = new SettingsManager();
