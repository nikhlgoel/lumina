import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { MusicTrack } from '../preload/types';
import { settingsManager } from './settings';
import { storageManager } from './storage';

export class MusicManager {
  private getYtDlpPath(): string {
    const venvYtDlp = path.join(process.cwd(), 'engine', 'venv', 'bin', 'yt-dlp');
    if (fs.existsSync(venvYtDlp)) {
      return venvYtDlp;
    }
    const winVenvYtDlp = path.join(process.cwd(), 'engine', 'venv', 'Scripts', 'yt-dlp.exe');
    if (fs.existsSync(winVenvYtDlp)) {
      return winVenvYtDlp;
    }
    return 'yt-dlp';
  }

  public async searchMusic(query: string): Promise<MusicTrack[]> {
    const ytdlp = this.getYtDlpPath();
    if (typeof query !== 'string') return [];
    const cleanQuery = query.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200);
    if (!cleanQuery || cleanQuery.startsWith('-')) return [];

    const args = [
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      '--',
      `ytsearch12:${cleanQuery}`
    ];

    return new Promise((resolve) => {
      const proc = spawn(ytdlp, args);
      let stdout = '';

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.on('close', () => {
        const tracks: MusicTrack[] = [];
        const lines = stdout.trim().split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            tracks.push({
              id: item.id || String(Date.now()),
              title: item.title || 'Unknown Track',
              artist: item.uploader || item.channel || 'Unknown Artist',
              duration: this.formatDuration(item.duration || 0),
              thumbnail: item.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
              url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
              album: item.album || 'Single'
            });
          } catch (e) {}
        }

        resolve(tracks);
      });

      proc.on('error', () => {
        resolve([]);
      });
    });
  }

  public async getStreamUrl(videoId: string): Promise<string> {
    if (typeof videoId !== 'string') return '';
    const cleanId = videoId.trim();
    if (!cleanId || cleanId.startsWith('-')) return '';

    let target: string;
    if (cleanId.startsWith('http://') || cleanId.startsWith('https://')) {
      try {
        const parsed = new URL(cleanId);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        target = parsed.href;
      } catch {
        return '';
      }
    } else if (/^[a-zA-Z0-9_-]{4,32}$/.test(cleanId)) {
      target = `https://www.youtube.com/watch?v=${cleanId}`;
    } else {
      return '';
    }

    const ytdlp = this.getYtDlpPath();
    return new Promise((resolve) => {
      const proc = spawn(ytdlp, ['--no-warnings', '-f', 'bestaudio', '-g', '--', target]);
      let stdout = '';

      proc.stdout.on('data', (c) => {
        stdout += c.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim().split('\n')[0]);
        } else {
          resolve('');
        }
      });

      proc.on('error', (err) => {
        console.error('Failed to get direct audio stream URL:', err);
        resolve('');
      });
    });
  }

  public async getDownloadedMedia(): Promise<{ videos: string[]; music: string[] }> {
    const settings = settingsManager.get();
    const drives = await storageManager.getDrives();
    
    const searchDirsVideo = [
      settings.internalVideoPath,
      path.join(settings.internalVideoPath, 'Playlists')
    ];
    const searchDirsMusic = [
      settings.internalMusicPath,
      path.join(settings.internalMusicPath, 'Playlists')
    ];

    for (const drive of drives) {
      if (drive.isRemovable && drive.mountpoint) {
        const baseUsb = path.join(drive.mountpoint, settings.usbFolderName || 'LuminaMedia');
        searchDirsVideo.push(path.join(baseUsb, 'Videos'));
        searchDirsVideo.push(path.join(baseUsb, 'Playlists'));
        searchDirsMusic.push(path.join(baseUsb, 'Music'));
        searchDirsMusic.push(path.join(baseUsb, 'Playlists'));
      }
    }

    const videos: string[] = [];
    const music: string[] = [];

    const scan = (dir: string, targetList: string[], extensions: string[], depth = 0) => {
      if (depth > 3 || !fs.existsSync(dir)) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(fullPath, targetList, extensions, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (extensions.includes(ext)) {
              targetList.push(fullPath);
            }
          }
        }
      } catch (e) {}
    };

    for (const dir of searchDirsVideo) {
      scan(dir, videos, ['.mp4', '.mkv', '.webm', '.avi', '.mov']);
    }

    for (const dir of searchDirsMusic) {
      scan(dir, music, ['.mp3', '.flac', '.opus', '.m4a', '.wav', '.ogg']);
    }

    return { videos, music };
  }

  private formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? `0${s}` : s}`;
  }
}

export const musicManager = new MusicManager();
