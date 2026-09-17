import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import type { LibraryItem, LibraryPlaylist, LibraryStats, MediaKind } from '../shared/types';
import { AUDIO_EXT, PLAYLIST_EXT, VIDEO_EXT, mediaKindOf, parsePlaylist } from '../core/playlists';
import { database, transaction } from './db';
import { settings } from './settings';
import { probe } from './media/probe';
import { logger } from './log';

const log = logger('library');
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', '.git', '.cache', 'appdata', '.trash']);
const MAX_DEPTH = 12;

export const itemId = (p: string) => createHash('sha1').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 20);

interface Row {
  id: string; path: string; root: string; kind: MediaKind; title: string; artist: string | null; album: string | null;
  track_no: number | null; duration_sec: number | null; codec: string | null; bitrate_kbps: number | null; sample_rate: number | null;
  bit_depth: number | null; lossless: number; width: number | null; height: number | null; has_artwork: number;
  size_bytes: number; mtime_ms: number; added_at: number;
}

const toItem = (r: Row): LibraryItem => ({
  id: r.id, path: r.path, kind: r.kind, title: r.title, artist: r.artist, album: r.album, trackNo: r.track_no,
  durationSec: r.duration_sec, codec: r.codec, bitrateKbps: r.bitrate_kbps, sampleRate: r.sample_rate, bitDepth: r.bit_depth,
  lossless: Boolean(r.lossless), width: r.width, height: r.height, hasArtwork: Boolean(r.has_artwork),
  sizeBytes: r.size_bytes, mtimeMs: r.mtime_ms, addedAt: r.added_at,
});

class Library extends EventEmitter<{ changed: [LibraryStats] }> {
  private scanning = false;
  private rescanRequested = false;
  private lastScanAt: number | null = null;
  private watchers: fs.FSWatcher[] = [];
  private watchTimer: NodeJS.Timeout | null = null;

  roots(): string[] {
    const s = settings.get().storage;
    const all = [...s.libraryRoots, s.musicDir, s.videoDir, s.seriesDir].map((r) => path.resolve(r));
    // Drop roots nested inside other roots so nothing is scanned twice.
    const unique = [...new Set(all)].filter((r) => fs.existsSync(r));
    return unique.filter((r) => !unique.some((o) => o !== r && r.startsWith(o + path.sep)));
  }

  stats(): LibraryStats {
    const db = database();
    const minAudio = settings.get().library.minAudioSeconds;
    const count = (kind: string) => (db.prepare(`SELECT COUNT(*) AS n FROM library_items WHERE kind = ?${kind === 'audio' ? ' AND (duration_sec IS NULL OR duration_sec >= ?)' : ''}`)
      .get(...(kind === 'audio' ? [kind, minAudio] : [kind])) as { n: number }).n;
    const playlists = (db.prepare('SELECT COUNT(*) AS n FROM playlists').get() as { n: number }).n;
    return { audio: count('audio'), video: count('video'), playlists, scanning: this.scanning, lastScanAt: this.lastScanAt };
  }

