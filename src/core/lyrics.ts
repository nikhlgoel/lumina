import type { LyricLine } from '../shared/types';

const NOISE = /\s*[([][^)\]]*(official|video|audio|lyrics?|lyric video|visuali[sz]er|remaster(ed)?|hd|hq|4k|mv|clip)[^)\]]*[)\]]/gi;

/** Strip YouTube clutter and split "Artist - Title" when the uploader is a channel, not an artist. */
export function cleanTrackMetadata(rawTitle: string, rawArtist?: string | null): { title: string; artist: string } {
  let title = (rawTitle || '').trim();
  let artist = (rawArtist || '').trim();
  const channelLike = !artist || /topic$|vevo$|records?$|music$|official/i.test(artist);

  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash?.[1] && dash[2] && channelLike) {
    artist = dash[1].trim();
    title = dash[2].trim();
  }

  title = title
    .replace(NOISE, '')
    .replace(/\s*[([](feat|ft)\.?[^)\]]*[)\]]/gi, '')
    .replace(/\s+(feat|ft)\.\s+.*$/i, '')
    .replace(/^["'“‘]|["'”’]$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  artist = artist
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*(,|&|\bx\b|\bfeat\.?|\bft\.?).*$/i, '')
    .trim();

  return { title, artist };
}

/** A looser title for a second search attempt: no brackets, no trailing "- Live" parts. */
export const relaxTitle = (title: string) =>
  title.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+[-–—].*$/, '').replace(/\s{2,}/g, ' ').trim();

const normalizeWords = (s: string) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

/** Word-overlap similarity (Dice coefficient), 0–1. */
export function wordSimilarity(a: string, b: string): number {
  const wa = normalizeWords(a);
  const wb = normalizeWords(b);
  if (!wa.length || !wb.length) return 0;
  const pool = [...wb];
  let shared = 0;
  for (const w of wa) {
    const i = pool.indexOf(w);
    if (i >= 0) {
      shared++;
      pool.splice(i, 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

export interface LyricsCandidate {
  trackName?: string;
  artistName?: string;
  duration?: number;
  syncedLyrics?: string | null;
}

/**
 * Score a search hit against the track, or return null when it is probably a different song.
 * Showing someone else's lyrics is worse than showing none.
 */
export function scoreLyricsMatch(c: LyricsCandidate, track: { title: string; artist: string; durationSec: number | null }): number | null {
  const titleScore = Math.max(wordSimilarity(c.trackName ?? '', track.title), wordSimilarity(relaxTitle(c.trackName ?? ''), relaxTitle(track.title)));
  const artistScore = track.artist && c.artistName ? wordSimilarity(c.artistName, track.artist) : 0;
  const diff = track.durationSec && c.duration ? Math.abs(c.duration - track.durationSec) : null;

  if (diff !== null && diff > 12) return null;
  if (titleScore < 0.6) return null;
  const durationConfirms = diff !== null && diff <= 4;
  if (track.artist && artistScore < 0.5 && !durationConfirms) return null;

  return titleScore * 2 + artistScore * 2 + (durationConfirms ? 3 : 0) + (c.syncedLyrics ? 1 : 0);
}

/** Parse LRC text. Supports multiple timestamps per line and the [offset:] tag. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let offsetSec = 0;
  for (const raw of text.split(/\r?\n/)) {
    const offset = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (offset?.[1]) {
      offsetSec = Number(offset[1]) / 1000;
      continue;
    }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const lyric = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
      lines.push({ timeSec: Math.max(0, Number(s[1]) * 60 + Number(s[2]) + frac - offsetSec), text: lyric });
    }
  }
  lines.sort((a, b) => a.timeSec - b.timeSec);
  // Drop leading empty lines; keep inner blanks as instrumental gaps.
  while (lines[0] && !lines[0].text) lines.shift();
  return lines;
}

export const parsePlainLyrics = (text: string): LyricLine[] =>
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((t) => ({ timeSec: -1, text: t }));

export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

/** Parse SRT or WebVTT into cues. */
export function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n/g, '\n').replace(/^﻿/, '').split(/\n\s*\n/);
  const toSec = (h: string | undefined, m: string, s: string, ms: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
  for (const block of blocks) {
    const rows = block.split('\n');
    const idx = rows.findIndex((r) => r.includes('-->'));
    if (idx < 0) continue;
    const m = rows[idx]!.match(/(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/);
    if (!m) continue;
    const body = rows.slice(idx + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]+\}/g, '').trim();
    if (!body) continue;
    cues.push({ startSec: toSec(m[1], m[2]!, m[3]!, m[4]!), endSec: toSec(m[5], m[6]!, m[7]!, m[8]!), text: body });
  }
  return cues.sort((a, b) => a.startSec - b.startSec);
}

export function cuesToVtt(cues: Cue[]): string {
  const ts = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  return `WEBVTT\n\n${cues.map((c) => `${ts(c.startSec)} --> ${ts(c.endSec)}\n${c.text}`).join('\n\n')}\n`;
}

/** Index of the active lyric line for a playback time (-1 before the first line). */
export function activeLineIndex(lines: LyricLine[], timeSec: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.timeSec <= timeSec) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
