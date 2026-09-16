import path from 'path';
import type { RepackPackage, RepackPart, DownloadRequest } from '../preload/types';
import { downloaderManager } from './downloader';
import { storageManager } from './storage';
import { settingsManager } from './settings';

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class RepackCrawler {
  /**
   * Sniff and parse arbitrary text, forum posts, or URLs to build a unified RepackPackage
   */
  public async crawlMultiLinks(rawText: string): Promise<RepackPackage> {
    const rawUrls = this.extractUrls(rawText);
    if (rawUrls.length === 0) {
      throw new Error('No valid download URLs found in the provided text.');
    }

    // Resolve details for all links concurrently with a worker pool (up to 6 concurrent probes)
    const partsList: RepackPart[] = [];
    const poolLimit = 6;
    let idx = 0;

    const workers = Array.from({ length: Math.min(poolLimit, rawUrls.length) }, async () => {
      while (idx < rawUrls.length) {
        const currentUrl = rawUrls[idx++];
        try {
          const part = await this.probeAndResolveUrl(currentUrl);
          partsList.push(part);
        } catch (e) {
          console.warn(`Failed to probe link: ${currentUrl}`, e);
          // Fallback minimal part representation
          const fallbackFilename = this.extractFilenameFromUrl(currentUrl);
          const ext = path.extname(fallbackFilename).toLowerCase();
          partsList.push({
            partIndex: this.detectPartNumber(fallbackFilename) || 0,
            rawUrl: currentUrl,
            directUrl: currentUrl,
            filename: fallbackFilename,
            extension: ext,
            hostName: this.identifyHost(currentUrl),
            sizeBytes: 0,
            sizeStr: 'Unknown',
            status: 'ready',
            isPlayable: this.isPlayableExtension(ext)
          });
        }
      }
    });

    await Promise.all(workers);

    // Group into multi-part archive sequence or standalone files
    return this.assemblePackage(partsList);
  }

  /**
   * Start 1-Click IDM Turbo downloads for all parts in the package into a dedicated directory
   */
  public async startRepackDownload(pkg: RepackPackage, customTargetDir?: string): Promise<string[]> {
    const targetDir = customTargetDir || storageManager.getRepackDownloadDirectory(pkg.title);
    const settings = settingsManager.get();
    const taskIds: string[] = [];

    // All parts in sequence
    const allItemsToDownload = [...pkg.parts, ...pkg.standaloneFiles];

    for (let i = 0; i < allItemsToDownload.length; i++) {
      const part = allItemsToDownload[i];
      const downloadUrl = part.directUrl || part.rawUrl;
      const partTaskId = `repack_${pkg.id}_part_${part.partIndex || i + 1}_${Date.now()}`;

      const request: DownloadRequest = {
        id: partTaskId,
        url: downloadUrl,
        title: part.filename || `${pkg.title} - Part ${part.partIndex}`,
        thumbnail: '',
        mode: 'video', // Direct file downloads use binary streams
        audioFormat: 'mp3',
        includeSubtitles: false,
        embedSubtitles: false,
        targetDir,
        isDirectFile: true,
        turboConnections: settings.turboConnections || 16
      };

      try {
        const startedId = await downloaderManager.startDownload(request);
        taskIds.push(startedId);
      } catch (err) {
        console.error(`Failed to queue part ${part.filename}:`, err);
      }
    }

    return taskIds;
  }

  /**
   * Extract all valid URLs from raw unstructured text blocks
   */
  public extractUrls(text: string): string[] {
    if (!text || typeof text !== 'string') return [];

    // Match http/https URLs and magnet links
    const urlRegex = /(https?:\/\/[^\s"'<>()]+|magnet:\?[^\s"'<>]+)/gi;
    const matches = text.match(urlRegex) || [];

    const cleanUrls: string[] = [];
    for (const raw of matches) {
      // Clean trailing punctuation that might get picked up from forum text
      const clean = raw.replace(/[.,;:)\]>]+$/, '').trim();
      if (clean && !cleanUrls.includes(clean)) {
        cleanUrls.push(clean);
      }
    }

    return cleanUrls;
  }

  /**
   * Probe URL with redirect following and direct host resolution
   */
  public async probeAndResolveUrl(url: string): Promise<RepackPart> {
    let targetUrl = url;
    let hostName = this.identifyHost(url);

    // 1. Specialized host unwrapping
    // Pixeldrain
    const pixelMatch = url.match(/pixeldrain\.com\/u\/([a-zA-Z0-9_-]+)/i);
    if (pixelMatch) {
      targetUrl = `https://pixeldrain.com/api/file/${pixelMatch[1]}`;
      hostName = 'Pixeldrain';
    }

    // Google Drive direct export
    const gdriveMatch = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/i);
    if (gdriveMatch) {
      targetUrl = `https://drive.google.com/uc?export=download&id=${gdriveMatch[1]}`;
      hostName = 'Google Drive';
    }

    // Follow redirects and inspect headers via HEAD or Range GET
    let filename = this.extractFilenameFromUrl(targetUrl);
    let sizeBytes = 0;
    let sizeStr = 'Unknown';
    let directUrl = targetUrl;

    try {
      const headers: Record<string, string> = {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': '*/*'
      };

      // Multi-hop redirect follower
      let res = await fetch(targetUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers
      });

      // If HEAD is rejected with 405 Method Not Allowed, fallback to minimal Range GET
      if (!res.ok && res.status === 405) {
        res = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: { ...headers, 'Range': 'bytes=0-1' }
        });
      }

      if (res.ok || res.status === 206) {
        directUrl = res.url || targetUrl;

        // Parse Content-Disposition for real filename
        const disp = res.headers.get('content-disposition');
        if (disp) {
          const nameMatch = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
          if (nameMatch && nameMatch[1]) {
            filename = decodeURIComponent(nameMatch[1].trim());
          }
        }

        // Parse Content-Length or Content-Range
        const cl = res.headers.get('content-length');
        const cr = res.headers.get('content-range');

        if (cr) {
          const totalMatch = cr.match(/\/(\d+)$/);
          if (totalMatch) {
            sizeBytes = parseInt(totalMatch[1], 10) || 0;
          }
        } else if (cl) {
          sizeBytes = parseInt(cl, 10) || 0;
        }

        if (sizeBytes > 0) {
          sizeStr = this.formatBytes(sizeBytes);
        }
      }
    } catch (e) {
      // Network probe failed or timeout; proceed with extracted URL information
    }

    const ext = path.extname(filename).toLowerCase();
    const partIndex = this.detectPartNumber(filename) || 0;
    const isPlayable = this.isPlayableExtension(ext);

    return {
      partIndex,
      rawUrl: url,
      directUrl,
      filename,
      extension: ext,
      hostName,
      sizeBytes,
      sizeStr,
      status: 'ready',
      isPlayable,
      streamUrl: isPlayable ? directUrl : undefined
    };
  }

  /**
   * Group parts and build comprehensive RepackPackage with missing-parts analysis
   */
  private assemblePackage(partsList: RepackPart[]): RepackPackage {
    const id = `repack_${Date.now()}`;
    const repackParts: RepackPart[] = [];
    const standaloneFiles: RepackPart[] = [];

    let totalSizeBytes = 0;
    let baseTitle = '';
    const hostsSet = new Set<string>();

    for (const part of partsList) {
      totalSizeBytes += part.sizeBytes;
      if (part.hostName) hostsSet.add(part.hostName);

      if (part.partIndex > 0 || this.isMultiPartExtension(part.extension) || /setup|fg-|data\d+/i.test(part.filename)) {
        repackParts.push(part);
        if (!baseTitle) {
          baseTitle = this.extractBaseTitle(part.filename);
        }
      } else {
        standaloneFiles.push(part);
        if (!baseTitle) {
          baseTitle = this.extractBaseTitle(part.filename);
        }
      }
    }

    // Sort repack parts numerically by their partIndex
    repackParts.sort((a, b) => a.partIndex - b.partIndex);

    // Analyze sequence completeness
    const missingParts: number[] = [];
    let totalPartsExpected = repackParts.length;

    if (repackParts.length > 0) {
      const maxPartIndex = Math.max(...repackParts.map(p => p.partIndex));
      const existingIndices = new Set(repackParts.map(p => p.partIndex));

      if (maxPartIndex > repackParts.length) {
        totalPartsExpected = maxPartIndex;
        for (let i = 1; i <= maxPartIndex; i++) {
          if (!existingIndices.has(i)) {
            missingParts.push(i);
          }
        }
      }
    }

    const hasPlayableMedia = partsList.some(p => p.isPlayable);
    const isComplete = missingParts.length === 0;
    const detectedHost = Array.from(hostsSet).join(', ') || 'Direct Download';

    if (!baseTitle) {
      baseTitle = `Lumina Repack (${partsList.length} Files)`;
    }

    return {
      id,
      title: baseTitle,
      totalPartsExpected,
      partsDiscoveredCount: repackParts.length,
      missingParts,
      isComplete,
      totalSizeBytes,
      totalSizeStr: this.formatBytes(totalSizeBytes),
      parts: repackParts,
      standaloneFiles,
      detectedHost,
      hasPlayableMedia
    };
  }

  /**
   * Detect numerical part index from filename: .part01.rar, setup-1.bin, fg-02.bin, etc.
   */
  public detectPartNumber(filename: string): number {
    // 1. Match: .part01.rar or .part1.rar
    const partMatch = filename.match(/[-_.]?part[-_.]?(\d+)/i);
    if (partMatch) return parseInt(partMatch[1], 10);

    // 2. Match: setup-1.bin or setup-01.bin
    const setupMatch = filename.match(/setup[-_.]?(\d+)/i);
    if (setupMatch) return parseInt(setupMatch[1], 10);

    // 3. Match: fg-01.bin or fg-1.bin
    const fgMatch = filename.match(/fg[-_.]?(\d+)/i);
    if (fgMatch) return parseInt(fgMatch[1], 10);

    // 4. Match: data1.bin or data-01.bin
    const dataMatch = filename.match(/data[-_.]?(\d+)/i);
    if (dataMatch) return parseInt(dataMatch[1], 10);

    // 5. Match: .7z.001 or .rar.001
    const splitMatch = filename.match(/\.(\d{2,4})$/);
    if (splitMatch) return parseInt(splitMatch[1], 10);

    // 6. Match trailing digits before extension: filename_1.rar
    const trailingDigitMatch = filename.match(/[-_](\d+)\.[a-zA-Z0-9]+$/);
    if (trailingDigitMatch) return parseInt(trailingDigitMatch[1], 10);

    return 0;
  }

  /**
   * Derive clean base package title by stripping part numbers and extension
   */
  public extractBaseTitle(filename: string): string {
    const ext = path.extname(filename);
    let title = path.basename(filename, ext);

    // Strip part identifiers
    title = title
      .replace(/[-_.]?part[-_.]?\d+/gi, '')
      .replace(/[-_.]?setup[-_.]?\d+/gi, '')
      .replace(/[-_.]?fg[-_.]?\d+/gi, '')
      .replace(/[-_.]?data[-_.]?\d+/gi, '')
      .replace(/[-_]\d+$/g, '')
      .replace(/[-_.]$/, '')
      .replace(/[-_]/g, ' ')
      .trim();

    return title || 'Lumina Repack Package';
  }

  private extractFilenameFromUrl(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      const pathname = parsed.pathname;
      const basename = path.basename(pathname);
      return basename || 'download_file';
    } catch {
      return 'download_file';
    }
  }

  private identifyHost(url: string): string {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      if (host.includes('pixeldrain')) return 'Pixeldrain';
      if (host.includes('1fichier')) return '1Fichier';
      if (host.includes('multiup')) return 'MultiUp';
      if (host.includes('mediafire')) return 'Mediafire';
      if (host.includes('drive.google')) return 'Google Drive';
      if (host.includes('rapidgator')) return 'Rapidgator';
      if (host.includes('ddownload')) return 'DDownload';
      if (host.includes('qiwi')) return 'Qiwi';
      if (host.includes('gofile')) return 'GoFile';
      if (host.includes('krakenfiles')) return 'KrakenFiles';
      if (host.includes('steamunlocked')) return 'SteamUnlocked';
      if (host.includes('fitgirl')) return 'FitGirl Repacks';
      if (host.includes('dodi-repacks')) return 'DODI Repacks';
      if (url.startsWith('magnet:')) return 'BitTorrent Magnet';

      return host.replace(/^www\./, '');
    } catch {
      return 'Direct Link';
    }
  }

  private isMultiPartExtension(ext: string): boolean {
    return /\.(rar|bin|7z|zip|001|002|003|004|005)$/i.test(ext);
  }

  private isPlayableExtension(ext: string): boolean {
    return /\.(mp4|mkv|webm|avi|mov|mp3|flac|wav|m4a|aac|ogg)$/i.test(ext);
  }

  private formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}

export const repackCrawler = new RepackCrawler();
