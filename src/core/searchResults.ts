// The logic behind search results, kept free of the network and the screen so it can be tested: reading YouTube's search answer, wording view
// counts, remembering recent answers, and deciding how many rows to show.

import type { PlayableItem, PlaylistEntry, SearchHit } from '../shared/types';

/** 12,345 → "12K", 5,808,378 → "5.8M"; rounds up into the next unit rather than printing "1000K". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1_000) return String(Math.floor(n));
  const units = [{ u: 'K', size: 1e3 }, { u: 'M', size: 1e6 }, { u: 'B', size: 1e9 }];
  const round = (v: number) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v));
  let i = units.reduce((at, unit, k) => (n >= unit.size ? k : at), 0);
  let shown = round(n / units[i]!.size);
  if (shown >= 1_000 && i < units.length - 1) {
    i += 1;
    shown = round(n / units[i]!.size);
  }
  return `${shown}${units[i]!.u}`;
}

/**
 * The view count in the words a person wants on a card. Takes the number (from yt-dlp) or the source's own text ("5,808,378 views",
 * "1,204 watching", "No views"). Null when it says nothing usable.
 */
export function compactViews(raw: string | number | null | undefined): string | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? `${formatCount(raw)} ${raw === 1 ? 'view' : 'views'}` : null;
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (/^no views?$/i.test(text)) return 'No views';
  const m = /([\d,.]+)\s*([KMB])?/i.exec(text);
  if (!m) return null;
  const base = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  const n = base * scale;
  const unit = /watching/i.test(text) ? 'watching' : n === 1 ? 'view' : 'views';
  return `${formatCount(n)} ${unit}`;
}

