import { describe, it, expect } from 'vitest';
import { SYNC_DOC_VERSION, fromDocument, toDocument } from '@core/syncDocument';
import { fromArray, toArray, type SyncRecord } from '@core/syncMerge';

const rec = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  id: 'a',
  type: 'cookie',
  payload: { domain: 'x.com', name: 's', value: 'secret' },
  updatedAt: 1000,
  deviceId: 'dev-1',
  deleted: false,
  ...over,
});

describe('syncDocument', () => {
  it('round-trips a store through the document envelope', () => {
    const store = fromArray([rec({ id: 'a' }), rec({ id: 'b', updatedAt: 2000 })]);
    const decoded = fromDocument(toDocument(store));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(toArray(decoded.store)).toEqual(toArray(store));
  });

  it('stamps the current format version', () => {
    const doc = toDocument(fromArray([rec()])) as { v: number };
    expect(doc.v).toBe(SYNC_DOC_VERSION);
  });

  it('rejects a newer, unsupported version', () => {
    const decoded = fromDocument({ v: SYNC_DOC_VERSION + 1, records: [] });
    expect(decoded).toEqual({ ok: false, error: 'unsupported-version' });
  });

  it('rejects malformed content (right seed, wrong structure)', () => {
    expect(fromDocument(null).ok).toBe(false);
    expect(fromDocument('nope').ok).toBe(false);
    expect(fromDocument({ v: 1 }).ok).toBe(false); // no records
    expect(fromDocument({ v: 1, records: [{ id: 'a' }] }).ok).toBe(false); // record missing fields
    expect(fromDocument({ v: 1, records: [{ ...rec(), type: 'bogus' }] }).ok).toBe(false); // bad type
  });

  it('reconciles duplicate/out-of-order records on decode', () => {
    const decoded = fromDocument({
      v: 1,
      records: [rec({ id: 'a', updatedAt: 1000, payload: 'old' }), rec({ id: 'a', updatedAt: 2000, payload: 'new' })],
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.store.size).toBe(1);
      expect(toArray(decoded.store)[0]!.payload).toBe('new');
    }
  });
});
