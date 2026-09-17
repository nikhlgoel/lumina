import path from 'path';
import type { RepackPackage, RepackPart, RepackMirror, DownloadRequest } from '../preload/types';
import { downloaderManager } from './downloader';
import { storageManager } from './storage';
import { settingsManager } from './settings';

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Blocklist of tracking, analytics, social, donation, and ad domains that commonly pollute copied text
const JUNK_DOMAIN_BLOCKLIST = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'adservice.google',
  'googlesyndication.com',
  'facebook.com',
  'twitter.com',
  't.co',
  'x.com',
  'disqus.com',
  'disquscdn.com',
  'gravatar.com',
  'wp.com',
  's.w.org',
  'cloudflare.com',
  'patreon.com',
  'paypal.com',
  'buymeacoffee.com',
  'donationalerts.com',
  'discord.gg',
  'reddit.com',
  'telegram.me',
  't.me',
  'instagram.com',
  'imgur.com',
  'postimg.cc',
  'imagebam.com',
  'imgbox.com',
  'turboimagehost.com'
];

// Blocklist of web asset extensions that are NEVER game repacks or direct binaries
const JUNK_EXTENSION_REGEX = /\.(js|jsx|ts|tsx|mjs|css|scss|less|png|jpg|jpeg|gif|svg|webp|ico|bmp|tiff|woff|woff2|ttf|eot|otf|map|vue|json|xml|rss)(\?.*)?$/i;

// Internal blog / forum navigation paths that should never be crawled as downloads
const JUNK_PATH_REGEX = /\/(category|tag|author|page|comments|feed|wp-json|wp-content\/plugins|wp-includes|donate|faq|contacts|all-my-repacks|how-to-install)\/?$/i;

// Valid payload extensions
const VALID_PAYLOAD_EXTENSIONS = /\.(rar|7z|zip|bin|iso|tar|gz|exe|001|002|003|004|005|006|007|008|009|010|mp4|mkv|mp3|flac|wav|m4a|pkg|dmg|apk|AppImage)(\?.*)?$/i;

// Known trusted file hosters
const KNOWN_FILE_HOSTERS = [
  'pixeldrain.com',
  '1fichier.com',
  'mediafire.com',
  'drive.google.com',
  'gofile.io',
  'rapidgator.net',
  'ddownload.com',
  'qiwi.gg',
  'krakenfiles.com',
  'buzzheavier.com',
  'megaup.net',
  'datanodes.to',
  'multiup.io',
  'multiup.org',
  'multiup.eu',
  'pastebin.com',
  'rentry.co',
  'rentry.org',
  'send.cm',
  'bowfile.com',
  'alfafile.net',
  'fuckingfast.co',
  'uploadhaven.com',
  'nitroflare.com',
  'turbobit.net'
];

