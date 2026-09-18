import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import type { Lyrics } from '../shared/types';
import { cleanTrackMetadata, parseLrc, parsePlainLyrics, relaxTitle, scoreLyricsMatch } from '../core/lyrics';
import { database } from './db';
import { askAi } from './ai';
import { settings } from './settings';
import { logger } from './log';

const log = logger('lyrics');
const HEADERS = { 'User-Agent': 'Lumina (https://github.com/nikhlgoel/lumina)', Accept: 'application/json' };
const CACHE_DAYS_FOUND = 90;
const CACHE_DAYS_MISSING = 3;

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function fromLrclib(r: LrclibRecord | null, title: string, artist: string): Lyrics | null {
  if (!r) return null;
  const base = { title: r.trackName || title, artist: r.artistName || artist, source: 'lrclib' as const };
  if (r.instrumental) return { ...base, synced: false, lines: [{ timeSec: -1, text: 'Instrumental' }], plain: null };
  if (r.syncedLyrics?.trim()) {
    const lines = parseLrc(r.syncedLyrics);
    if (lines.length) return { ...base, synced: true, lines, plain: r.plainLyrics ?? null };
  }
  if (r.plainLyrics?.trim()) return { ...base, synced: false, lines: parsePlainLyrics(r.plainLyrics), plain: r.plainLyrics };
  return null;
}

async function fromLocalFile(mediaPath: string): Promise<Lyrics | null> {
  const stem = mediaPath.slice(0, -path.extname(mediaPath).length);
  for (const candidate of [`${stem}.lrc`, `${stem}.en.lrc`]) {
    if (fs.existsSync(candidate)) {
      const lines = parseLrc(fs.readFileSync(candidate, 'utf8'));
      if (lines.length) return { title: path.basename(stem), artist: '', synced: true, lines, plain: null, source: 'lrc-file' };
    }
  }
  try {
    const meta = await parseFile(mediaPath, { skipCovers: true });
    for (const tag of meta.common.lyrics ?? []) {
      if (tag.syncText?.length && tag.syncText.some((t) => t.timestamp != null)) {
        const lines = tag.syncText.map((t) => ({ timeSec: (t.timestamp ?? 0) / 1000, text: t.text.trim() })).sort((a, b) => a.timeSec - b.timeSec);
        return { title: meta.common.title ?? '', artist: meta.common.artist ?? '', synced: true, lines, plain: null, source: 'embedded' };
      }
      if (tag.text?.trim()) {
        // Some taggers store LRC text inside plain lyrics fields.
        const lrc = parseLrc(tag.text);
        if (lrc.length > 2) return { title: meta.common.title ?? '', artist: meta.common.artist ?? '', synced: true, lines: lrc, plain: null, source: 'embedded' };
        return { title: meta.common.title ?? '', artist: meta.common.artist ?? '', synced: false, lines: parsePlainLyrics(tag.text), plain: tag.text, source: 'embedded' };
      }
    }
  } catch {
    // not a taggable file
  }
  return null;
}

export async function getLyrics(q: { title: string; artist: string | null; durationSec: number | null; path: string | null }): Promise<Lyrics | null> {
  if (q.path && fs.existsSync(q.path)) {
    const local = await fromLocalFile(q.path);
    if (local) return local;
  }

  const { title, artist } = cleanTrackMetadata(q.title, q.artist);
  if (!title) return null;
  // v2: stricter matching; ignores entries cached by the old, looser search.
  const key = `v2|${artist.toLowerCase()}|${title.toLowerCase()}|${Math.round((q.durationSec ?? 0) / 5)}`;
  const db = database();
  const cached = db.prepare('SELECT data, fetched_at FROM lyrics_cache WHERE key = ?').get(key) as { data: string | null; fetched_at: number } | undefined;
  if (cached) {
    const ageDays = (Date.now() - cached.fetched_at) / 86_400_000;
    if (ageDays < (cached.data ? CACHE_DAYS_FOUND : CACHE_DAYS_MISSING)) return cached.data ? (JSON.parse(cached.data) as Lyrics) : null;
  }

  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set('artist_name', artist);
  if (q.durationSec) params.set('duration', String(Math.round(q.durationSec)));

  let result = fromLrclib(await getJson<LrclibRecord>(`https://lrclib.net/api/get?${params}`), title, artist);

  if (!result) {
    const relaxed = relaxTitle(title);
    for (const query of [`${artist} ${title}`, `${artist} ${relaxed}`, title].map((s) => s.trim()).filter((s, i, a) => s && a.indexOf(s) === i)) {
      const hits = await getJson<LrclibRecord[]>(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
      if (!hits?.length) continue;
      const track = { title, artist, durationSec: q.durationSec };
      const best = hits
        .map((h) => ({ h, score: scoreLyricsMatch(h, track) }))
        .filter((x): x is { h: LrclibRecord; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score)[0];
      result = fromLrclib(best?.h ?? null, title, artist);
      if (result) break;
    }
  }

  if (!result && artist) {
    const ovh = await getJson<{ lyrics?: string }>(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (ovh?.lyrics?.trim()) result = { title, artist, synced: false, lines: parsePlainLyrics(ovh.lyrics), plain: ovh.lyrics, source: 'lyrics.ovh' };
  }

  // Last resort, off by default and only with the user's own key: ask their AI provider. A model
  // recalls lyrics imperfectly, so this is marked source:'ai' and the player labels it as unverified.
  if (!result && settings.get().lyrics.aiFallback) {
    try {
      const answer = await askAi(
        `Give the lyrics of the song "${title}"${artist ? ` by ${artist}` : ''}.
` +
        'Reply with the lyric lines only — no title, no commentary, no timestamps. ' +
        'If you are not confident you know this exact song, reply with only: UNKNOWN',
      );
      const text = answer?.trim();
      if (text && !/^unknown$/i.test(text)) {
        result = { title, artist, synced: false, lines: parsePlainLyrics(text), plain: text, source: 'ai' };
        log.info(`AI fallback supplied lyrics for ${artist} – ${title}`);
      }
    } catch (err) {
      // A bad key or a rate limit shouldn't break playback; the player just shows no lyrics.
      log.warn('AI lyrics fallback failed', err);
    }
  }

  db.prepare('INSERT OR REPLACE INTO lyrics_cache (key, data, fetched_at) VALUES (?, ?, ?)').run(key, result ? JSON.stringify(result) : null, Date.now());
  if (!result) log.debug(`No lyrics for ${artist} – ${title}`);
  return result;
}