  items(query: { kind?: MediaKind; playlistId?: string; query?: string }): LibraryItem[] {
    const db = database();
    if (query.playlistId) {
      const pl = db.prepare('SELECT item_paths FROM playlists WHERE id = ?').get(query.playlistId) as { item_paths: string } | undefined;
      if (!pl) return [];
      const paths = JSON.parse(pl.item_paths) as string[];
      const byPath = new Map<string, LibraryItem>();
      const stmt = db.prepare('SELECT * FROM library_items WHERE id = ?');
      for (const p of paths) {
        const row = stmt.get(itemId(p)) as Row | undefined;
        if (row) byPath.set(p, toItem(row));
      }
      return paths.map((p) => byPath.get(p)).filter((x): x is LibraryItem => Boolean(x));
    }
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.kind) {
      where.push('kind = ?');
      params.push(query.kind);
    }
    // Short clips (notification sounds, voice memos) aren't music; hide them from the song list.
    if (query.kind === 'audio') {
      where.push('(duration_sec IS NULL OR duration_sec >= ?)');
      params.push(settings.get().library.minAudioSeconds);
    }
    if (query.query?.trim()) {
      where.push('(title LIKE ? OR artist LIKE ? OR album LIKE ?)');
      const q = `%${query.query.trim()}%`;
      params.push(q, q, q);
    }
    const sql = `SELECT * FROM library_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY added_at DESC LIMIT 20000`;
    return (db.prepare(sql).all(...params) as unknown as Row[]).map(toItem);
  }

  getById(id: string): LibraryItem | null {
    const row = database().prepare('SELECT * FROM library_items WHERE id = ?').get(id) as Row | undefined;
    return row ? toItem(row) : null;
  }

  playlists(): LibraryPlaylist[] {
    const rows = database().prepare('SELECT id, name, source, path, kind, location, item_paths FROM playlists ORDER BY name COLLATE NOCASE').all() as {
      id: string; name: string; source: LibraryPlaylist['source']; path: string; kind: LibraryPlaylist['kind']; location: string; item_paths: string;
    }[];
    return rows.map((r) => ({ id: r.id, name: r.name, source: r.source, path: r.path, kind: r.kind, location: r.location, itemCount: (JSON.parse(r.item_paths) as string[]).length }));
  }

  /** True if the path is inside a library root or already indexed; used to guard file access. */
  isAllowedPath(p: string): boolean {
    const abs = path.resolve(p);
    if (this.getById(itemId(abs))) return true;
    const s = settings.get().storage;
    return [...this.roots(), s.otherDir].some((r) => abs === r || abs.startsWith(path.resolve(r) + path.sep));
  }

  /** Index one file now (e.g. just downloaded or opened directly). */
  async ingest(file: string): Promise<LibraryItem | null> {
    const abs = path.resolve(file);
    const kind = mediaKindOf(abs);
    if (!kind || !fs.existsSync(abs)) return null;
    const root = this.roots().find((r) => abs.startsWith(r + path.sep)) ?? path.dirname(abs);
    const row = await this.readMetadata(abs, kind, root);
    if (!row) return null;
    this.upsert(row);
    this.emit('changed', this.stats());
    return toItem(row);
  }

  async scan(): Promise<void> {
    if (this.scanning) {
      this.rescanRequested = true;
      return;
    }
    this.scanning = true;
    this.emit('changed', this.stats());
    const started = Date.now();
    try {
      const roots = this.roots();
      const media: { file: string; kind: MediaKind; root: string }[] = [];
      const playlistFiles: string[] = [];
      const folders = new Map<string, { audio: string[]; video: string[] }>();

      for (const root of roots) this.walk(root, root, 0, media, playlistFiles, folders);

      const db = database();
      const existing = new Map((db.prepare('SELECT path, mtime_ms, size_bytes FROM library_items').all() as { path: string; mtime_ms: number; size_bytes: number }[]).map((r) => [r.path, r]));
      const seen = new Set<string>();
      const toRead = media.filter(({ file }) => {
        seen.add(file);
        const prev = existing.get(file);
        if (!prev) return true;
        try {
          const st = fs.statSync(file);
          return Math.round(st.mtimeMs) !== prev.mtime_ms || st.size !== prev.size_bytes;
        } catch {
          return false;
        }
      });

      // Read metadata with limited parallelism.
      let next = 0;
      const batch: Row[] = [];
      const worker = async () => {
        while (next < toRead.length) {
          const m = toRead[next++]!;
          const row = await this.readMetadata(m.file, m.kind, m.root);
          if (row) batch.push(row);
          if (batch.length >= 100) this.flush(batch);
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      this.flush(batch);

      // Remove files that disappeared from scanned roots.
      transaction(() => {
        const del = db.prepare('DELETE FROM library_items WHERE path = ?');
        for (const [p] of existing) {
          const underScannedRoot = roots.some((r) => p.startsWith(r + path.sep));
          if (underScannedRoot && !seen.has(p)) del.run(p);
        }
      });

      this.indexPlaylists(playlistFiles, folders, roots);
      this.lastScanAt = Date.now();
      log.info(`Scan finished in ${Math.round((Date.now() - started) / 1000)}s: ${media.length} files, ${toRead.length} updated`);
    } catch (err) {
      log.error('Library scan failed', err);
    } finally {
      this.scanning = false;
      this.emit('changed', this.stats());
      if (this.rescanRequested) {
        this.rescanRequested = false;
        void this.scan();
      }
    }
  }

  watch() {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (!settings.get().library.watchFolders) return;
    for (const root of this.roots()) {
      try {
        const w = fs.watch(root, { recursive: true }, (_event, name) => {
          if (!name) return;
          const ext = path.extname(String(name)).toLowerCase();
          if (!AUDIO_EXT.has(ext) && !VIDEO_EXT.has(ext) && !PLAYLIST_EXT.has(ext)) return;
          if (this.watchTimer) clearTimeout(this.watchTimer);
          this.watchTimer = setTimeout(() => void this.scan(), 4000);
        });
        w.on('error', (err) => log.warn(`Watcher error for ${root}`, err));
        this.watchers.push(w);
      } catch (err) {
        log.warn(`Cannot watch ${root}`, err);
      }
    }
  }

  getPosition(p: string): number | null {
    const row = database().prepare('SELECT position_sec FROM play_positions WHERE path = ?').get(path.resolve(p)) as { position_sec: number } | undefined;
    return row?.position_sec ?? null;
  }

  savePosition(p: string, positionSec: number) {
    database().prepare('INSERT INTO play_positions (path, position_sec, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET position_sec = excluded.position_sec, updated_at = excluded.updated_at')
      .run(path.resolve(p), positionSec, Date.now());
  }

  private walk(dir: string, root: string, depth: number, media: { file: string; kind: MediaKind; root: string }[], playlists: string[], folders: Map<string, { audio: string[]; video: string[] }>) {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) this.walk(full, root, depth + 1, media, playlists, folders);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (PLAYLIST_EXT.has(ext)) {
        playlists.push(full);
        continue;
      }
      const kind = mediaKindOf(full);
      if (!kind) continue;
      media.push({ file: full, kind, root });
      const f = folders.get(dir) ?? { audio: [], video: [] };
      f[kind].push(full);
      folders.set(dir, f);
    }
  }

  private async readMetadata(file: string, kind: MediaKind, root: string): Promise<Row | null> {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      return null;
    }
    const prev = database().prepare('SELECT added_at FROM library_items WHERE path = ?').get(file) as { added_at: number } | undefined;
    const base: Row = {
      id: itemId(file), path: file, root, kind, title: path.basename(file, path.extname(file)), artist: null, album: null, track_no: null,
      duration_sec: null, codec: null, bitrate_kbps: null, sample_rate: null, bit_depth: null, lossless: 0, width: null, height: null,
      has_artwork: 0, size_bytes: st.size, mtime_ms: Math.round(st.mtimeMs), added_at: prev?.added_at ?? Math.round(st.birthtimeMs || st.mtimeMs),
    };
    try {
      if (kind === 'audio') {
        const m = await parseFile(file, { duration: true, skipCovers: false });
        const c = m.common;
        const f = m.format;
        return {
          ...base, title: c.title || base.title.replace(/^\d+\s*[-.]\s*/, ''), artist: c.artist ?? c.albumartist ?? null, album: c.album ?? null,
          track_no: c.track?.no ?? null, duration_sec: f.duration ?? null, codec: f.codec ?? f.container ?? null,
          bitrate_kbps: f.bitrate ? Math.round(f.bitrate / 1000) : f.duration ? Math.round((st.size * 8) / f.duration / 1000) : null, sample_rate: f.sampleRate ?? null, bit_depth: f.bitsPerSample ?? null,
          lossless: f.lossless ? 1 : 0, has_artwork: c.picture?.length ? 1 : 0,
        };
      }
      const p = await probe(file);
      return {
        ...base, title: p.tags.title || base.title, artist: p.tags.artist ?? null, duration_sec: p.durationSec,
        codec: p.video?.codec ?? null, bitrate_kbps: p.bitrateKbps, width: p.video?.width ?? null, height: p.video?.height ?? null,
        has_artwork: p.hasAttachedPic ? 1 : 0,
      };
    } catch (err) {
      log.debug(`Metadata read failed for ${file}`, err);
      return base;
    }
  }

  private flush(batch: Row[]) {
    if (!batch.length) return;
    const rows = batch.splice(0);
    transaction(() => rows.forEach((r) => this.upsert(r)));
    this.emit('changed', this.stats());
  }

  private upsert(r: Row) {
    database().prepare(`INSERT INTO library_items (id, path, root, kind, title, artist, album, track_no, duration_sec, codec, bitrate_kbps, sample_rate, bit_depth, lossless, width, height, has_artwork, size_bytes, mtime_ms, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET path=excluded.path, root=excluded.root, kind=excluded.kind, title=excluded.title, artist=excluded.artist, album=excluded.album,
        track_no=excluded.track_no, duration_sec=excluded.duration_sec, codec=excluded.codec, bitrate_kbps=excluded.bitrate_kbps, sample_rate=excluded.sample_rate,
        bit_depth=excluded.bit_depth, lossless=excluded.lossless, width=excluded.width, height=excluded.height, has_artwork=excluded.has_artwork,
        size_bytes=excluded.size_bytes, mtime_ms=excluded.mtime_ms`)
      .run(r.id, r.path, r.root, r.kind, r.title, r.artist, r.album, r.track_no, r.duration_sec, r.codec, r.bitrate_kbps, r.sample_rate, r.bit_depth, r.lossless, r.width, r.height, r.has_artwork, r.size_bytes, r.mtime_ms, r.added_at);
  }

  private indexPlaylists(files: string[], folders: Map<string, { audio: string[]; video: string[] }>, roots: string[]) {
    const rows: { id: string; name: string; source: string; path: string; kind: string; location: string; items: string[] }[] = [];
    const locationOf = (p: string) => {
      const root = roots.find((r) => p.startsWith(r + path.sep));
      const rel = root ? path.relative(path.dirname(root), path.dirname(p)) : path.dirname(p);
      return rel.split(path.sep).join(' › ');
    };
    const kindOf = (items: string[]): LibraryPlaylist['kind'] => {
      const kinds = new Set(items.map((i) => mediaKindOf(i)));
      return kinds.size === 1 ? ([...kinds][0] ?? 'mixed') as MediaKind : 'mixed';
    };
    const playlistDirs = new Set<string>();

    for (const file of files) {
      try {
        const parsed = parsePlaylist(file, fs.readFileSync(file, 'utf8'));
        const items = parsed.entries.filter((e) => mediaKindOf(e) && fs.existsSync(e));
        if (!items.length) continue;
        playlistDirs.add(path.dirname(file));
        rows.push({ id: itemId(file), name: parsed.name || path.basename(file, path.extname(file)), source: 'file', path: file, kind: kindOf(items), location: locationOf(file), items });
      } catch (err) {
        log.debug(`Unreadable playlist ${file}`, err);
      }
    }

    for (const [dir, f] of folders) {
      // A folder with its own playlist file is already represented by that file.
      if (playlistDirs.has(dir)) continue;
      const items = [...f.audio, ...f.video].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (items.length < 2 || roots.includes(dir)) continue;
      rows.push({ id: itemId(`${dir}${path.sep}`), name: path.basename(dir), source: 'folder', path: dir, kind: kindOf(items), location: locationOf(path.join(dir, 'x')), items });
    }

    transaction(() => {
      const db = database();
      db.prepare("DELETE FROM playlists WHERE source != 'user'").run();
      const ins = db.prepare('INSERT OR REPLACE INTO playlists (id, name, source, path, kind, location, item_paths) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) ins.run(r.id, r.name, r.source, r.path, r.kind, r.location, JSON.stringify(r.items));
    });
  }
}

export const library = new Library();
