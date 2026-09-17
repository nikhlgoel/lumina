import { wordSimilarity } from '../../core/lyrics';
import { logger } from '../log';

const log = logger('ytmusic');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
// "Songs" filter: official audio tracks rather than music videos with intros.
const SONGS_FILTER = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';

export interface TrackQuery {
  title: string;
  artist: string;
  album?: string;
  durationSec: number | null;
}

export interface SongResult {
  videoId: string;
  title: string;
  artists: string;
  album: string | null;
  durationSec: number | null;
}

interface Run { text?: string }
interface FlexColumn { musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: Run[] } } }
interface ListItem { musicResponsiveListItemRenderer?: { playlistItemData?: { videoId?: string }; flexColumns?: FlexColumn[] } }

const toSeconds = (t: string) => t.split(':').reduce((s, part) => s * 60 + Number(part), 0);

export async function searchSongs(query: string): Promise<SongResult[]> {
  const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', 'User-Agent': UA },
    body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20260901.01.00', hl: 'en', gl: 'US' } }, query, params: SONGS_FILTER }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`YouTube Music search failed (${res.status})`);
  const data = await res.json() as {
    contents?: { tabbedSearchResultsRenderer?: { tabs?: { tabRenderer?: { content?: { sectionListRenderer?: { contents?: { musicShelfRenderer?: { contents?: ListItem[] } }[] } } } }[] } };
  };
  const shelves = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const results: SongResult[] = [];
  for (const shelf of shelves) {
    for (const item of shelf.musicShelfRenderer?.contents ?? []) {
      const r = item.musicResponsiveListItemRenderer;
      const videoId = r?.playlistItemData?.videoId;
      const cols = (r?.flexColumns ?? []).map((c) => (c.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []).map((x) => x.text ?? '').join(''));
      if (!videoId || !cols[0]) continue;
      const parts = (cols[1] ?? '').split(' • ').map((p) => p.trim());
      const duration = parts.find((p) => /^\d{1,2}(:\d{2}){1,2}$/.test(p));
      results.push({
        videoId,
        title: cols[0],
        artists: parts[0] ?? '',
        album: parts.length >= 3 ? parts[1] ?? null : null,
        durationSec: duration ? toSeconds(duration) : null,
      });
    }
  }
  return results;
}

/** Score how well a search result matches a track; null means it's a different song. */
export function scoreSong(r: SongResult, q: TrackQuery): number | null {
  const title = wordSimilarity(r.title, q.title);
  const artist = q.artist ? wordSimilarity(r.artists, q.artist) : 1;
  const diff = q.durationSec && r.durationSec ? Math.abs(r.durationSec - q.durationSec) : null;
  if (diff !== null && diff > 10) return null;
  if (title < 0.5 || artist < 0.34) return null;
  const variantPenalty = /\b(live|remix|cover|karaoke|instrumental|sped up|slowed|nightcore|8d)\b/i.test(r.title) && !/\b(live|remix|cover|karaoke|instrumental|sped up|slowed|nightcore|8d)\b/i.test(q.title) ? 1.5 : 0;
  const albumBonus = q.album && r.album ? wordSimilarity(r.album, q.album) : 0;
  return title * 3 + artist * 2 + albumBonus + (diff === null ? 0 : diff <= 2 ? 2 : diff <= 5 ? 1 : 0) - variantPenalty;
}

export async function matchTrack(q: TrackQuery): Promise<string | null> {
  const queries = [`${q.artist} ${q.title}`, q.title].filter((s, i, a) => s.trim() && a.indexOf(s) === i);
  for (const query of queries) {
    try {
      const best = (await searchSongs(query))
        .map((r) => ({ r, score: scoreSong(r, q) }))
        .filter((x): x is { r: SongResult; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score)[0];
      if (best) return `https://music.youtube.com/watch?v=${best.r.videoId}`;
    } catch (err) {
      log.debug(`Search failed for "${query}"`, err);
    }
  }
  return null;
}

/** Match many tracks with limited parallelism. Unmatched tracks fall back to a plain YouTube search. */
export async function matchTracks(tracks: TrackQuery[], onProgress: (done: number) => void, stopped: () => boolean): Promise<{ urls: string[]; unmatched: number }> {
  const urls = new Array<string>(tracks.length);
  let unmatched = 0;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < tracks.length && !stopped()) {
      const i = next++;
      const t = tracks[i]!;
      const url = await matchTrack(t);
      if (!url) unmatched++;
      urls[i] = url ?? `ytsearch1:${t.artist} - ${t.title} official audio`;
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { urls, unmatched };
}
