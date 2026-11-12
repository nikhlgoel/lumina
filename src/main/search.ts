// Multi-source search: one query, results split by intent so "animal" shows both the popular song and the videos.
//
// Songs come from YouTube Music (official audio tracks); videos come from YouTube's own search. The two are separate, independent lookups, so the
// screen shows whichever arrives first instead of waiting for both (the old single call waited for yt-dlp, about 4 s, to show songs that were ready
// in under one). Clicking a result reuses the normal inspect->download flow, which already defaults to audio for music.youtube.com and video for
// youtube.com, so each result downloads in the right form without extra wiring.
//
// Speed: a video search asks YouTube's website endpoint directly (about 1 s for 20 results, with views and upload age) and falls back to yt-dlp
// (about 4 s) if that answers with nothing usable. Answers are remembered for ten minutes, and two screens asking the same thing at once share one
// request.

import type { SearchHit, SearchPart, SearchResults } from '../shared/types';
import { parseMusicCollections, parseVideoSearch, compactViews, searchKey, TtlCache, withoutDuplicates } from '../core/searchResults';
import { youtubeThumb } from '../core/url';
import { MUSIC_FILTERS, searchMusicRaw, searchSongs } from './services/ytmusic';
import { tools } from './tools';
import { runTool } from './process';
import { logger } from './log';

const log = logger('search');

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 40;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
/** "Videos" only: no channels, playlists or shelves. */
const VIDEOS_FILTER = 'EgIQAQ%3D%3D';

const cache = new TtlCache<SearchPart>(60, 10 * 60_000);
const inFlight = new Map<string, Promise<SearchPart>>();

