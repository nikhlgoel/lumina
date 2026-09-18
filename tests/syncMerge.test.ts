import { describe, it, expect } from 'vitest';
import {
  changesSince,
  fromArray,
  highWater,
  liveRecords,
  mergeAll,
  mergeRecord,
  mergeStores,
  pruneTombstones,
  recordKey,
  toArray,
  tombstone,
  upsert,
  type SyncRecord,
  type SyncStore,
} from '@core/syncMerge';

const rec = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  id: 'a',
  type: 'bookmark',
  payload: { url: 'https://example.com' },
  updatedAt: 1000,
  deviceId: 'dev-1',
  deleted: false,
  ...over,
});

describe('syncMerge — identity', () => {
  it('scopes ids by type so two types never collide', () => {
    expect(recordKey('bookmark', 'x')).not.toBe(recordKey('history', 'x'));
  });
});

describe('syncMerge — mergeRecord (last-write-wins, deterministic)', () => {
  it('newer updatedAt wins', () => {
    const older = rec({ updatedAt: 1000 });
    const newer = rec({ updatedAt: 2000, payload: { url: 'new' } });
    expect(mergeRecord(older, newer)).toBe(newer);
    expect(mergeRecord(newer, older)).toBe(newer); // order-independent
  });

  it('ties break by higher deviceId', () => {
    const a = rec({ deviceId: 'dev-1' });
    const b = rec({ deviceId: 'dev-2' });
    expect(mergeRecord(a, b)).toBe(b);
    expect(mergeRecord(b, a)).toBe(b);
  });

  it('a full tie prefers the tombstone (no accidental resurrection)', () => {
    const live = rec({ deleted: false });
    const dead = rec({ deleted: true });
    expect(mergeRecord(live, dead).deleted).toBe(true);
    expect(mergeRecord(dead, live).deleted).toBe(true);
  });
});

describe('syncMerge — upsert immutability', () => {
  it('returns a new store and never mutates the input', () => {
    const base: SyncStore = new Map();
    const next = upsert(base, rec());
    expect(base.size).toBe(0);
    expect(next.size).toBe(1);
  });

  it('an older write does not override a newer one', () => {
    let store: SyncStore = new Map();
    store = upsert(store, rec({ updatedAt: 2000, payload: 'new' }));
    store = upsert(store, rec({ updatedAt: 1000, payload: 'old' }));
    expect(store.get(recordKey('bookmark', 'a'))!.payload).toBe('new');
  });

  it('returns the same reference when nothing changes (idempotent upsert)', () => {
    const store = upsert(new Map(), rec());
    expect(upsert(store, rec())).toBe(store);
  });
});

describe('syncMerge — mergeStores', () => {
  const a = fromArray([rec({ id: 'a', updatedAt: 1000 }), rec({ id: 'b', updatedAt: 1000 })]);
  const b = fromArray([rec({ id: 'b', updatedAt: 3000, payload: 'B2' }), rec({ id: 'c', updatedAt: 1000 })]);

  it('is commutative — both orders converge', () => {
    const ab = toArray(mergeStores(a, b));
    const ba = toArray(mergeStores(b, a));
    expect(ab).toEqual(ba);
  });

  it('is idempotent — merging twice changes nothing', () => {
    const once = mergeStores(a, b);
    expect(toArray(mergeStores(once, b))).toEqual(toArray(once));
  });

  it('is associative', () => {
    const c = fromArray([rec({ id: 'a', updatedAt: 5000, payload: 'A3' })]);
    const left = mergeStores(mergeStores(a, b), c);
    const right = mergeStores(a, mergeStores(b, c));
    expect(toArray(left)).toEqual(toArray(right));
  });

  it('keeps the newest version of a conflicting record', () => {
    const merged = mergeStores(a, b);
    expect(merged.get(recordKey('bookmark', 'b'))!.payload).toBe('B2');
  });

  it('returns the base reference when incoming adds nothing new', () => {
    expect(mergeStores(a, new Map())).toBe(a);
  });
});

describe('syncMerge — tombstones and live view', () => {
  it('a tombstone hides the record from the live view but keeps it in the store', () => {
    let store = upsert(new Map(), rec({ id: 'a', updatedAt: 1000 }));
    store = tombstone(store, 'bookmark', 'a', 'dev-2', 2000);
    expect(store.size).toBe(1);
    expect(liveRecords(store)).toHaveLength(0);
  });

  it('a delete wins over an older edit merged in from another device', () => {
    const deleted = tombstone(new Map(), 'bookmark', 'a', 'dev-1', 2000);
    const staleEdit = upsert(new Map(), rec({ id: 'a', updatedAt: 1500, payload: 'stale' }));
    const merged = mergeStores(deleted, staleEdit);
    expect(liveRecords(merged)).toHaveLength(0);
  });
});

describe('syncMerge — delta sync', () => {
  const store = fromArray([
    rec({ id: 'a', updatedAt: 1000 }),
    rec({ id: 'b', updatedAt: 5000 }),
    rec({ id: 'c', updatedAt: 3000 }),
  ]);

  it('highWater is the newest updatedAt (0 when empty)', () => {
    expect(highWater(store)).toBe(5000);
    expect(highWater(new Map())).toBe(0);
  });

  it('changesSince returns only records newer than the high-water mark', () => {
    const delta = changesSince(store, 3000).map((r) => r.id).sort();
    expect(delta).toEqual(['b']);
  });
});

describe('syncMerge — pruneTombstones', () => {
  it('drops old tombstones but keeps live records and recent tombstones', () => {
    let store: SyncStore = new Map();
    store = upsert(store, rec({ id: 'live', updatedAt: 100 }));
    store = tombstone(store, 'bookmark', 'old', 'dev-1', 100);
    store = tombstone(store, 'bookmark', 'recent', 'dev-1', 9000);
    const pruned = pruneTombstones(store, 10_000, 5000); // cutoff = 5000
    const ids = toArray(pruned).map((r) => r.id).sort();
    expect(ids).toEqual(['live', 'recent']);
  });

  it('returns the same reference when nothing is pruned', () => {
    const store = upsert(new Map(), rec());
    expect(pruneTombstones(store, 10_000, 5000)).toBe(store);
  });
});

describe('syncMerge — serialisation', () => {
  it('toArray/fromArray round-trips and dedupes to the newest version', () => {
    const records = [
      rec({ id: 'a', updatedAt: 1000, payload: 'old' }),
      rec({ id: 'a', updatedAt: 2000, payload: 'new' }),
      rec({ id: 'b', updatedAt: 1000 }),
    ];
    const store = fromArray(records);
    expect(store.size).toBe(2);
    expect(store.get(recordKey('bookmark', 'a'))!.payload).toBe('new');
    expect(toArray(fromArray(toArray(store)))).toEqual(toArray(store));
  });
});

describe('syncMerge — mergeAll', () => {
  it('folds many stores into one convergent result', () => {
    const s1 = fromArray([rec({ id: 'a', updatedAt: 1000 })]);
    const s2 = fromArray([rec({ id: 'a', updatedAt: 4000, payload: 'win' })]);
    const s3 = fromArray([rec({ id: 'b', updatedAt: 2000 })]);
    const merged = mergeAll([s1, s2, s3]);
    expect(merged.size).toBe(2);
    expect(merged.get(recordKey('bookmark', 'a'))!.payload).toBe('win');
  });
});
