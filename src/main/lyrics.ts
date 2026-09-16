/**
 * ============================================================
 *  LUMINA LYRICS ENGINE
 *  Fetches beautifully synchronized (.lrc) and plain lyrics
 *  from LRCLIB with smart title/artist sanitization & fallback.
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
    if (title.includes(' - ') && (!artist || artist === 'Lumina' || artist.toLowerCase().includes('topic') || artist.toLowerCase().includes('records'))) {
      const parts = title.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    } else if (title.includes(' – ')) {
      const parts = title.split(' – ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' – ').trim();
    }

    // Strip common YouTube/music video clutter
    title = title
      .replace(/\s*\([^)]*(?:official|video|music video|audio|lyrics|lyric video|visualizer|remaster|live|performance|version|hq|hd|4k)[^)]*\)/gi, '')
      .replace(/\s*\[[^\]]*(?:official|video|music video|audio|lyrics|lyric video|visualizer|remaster|live|performance|version|hq|hd|4k)[^\]]*\]/gi, '')
      .replace(/\s*\(feat\.[^)]*\)/gi, '')
      .replace(/\s*\[feat\.[^\]]*\]/gi, '')
      .replace(/\s*feat\.\s+[^,\s-]+/gi, '')
      .replace(/\s*ft\.\s+[^,\s-]+/gi, '')
      .replace(/\s*\(prod\.[^)]*\)/gi, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    artist = artist
      .replace(/ - Topic$/i, '')
      .replace(/VEVO$/i, '')
      .replace(/\s*(?:&|,|\bx\b)\s*.*$/i, '') // Keep primary artist
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();

    return { title, artist };
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
   * Fetches lyrics for a track with multi-strategy fallback.
   */
  public async getLyrics(params: { title: string; artist?: string; duration?: number }): Promise<LyricsData | null> {
    const { title: rawTitle, artist: rawArtist, duration } = params;
    if (!rawTitle || typeof rawTitle !== 'string') return null;

    const { title: cleanTitle, artist: cleanArtist } = this.cleanMetadata(rawTitle, rawArtist);
    const cacheKey = `${cleanArtist.toLowerCase()}__${cleanTitle.toLowerCase()}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || null;
    }

    let result = await this.fetchFromLrclib(cleanTitle, cleanArtist, duration);

    // If no match with primary artist, try search query with both or just title
    if (!result && cleanTitle) {
      result = await this.searchLrclib(`${cleanArtist} ${cleanTitle}`.trim());
    }

    if (!result && cleanTitle) {
      result = await this.searchLrclib(cleanTitle);
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
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'LuminaMedia/1.3.2 (https://github.com/nikhlgoel/lumina)'
        }
      });

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
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'LuminaMedia/1.3.2 (https://github.com/nikhlgoel/lumina)'
        }
      });

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
