import { describe, it, expect } from 'vitest';
import { collect, distribute, recordsOfType, type SyncProvider } from '@core/syncEngine';
import { fromArray, recordKey, type SyncRecord, type SyncStore } from '@core/syncMerge';

const rec = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  id: 'a',
  type: 'bookmark',
  payload: { url: 'https://x' },
  updatedAt: 1000,
  deviceId: 'dev',
  deleted: false,
  ...over,
});

class FakeProvider implements SyncProvider {
  applied: SyncRecord[] | null = null;
  constructor(
    readonly type: SyncProvider['type'],
    private readonly records: SyncRecord[],
  ) {}
  snapshot() {
    return this.records;
  }
  apply(records: readonly SyncRecord[]) {
    this.applied = [...records];
  }
}

describe('syncEngine', () => {
  it('recordsOfType returns live + tombstones of that type only', () => {
    const store = fromArray([
      rec({ id: 'a', type: 'bookmark' }),
      rec({ id: 'b', type: 'bookmark', deleted: true }),
      rec({ id: 'c', type: 'like' }),
    ]);
    expect(recordsOfType(store, 'bookmark').map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('collect merges each provider snapshot into the base store', async () => {
    const base: SyncStore = fromArray([rec({ id: 'a', updatedAt: 1000 })]);
    const bookmarks = new FakeProvider('bookmark', [rec({ id: 'a', updatedAt: 2000, payload: 'new' })]);
    const likes = new FakeProvider('like', [rec({ id: 'x', type: 'like' })]);
    const merged = await collect([bookmarks, likes], base);
    expect(merged.size).toBe(2);
    expect(merged.get(recordKey('bookmark', 'a'))!.payload).toBe('new'); // newer snapshot wins
  });

  it('distribute hands each provider all records of its own type (incl tombstones)', async () => {
    const store = fromArray([
      rec({ id: 'a', type: 'bookmark' }),
      rec({ id: 'b', type: 'bookmark', deleted: true }),
      rec({ id: 'x', type: 'like' }),
    ]);
    const bookmarks = new FakeProvider('bookmark', []);
    const likes = new FakeProvider('like', []);
    await distribute([bookmarks, likes], store);
    expect(bookmarks.applied!.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(likes.applied!.map((r) => r.id)).toEqual(['x']);
  });
});
