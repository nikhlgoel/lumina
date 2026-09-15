import { spawn, exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { MusicTrack } from '../preload/types';
import { settingsManager } from './settings';
import { storageManager } from './storage';

const execAsync = util.promisify(exec);

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
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const args = [
      `ytsearch12:${cleanQuery}`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
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
    const ytdlp = this.getYtDlpPath();
    const target = videoId.startsWith('http') ? videoId : `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const { stdout } = await execAsync(`"${ytdlp}" -f bestaudio -g "${target}"`);
      return stdout.trim().split('\n')[0] || '';
    } catch (err) {
      console.error('Failed to get direct audio stream URL:', err);
      return '';
    }
  }

  public async getDownloadedMedia(): Promise<{ videos: string[]; music: string[] }> {
    const settings = settingsManager.get();
    const drives = await storageManager.getDrives();
    
    const searchDirsVideo = [settings.internalVideoPath];
    const searchDirsMusic = [settings.internalMusicPath];

    for (const drive of drives) {
      if (drive.isRemovable && drive.mountpoint) {
        searchDirsVideo.push(path.join(drive.mountpoint, settings.usbFolderName || 'LuminaMedia', 'Videos'));
        searchDirsMusic.push(path.join(drive.mountpoint, settings.usbFolderName || 'LuminaMedia', 'Music'));
      }
    }

    const videos: string[] = [];
    const music: string[] = [];

    const scan = (dirs: string[], targetList: string[], extensions: string[]) => {
      for (const dir of dirs) {
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir);
            for (const f of files) {
              const ext = path.extname(f).toLowerCase();
              if (extensions.includes(ext)) {
                targetList.push(path.join(dir, f));
              }
            }
          } catch (e) {}
        }
      }
    };

    scan(searchDirsVideo, videos, ['.mp4', '.mkv', '.webm', '.avi', '.mov']);
    scan(searchDirsMusic, music, ['.mp3', '.flac', '.opus', '.m4a', '.wav', '.ogg']);

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
