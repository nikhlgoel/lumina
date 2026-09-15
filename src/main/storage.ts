import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { StorageDrive } from '../preload/types';
import { settingsManager } from './settings';

const execAsync = util.promisify(exec);

export class StorageManager {
  private cachedDrives: StorageDrive[] = [];
  private pollInterval: NodeJS.Timeout | null = null;
  private changeCallbacks: ((drives: StorageDrive[]) => void)[] = [];

  constructor() {
    this.startPolling();
  }

  public onChange(callback: (drives: StorageDrive[]) => void): () => void {
    this.changeCallbacks.push(callback);
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter(cb => cb !== callback);
    };
  }

  public async getDrives(): Promise<StorageDrive[]> {
    try {
      if (process.platform === 'linux') {
        return await this.getLinuxDrives();
      } else if (process.platform === 'win32') {
        return await this.getWindowsDrives();
      } else {
        return await this.getDarwinDrives();
      }
    } catch (err) {
      console.error('Failed to get storage drives:', err);
      return [];
    }
  }

  public getActiveDownloadDirectory(mode: 'video' | 'audio'): string {
    const settings = settingsManager.get();
    if (settings.autoSaveToUsb) {
      const usbDrive = this.cachedDrives.find(d => d.isRemovable);
      if (usbDrive && usbDrive.mountpoint && fs.existsSync(usbDrive.mountpoint)) {
        const targetSubdir = mode === 'video' ? 'Videos' : 'Music';
        const usbTarget = path.join(usbDrive.mountpoint, settings.usbFolderName || 'LuminaMedia', targetSubdir);
        if (!fs.existsSync(usbTarget)) {
          fs.mkdirSync(usbTarget, { recursive: true });
        }
        return usbTarget;
      }
    }

    // Default internal fallback
    return mode === 'video' ? settings.internalVideoPath : settings.internalMusicPath;
  }

  public getPlaylistDownloadDirectory(playlistTitle: string): string {
    const settings = settingsManager.get();
    const rawClean = (typeof playlistTitle === 'string' ? playlistTitle : '')
      .replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_')
      .replace(/\.{2,}/g, '_')
      .trim();
    const sanitizedTitle = path.basename(rawClean).slice(0, 100) || 'Untitled_Playlist';
    let baseDir: string;

    if (settings.autoSaveToUsb) {
      const usbDrive = this.cachedDrives.find(d => d.isRemovable);
      if (usbDrive && usbDrive.mountpoint && fs.existsSync(usbDrive.mountpoint)) {
        baseDir = path.join(usbDrive.mountpoint, settings.usbFolderName || 'LuminaMedia', 'Playlists');
      } else {
        baseDir = path.join(settings.internalMusicPath, 'Playlists');
      }
    } else {
      baseDir = path.join(settings.internalMusicPath, 'Playlists');
    }

    const targetDir = path.resolve(baseDir, sanitizedTitle);
    if (!targetDir.startsWith(path.resolve(baseDir))) {
      throw new Error('Invalid playlist directory path');
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    return targetDir;
  }

  public getTorrentDownloadDirectory(): string {
    const settings = settingsManager.get();
    let targetDir: string;

    if (settings.autoSaveToUsb) {
      const usbDrive = this.cachedDrives.find(d => d.isRemovable);
      if (usbDrive && usbDrive.mountpoint && fs.existsSync(usbDrive.mountpoint)) {
        targetDir = path.join(usbDrive.mountpoint, settings.usbFolderName || 'LuminaMedia', 'Torrents');
      } else {
        targetDir = path.join(path.dirname(settings.internalVideoPath), 'Torrents');
      }
    } else {
      targetDir = path.join(path.dirname(settings.internalVideoPath), 'Torrents');
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    return targetDir;
  }

  private async getLinuxDrives(): Promise<StorageDrive[]> {
    const drives: StorageDrive[] = [];
    try {
      const { stdout } = await execAsync('lsblk -J -o NAME,TYPE,SIZE,MOUNTPOINTS,RM,HOTPLUG,TRAN,MODEL,VENDOR,FSTYPE,LABEL');
      const data = JSON.parse(stdout);

      const traverse = (device: any) => {
        const isUsb = device.tran === 'usb' || device.rm === true || device.hotplug === true;
        const mountpoints = Array.isArray(device.mountpoints) ? device.mountpoints : [];
        
        for (const mount of mountpoints) {
          if (mount && mount !== '[SWAP]' && !mount.startsWith('/boot') && !mount.startsWith('/var') && !mount.startsWith('/tmp')) {
            let freeBytes = 0;
            let totalSpace = device.size || 'Unknown';
            let freeSpace = 'Unknown';
            
            try {
              const stats = fs.statfsSync(mount);
              freeBytes = stats.bavail * stats.bsize;
              freeSpace = this.formatBytes(freeBytes);
            } catch (e) {
              // Filesystem stats unavailable
            }

            const driveLabel = device.label || device.name || 'Removable Disk';
            const modelName = device.model || (isUsb ? 'USB Flash Drive' : 'Local Storage');

            // If it's a USB drive, ensure default Lumina directories exist
            if (isUsb) {
              this.ensureUsbDirectories(mount);
            }

            drives.push({
              id: `${device.name}-${mount}`,
              name: modelName.trim(),
              label: driveLabel.trim(),
              mountpoint: mount,
              totalSpace,
              freeSpace,
              freeBytes,
              isRemovable: isUsb
            });
          }
        }

        if (device.children && Array.isArray(device.children)) {
          for (const child of device.children) {
            traverse(child);
          }
        }
      };

      if (data.blockdevices) {
        for (const dev of data.blockdevices) {
          traverse(dev);
        }
      }
    } catch (err) {
      console.warn('Error reading Linux block devices via lsblk:', err);
    }
    return drives;
  }

  private async getWindowsDrives(): Promise<StorageDrive[]> {
    // Windows logic: queries logical drives
    const drives: StorageDrive[] = [];
    try {
      const { stdout } = await execAsync('wmic logicaldisk get Caption,Description,FreeSpace,Size,VolumeName /format:csv');
      const lines = stdout.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.split(',').map(s => s.trim());
        if (parts.length >= 5) {
          const caption = parts[1]; // e.g. "D:"
          const description = parts[2]; // e.g. "Removable Disk"
          const freeSpaceBytes = parseInt(parts[3], 10) || 0;
          const sizeBytes = parseInt(parts[4], 10) || 0;
          const volumeName = parts[5] || 'Removable Drive';
          const isRemovable = description.toLowerCase().includes('removable');

          if (caption) {
            const mount = caption.endsWith('\\') ? caption : `${caption}\\`;
            if (isRemovable && fs.existsSync(mount)) {
              this.ensureUsbDirectories(mount);
            }

            drives.push({
              id: caption,
              name: description || 'Local Drive',
              label: volumeName || caption,
              mountpoint: mount,
              totalSpace: this.formatBytes(sizeBytes),
              freeSpace: this.formatBytes(freeSpaceBytes),
              freeBytes: freeSpaceBytes,
              isRemovable
            });
          }
        }
      }
    } catch (e) {
      console.warn('Error executing Windows storage scan:', e);
    }
    return drives;
  }

  private async getDarwinDrives(): Promise<StorageDrive[]> {
    const drives: StorageDrive[] = [];
    const volumesDir = '/Volumes';
    if (fs.existsSync(volumesDir)) {
      const entries = fs.readdirSync(volumesDir);
      for (const entry of entries) {
        const mount = path.join(volumesDir, entry);
        if (mount !== '/') {
          try {
            const stats = fs.statfsSync(mount);
            const freeBytes = stats.bavail * stats.bsize;
            this.ensureUsbDirectories(mount);
            drives.push({
              id: entry,
              name: 'External Drive',
              label: entry,
              mountpoint: mount,
              totalSpace: this.formatBytes(stats.blocks * stats.bsize),
              freeSpace: this.formatBytes(freeBytes),
              freeBytes,
              isRemovable: true
            });
          } catch (e) {}
        }
      }
    }
    return drives;
  }

  private ensureUsbDirectories(mountpoint: string) {
    try {
      const settings = settingsManager.get();
      const baseDir = path.join(mountpoint, settings.usbFolderName || 'LuminaMedia');
      const videoDir = path.join(baseDir, 'Videos');
      const musicDir = path.join(baseDir, 'Music');
      const playlistDir = path.join(baseDir, 'Playlists');
      const torrentDir = path.join(baseDir, 'Torrents');
      if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
      }
      if (!fs.existsSync(musicDir)) {
        fs.mkdirSync(musicDir, { recursive: true });
      }
      if (!fs.existsSync(playlistDir)) {
        fs.mkdirSync(playlistDir, { recursive: true });
      }
      if (!fs.existsSync(torrentDir)) {
        fs.mkdirSync(torrentDir, { recursive: true });
      }
    } catch (e) {
      console.warn(`Failed to auto-create LuminaMedia directory on ${mountpoint}:`, e);
    }
  }

  private formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  private startPolling() {
    this.poll();
    this.pollInterval = setInterval(() => this.poll(), 3500);
  }

  private async poll() {
    const current = await this.getDrives();
    const hasChanged = JSON.stringify(current.map(d => d.id)) !== JSON.stringify(this.cachedDrives.map(d => d.id));
    this.cachedDrives = current;
    if (hasChanged) {
      for (const cb of this.changeCallbacks) {
        cb(current);
      }
    }
  }
}

export const storageManager = new StorageManager();
