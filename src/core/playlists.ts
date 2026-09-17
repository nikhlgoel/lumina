// Parsers for playlist files found on disk. Returned paths are resolved against the playlist's folder.
import path from 'node:path';
import { mediaKindOf } from './mediaKind';

export { AUDIO_EXT, VIDEO_EXT, PLAYLIST_EXT, mediaKindOf } from './mediaKind';

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function toPath(entry: string, baseDir: string): string | null {
  let e = entry.trim();
  if (!e) return null;
  if (/^file:\/\//i.test(e)) {
    try {
      e = decodeURIComponent(new URL(e).pathname);
      if (/^\/[a-zA-Z]:\//.test(e)) e = e.slice(1);
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(e)) {
    return null; // remote streams are not part of the local library
  }
  return path.resolve(baseDir, e.replace(/\\/g, path.sep).replace(/\//g, path.sep));
}

export interface ParsedPlaylist {
  name: string | null;
  entries: string[];
}

export function parsePlaylist(fileName: string, content: string): ParsedPlaylist {
  const ext = path.extname(fileName).toLowerCase();
  const baseDir = path.dirname(fileName);
  const text = content.replace(/^﻿/, '');
  const entries: string[] = [];
  let name: string | null = null;
  const add = (raw: string) => {
    const p = toPath(raw, baseDir);
    if (p) entries.push(p);
  };

  if (ext === '.m3u' || ext === '.m3u8') {
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (l.startsWith('#PLAYLIST:')) name = l.slice(10).trim() || null;
      else if (l && !l.startsWith('#')) add(l);
    }
  } else if (ext === '.pls') {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^File\d+=(.+)$/i);
      if (m?.[1]) add(m[1]);
    }
  } else if (ext === '.xspf') {
    name = decodeEntities(text.match(/<playlist[^>]*>[\s\S]*?<title>([^<]*)<\/title>/i)?.[1] ?? '') || null;
    for (const m of text.matchAll(/<location>([^<]+)<\/location>/gi)) add(decodeEntities(m[1] ?? ''));
  } else if (ext === '.wpl' || ext === '.zpl') {
    name = decodeEntities(text.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '') || null;
    for (const m of text.matchAll(/<media[^>]*\bsrc="([^"]+)"/gi)) add(decodeEntities(m[1] ?? ''));
  }

  return { name, entries };
}

/** Serialize an extended M3U playlist with paths relative to the playlist file when possible. */
export function writeM3u8(playlistFile: string, name: string, items: { path: string; title: string; durationSec: number | null }[]): string {
  const dir = path.dirname(playlistFile);
  const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
  for (const item of items) {
    const rel = path.relative(dir, item.path);
    const usable = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : item.path;
    lines.push(`#EXTINF:${Math.round(item.durationSec ?? -1)},${item.title}`, usable);
  }
  return `${lines.join('\n')}\n`;
}
