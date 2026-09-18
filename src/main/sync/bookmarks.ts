// Bookmarks — the in-app browser's saved sites, and the first real Lumina Sync provider.
//
// Bookmarks are Lumina-owned and non-sensitive, which makes them the natural first thing to sync (and the browser
// needs them anyway). The store persists its rows *as sync records* — each bookmark carries `updatedAt`/`deviceId`
// and deletes are tombstones — so it plugs straight into the merge engine with no impedance mismatch. Kept free of
// Electron (a plain file path + injected clock/device id) so the add → snapshot → merge → apply round-trip is
// fully unit-testable; the main process just hands it a real path under `dataDir`.

import fs from 'node:fs';
import path from 'node:path';
import type { Bookmark } from '../../shared/types';
import type { SyncProvider } from '../../core/syncEngine';
import { fromArray, liveRecords, mergeStores, recordKey, toArray, upsert, type SyncRecord, type SyncStore } from '../../core/syncMerge';

export type { Bookmark };

interface BookmarkPayload {
  readonly url: string;
  readonly title: string;
  readonly addedAt: number;
}

function isSyncRecord(v: unknown): v is SyncRecord {
  const r = v as Partial<SyncRecord> | null;
  return (
    !!r &&
    typeof r.id === 'string' &&
    r.type === 'bookmark' &&
    typeof r.updatedAt === 'number' &&
    Number.isFinite(r.updatedAt) &&
    typeof r.deviceId === 'string' &&
    typeof r.deleted === 'boolean'
  );
}

function toBookmark(r: SyncRecord): Bookmark | null {
  const p = r.payload as Partial<BookmarkPayload> | null;
  if (!p || typeof p.url !== 'string') return null;
  return {
    id: r.id,
    url: p.url,
    title: typeof p.title === 'string' && p.title ? p.title : p.url,
    addedAt: typeof p.addedAt === 'number' ? p.addedAt : r.updatedAt,
  };
}

/** A bookmarks store that is also a {@link SyncProvider}. Electron-free for testability. */
export class BookmarkStore implements SyncProvider {
  readonly type = 'bookmark' as const;
  private store: SyncStore;

  constructor(
    private readonly filePath: string,
    private readonly deviceId: string,
    private readonly now: () => number = Date.now,
  ) {
    this.store = this.load();
  }

  private load(): SyncStore {
    try {
      if (!fs.existsSync(this.filePath)) return new Map();
      const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const records = Array.isArray(parsed) ? parsed.filter(isSyncRecord) : [];
      return fromArray(records);
    } catch {
      return new Map(); // a corrupt local cache should never crash the app; it rebuilds on next sync
    }
  }

  private persist(): void {
    const tmp = `${this.filePath}.tmp-${process.pid}-${this.now()}`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(toArray(this.store)));
      try {
        fs.renameSync(tmp, this.filePath);
      } catch {
        fs.rmSync(this.filePath, { force: true });
        fs.renameSync(tmp, this.filePath);
      }
    } catch {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** Live bookmarks, newest first. */
  list(): Bookmark[] {
    return liveRecords(this.store)
      .map(toBookmark)
      .filter((b): b is Bookmark => b !== null)
      .sort((a, b) => b.addedAt - a.addedAt);
  }

  /** Save (or update) a bookmark for `url`. Re-saving keeps the original `addedAt`. */
  add(url: string, title: string): Bookmark {
    const id = url.trim();
    const existing = toBookmark(this.store.get(recordKey('bookmark', id)) ?? ({} as SyncRecord));
    const addedAt = existing?.addedAt ?? this.now();
    this.store = upsert(this.store, {
      id,
      type: 'bookmark',
      payload: { url: id, title, addedAt } satisfies BookmarkPayload,
      updatedAt: this.now(),
      deviceId: this.deviceId,
      deleted: false,
    });
    this.persist();
    return { id, url: id, title, addedAt };
  }

  /** Remove a bookmark (a tombstone, so the delete propagates through the chain). */
  remove(id: string): void {
    if (!this.store.has(recordKey('bookmark', id))) return;
    this.store = upsert(this.store, {
      id,
      type: 'bookmark',
      payload: null,
      updatedAt: this.now(),
      deviceId: this.deviceId,
      deleted: true,
    });
    this.persist();
  }

  /** {@link SyncProvider.snapshot}: every row (live + tombstones) as records. */
  snapshot(): SyncRecord[] {
    return toArray(this.store);
  }

  /** {@link SyncProvider.apply}: merge the chain's bookmark records into the store and persist. */
  apply(records: readonly SyncRecord[]): void {
    const next = mergeStores(this.store, fromArray([...records]));
    if (next === this.store) return;
    this.store = next;
    this.persist();
  }
}
