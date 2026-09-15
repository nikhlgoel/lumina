import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { 
  MediaMetadata, 
  MediaFormat, 
  AudioFormatOption, 
  SubtitleOption, 
  DownloadRequest, 
  DownloadProgress, 
  PlaylistTrack 
} from '../preload/types';
import { settingsManager } from './settings';
import { storageManager } from './storage';

export class DownloaderManager {
  private activeProcesses = new Map<string, { proc: ChildProcess; request: DownloadRequest; progress: DownloadProgress }>();
  private progressListeners: ((progress: DownloadProgress) => void)[] = [];
  private cancelledTasks = new Set<string>();

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
    const cleanUrl = url.trim();

    // 1. Check for Spotify Playlist / Album / Track
    const spotifyMatch = cleanUrl.match(/(?:open\.spotify\.com\/|spotify:)(playlist|album|track)[/:]([a-zA-Z0-9]+)/);
    if (spotifyMatch) {
      const type = spotifyMatch[1] as 'playlist' | 'album' | 'track';
      const id = spotifyMatch[2];
      return await this.inspectSpotify(cleanUrl, type, id);
    }

    // 2. Check for YouTube / YouTube Music Playlist
    const isYtPlaylist = (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) && 
      (cleanUrl.includes('playlist?list=') || cleanUrl.includes('&list=') || cleanUrl.includes('?list='));
    if (isYtPlaylist) {
      try {
        const playlistMeta = await this.inspectYouTubePlaylist(cleanUrl);
        if (playlistMeta) {
          return playlistMeta;
        }
      } catch (e) {
        console.warn('YouTube playlist extraction failed, falling back to standard inspect:', e);
      }
    }

