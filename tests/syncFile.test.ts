import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateSeed } from '@core/syncCrypto';
import { fromArray, liveRecords, recordKey, type SyncRecord, type SyncStore } from '@core/syncMerge';
import { SYNC_FILE_NAME, readSyncFile, syncWithFile, writeSyncFile } from '../src/main/sync/syncFile';

const rec = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  id: 'a',
  type: 'bookmark',
  payload: { url: 'https://example.com' },
  updatedAt: 1000,
  deviceId: 'dev-1',
  deleted: false,
  ...over,
});

let dir: string;
let file: string;
const seed = generateSeed();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-sync-'));
  file = path.join(dir, SYNC_FILE_NAME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const leftoverTmp = () => fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));

describe('syncFile — read/write round-trip', () => {
  it('writes then reads back the same records', () => {
    const store = fromArray([rec({ id: 'a' }), rec({ id: 'b', updatedAt: 2000 })]);
    expect(writeSyncFile(file, seed, store)).toBe(true);
    const read = readSyncFile(file, seed);
    expect(read.status).toBe('ok');
    if (read.status === 'ok') expect(read.store.size).toBe(2);
  });

  it('leaves no temp file behind', () => {
    writeSyncFile(file, seed, fromArray([rec()]));
    expect(leftoverTmp()).toHaveLength(0);
  });
});

describe('syncFile — read errors', () => {
  it('reports a missing file distinctly (not an error)', () => {
    expect(readSyncFile(file, seed)).toEqual({ status: 'missing' });
  });

  it('reports unreadable when the seed is wrong', () => {
    writeSyncFile(file, seed, fromArray([rec()]));
    expect(readSyncFile(file, generateSeed())).toEqual({ status: 'error', error: 'unreadable' });
  });

  it('reports unreadable for a garbage (non-Lumina) file', () => {
    fs.writeFileSync(file, Buffer.from('this is not an encrypted sync blob'));
    expect(readSyncFile(file, seed)).toEqual({ status: 'error', error: 'unreadable' });
  });
});

describe('syncFile — syncWithFile', () => {
  it('creates the file on first sync from a missing path', () => {
    const local = fromArray([rec({ id: 'a' })]);
    const result = syncWithFile(file, seed, local);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.wrote).toBe(true);
      expect(result.localChanged).toBe(false);
    }
    expect(fs.existsSync(file)).toBe(true);
  });

  it('merges two devices through the file (union available to both)', () => {
    const deviceA = fromArray([rec({ id: 'a', deviceId: 'A' })]);
    const deviceB = fromArray([rec({ id: 'b', deviceId: 'B' })]);

    // Device A publishes, device B syncs and gains A's record.
    syncWithFile(file, seed, deviceA);
    const bResult = syncWithFile(file, seed, deviceB);
    expect(bResult.status).toBe('ok');
    if (bResult.status === 'ok') {
      expect(bResult.localChanged).toBe(true);
      expect(liveRecords(bResult.store).map((r) => r.id).sort()).toEqual(['a', 'b']);
    }

    // Device A syncs again and now sees B's record too.
    const aResult = syncWithFile(file, seed, deviceA);
    expect(aResult.status).toBe('ok');
    if (aResult.status === 'ok') expect(liveRecords(aResult.store).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('does not rewrite the file when it already has everything local holds', () => {
    const local = fromArray([rec({ id: 'a' })]);
    syncWithFile(file, seed, local); // first write
    const again = syncWithFile(file, seed, local);
    expect(again.status).toBe('ok');
    if (again.status === 'ok') expect(again.wrote).toBe(false);
  });

  it('refuses to overwrite an existing file it cannot decrypt', () => {
    const good = fromArray([rec({ id: 'a', payload: 'keep-me' })]);
    writeSyncFile(file, seed, good);
    const before = fs.readFileSync(file);

    const result = syncWithFile(file, generateSeed(), fromArray([rec({ id: 'b' })]));
    expect(result).toEqual({ status: 'error', error: 'unreadable' });
    expect(fs.readFileSync(file)).toEqual(before); // untouched

    // The original seed still reads the original data intact.
    const read = readSyncFile(file, seed);
    expect(read.status).toBe('ok');
    if (read.status === 'ok') expect(read.store.get(recordKey('bookmark', 'a'))!.payload).toBe('keep-me');
  });

  it('propagates a delete (tombstone) through the file', () => {
    const withRecord = fromArray([rec({ id: 'a', updatedAt: 1000 })]);
    syncWithFile(file, seed, withRecord);

    const deleted: SyncStore = fromArray([rec({ id: 'a', updatedAt: 2000, deleted: true, payload: null })]);
    syncWithFile(file, seed, deleted);

    const fresh = syncWithFile(file, seed, new Map());
    expect(fresh.status).toBe('ok');
    if (fresh.status === 'ok') expect(liveRecords(fresh.store)).toHaveLength(0);
  });
});
