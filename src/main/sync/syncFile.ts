// Lumina Sync — encrypted file / USB / shared-folder transport (step 2 of HANDOVER §11).
//
// The offline, cross-network leg of a chain: sync through an encrypted `lumina-sync.bin` on a place the user
// controls — a USB drive, a shared folder, or their own Syncthing/Drive/Dropbox folder. Each device reads the
// blob, merges it with its own store, and writes the union back. This is also the "lose a device, restore from
// another / from USB" story: a fresh device with the chain seed reads the file and gets everything.
//
// Kept free of Electron (only node builtins + the pure `src/core` sync modules) so the file logic — atomic
// writes, and the crucial refusal to overwrite data it can't read — is fully unit-testable. The caller (a
// main-process sync manager / IPC handler) owns logging and the seed (from the OS keychain via secrets.ts).
//
// Safety invariant: an existing file that fails to decrypt (wrong seed / tampered / corrupt) is NEVER treated as
// empty and NEVER overwritten. Only a genuinely missing file starts a new chain document.

import fs from 'node:fs';
import path from 'node:path';
import { decrypt, encryptJson } from '../../core/syncCrypto';
import { fromDocument, toDocument, type SyncDecodeError } from '../../core/syncDocument';
import { mergeStores, type SyncStore } from '../../core/syncMerge';

/** Conventional filename for the shared blob inside a synced folder / USB drive. */
export const SYNC_FILE_NAME = 'lumina-sync.bin';

/** `unreadable` = decryption failed (wrong seed / tampered); `io` = filesystem error; rest are codec errors. */
export type SyncFileError = SyncDecodeError | 'unreadable' | 'io';

export type SyncFileRead =
  | { readonly status: 'missing' }
  | { readonly status: 'ok'; readonly store: SyncStore }
  | { readonly status: 'error'; readonly error: SyncFileError };

/** Read, decrypt and decode the blob at `filePath`. Distinguishes "not there yet" from "can't read it". */
export function readSyncFile(filePath: string, seed: Uint8Array): SyncFileRead {
  let bytes: Buffer;
  try {
    if (!fs.existsSync(filePath)) return { status: 'missing' };
    bytes = fs.readFileSync(filePath);
  } catch {
    return { status: 'error', error: 'io' };
  }
  const plain = decrypt(seed, bytes);
  if (!plain) return { status: 'error', error: 'unreadable' };
  let doc: unknown;
  try {
    doc = JSON.parse(Buffer.from(plain).toString('utf8'));
  } catch {
    return { status: 'error', error: 'malformed' };
  }
  const decoded = fromDocument(doc);
  return decoded.ok ? { status: 'ok', store: decoded.store } : { status: 'error', error: decoded.error };
}

/** Encrypt and write a store atomically (temp file + rename) so a crash mid-write can't corrupt the blob. */
export function writeSyncFile(filePath: string, seed: Uint8Array, store: SyncStore): boolean {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, encryptJson(seed, toDocument(store)), { mode: 0o600 });
    try {
      fs.renameSync(tmp, filePath);
    } catch {
      // Windows can refuse rename-over-existing; replace then rename as a fallback.
      fs.rmSync(filePath, { force: true });
      fs.renameSync(tmp, filePath);
    }
    return true;
  } catch {
    fs.rmSync(tmp, { force: true }); // never leave a stray temp file behind
    return false;
  }
}

export type SyncFileSync =
  | { readonly status: 'ok'; readonly store: SyncStore; readonly wrote: boolean; readonly localChanged: boolean }
  | { readonly status: 'error'; readonly error: SyncFileError };

/**
 * One full file-sync pass: read the shared blob, merge it with `localStore`, and write the union back if the
 * file was missing or didn't already contain everything local has. Returns the merged store to apply locally,
 * whether the file was written, and whether local gained anything from the file. On any read error (including an
 * unreadable/wrong-seed file) it returns the error and writes nothing — never clobbering data it can't read.
 */
export function syncWithFile(filePath: string, seed: Uint8Array, localStore: SyncStore): SyncFileSync {
  const read = readSyncFile(filePath, seed);
  if (read.status === 'error') return read;

  const remote: SyncStore = read.status === 'ok' ? read.store : new Map();
  const merged = mergeStores(localStore, remote); // local-based union (same content whichever side is the base)
  const localChanged = merged !== localStore;
  // The file already has everything local holds when merging local into remote adds nothing new.
  const fileHasEverything = read.status === 'ok' && mergeStores(remote, localStore) === remote;

  let wrote = false;
  if (!fileHasEverything) {
    wrote = writeSyncFile(filePath, seed, merged);
    if (!wrote) return { status: 'error', error: 'io' };
  }
  return { status: 'ok', store: merged, wrote, localChanged };
}
