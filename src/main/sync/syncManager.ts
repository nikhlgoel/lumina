// Lumina Sync — the main-process orchestrator that ties the (tested) core to Electron.
//
// Owns the chain seed (generated/joined, stored in the OS keychain via secrets.ts), a stable per-install device
// id, and the registered providers. A "sync now" run is: collect each provider's current domain state → merge →
// exchange through the encrypted file (syncWithFile) → distribute the merged result back to the providers. The
// heavy lifting is all in `src/core/*` and `syncFile.ts`/`bookmarks.ts` (unit-tested); this file only supplies
// the seed, paths, hostname and event broadcast that need Electron.

import { safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Bookmark, SyncStatus } from '../../shared/types';
import { decodeSeed, encodeSeed, generateSeed } from '../../core/syncCrypto';
import { collect, distribute, type SyncProvider } from '../../core/syncEngine';
import { dataDir } from '../paths';
import { logger } from '../log';
import { deleteSecret, loadSecret, saveSecret } from '../secrets';
import { settings } from '../settings';
import { BookmarkStore } from './bookmarks';
import { SYNC_FILE_NAME, syncWithFile } from './syncFile';

const log = logger('sync');
const SEED_SECRET = 'sync-seed';
const syncDir = () => path.join(dataDir(), 'sync');

let bookmarkStore: BookmarkStore | null = null;
let providers: SyncProvider[] = [];
let deviceIdCache = '';
let lastSyncedAt = 0;

/** A stable id for this install, generated once and cached on disk. */
function deviceId(): string {
  if (deviceIdCache) return deviceIdCache;
  const file = path.join(syncDir(), 'device-id');
  try {
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, 'utf8').trim();
      if (saved) return (deviceIdCache = saved);
    }
  } catch {
    // fall through to generate
  }
  deviceIdCache = crypto.randomUUID();
  try {
    fs.mkdirSync(syncDir(), { recursive: true });
    fs.writeFileSync(file, deviceIdCache);
  } catch (err) {
    log.warn('could not persist device id', err);
  }
  return deviceIdCache;
}

function loadSeed(): Uint8Array | null {
  const b64 = loadSecret<string>(SEED_SECRET);
  if (!b64) return null;
  try {
    const seed = new Uint8Array(Buffer.from(b64, 'base64'));
    return seed.length === 32 ? seed : null;
  } catch {
    return null;
  }
}

function storeSeed(seed: Uint8Array): void {
  saveSecret(SEED_SECRET, Buffer.from(seed).toString('base64'));
}

/** Build the provider set. Called once at startup (and lazily if needed). */
export function initSync(): void {
  bookmarkStore = new BookmarkStore(path.join(syncDir(), 'bookmarks.json'), deviceId());
  providers = [bookmarkStore];
}

/** The bookmarks store, used by the bookmarks IPC handlers and (later) the in-app browser. */
export function bookmarks(): BookmarkStore {
  if (!bookmarkStore) initSync();
  return bookmarkStore!;
}

export function syncStatus(): SyncStatus {
  const seed = loadSeed();
  const s = settings.get().sync;
  return {
    hasChain: seed !== null,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    recoveryCode: seed ? encodeSeed(seed) : null,
    deviceId: deviceId(),
    deviceLabel: s.deviceLabel || os.hostname(),
    folder: s.folder,
    bookmarkCount: bookmarks().list().length,
    lastSyncedAt,
  };
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('This system can’t securely store the sync key, so a sync chain can’t be created here.');
  }
}

/** Start a brand-new chain on this device (generates the seed). No-op if a chain already exists. */
export function createChain(): SyncStatus {
  requireEncryption();
  if (!loadSeed()) storeSeed(generateSeed());
  return syncStatus();
}

/** Join an existing chain by entering its recovery code. */
export function joinChain(code: string): SyncStatus {
  requireEncryption();
  const seed = decodeSeed(code);
  if (!seed) throw new Error('That recovery code isn’t valid — check the characters and try again.');
  storeSeed(seed);
  return syncStatus();
}

/** Leave the chain on this device (forgets the seed; local data stays). */
export function leaveChain(): SyncStatus {
  deleteSecret(SEED_SECRET);
  return syncStatus();
}

/** Run one file-based sync pass against the configured folder. */
export async function syncNow(): Promise<SyncStatus> {
  const seed = loadSeed();
  if (!seed) throw new Error('Set up a sync chain first.');
  const folder = settings.get().sync.folder;
  if (!folder) throw new Error('Choose a sync folder first — a USB drive or a folder both devices can reach.');
  if (!fs.existsSync(folder)) throw new Error('That sync folder isn’t available. Reconnect the drive or pick another folder.');

  const local = await collect(providers, new Map());
  const result = syncWithFile(path.join(folder, SYNC_FILE_NAME), seed, local);
  if (result.status !== 'ok') {
    throw new Error(
      result.error === 'unreadable'
        ? 'The sync file in that folder is from a different chain (its data couldn’t be read with this chain’s key).'
        : `Sync couldn’t complete (${result.error}).`,
    );
  }
  await distribute(providers, result.store);
  lastSyncedAt = Date.now();
  log.info(`sync complete (${result.wrote ? 'wrote' : 'no write'}; ${bookmarks().list().length} bookmarks)`);
  return syncStatus();
}

/** Add a bookmark (used by IPC / the browser's save-page action). */
export function addBookmark(url: string, title: string): Bookmark {
  return bookmarks().add(url, title);
}

export function removeBookmark(id: string): void {
  bookmarks().remove(id);
}

export function listBookmarks(): Bookmark[] {
  return bookmarks().list();
}
