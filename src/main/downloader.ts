import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { MediaMetadata, MediaFormat, AudioFormatOption, SubtitleOption, DownloadRequest, DownloadProgress } from '../preload/types';
import { settingsManager } from './settings';
import { storageManager } from './storage';

export class DownloaderManager {
  private activeProcesses = new Map<string, { proc: ChildProcess; request: DownloadRequest; progress: DownloadProgress }>();
  private progressListeners: ((progress: DownloadProgress) => void)[] = [];

  constructor() {
    this.ensureStagingDirectory();
  }

  public onProgress(callback: (progress: DownloadProgress) => void): () => void {
    this.progressListeners.push(callback);
    return () => {
      this.progressListeners = this.progressListeners.filter(cb => cb !== callback);
    };
  }

  private emitProgress(progress: DownloadProgress) {
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

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

  private getFfmpegPath(): string {
    if (fs.existsSync('/usr/bin/ffmpeg')) {
      return '/usr/bin/ffmpeg';
    }
    return 'ffmpeg';
  }

  private ensureStagingDirectory(): string {
    const staging = path.join(os.tmpdir(), 'lumina_staging');
    if (!fs.existsSync(staging)) {
      fs.mkdirSync(staging, { recursive: true });
    }
    return staging;
  }

  public async inspectUrl(url: string): Promise<MediaMetadata> {
    const ytdlp = this.getYtDlpPath();
    const settings = settingsManager.get();

    const args = [
      url,
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
    ];

    if (settings.browserForCookies && settings.browserForCookies !== 'none') {
      args.push('--cookies-from-browser', settings.browserForCookies);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(ytdlp, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`Failed to inspect media: ${stderr.slice(0, 300)}`));
        }

        try {
          const raw = JSON.parse(stdout);
          const metadata = this.parseMetadata(url, raw);
          resolve(metadata);
        } catch (e) {
          reject(new Error(`Failed to parse media metadata: ${e}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to launch yt-dlp: ${err.message}`));
      });
    });
  }

  private parseMetadata(url: string, raw: any): MediaMetadata {
    const rawFormats = Array.isArray(raw.formats) ? raw.formats : [];
    const formatsMap = new Map<string, MediaFormat>();

    // Resolutions to look for
    const targetHeights = [4320, 2160, 1440, 1080, 720, 480, 360];

    for (const f of rawFormats) {
      if (!f.vcodec || f.vcodec === 'none') continue;
      const height = f.height || 0;
      const fps = f.fps || 30;

      let resLabel = `${height}p`;
      if (height >= 4320) resLabel = '8K (4320p)';
      else if (height >= 2160) resLabel = '4K (2160p)';
      else if (height >= 1440) resLabel = '2K (1440p)';
      else if (height >= 1080) resLabel = fps > 30 ? '1080p60' : '1080p';
      else if (height >= 720) resLabel = fps > 30 ? '720p60' : '720p';

      let vcodecClean = 'H.264';
      if (f.vcodec.startsWith('av01')) vcodecClean = 'AV1';
      else if (f.vcodec.startsWith('vp9') || f.vcodec.startsWith('vp09')) vcodecClean = 'VP9';

      const key = `${height}-${vcodecClean}`;
      const filesize = f.filesize || f.filesize_approx || (f.tbr && raw.duration ? (f.tbr * 1024 * raw.duration) / 8 : 0);

      if (!formatsMap.has(key) || (formatsMap.get(key)!.filesize < filesize)) {
        formatsMap.set(key, {
          formatId: f.format_id,
          resolution: resLabel,
          fps,
          vcodec: vcodecClean,
          acodec: f.acodec || 'none',
          filesize,
          filesizeStr: this.formatBytes(filesize),
          ext: f.ext || 'mp4',
          quality: `${resLabel} • ${vcodecClean}`
        });
      }
    }

    const formats = Array.from(formatsMap.values())
      .sort((a, b) => {
        const hA = parseInt(a.resolution) || (a.resolution.includes('8K') ? 4320 : a.resolution.includes('4K') ? 2160 : a.resolution.includes('2K') ? 1440 : 0);
        const hB = parseInt(b.resolution) || (b.resolution.includes('8K') ? 4320 : b.resolution.includes('4K') ? 2160 : b.resolution.includes('2K') ? 1440 : 0);
        return hB - hA;
      });

    // Audio format options
    const audioFormats: AudioFormatOption[] = [
      { format: 'flac', label: 'FLAC Lossless', bitrate: 'Lossless (24-bit/48kHz)', approxSizeStr: this.formatBytes(raw.duration ? raw.duration * 120000 : 35000000) },
      { format: 'mp3', label: 'MP3 High-Fidelity', bitrate: '320 kbps CBR', approxSizeStr: this.formatBytes(raw.duration ? (raw.duration * 320 * 1024) / 8 : 12000000) },
      { format: 'opus', label: 'OPUS High-Res', bitrate: '160 kbps Native', approxSizeStr: this.formatBytes(raw.duration ? (raw.duration * 160 * 1024) / 8 : 7000000) },
      { format: 'aac', label: 'AAC / M4A', bitrate: '256 kbps (Apple/Mobile)', approxSizeStr: this.formatBytes(raw.duration ? (raw.duration * 256 * 1024) / 8 : 9000000) },
      { format: 'wav', label: 'WAV Studio PCM', bitrate: 'Uncompressed', approxSizeStr: this.formatBytes(raw.duration ? raw.duration * 176400 : 50000000) },
    ];

    // Subtitle parsing
    const subtitles: SubtitleOption[] = [];
    const subsObj = raw.subtitles || {};
    const autoSubsObj = raw.automatic_captions || {};

    for (const [lang, list] of Object.entries(subsObj)) {
      const label = (Array.isArray(list) && list[0]?.name) || lang;
      subtitles.push({ lang, label: `${label} (Official)`, isAuto: false });
    }

    for (const [lang, list] of Object.entries(autoSubsObj)) {
      if (!subtitles.some(s => s.lang === lang)) {
        const label = (Array.isArray(list) && list[0]?.name) || lang;
        subtitles.push({ lang, label: `${label} (Auto)`, isAuto: true });
      }
    }

    return {
      id: raw.id || String(Date.now()),
      url,
      title: raw.title || 'Untitled Media',
      thumbnail: raw.thumbnail || '',
      duration: raw.duration || 0,
      durationStr: this.formatDuration(raw.duration || 0),
      uploader: raw.uploader || raw.channel || 'Unknown Creator',
      uploaderUrl: raw.uploader_url || raw.channel_url,
      viewCount: raw.view_count || 0,
      isLive: Boolean(raw.is_live),
      formats,
      audioFormats,
      subtitles: subtitles.slice(0, 30) // Top 30 languages
    };
  }

  public async startDownload(request: DownloadRequest): Promise<string> {
    const taskId = request.id || `task_${Date.now()}`;
    const stagingDir = this.ensureStagingDirectory();
    const finalDir = request.targetDir || storageManager.getActiveDownloadDirectory(request.mode);
    const ytdlp = this.getYtDlpPath();
    const ffmpeg = this.getFfmpegPath();
    const settings = settingsManager.get();

    // Staging file template
    const stagingTemplate = path.join(stagingDir, `${taskId}_%(title)s.%(ext)s`);

    const args = [
      request.url,
      '--newline',
      '--progress-template',
      'LUMINA_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s',
      '--ffmpeg-location', ffmpeg,
      '-o', stagingTemplate,
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
    ];

    if (settings.browserForCookies && settings.browserForCookies !== 'none') {
      args.push('--cookies-from-browser', settings.browserForCookies);
    }

    if (request.mode === 'video') {
      if (request.videoFormatId) {
        args.push('-f', `${request.videoFormatId}+bestaudio/best`);
      } else {
        args.push('-f', 'bestvideo+bestaudio/best');
      }
      args.push('--merge-output-format', 'mp4');

      if (request.includeSubtitles && request.subtitleLang) {
        args.push('--write-subs', '--sub-langs', request.subtitleLang);
        if (request.embedSubtitles) {
          args.push('--embed-subs');
        }
      }
    } else {
      // Audio only mode
      args.push('-x', '--audio-format', request.audioFormat || 'mp3', '--audio-quality', '0');
      args.push('--embed-thumbnail', '--embed-metadata');
    }

    const initialProgress: DownloadProgress = {
      taskId,
      status: 'downloading',
      percent: 0,
      speed: 'Initializing...',
      eta: '--',
      downloadedBytes: 0,
      totalBytes: 0,
      stage: 'Starting download...'
    };

    this.emitProgress(initialProgress);

    const proc = spawn(ytdlp, args);
    this.activeProcesses.set(taskId, { proc, request, progress: initialProgress });

    let lastProgress = initialProgress;

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.includes('LUMINA_PROGRESS:')) {
          const rawTelemetry = line.replace('LUMINA_PROGRESS:', '').trim();
          const [pctStr, speedStr, etaStr, dlBytesStr, totalBytesStr] = rawTelemetry.split('|');

          const percent = parseFloat(pctStr?.replace('%', '')) || lastProgress.percent;
          const speed = speedStr || lastProgress.speed;
          const eta = etaStr || lastProgress.eta;
          const downloadedBytes = parseInt(dlBytesStr, 10) || lastProgress.downloadedBytes;
          const totalBytes = parseInt(totalBytesStr, 10) || lastProgress.totalBytes;

          let stage = 'Downloading streams...';
          if (percent >= 99) {
            stage = 'Multiplexing with FFmpeg...';
          }

          lastProgress = {
            taskId,
            status: percent >= 99 ? 'muxing' : 'downloading',
            percent,
            speed,
            eta,
            downloadedBytes,
            totalBytes,
            stage
          };

          this.emitProgress(lastProgress);
        } else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
          lastProgress = {
            ...lastProgress,
            status: 'muxing',
            stage: 'Muxing with FFmpeg...'
          };
          this.emitProgress(lastProgress);
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const errLine = chunk.toString();
      if (errLine.includes('WARNING:')) return;
      console.warn(`[yt-dlp stderr] ${errLine}`);
    });

    proc.on('close', async (code) => {
      this.activeProcesses.delete(taskId);

      if (code !== 0) {
        const errorProgress: DownloadProgress = {
          ...lastProgress,
          status: 'error',
          stage: 'Download failed',
          error: `Process exited with code ${code}`
        };
        this.emitProgress(errorProgress);
        return;
      }

      // Locate output file in staging dir
      try {
        const files = fs.readdirSync(stagingDir);
        const match = files.find(f => f.startsWith(`${taskId}_`));

        if (!match) {
          throw new Error('Downloaded file not found in staging area');
        }

        const stagedPath = path.join(stagingDir, match);
        const cleanFileName = match.replace(`${taskId}_`, '');
        const finalPath = path.join(finalDir, cleanFileName);

        // Emit transferring stage
        this.emitProgress({
          ...lastProgress,
          status: 'transferring',
          percent: 100,
          stage: finalDir.includes('LuminaMedia') ? 'Transferring to USB Drive...' : 'Finalizing file...'
        });

        // Ensure final directory exists
        if (!fs.existsSync(finalDir)) {
          fs.mkdirSync(finalDir, { recursive: true });
        }

        // Copy / Move file atomically
        await fs.promises.copyFile(stagedPath, finalPath);
        await fs.promises.unlink(stagedPath);

        const completeProgress: DownloadProgress = {
          taskId,
          status: 'completed',
          percent: 100,
          speed: 'Done',
          eta: '0s',
          downloadedBytes: lastProgress.totalBytes || lastProgress.downloadedBytes,
          totalBytes: lastProgress.totalBytes || lastProgress.downloadedBytes,
          stage: 'Completed successfully',
          outputPath: finalPath
        };

        this.emitProgress(completeProgress);
      } catch (err: any) {
        this.emitProgress({
          ...lastProgress,
          status: 'error',
          stage: 'Transfer failed',
          error: err?.message || 'Failed to move completed file'
        });
      }
    });

    return taskId;
  }

  public cancelDownload(taskId: string): boolean {
    const active = this.activeProcesses.get(taskId);
    if (active) {
      try {
        active.proc.kill('SIGKILL');
        this.activeProcesses.delete(taskId);
        this.emitProgress({
          ...active.progress,
          status: 'cancelled',
          stage: 'Cancelled by user'
        });
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  private formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  private formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const sStr = s < 10 ? `0${s}` : `${s}`;
    if (h > 0) {
      const mStr = m < 10 ? `0${m}` : `${m}`;
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  }
}

export const downloaderManager = new DownloaderManager();
