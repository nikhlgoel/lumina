import { DatabaseSync } from 'node:sqlite';
import { databaseFile } from './paths';
import { logger } from './log';

const log = logger('db');

const MIGRATIONS: string[] = [
  `
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE library_items (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    root TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    track_no INTEGER,
    duration_sec REAL,
    codec TEXT,
    bitrate_kbps INTEGER,
    sample_rate INTEGER,
    bit_depth INTEGER,
    lossless INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    has_artwork INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX library_items_kind ON library_items(kind);
  CREATE INDEX library_items_dir ON library_items(root);

  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    location TEXT NOT NULL,
    item_paths TEXT NOT NULL
  );

  CREATE TABLE lyrics_cache (
    key TEXT PRIMARY KEY,
    data TEXT,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE play_positions (
    path TEXT PRIMARY KEY,
    position_sec REAL NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];

let db: DatabaseSync | null = null;

export function database(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(databaseFile());
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    log.info(`Applying migration ${v + 1}`);
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

export function transaction<T>(fn: () => T): T {
  const d = database();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export function closeDatabase() {
  db?.close();
  db = null;
}