const clampLimit = (n: number | undefined): number => Math.max(1, Math.min(MAX_LIMIT, Math.floor(n ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
const cleanQuery = (q: string): string => q.trim().slice(0, 200);

/** Answer from the memory, or ask once (however many ask together), and remember a good answer; a failed one is never remembered. */
async function remembered(key: string, ask: () => Promise<SearchPart>): Promise<SearchPart> {
  const known = cache.get(key);
  if (known) return known;
  const running = inFlight.get(key);
  if (running) return running;
  const promise = ask().then((part) => {
    if (!part.failed) cache.set(key, part);
    return part;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function songHits(query: string, limit: number): Promise<SearchPart> {
  try {
    const songs = await searchSongs(query);
    const hits: SearchHit[] = songs.slice(0, limit).map((s) => ({
      source: 'ytmusic',
      kind: 'audio',
      url: `https://music.youtube.com/watch?v=${s.videoId}`,
      title: s.title,
      subtitle: s.artists,
      album: s.album,
      durationSec: s.durationSec,
      thumbnail: s.thumbnail ?? youtubeThumb(s.videoId),
    }));
    return { hits, failed: false, more: songs.length > limit };
  } catch (err) {
    log.debug('song search failed', err);
    return { hits: [], failed: true, more: false };
  }
}

/** YouTube's website endpoint: the quickest way to a list of videos with their views and age. Throws when the answer has no videos. */
async function fastVideos(query: string, limit: number): Promise<SearchHit[]> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://www.youtube.com', 'User-Agent': UA },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20260901.00.00', hl: 'en', gl: 'US' } }, query, params: VIDEOS_FILTER }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`YouTube search answered ${res.status}`);
  const hits = parseVideoSearch(await res.json(), limit);
  if (!hits.length) throw new Error('YouTube search had no videos in its answer');
  return hits;
}

interface FlatEntry {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number | null;
  view_count?: number | null;
  channel_is_verified?: boolean | null;
}

/** The slower road, through yt-dlp: used when the quick one fails, and for more results than one page of the quick one holds. */
async function ytdlpVideos(query: string, limit: number): Promise<SearchHit[]> {
  const r = await runTool(
    tools.require('yt-dlp'),
    ['--flat-playlist', '--dump-single-json', '--no-warnings', '--ignore-config', `ytsearch${limit}:${query}`],
    { env: tools.env(), timeoutMs: 25_000 },
  );
  if (r.code !== 0 || !r.stdout.trim()) throw new Error('yt-dlp found no videos');
  const entries = (JSON.parse(r.stdout) as { entries?: FlatEntry[] }).entries ?? [];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.id || !e.title || seen.has(e.id)) continue;
    seen.add(e.id);
    hits.push({
      source: 'youtube',
      kind: 'video',
      url: `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title,
      subtitle: e.uploader ?? e.channel ?? '',
      durationSec: typeof e.duration === 'number' ? e.duration : null,
      thumbnail: youtubeThumb(e.id),
      views: compactViews(e.view_count),
      verified: Boolean(e.channel_is_verified),
    });
  }
  return hits;
}

async function videoHits(query: string, limit: number): Promise<SearchPart> {
  // One page of the quick road holds about twenty; asking for more goes the slower way, which can be asked for any number.
  if (limit <= 20 && !process.env.LUMINA_SEARCH_NO_FAST) {
    try {
      const hits = await fastVideos(query, limit);
      return { hits, failed: false, more: hits.length >= limit };
    } catch (err) {
      log.debug('quick video search failed, trying yt-dlp', err);
    }
  }
  try {
    const hits = await ytdlpVideos(query, limit);
    return { hits, failed: false, more: hits.length >= limit && limit < MAX_LIMIT };
  } catch (err) {
    log.debug('video search failed', err);
    return { hits: [], failed: true, more: false };
  }
}

/** Albums (YouTube Music): the page of twenty it answers with, cut to `limit`. */
async function albumHits(query: string, limit: number): Promise<SearchPart> {
  try {
    const hits = parseMusicCollections(await searchMusicRaw(query, MUSIC_FILTERS.albums), 'album', limit);
    return { hits, failed: false, more: false };
  } catch (err) {
    log.debug('album search failed', err);
    return { hits: [], failed: true, more: false };
  }
}

/** Playlists: YouTube Music's own curated ones first, then the ones people made. Fails only when neither can be reached. */
async function playlistHits(query: string, limit: number): Promise<SearchPart> {
  const [featured, community] = await Promise.allSettled([searchMusicRaw(query, MUSIC_FILTERS.featured), searchMusicRaw(query, MUSIC_FILTERS.community)]);
  if (featured.status === 'rejected' && community.status === 'rejected') {
    log.debug('playlist search failed', featured.reason);
    return { hits: [], failed: true, more: false };
  }
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const answer of [featured, community]) {
    if (answer.status !== 'fulfilled') continue;
    for (const hit of parseMusicCollections(answer.value, 'playlist', limit)) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      hits.push(hit);
    }
  }
  return { hits: hits.slice(0, limit), failed: false, more: false };
}

/** Songs for a query (YouTube Music). `limit` is how many to return, at most 40. */
export function searchSongsPart(query: string, limit?: number): Promise<SearchPart> {
  const q = cleanQuery(query);
  const n = clampLimit(limit);
  if (!q) return Promise.resolve({ hits: [], failed: false, more: false });
  return remembered(searchKey('songs', q, n), () => songHits(q, n));
}

/** Videos for a query (YouTube). `limit` is how many to return, at most 40. */
export function searchVideosPart(query: string, limit?: number): Promise<SearchPart> {
  const q = cleanQuery(query);
  const n = clampLimit(limit);
  if (!q) return Promise.resolve({ hits: [], failed: false, more: false });
  return remembered(searchKey('videos', q, n), () => videoHits(q, n));
}

/** Albums for a query (YouTube Music). */
export function searchAlbumsPart(query: string, limit?: number): Promise<SearchPart> {
  const q = cleanQuery(query);
  const n = clampLimit(limit);
  if (!q) return Promise.resolve({ hits: [], failed: false, more: false });
  return remembered(searchKey('albums', q, n), () => albumHits(q, n));
}

/** Playlists for a query (YouTube Music's own, then people's). */
export function searchPlaylistsPart(query: string, limit?: number): Promise<SearchPart> {
  const q = cleanQuery(query);
  const n = clampLimit(limit);
  if (!q) return Promise.resolve({ hits: [], failed: false, more: false });
  return remembered(searchKey('playlists', q, n), () => playlistHits(q, n));
}

/** Both at once, for callers that want everything together; a failure in one source doesn't sink the other. */
export async function searchMulti(query: string): Promise<SearchResults> {
  const q = cleanQuery(query);
  const [songs, videos] = await Promise.all([searchSongsPart(q), searchVideosPart(q)]);
  return { query: q, songs: songs.hits, videos: withoutDuplicates(songs.hits, videos.hits) };
}

/** Test hook: forget everything remembered. */
export function clearSearchMemory(): void {
  inFlight.clear();
  cache.clear();
}
