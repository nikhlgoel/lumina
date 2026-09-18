import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateSeed } from '@core/syncCrypto';
import { collect, distribute, type SyncProvider } from '@core/syncEngine';
import { type SyncStore } from '@core/syncMerge';
import { BookmarkStore } from '../src/main/sync/bookmarks';
import { SYNC_FILE_NAME, syncWithFile } from '../src/main/sync/syncFile';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-bm-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// A monotonic clock so timestamps are deterministic and strictly increasing within a test.
function clock(start = 1000): () => number {
  let t = start;
  return () => ++t;
}

describe('BookmarkStore', () => {
  it('adds, lists newest-first, and de-dupes by URL', () => {
    const store = new BookmarkStore(path.join(dir, 'bm.json'), 'dev-1', clock());
    store.add('https://a.com', 'A');
    store.add('https://b.com', 'B');
    const list = store.list();
    expect(list.map((b) => b.title)).toEqual(['B', 'A']); // newest first
    store.add('https://a.com', 'A renamed'); // same URL → update, not duplicate
    expect(store.list()).toHaveLength(2);
    expect(store.list().find((b) => b.url === 'https://a.com')!.title).toBe('A renamed');
  });

  it('keeps the original addedAt when a bookmark is re-saved', () => {
    const store = new BookmarkStore(path.join(dir, 'bm.json'), 'dev-1', clock());
    const first = store.add('https://a.com', 'A');
    store.add('https://a.com', 'A2');
    expect(store.list()[0]!.addedAt).toBe(first.addedAt);
  });

  it('removes via a tombstone (hidden from list, kept in snapshot)', () => {
    const store = new BookmarkStore(path.join(dir, 'bm.json'), 'dev-1', clock());
    store.add('https://a.com', 'A');
    store.remove('https://a.com');
    expect(store.list()).toHaveLength(0);
    expect(store.snapshot().some((r) => r.id === 'https://a.com' && r.deleted)).toBe(true);
  });

  it('persists across instances', () => {
    const file = path.join(dir, 'bm.json');
    new BookmarkStore(file, 'dev-1', clock()).add('https://a.com', 'A');
    expect(new BookmarkStore(file, 'dev-1').list().map((b) => b.url)).toEqual(['https://a.com']);
  });

  it('survives a corrupt cache file (empty, no throw)', () => {
    const file = path.join(dir, 'bm.json');
    fs.writeFileSync(file, 'not json at all');
    const store = new BookmarkStore(file, 'dev-1');
    expect(store.list()).toEqual([]);
  });

  it('apply merges chain records, newest write winning', () => {
    const store = new BookmarkStore(path.join(dir, 'bm.json'), 'dev-1', clock());
    store.add('https://a.com', 'local');
    store.apply([
      { id: 'https://a.com', type: 'bookmark', payload: { url: 'https://a.com', title: 'remote-newer', addedAt: 1 }, updatedAt: 9_999_999, deviceId: 'dev-2', deleted: false },
    ]);
    expect(store.list().find((b) => b.url === 'https://a.com')!.title).toBe('remote-newer');
  });
});

describe('desktop sync pipeline (BookmarkStore ⇄ encrypted file ⇄ BookmarkStore)', () => {
  const seed = generateSeed();

  // Mirrors what src/main/sync/syncManager.ts does: local changes → merge → file sync → apply back.
  async function syncDevice(providers: SyncProvider[], file: string, local: SyncStore): Promise<SyncStore> {
    const collected = await collect(providers, local);
    const result = syncWithFile(file, seed, collected);
    if (result.status !== 'ok') throw new Error(`sync failed: ${result.error}`);
    await distribute(providers, result.store);
    return result.store;
  }

  it('propagates an add from device A to device B, and a delete back to A', async () => {
    const file = path.join(dir, SYNC_FILE_NAME);
    const A = new BookmarkStore(path.join(dir, 'a.json'), 'A', clock(1000));
    const B = new BookmarkStore(path.join(dir, 'b.json'), 'B', clock(5000));

    // A saves a bookmark and publishes to the shared file.
    A.add('https://shared.com', 'Shared');
    let aState = await syncDevice([A], file, new Map());

    // B syncs and now sees A's bookmark.
    let bState = await syncDevice([B], file, new Map());
    expect(B.list().map((b) => b.url)).toEqual(['https://shared.com']);

    // B deletes it and publishes; A syncs and the delete propagates.
    B.remove('https://shared.com');
    bState = await syncDevice([B], file, bState);
    aState = await syncDevice([A], file, aState);
    expect(A.list()).toHaveLength(0);
    void aState;
  });
});