    // 3. Fallback to standard single media inspection
    return await this.inspectStandardMedia(cleanUrl);
  }

  private async inspectSpotify(url: string, type: 'playlist' | 'album' | 'track', id: string): Promise<MediaMetadata> {
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok) {
      throw new Error(`Spotify server returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) {
      throw new Error('Unable to extract Spotify payload. Link may be private or restricted.');
    }

    const payload = JSON.parse(match[1]);
    const entity = payload?.props?.pageProps?.state?.data?.entity;
    if (!entity) {
      throw new Error('Spotify entity data missing from payload');
    }

    // Resolve cover art from visuals or images
    let coverArt = '';
    const images = entity.visualIdentity?.image || entity.coverArt?.image || entity.images || [];
    if (Array.isArray(images) && images.length > 0) {
      coverArt = images[images.length - 1]?.url || images[0]?.url || '';
    }

    const audioFormats = this.getStandardAudioFormats(0);

    if (type === 'track') {
      const artists = Array.isArray(entity.artists) 
        ? entity.artists.map((a: any) => a.name).join(', ') 
        : (entity.subtitle || 'Spotify Artist');
      const duration = Math.round((entity.duration || 0) / 1000);

      return {
        id,
        url,
        title: `${artists} - ${entity.title || entity.name || 'Untitled Track'}`,
        thumbnail: coverArt,
        duration,
        durationStr: this.formatDuration(duration),
        uploader: artists,
        viewCount: 0,
        isLive: false,
        formats: [],
        audioFormats,
        subtitles: [],
        isPlaylist: false
      };
    }

    // Playlist or Album
    const rawTracks = Array.isArray(entity.trackList) ? entity.trackList : [];
    const tracks: PlaylistTrack[] = rawTracks.map((t: any, idx: number) => {
      const artist = t.subtitle || (Array.isArray(t.artists) ? t.artists.map((a: any) => a.name).join(', ') : 'Unknown Artist');
      const durSec = Math.round((t.duration || 0) / 1000);
      const trackThumb = t.visualIdentity?.image?.[0]?.url || coverArt;
      return {
        id: t.id || t.uid || `track_${idx + 1}`,
        title: t.title || `Track ${idx + 1}`,
        artist,
        durationStr: this.formatDuration(durSec),
        thumbnail: trackThumb,
        url: `https://open.spotify.com/track/${t.id || t.uid || ''}`
      };
    });

    const totalDurationMs = rawTracks.reduce((acc: number, t: any) => acc + (t.duration || 0), 0);
    const totalDurationSec = Math.round(totalDurationMs / 1000);
    const curator = entity.subtitle || entity.authors?.[0]?.name || (type === 'album' ? 'Spotify Album' : 'Spotify Curated');
    const collectionTitle = entity.title || entity.name || (type === 'album' ? 'Spotify Album' : 'Spotify Playlist');

    return {
      id,
      url,
      title: collectionTitle,
      thumbnail: coverArt,
      duration: totalDurationSec,
      durationStr: this.formatDuration(totalDurationSec),
      uploader: curator,
      viewCount: tracks.length,
      isLive: false,
      formats: [],
      audioFormats,
      subtitles: [],
      isPlaylist: true,
      playlistType: 'spotify',
      playlistTitle: collectionTitle,
      trackCount: tracks.length,
      tracks
    };
  }

  private async inspectYouTubePlaylist(url: string): Promise<MediaMetadata | null> {
    const ytdlp = this.getYtDlpPath();
    const settings = settingsManager.get();

    const args = [
      url,
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
    ];

    if (settings.browserForCookies && settings.browserForCookies !== 'none') {
      args.push('--cookies-from-browser', settings.browserForCookies);
    }

    return new Promise((resolve) => {
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
        if (code !== 0 || !stdout.trim()) {
          return resolve(null);
        }

        try {
          const raw = JSON.parse(stdout);
          if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
            return resolve(null);
          }

          const tracks: PlaylistTrack[] = raw.entries.map((entry: any, idx: number) => {
            const entryTitle = entry.title || `Track ${idx + 1}`;
            const entryArtist = entry.uploader || entry.channel || 'YouTube Artist';
            const dur = entry.duration || 0;
            const thumb = entry.thumbnails?.[0]?.url || (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : '');
            const trackUrl = entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : undefined);
            return {
              id: entry.id || String(idx + 1),
              title: entryTitle,
              artist: entryArtist,
              durationStr: this.formatDuration(dur),
              thumbnail: thumb,
              url: trackUrl
            };
          });

          const coverArt = raw.thumbnails?.[raw.thumbnails.length - 1]?.url || tracks[0]?.thumbnail || '';
          const playlistTitle = raw.title || 'YouTube Playlist';
          const uploader = raw.uploader || raw.channel || 'YouTube Playlist';

          const formats: MediaFormat[] = [
            { formatId: 'bestvideo[height<=1080]+bestaudio/best', resolution: '1080p (FHD)', fps: 60, vcodec: 'H.264', acodec: 'AAC', filesize: 0, filesizeStr: 'HD Stream', ext: 'mp4', quality: '1080p • Full HD' },
            { formatId: 'bestvideo[height<=2160]+bestaudio/best', resolution: '4K (2160p)', fps: 60, vcodec: 'VP9/AV1', acodec: 'AAC', filesize: 0, filesizeStr: 'Ultra HD', ext: 'mp4', quality: '4K • Ultra HD' },
            { formatId: 'bestvideo[height<=720]+bestaudio/best', resolution: '720p (HD)', fps: 30, vcodec: 'H.264', acodec: 'AAC', filesize: 0, filesizeStr: 'Standard HD', ext: 'mp4', quality: '720p • HD' }
          ];

          const audioFormats = this.getStandardAudioFormats(0);

          resolve({
            id: raw.id || String(Date.now()),
            url,
            title: playlistTitle,
            thumbnail: coverArt,
            duration: 0,
            durationStr: `${tracks.length} tracks`,
            uploader,
            viewCount: tracks.length,
            isLive: false,
            formats,
            audioFormats,
            subtitles: [],
            isPlaylist: true,
            playlistType: 'youtube',
            playlistTitle,
            trackCount: tracks.length,
            tracks
          });
        } catch (e) {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  private async inspectStandardMedia(url: string): Promise<MediaMetadata> {
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

    const audioFormats = this.getStandardAudioFormats(raw.duration || 0);

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
      subtitles: subtitles.slice(0, 30),
      isPlaylist: false
    };
  }

  private getStandardAudioFormats(durationSec: number): AudioFormatOption[] {
    return [
      { format: 'mp3', label: 'MP3 High-Fidelity', bitrate: '320 kbps CBR', approxSizeStr: durationSec ? this.formatBytes((durationSec * 320 * 1024) / 8) : '8-12 MB' },
      { format: 'flac', label: 'FLAC Lossless', bitrate: 'Lossless (24-bit/48kHz)', approxSizeStr: durationSec ? this.formatBytes(durationSec * 120000) : '25-35 MB' },
      { format: 'opus', label: 'OPUS High-Res', bitrate: '160 kbps Native', approxSizeStr: durationSec ? this.formatBytes((durationSec * 160 * 1024) / 8) : '5-7 MB' },
      { format: 'aac', label: 'AAC / M4A', bitrate: '256 kbps (Apple/Mobile)', approxSizeStr: durationSec ? this.formatBytes((durationSec * 256 * 1024) / 8) : '7-9 MB' },
      { format: 'wav', label: 'WAV Studio PCM', bitrate: 'Uncompressed', approxSizeStr: durationSec ? this.formatBytes(durationSec * 176400) : '40-50 MB' },
    ];
  }

  public async startDownload(request: DownloadRequest): Promise<string> {
    // Branch 1: Entire Playlist / Album download into dedicated folder
    if (request.isPlaylist) {
      return this.startPlaylistDownload(request);
    }

    // Branch 2: Single media download
    const taskId = request.id || `task_${Date.now()}`;
    const stagingDir = this.ensureStagingDirectory();
    const finalDir = request.targetDir || storageManager.getActiveDownloadDirectory(request.mode);
    const ytdlp = this.getYtDlpPath();
    const ffmpeg = this.getFfmpegPath();
    const settings = settingsManager.get();

    const stagingTemplate = path.join(stagingDir, `${taskId}_%(title)s.%(ext)s`);

    // Target query resolution (if Spotify track, convert to search query)
    let downloadTarget = request.url;
    if (downloadTarget.includes('open.spotify.com')) {
      downloadTarget = `ytsearch1:${request.title} audio`.trim();
    }

    const args = [
      downloadTarget,
      '--newline',
      '--progress-template',
      'LUMINA_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s',
      '--ffmpeg-location', ffmpeg,
      '-o', stagingTemplate,
      '--no-playlist',
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
      stage: 'Starting stream download...'
    };

    this.emitProgress(initialProgress);
    this.cancelledTasks.delete(taskId);

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

      if (this.cancelledTasks.has(taskId)) {
        this.emitProgress({
          ...lastProgress,
          status: 'cancelled',
          stage: 'Cancelled by user'
        });
        return;
      }

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

      // Move from staging area into final destination
      try {
        const files = fs.readdirSync(stagingDir);
        const match = files.find(f => f.startsWith(`${taskId}_`));

        if (!match) {
          throw new Error('Downloaded file not found in staging area');
        }

        const stagedPath = path.join(stagingDir, match);
        const cleanFileName = match.replace(`${taskId}_`, '');
        const finalPath = path.join(finalDir, cleanFileName);

        this.emitProgress({
          ...lastProgress,
          status: 'transferring',
          percent: 100,
          stage: finalDir.includes('LuminaMedia') ? 'Transferring to USB Drive...' : 'Finalizing file...'
        });

        if (!fs.existsSync(finalDir)) {
          fs.mkdirSync(finalDir, { recursive: true });
        }

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

  public async startPlaylistDownload(request: DownloadRequest): Promise<string> {
    const taskId = request.id || `playlist_${Date.now()}`;
    const playlistTitle = request.playlistTitle || request.title || 'Lumina_Playlist';
    const finalDir = request.targetDir || storageManager.getPlaylistDownloadDirectory(playlistTitle);
    const tracks = request.tracks || [];
    const totalTracks = tracks.length;
    const ytdlp = this.getYtDlpPath();
    const ffmpeg = this.getFfmpegPath();
    const settings = settingsManager.get();

    const initialProgress: DownloadProgress = {
      taskId,
      status: 'downloading',
      percent: 0,
      speed: 'Initializing batch...',
      eta: '--',
      downloadedBytes: 0,
      totalBytes: 0,
      stage: `Queued ${totalTracks} tracks for playlist: ${playlistTitle}`,
      outputPath: finalDir,
      currentTrackIndex: 0,
      totalTracks,
      currentTrackTitle: ''
    };

    this.emitProgress(initialProgress);
    this.cancelledTasks.delete(taskId);

    // Asynchronously process the playlist tracks sequentially
    (async () => {
      let completedCount = 0;

      for (let i = 0; i < totalTracks; i++) {
        if (this.cancelledTasks.has(taskId)) {
          this.emitProgress({
            taskId,
            status: 'cancelled',
            percent: (completedCount / totalTracks) * 100,
            speed: '0 KB/s',
            eta: '0s',
            downloadedBytes: 0,
            totalBytes: 0,
            stage: 'Playlist download cancelled by user',
            outputPath: finalDir,
            currentTrackIndex: i + 1,
            totalTracks,
            currentTrackTitle: tracks[i]?.title
          });
          return;
        }

        const track = tracks[i];
        const trackNumber = i + 1;
        const trackBaseProgress = (i / totalTracks) * 100;
        const fullTrackTitle = track.artist ? `${track.artist} - ${track.title}` : track.title;

        this.emitProgress({
          taskId,
          status: 'downloading',
          percent: trackBaseProgress,
          speed: 'Connecting...',
          eta: '--',
          downloadedBytes: 0,
          totalBytes: 0,
          stage: `[${trackNumber}/${totalTracks}] Downloading: ${fullTrackTitle}`,
          outputPath: finalDir,
          currentTrackIndex: trackNumber,
          totalTracks,
          currentTrackTitle: fullTrackTitle
        });

        const paddedIndex = String(trackNumber).padStart(2, '0');
        const outputTemplate = path.join(finalDir, `${paddedIndex} - %(title)s.%(ext)s`);

        let downloadTarget = track.url;
        if (!downloadTarget || downloadTarget.includes('open.spotify.com')) {
          downloadTarget = `ytsearch1:${track.artist || ''} ${track.title} audio`.trim();
        }

        const args = [
          downloadTarget,
          '--newline',
          '--progress-template',
          'LUMINA_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s',
          '--ffmpeg-location', ffmpeg,
          '-o', outputTemplate,
          '--no-playlist',
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
        } else {
          args.push('-x', '--audio-format', request.audioFormat || 'mp3', '--audio-quality', '0');
          args.push('--embed-thumbnail', '--embed-metadata');
        }

        try {
          await new Promise<void>((resolve) => {
            const proc = spawn(ytdlp, args);
            this.activeProcesses.set(taskId, { proc, request, progress: initialProgress });

            proc.stdout.on('data', (chunk) => {
              const lines = chunk.toString().split('\n');
              for (const line of lines) {
                if (line.includes('LUMINA_PROGRESS:')) {
                  const rawTelemetry = line.replace('LUMINA_PROGRESS:', '').trim();
                  const [pctStr, speedStr, etaStr, dlBytesStr, totalBytesStr] = rawTelemetry.split('|');
                  const trackPct = parseFloat(pctStr?.replace('%', '')) || 0;
                  const overallPercent = Math.min(99.9, ((i + trackPct / 100) / totalTracks) * 100);

                  this.emitProgress({
                    taskId,
                    status: 'downloading',
                    percent: overallPercent,
                    speed: speedStr || 'Downloading...',
                    eta: etaStr || '--',
                    downloadedBytes: parseInt(dlBytesStr, 10) || 0,
                    totalBytes: parseInt(totalBytesStr, 10) || 0,
                    stage: `[${trackNumber}/${totalTracks}] Downloading: ${fullTrackTitle}`,
                    outputPath: finalDir,
                    currentTrackIndex: trackNumber,
                    totalTracks,
                    currentTrackTitle: fullTrackTitle
                  });
                }
              }
            });

            proc.on('close', (code) => {
              if (code === 0) {
                completedCount++;
              } else {
                console.warn(`[Playlist Track ${trackNumber}] Exited with code ${code}`);
              }
              resolve();
            });

            proc.on('error', (err) => {
              console.warn(`[Playlist Track ${trackNumber}] Process error:`, err);
              resolve();
            });
          });
        } catch (e) {
          console.warn(`Error processing playlist track ${trackNumber}:`, e);
        }
      }

      this.activeProcesses.delete(taskId);

      if (this.cancelledTasks.has(taskId)) {
        this.emitProgress({
          taskId,
          status: 'cancelled',
          percent: (completedCount / totalTracks) * 100,
          speed: '0 KB/s',
          eta: '0s',
          downloadedBytes: 0,
          totalBytes: 0,
          stage: 'Cancelled by user',
          outputPath: finalDir,
          currentTrackIndex: completedCount,
          totalTracks
        });
      } else {
        this.emitProgress({
          taskId,
          status: 'completed',
          percent: 100,
          speed: 'Done',
          eta: '0s',
          downloadedBytes: 0,
          totalBytes: 0,
          stage: `Downloaded ${completedCount} of ${totalTracks} tracks into: ${path.basename(finalDir)}`,
          outputPath: finalDir,
          currentTrackIndex: totalTracks,
          totalTracks,
          currentTrackTitle: 'All tracks completed'
        });
      }
    })();

    return taskId;
  }

  public cancelDownload(taskId: string): boolean {
    this.cancelledTasks.add(taskId);
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