export class RepackCrawler {
  /**
   * Sniff and parse arbitrary text, forum posts, or URLs to build a unified RepackPackage
   */
  public async crawlMultiLinks(rawText: string): Promise<RepackPackage> {
    // 1. Unroll any paste service links (Pastebin / Rentry) first
    const expandedText = await this.expandPasteServices(rawText);

    // 2. Extract and rigorously filter raw candidate URLs
    const rawUrls = this.extractValidCandidateUrls(expandedText);
    if (rawUrls.length === 0) {
      throw new Error('No valid game repack or binary download links detected. Web assets and tracking URLs were filtered out.');
    }

    // 3. Concurrently unwrap and probe all candidate URLs
    const partsList: RepackPart[] = [];
    const poolLimit = 8;
    let idx = 0;

    const workers = Array.from({ length: Math.min(poolLimit, rawUrls.length) }, async () => {
      while (idx < rawUrls.length) {
        const currentUrl = rawUrls[idx++];
        try {
          const resolvedParts = await this.probeAndResolveUrl(currentUrl);
          for (const p of resolvedParts) {
            // Discard any part that ended up resolving to a generic HTML webpage without an archive payload
            if (p.extension === '.html' || p.extension === '.htm' || p.extension === '.php') {
              continue;
            }
            partsList.push(p);
          }
        } catch (e) {
          console.warn(`Failed to probe link: ${currentUrl}`, e);
          const fallbackFilename = this.extractFilenameFromUrl(currentUrl);
          const ext = path.extname(fallbackFilename).toLowerCase();
          // Only add if extension is a genuine payload
          if (VALID_PAYLOAD_EXTENSIONS.test(ext) || this.isKnownHoster(currentUrl)) {
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
      }
    });

    await Promise.all(workers);

    if (partsList.length === 0) {
      throw new Error('Could not identify any valid downloadable files from the provided links.');
    }

    // 4. Group into multi-part archive mirrors, selective DLCs, and standalone files
    return this.assemblePackage(partsList);
  }

  /**
   * Start 1-Click IDM Turbo downloads for parts in the package into a dedicated directory
   */
  public async startRepackDownload(pkg: RepackPackage, customTargetDir?: string): Promise<string[]> {
    const targetDir = customTargetDir || storageManager.getRepackDownloadDirectory(pkg.title);
    const settings = settingsManager.get();
    const taskIds: string[] = [];

    // Prioritize selected mirror or first complete mirror
    let partsToDownload: RepackPart[] = [];

    if (pkg.mirrors.length > 0) {
      const chosenMirror = pkg.selectedMirrorHost
        ? pkg.mirrors.find(m => m.hostName === pkg.selectedMirrorHost)
        : pkg.mirrors.find(m => m.isComplete) || pkg.mirrors[0];

      if (chosenMirror) {
        partsToDownload = [...chosenMirror.parts];
      }
    }

    if (partsToDownload.length === 0) {
      partsToDownload = [...pkg.parts];
    }

    // Append standalone files and selective DLCs
    const allItemsToDownload = [
      ...partsToDownload,
      ...pkg.standaloneFiles,
      ...pkg.selectiveDlcFiles
    ];

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
   * Expand raw text from pastebin/rentry paste services before parsing
   */
  public async expandPasteServices(rawText: string): Promise<string> {
    let text = rawText;
    const pastebinMatch = text.match(/https?:\/\/(?:www\.)?pastebin\.com\/(?:raw\/)?([a-zA-Z0-9]+)/i);
    if (pastebinMatch) {
      try {
        const rawRes = await fetch(`https://pastebin.com/raw/${pastebinMatch[1]}`, {
          headers: { 'User-Agent': BROWSER_USER_AGENT }
        });
        if (rawRes.ok) {
          const rawContent = await rawRes.text();
          text += '\n' + rawContent;
        }
      } catch (_) {}
    }

    const rentryMatch = text.match(/https?:\/\/(?:www\.)?rentry\.(?:co|org)\/(?:raw\/)?([a-zA-Z0-9]+)/i);
    if (rentryMatch) {
      try {
        const rawRes = await fetch(`https://rentry.co/${rentryMatch[1]}/raw`, {
          headers: { 'User-Agent': BROWSER_USER_AGENT }
        });
        if (rawRes.ok) {
          const rawContent = await rawRes.text();
          text += '\n' + rawContent;
        }
      } catch (_) {}
    }

    return text;
  }

  /**
   * Extract all valid candidates and discard 100% of web assets, ads, tracking, and junk
   */
  public extractValidCandidateUrls(text: string): string[] {
    if (!text || typeof text !== 'string') return [];

    const urlRegex = /(https?:\/\/[^\s"'<>()]+|magnet:\?[^\s"'<>]+)/gi;
    const matches = text.match(urlRegex) || [];

    const cleanCandidates: string[] = [];

    for (const raw of matches) {
      const clean = raw.replace(/[.,;:)\]>]+$/, '').trim();
      if (!clean) continue;

      // 1. Always accept magnet links
      if (clean.startsWith('magnet:?')) {
        if (!cleanCandidates.includes(clean)) cleanCandidates.push(clean);
        continue;
      }

      // 2. Reject junk web assets
      if (JUNK_EXTENSION_REGEX.test(clean)) {
        // Exception: Pixeldrain API endpoint
        if (!clean.includes('pixeldrain.com/api/file/')) {
          continue;
        }
      }

      // 3. Reject junk domains
      const isJunkDomain = JUNK_DOMAIN_BLOCKLIST.some(d => clean.toLowerCase().includes(d));
      if (isJunkDomain) continue;

      // 4. Reject navigation / blog paths
      try {
        const parsed = new URL(clean);
        if (JUNK_PATH_REGEX.test(parsed.pathname)) continue;
      } catch {
        continue;
      }

      // 5. Must either be a known file hoster, or have a valid payload extension, or contain download parameters
      const isHoster = this.isKnownHoster(clean);
      const isPayload = VALID_PAYLOAD_EXTENSIONS.test(clean);
      const isDownloadParam = /download|export=download|__down\?bytes=/i.test(clean);

      if (isHoster || isPayload || isDownloadParam) {
        if (!cleanCandidates.includes(clean)) {
          cleanCandidates.push(clean);
        }
      }
    }

    return cleanCandidates;
  }

  /**
   * Probe URL with redirect following and direct host unwrapping
   */
  public async probeAndResolveUrl(url: string): Promise<RepackPart[]> {
    // 1. BitTorrent Magnet
    if (url.startsWith('magnet:?')) {
      const dnMatch = url.match(/dn=([^&]+)/);
      const filename = dnMatch ? decodeURIComponent(dnMatch[1]) : 'BitTorrent Repack Swarm';
      return [{
        partIndex: 0,
        rawUrl: url,
        directUrl: url,
        filename,
        extension: '.torrent',
        hostName: 'BitTorrent Magnet',
        sizeBytes: 0,
        sizeStr: 'P2P Swarm',
        status: 'ready',
        isPlayable: false
      }];
    }

    // 2. MultiUp Unwrapper
    // MultiUp mirrors often contain direct links to Pixeldrain, 1Fichier, etc.
    const multiUpMatch = url.match(/multiup\.(?:io|org|eu)\/(?:en\/mirror|download)\/([a-zA-Z0-9_-]+)/i);
    if (multiUpMatch) {
      const multiUpParts = await this.unwrapMultiUpLink(url, multiUpMatch[1]);
      if (multiUpParts.length > 0) {
        return multiUpParts;
      }
    }

    let targetUrl = url;
    let hostName = this.identifyHost(url);

    // 3. Pixeldrain unwrapping
    const pixelMatch = url.match(/pixeldrain\.com\/u\/([a-zA-Z0-9_-]+)/i);
    if (pixelMatch) {
      targetUrl = `https://pixeldrain.com/api/file/${pixelMatch[1]}`;
      hostName = 'Pixeldrain';
    }

    // 4. Google Drive direct download
    const gdriveMatch = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/i);
    if (gdriveMatch) {
      targetUrl = `https://drive.google.com/uc?export=download&id=${gdriveMatch[1]}`;
      hostName = 'Google Drive';
    }

    // 5. Mediafire Direct Download Link Extraction
    if (url.includes('mediafire.com/file/')) {
      const directMf = await this.resolveMediafireDirect(url);
      if (directMf) {
        targetUrl = directMf.directUrl;
        hostName = 'Mediafire';
      }
    }

    // 6. Probing headers and resolving redirects
    let filename = this.extractFilenameFromUrl(targetUrl);
    let sizeBytes = 0;
    let sizeStr = 'Unknown';
    let directUrl = targetUrl;
    let contentType = '';

    try {
      const headers: Record<string, string> = {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': '*/*'
      };

      let res = await fetch(targetUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers
      });

      if (!res.ok && res.status === 405) {
        res = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: { ...headers, 'Range': 'bytes=0-1' }
        });
      }

      if (res.ok || res.status === 206) {
        directUrl = res.url || targetUrl;
        contentType = res.headers.get('content-type') || '';

        // Content-Disposition check
        const disp = res.headers.get('content-disposition');
        if (disp) {
          const nameMatch = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
          if (nameMatch && nameMatch[1]) {
            filename = decodeURIComponent(nameMatch[1].trim());
          }
        }

        // Content-Length check
        const cl = res.headers.get('content-length');
        const cr = res.headers.get('content-range');

        if (cr) {
          const totalMatch = cr.match(/\/(\d+)$/);
          if (totalMatch) sizeBytes = parseInt(totalMatch[1], 10) || 0;
        } else if (cl) {
          sizeBytes = parseInt(cl, 10) || 0;
        }

        if (sizeBytes > 0) {
          sizeStr = this.formatBytes(sizeBytes);
        }
      }
    } catch (_) {
      // Proceed with extracted URL info
    }

    const ext = path.extname(filename).toLowerCase();

    // If contentType is text/html and not an archive file, discard
    if (contentType.includes('text/html') && !VALID_PAYLOAD_EXTENSIONS.test(ext) && !this.isKnownHoster(url)) {
      return [];
    }

    const partIndex = this.detectPartNumber(filename) || 0;
    const isPlayable = this.isPlayableExtension(ext);

    return [{
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
    }];
  }

  /**
   * Mediafire page parser: extracts direct download URL from landing page
   */
  private async resolveMediafireDirect(url: string): Promise<{ directUrl: string; filename: string } | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT }
      });
      if (res.ok) {
        const html = await res.text();
        const directMatch = html.match(/href="(https?:\/\/download\d+\.mediafire\.com\/[^"]+)"/i) ||
                            html.match(/id="downloadButton"[^>]*href="([^"]+)"/i);
        if (directMatch && directMatch[1]) {
          const filename = this.extractFilenameFromUrl(directMatch[1]);
          return {
            directUrl: directMatch[1],
            filename
          };
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * MultiUp page / API parser: extracts available mirrors
   */
  private async unwrapMultiUpLink(url: string, fileId: string): Promise<RepackPart[]> {
    try {
      // 1. Try MultiUp check-file API
      const apiRes = await fetch(`https://multiup.io/api/check-file/${fileId}`, {
        headers: { 'User-Agent': BROWSER_USER_AGENT }
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data && data.hosts) {
          const mirrors: RepackPart[] = [];
          const filename = data.name || this.extractFilenameFromUrl(url);
          const ext = path.extname(filename).toLowerCase();
          const sizeBytes = data.size || 0;
          const sizeStr = sizeBytes > 0 ? this.formatBytes(sizeBytes) : 'Unknown';
          const partIndex = this.detectPartNumber(filename) || 0;

          // Pick the highest speed available host: Pixeldrain > 1Fichier > DDownload
          for (const hostKey of ['pixeldrain', '1fichier', 'ddownload', 'gofile']) {
            if (data.hosts[hostKey] && data.hosts[hostKey].selected) {
              const directHostUrl = data.hosts[hostKey].link;
              if (directHostUrl) {
                mirrors.push({
                  partIndex,
                  rawUrl: url,
                  directUrl: directHostUrl,
                  filename,
                  extension: ext,
                  hostName: this.identifyHost(directHostUrl) || 'MultiUp Mirror',
                  sizeBytes,
                  sizeStr,
                  status: 'ready',
                  isPlayable: this.isPlayableExtension(ext)
                });
                break;
              }
            }
          }
          if (mirrors.length > 0) return mirrors;
        }
      }
    } catch (_) {}

    // Fallback: return as standard MultiUp link
    const filename = this.extractFilenameFromUrl(url);
    const ext = path.extname(filename).toLowerCase();
    return [{
      partIndex: this.detectPartNumber(filename) || 0,
      rawUrl: url,
      directUrl: url,
      filename,
      extension: ext,
      hostName: 'MultiUp',
      sizeBytes: 0,
      sizeStr: 'MultiUp Mirror',
      status: 'ready',
      isPlayable: false
    }];
  }

  /**
   * Group parts into distinct mirrors, selective DLC components, and standalone files
   */
  private assemblePackage(partsList: RepackPart[]): RepackPackage {
    const id = `repack_${Date.now()}`;
    const repackParts: RepackPart[] = [];
    const standaloneFiles: RepackPart[] = [];
    const selectiveDlcFiles: RepackPart[] = [];

    let totalSizeBytes = 0;
    let baseTitle = '';
    const hostsSet = new Set<string>();

    for (const part of partsList) {
      totalSizeBytes += part.sizeBytes;
      if (part.hostName) hostsSet.add(part.hostName);

      // Detect FitGirl / DODI selective/optional components (e.g. fg-selective-*, fg-optional-*)
      if (/fg[-_.]?(selective|optional)|setup[-_.]?optional/i.test(part.filename)) {
        selectiveDlcFiles.push(part);
        if (!baseTitle) baseTitle = this.extractBaseTitle(part.filename);
      } else if (part.partIndex > 0 || this.isMultiPartExtension(part.extension) || /part\d+|setup-\d+|data\d+/i.test(part.filename)) {
        repackParts.push(part);
        if (!baseTitle) baseTitle = this.extractBaseTitle(part.filename);
      } else {
        standaloneFiles.push(part);
        if (!baseTitle) baseTitle = this.extractBaseTitle(part.filename);
      }
    }

    // Sort repack parts numerically
    repackParts.sort((a, b) => a.partIndex - b.partIndex);

    // Group into Mirrors by hostName
    const mirrorsMap = new Map<string, RepackPart[]>();
    for (const part of repackParts) {
      const h = part.hostName || 'Direct';
      if (!mirrorsMap.has(h)) {
        mirrorsMap.set(h, []);
      }
      mirrorsMap.get(h)!.push(part);
    }

    const mirrors: RepackMirror[] = [];
    for (const [host, mParts] of mirrorsMap.entries()) {
      mParts.sort((a, b) => a.partIndex - b.partIndex);
      const maxPart = mParts.length > 0 ? Math.max(...mParts.map(p => p.partIndex)) : 0;
      const existing = new Set(mParts.map(p => p.partIndex));
      const mMissing: number[] = [];

      if (maxPart > mParts.length) {
        for (let i = 1; i <= maxPart; i++) {
          if (!existing.has(i)) mMissing.push(i);
        }
      }

      const mTotalBytes = mParts.reduce((acc, p) => acc + p.sizeBytes, 0);

      mirrors.push({
        hostName: host,
        parts: mParts,
        totalPartsExpected: maxPart || mParts.length,
        partsDiscoveredCount: mParts.length,
        missingParts: mMissing,
        isComplete: mMissing.length === 0,
        totalSizeBytes: mTotalBytes,
        totalSizeStr: this.formatBytes(mTotalBytes)
      });
    }

    // Overall package missing parts analysis
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
      selectiveDlcFiles,
      mirrors,
      selectedMirrorHost: mirrors[0]?.hostName,
      detectedHost,
      hasPlayableMedia
    };
  }

  /**
   * Detect numerical part index from filename: .part01.rar, setup-1.bin, fg-02.bin, etc.
   */
  public detectPartNumber(filename: string): number {
    const partMatch = filename.match(/[-_.]?part[-_.]?(\d+)/i);
    if (partMatch) return parseInt(partMatch[1], 10);

    const setupMatch = filename.match(/setup[-_.]?(\d+)/i);
    if (setupMatch) return parseInt(setupMatch[1], 10);

    const fgMatch = filename.match(/fg[-_.]?(\d+)/i);
    if (fgMatch) return parseInt(fgMatch[1], 10);

    const dataMatch = filename.match(/data[-_.]?(\d+)/i);
    if (dataMatch) return parseInt(dataMatch[1], 10);

    const splitMatch = filename.match(/\.(\d{2,4})$/);
    if (splitMatch) return parseInt(splitMatch[1], 10);

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

  private isKnownHoster(url: string): boolean {
    return KNOWN_FILE_HOSTERS.some(h => url.toLowerCase().includes(h));
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
