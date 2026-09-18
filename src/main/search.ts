// Multi-source search: one query, results split by intent so "animal" shows both the popular song and the videos.
//
// Songs come from YouTube Music (official audio tracks) via the existing service; videos come from a flat yt-dlp
// YouTube search. Both run in parallel and independently — if one source is slow or fails, the other still shows.
// Clicking a result reuses the normal inspect→download flow, which already defaults to audio for music.youtube.com
// and video for youtube.com, so each result downloads in the right form without extra wiring.

import type { SearchHit, SearchResults } from '../shared/types';
import { youtubeThumb } from '../core/url';
import { searchSongs } from './services/ytmusic';
import { tools } from './tools';
import { runTool } from './process';
import { logger } from './log';

const log = logger('search');
const SONG_LIMIT = 8;
const VIDEO_LIMIT = 10;

async function songHits(query: string): Promise<SearchHit[]> {
  const songs = await searchSongs(query);
  return songs.slice(0, SONG_LIMIT).map((s) => ({
    source: 'ytmusic',
    kind: 'audio',
    url: `https://music.youtube.com/watch?v=${s.videoId}`,
    title: s.title,
    subtitle: [s.artists, s.album].filter(Boolean).join(' · '),
    durationSec: s.durationSec,
    thumbnail: youtubeThumb(s.videoId),
  }));
}

interface FlatEntry {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number | null;
}

async function videoHits(query: string, exclude: Set<string>): Promise<SearchHit[]> {
  const r = await runTool(
    tools.require('yt-dlp'),
    ['--flat-playlist', '--dump-single-json', '--no-warnings', '--ignore-config', `ytsearch${VIDEO_LIMIT}:${query}`],
    { env: tools.env(), timeoutMs: 25_000 },
  );
  if (r.code !== 0 || !r.stdout.trim()) return [];
  const entries = (JSON.parse(r.stdout) as { entries?: FlatEntry[] }).entries ?? [];
  const hits: SearchHit[] = [];
  const seen = new Set(exclude);
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
    });
  }
  return hits;
}

const idOf = (url: string): string => url.split('v=')[1] ?? '';

/** Run the song and video searches in parallel; a failure in one source doesn't sink the other. */
export async function searchMulti(query: string): Promise<SearchResults> {
  const q = query.trim().slice(0, 200);
  const [songsResult, videosResult] = await Promise.allSettled([songHits(q), videoHits(q, new Set())]);

  const songs = songsResult.status === 'fulfilled' ? songsResult.value : [];
  if (songsResult.status === 'rejected') log.debug('song search failed', songsResult.reason);
  const rawVideos = videosResult.status === 'fulfilled' ? videosResult.value : [];
  if (videosResult.status === 'rejected') log.debug('video search failed', videosResult.reason);

  // Don't repeat a track that already appears under Songs.
  const songIds = new Set(songs.map((s) => idOf(s.url)));
  const videos = rawVideos.filter((v) => !songIds.has(idOf(v.url)));

  return { query: q, songs, videos };
}
