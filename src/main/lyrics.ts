/**
 * ============================================================
 *  LUMINA MULTI-SOURCE LYRICS ENGINE
 *  Robust lyrics aggregator combining:
 *   1. LRCLIB (Primary - Synced LRC timestamps & plain text)
 *   2. Lyrics.ovh (Fallback - Extensive plain lyrics catalog)
 *   3. Relaxed token & fuzzy matching for rare/obscure titles
 *   4. Subtitle/VTT parser for video captions
 *  Includes privacy headers & smart metadata sanitization.
 * ============================================================
 */

export interface LyricLine {
  time: number; // in seconds (e.g. 12.45), or -1 for unsynced
  text: string;
}

export interface LyricsData {
  trackName: string;
  artistName: string;
  plainLyrics?: string;
  syncedLyrics?: string;
  lines: LyricLine[];
  isSynced: boolean;
  source: string;
}

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ANONYMOUS_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'DNT': '1',
  'Sec-GPC': '1'
};

export class LyricsManager {
  private cache: Map<string, LyricsData | null> = new Map();

  /**
   * Sanitizes track titles and artist names by removing noisy tags
   * like (Official Video), (Lyrics), (Remastered), feat., etc.
   */
  public cleanMetadata(rawTitle: string, rawArtist?: string): { title: string; artist: string } {
    let title = (rawTitle || '').trim();
    let artist = (rawArtist || '').trim();

    // If title contains " - ", try splitting if artist is empty or looks like a generic channel
    if (title.includes(' - ') && (!artist || artist === 'Lumina' || artist.toLowerCase().includes('topic') || artist.toLowerCase().includes('records') || artist.toLowerCase().includes('vevo'))) {
      const parts = title.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    } else if (title.includes(' – ')) {
      const parts = title.split(' – ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' – ').trim();
    } else if (title.includes(' : ')) {
      const parts = title.split(' : ');
      if (!artist || artist === 'Lumina') {
        artist = parts[0].trim();
        title = parts.slice(1).join(' : ').trim();
      }
    }

    // Strip quotes around title
    title = title.replace(/^["'“‘](.*)["'”’]$/, '$1').trim();

    // Strip common YouTube/music video clutter
    title = title
      .replace(/\s*\([^)]*(?:official|video|music video|audio|lyrics|lyric video|visualizer|remaster|live|performance|version|hq|hd|4k|4k video|clip)[^)]*\)/gi, '')
      .replace(/\s*\[[^\]]*(?:official|video|music video|audio|lyrics|lyric video|visualizer|remaster|live|performance|version|hq|hd|4k|4k video|clip)[^\]]*\]/gi, '')
      .replace(/\s*\(feat\.[^)]*\)/gi, '')
      .replace(/\s*\[feat\.[^\]]*\]/gi, '')
      .replace(/\s*feat\.\s+[^,\s-]+/gi, '')
      .replace(/\s*ft\.\s+[^,\s-]+/gi, '')
      .replace(/\s*\(prod\.[^)]*\)/gi, '')
      .replace(/\s*\(from\s+[^)]+\)/gi, '')
      .replace(/\s*\[from\s+[^\]]+\]/gi, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    artist = artist
      .replace(/ - Topic$/i, '')
      .replace(/VEVO$/i, '')
      .replace(/\s*(?:&|,|\bx\b)\s*.*$/i, '') // Keep primary artist for search
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();

    return { title, artist };
  }

  /**
   * Generates a further relaxed, minimal title by stripping secondary descriptors
   * like "(Acoustic)", " - Acoustic", etc.
   */
  public relaxTitle(title: string): string {
    return title
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s*\[[^\]]*\]/g, '')
      .replace(/\s*[-–—].*$/, '')
      .replace(/[^\w\s\u00C0-\u024F\u4e00-\u9fa5]/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Parses standard LRC timestamped lyrics into an array of LyricLines.
   */
  public parseLrc(lrcText: string): LyricLine[] {
    if (!lrcText || typeof lrcText !== 'string') return [];

    const lines: LyricLine[] = [];
    const rawLines = lrcText.split(/\r?\n/);

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Matches [mm:ss.xx] or [mm:ss.xxx] or [mm:ss]
      const match = trimmed.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        let ms = 0;
        if (match[3]) {
          const rawMs = match[3];
          ms = parseInt(rawMs.padEnd(3, '0').slice(0, 3), 10);
        }
        const time = minutes * 60 + seconds + ms / 1000;
        const text = match[4].trim();

        // Skip metadata tags like [al:Album] or [ti:Title]
        if (text || lines.length > 0) {
          lines.push({ time, text });
        }
      }
    }

    // Sort by timestamp
    return lines.sort((a, b) => a.time - b.time);
  }

  /**
   * Parses plain unsynced lyrics into lines with time = -1.
   */
  public parsePlain(plainText: string): LyricLine[] {
    if (!plainText || typeof plainText !== 'string') return [];
    return plainText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(text => ({ time: -1, text }));
  }

  /**
   * Parses WebVTT or SRT subtitle captions into synchronized LyricLines.
   */
  public parseVttOrSrt(captionText: string): LyricLine[] {
    if (!captionText || typeof captionText !== 'string') return [];
    const lines: LyricLine[] = [];
    
    // Normalize line endings
    const blocks = captionText.replace(/\r\n/g, '\n').split(/\n\s*\n/);
    
    for (const block of blocks) {
      const bLines = block.trim().split('\n');
      for (let i = 0; i < bLines.length; i++) {
        const timeMatch = bLines[i].match(/(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1] || '0', 10);
          const mins = parseInt(timeMatch[2], 10);
          const secs = parseInt(timeMatch[3], 10);
          const ms = parseInt(timeMatch[4], 10);
          const time = hours * 3600 + mins * 60 + secs + ms / 1000;
          
          const text = bLines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
          if (text) {
            lines.push({ time, text });
          }
          break;
        }
      }
    }
    
    return lines.sort((a, b) => a.time - b.time);
  }

  /**
   * Fetches lyrics for a track with multi-source fallback:
   * 1. LRCLIB exact match
   * 2. LRCLIB query search (Artist + Title)
   * 3. LRCLIB query search (Title only)
   * 4. Lyrics.ovh API (Artist + Title)
   * 5. LRCLIB relaxed title search
   * 6. Lyrics.ovh API (Artist + Relaxed Title)
   */
  public async getLyrics(params: { title: string; artist?: string; duration?: number }): Promise<LyricsData | null> {
    const { title: rawTitle, artist: rawArtist, duration } = params;
    if (!rawTitle || typeof rawTitle !== 'string') return null;

    const { title: cleanTitle, artist: cleanArtist } = this.cleanMetadata(rawTitle, rawArtist);
    const cacheKey = `${cleanArtist.toLowerCase()}__${cleanTitle.toLowerCase()}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || null;
    }

    // --- Strategy 1: LRCLIB exact lookup ---
    let result = await this.fetchFromLrclib(cleanTitle, cleanArtist, duration);

    // --- Strategy 2: LRCLIB search query with artist + title ---
    if (!result && cleanTitle) {
      result = await this.searchLrclib(`${cleanArtist} ${cleanTitle}`.trim());
    }

    // --- Strategy 3: LRCLIB search query with title only ---
    if (!result && cleanTitle) {
      result = await this.searchLrclib(cleanTitle);
    }

    // --- Strategy 4: Lyrics.ovh catalog lookup (Plain Lyrics) ---
    if (!result && cleanArtist && cleanTitle) {
      result = await this.fetchFromLyricsOvh(cleanArtist, cleanTitle);
    }

    // --- Strategy 5: Relaxed title matching (strips subtitle brackets, live tags) ---
    const relaxedTitle = this.relaxTitle(cleanTitle);
    if (!result && relaxedTitle && relaxedTitle !== cleanTitle) {
      result = await this.searchLrclib(`${cleanArtist} ${relaxedTitle}`.trim());
      if (!result && cleanArtist) {
        result = await this.fetchFromLyricsOvh(cleanArtist, relaxedTitle);
      }
      if (!result) {
        result = await this.searchLrclib(relaxedTitle);
      }
    }

    // --- Strategy 6: Inverted artist / title fallback (e.g. if "Title - Artist" was reversed) ---
    if (!result && cleanArtist && cleanTitle) {
      result = await this.fetchFromLyricsOvh(cleanTitle, cleanArtist);
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  private async fetchFromLrclib(title: string, artist?: string, duration?: number): Promise<LyricsData | null> {
    try {
      const params = new URLSearchParams();
      params.append('track_name', title);
      if (artist) params.append('artist_name', artist);
      if (duration && duration > 0) params.append('duration', Math.round(duration).toString());

      const url = `https://lrclib.net/api/get?${params.toString()}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers: ANONYMOUS_HEADERS,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      const data: any = await res.json();
      return this.formatLrclibResponse(data, title, artist);
    } catch {
      return null;
    }
  }

  private async searchLrclib(query: string): Promise<LyricsData | null> {
    try {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers: ANONYMOUS_HEADERS,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      const results: any[] = await res.json();
      if (!Array.isArray(results) || results.length === 0) return null;

      // Prefer results with syncedLyrics
      const best = results.find(r => r.syncedLyrics && r.syncedLyrics.trim().length > 0) || results[0];
      return this.formatLrclibResponse(best, best.trackName, best.artistName);
    } catch {
      return null;
    }
  }

  /**
   * Fetches plain lyrics from Lyrics.ovh API as secondary provider
   */
  private async fetchFromLyricsOvh(artist: string, title: string): Promise<LyricsData | null> {
    try {
      const cleanA = artist.replace(/[/\\?%*:|"<>]/g, '').trim();
      const cleanT = title.replace(/[/\\?%*:|"<>]/g, '').trim();
      if (!cleanA || !cleanT) return null;

      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanA)}/${encodeURIComponent(cleanT)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers: ANONYMOUS_HEADERS,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      const data: any = await res.json();
      if (!data || !data.lyrics || typeof data.lyrics !== 'string') return null;

      const cleanLyrics = data.lyrics.trim();
      if (!cleanLyrics) return null;

      const lines = this.parsePlain(cleanLyrics);
      if (lines.length === 0) return null;

      return {
        trackName: title,
        artistName: artist,
        plainLyrics: cleanLyrics,
        lines,
        isSynced: false,
        source: 'lyrics.ovh'
      };
    } catch {
      return null;
    }
  }

  private formatLrclibResponse(data: any, fallbackTitle: string, fallbackArtist?: string): LyricsData | null {
    if (!data) return null;

    if (data.instrumental) {
      return {
        trackName: data.trackName || fallbackTitle,
        artistName: data.artistName || fallbackArtist || '',
        plainLyrics: '♪ Instrumental ♪',
        syncedLyrics: '[00:00.00] ♪ Instrumental ♪',
        lines: [{ time: 0, text: '♪ Instrumental ♪' }],
        isSynced: true,
        source: 'lrclib'
      };
    }

    if (data.syncedLyrics && data.syncedLyrics.trim().length > 0) {
      const lines = this.parseLrc(data.syncedLyrics);
      if (lines.length > 0) {
        return {
          trackName: data.trackName || fallbackTitle,
          artistName: data.artistName || fallbackArtist || '',
          plainLyrics: data.plainLyrics,
          syncedLyrics: data.syncedLyrics,
          lines,
          isSynced: true,
          source: 'lrclib'
        };
      }
    }

    if (data.plainLyrics && data.plainLyrics.trim().length > 0) {
      const lines = this.parsePlain(data.plainLyrics);
      if (lines.length > 0) {
        return {
          trackName: data.trackName || fallbackTitle,
          artistName: data.artistName || fallbackArtist || '',
          plainLyrics: data.plainLyrics,
          lines,
          isSynced: false,
          source: 'lrclib'
        };
      }
    }

    return null;
  }
}

export const lyricsManager = new LyricsManager();