/** "1:02:03" → 3723; null when it is not a time. */
export function clockToSeconds(text: string | undefined | null): number | null {
  if (!text || !/^\d{1,3}(:\d{2}){1,2}$/.test(text.trim())) return null;
  return text.trim().split(':').reduce((s, part) => s * 60 + Number(part), 0);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => {
  const o = obj(v);
  if (!o) return '';
  if (typeof o.simpleText === 'string') return o.simpleText;
  return arr(o.runs).map((r) => (typeof obj(r)?.text === 'string' ? (obj(r)!.text as string) : '')).join('');
};

/**
 * The videos in YouTube's own search answer (the JSON its website asks for). Anything that is not a video (ads, shelves, channels, playlists)
 * is left out; a missing field leaves that detail out rather than the whole result. Never throws: an answer of another shape gives [].
 */
export function parseVideoSearch(data: unknown, limit = 50): SearchHit[] {
  const sections = arr(obj(obj(obj(obj(obj(data)?.contents)?.twoColumnSearchResultsRenderer)?.primaryContents)?.sectionListRenderer)?.contents);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const item of arr(obj(obj(section)?.itemSectionRenderer)?.contents)) {
      const v = obj(obj(item)?.videoRenderer);
      const id = typeof v?.videoId === 'string' ? v.videoId : '';
      if (!v || !/^[\w-]{11}$/.test(id) || seen.has(id)) continue;
      const title = text(v.title).trim();
      if (!title) continue;
      seen.add(id);
      const thumbs = arr(obj(v.thumbnail)?.thumbnails).map(obj).filter((t): t is Json => Boolean(t && typeof t.url === 'string'));
      const best = thumbs.sort((a, b) => Number(a.width ?? 0) - Number(b.width ?? 0)).at(-1);
      const badges = arr(v.ownerBadges).map((b) => String(obj(obj(b)?.metadataBadgeRenderer)?.style ?? ''));
      hits.push({
        source: 'youtube',
        kind: 'video',
        url: `https://www.youtube.com/watch?v=${id}`,
        title,
        subtitle: (text(v.ownerText) || text(v.longBylineText)).trim(),
        durationSec: clockToSeconds(text(v.lengthText)),
        thumbnail: (best?.url as string | undefined) ?? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        views: compactViews(text(v.viewCountText)),
        published: text(v.publishedTimeText).trim() || null,
        verified: badges.some((s) => /VERIFIED/i.test(s)),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** Drop from `videos` the ones that already appear as songs (the same video id), so one track is not listed twice. */
export function withoutDuplicates(songs: readonly SearchHit[], videos: readonly SearchHit[]): SearchHit[] {
  const id = (url: string) => /[?&]v=([\w-]{11})/.exec(url)?.[1] ?? url;
  const taken = new Set(songs.map((s) => id(s.url)));
  return videos.filter((v) => !taken.has(id(v.url)));
}

/** A small memory of recent answers: each lives for `ttlMs`, and the oldest-used is forgotten past `max` entries. */
export class TtlCache<T> {
  private entries = new Map<string, { at: number; value: T }>();

  constructor(private readonly max: number, private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get(key: string): T | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Used now: move it to the back of the line for forgetting.
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** The same search typed with different capitals or spacing is one search. */
export const searchKey = (kind: string, query: string, limit: number): string => `${kind}|${query.trim().replace(/\s+/g, ' ').toLowerCase()}|${limit}`;

/** How many rows a section shows: its first few until the person expands it. */
export function visibleHits<T>(hits: readonly T[], expanded: boolean, initial: number): { shown: T[]; hidden: number } {
  const shown = expanded ? [...hits] : hits.slice(0, Math.max(1, initial));
  return { shown, hidden: hits.length - shown.length };
}

/** Google's picture addresses end in the size they are served at (`=w60-h60-l90-rj`): ask for a bigger one. */
export function biggerArt(url: string | undefined | null, size = 400): string | null {
  if (!url) return null;
  return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^?\s]*$/, `=w${size}-h${size}-l90-rj`) : url;
}

const countFrom = (text: string): number | null => {
  const m = /(\d[\d,]*)\s+songs?/i.exec(text);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
};

/**
 * The albums or playlists in a YouTube Music search answer. An album's address is its playlist (the "OLAK5uy..." id behind its play button), which is what
 * a download or a play needs; a playlist's is its own id (the browse id without its "VL"). Anything without such an id is left out. Never throws.
 */
export function parseMusicCollections(data: unknown, kind: 'album' | 'playlist', limit = 50): SearchHit[] {
  const sections = arr(obj(obj(obj(obj(arr(obj(obj(obj(data)?.contents)?.tabbedSearchResultsRenderer)?.tabs)[0])?.tabRenderer)?.content)?.sectionListRenderer)?.contents);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const item of arr(obj(obj(section)?.musicShelfRenderer)?.contents)) {
      const r = obj(obj(item)?.musicResponsiveListItemRenderer);
      if (!r) continue;
      const cols = arr(r.flexColumns).map((c) => text(obj(obj(c)?.musicResponsiveListItemFlexColumnRenderer)?.text).trim());
      const title = cols[0];
      if (!title) continue;
      const watch = obj(obj(obj(obj(obj(r.overlay)?.musicItemThumbnailOverlayRenderer)?.content)?.musicPlayButtonRenderer)?.playNavigationEndpoint);
      const watchId = obj(watch?.watchPlaylistEndpoint)?.playlistId;
      const browse = obj(obj(r.navigationEndpoint)?.browseEndpoint)?.browseId;
      const id = typeof watchId === 'string' && watchId ? watchId : typeof browse === 'string' ? browse.replace(/^VL/, '') : '';
      if (!/^[\w-]{10,}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      const parts = (cols[1] ?? '').split(' • ').map((p) => p.trim()).filter(Boolean);
      const thumbs = arr(obj(obj(obj(r.thumbnail)?.musicThumbnailRenderer)?.thumbnail)?.thumbnails).map(obj).filter((t): t is Json => Boolean(t && typeof t.url === 'string'));
      const best = thumbs.sort((a, b) => Number(a.width ?? 0) - Number(b.width ?? 0)).at(-1);
      const year = kind === 'album' ? parts.find((p) => /^\d{4}$/.test(p)) ?? null : null;
      const subtitle = kind === 'album'
        ? parts.slice(1).filter((p) => p !== year).join(', ')
        : parts.filter((p) => !/\bviews?\b/i.test(p) && !countFrom(p)).join(' · ');
      hits.push({
        source: 'ytmusic',
        kind,
        url: `https://music.youtube.com/playlist?list=${id}`,
        title,
        subtitle,
        durationSec: null,
        thumbnail: biggerArt(best?.url as string | undefined, 544),
        year,
        albumType: kind === 'album' ? parts[0] ?? null : null,
        trackCount: countFrom(cols[1] ?? ''),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/**
 * The tracks of an album or playlist as a play queue: each is only listed (title, artist, length, picture, and the link to work its stream out from); the player
 * works a stream out when it is that track's turn. Entries without a link are left out.
 */
export function queueFromEntries(entries: readonly PlaylistEntry[], album: string | null): PlayableItem[] {
  return entries
    .filter((e) => e.url)
    .map((e, i) => ({
      id: `listed:${e.id || i}:${i}`,
      kind: 'audio' as const,
      title: e.title,
      artist: e.uploader || null,
      album,
      durationSec: e.durationSec,
      src: '',
      artworkUrl: e.thumbnail,
      path: null,
      lazyUrl: e.url,
    }));
}
