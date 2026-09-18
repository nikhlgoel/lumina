// Lumina Sync — the on-disk / on-wire document codec (pure, fully unit-testable).
//
// A "sync document" is the encrypted blob a chain exchanges through a user-owned location (a USB drive, a shared
// folder, the user's own cloud folder) or over the LAN. It is just `{ v, records }` — the format version plus the
// serialised merge store — encrypted with the chain seed (see syncCrypto.ts). Encoding and decoding live here,
// separate from any file/network I/O (that's in src/main/sync/*), so the whole codec round-trips in tests.
//
// Decoding is defensive: the bytes are the user's own encrypted data, but a wrong seed, a truncated/tampered file,
// an unknown future version or a malformed structure must never crash the app or — worse — be mistaken for an empty
// chain and silently overwrite good data. So decode returns a tagged result the caller inspects.

import { z } from 'zod';
import { SYNC_TYPES, fromArray, toArray, type SyncStore } from './syncMerge';

/** Current document format version. Bump when the envelope shape changes; older readers reject newer docs. */
export const SYNC_DOC_VERSION = 1;

const syncRecordSchema = z.object({
  id: z.string(),
  type: z.enum(SYNC_TYPES),
  payload: z.unknown(),
  updatedAt: z.number().finite(),
  deviceId: z.string(),
  deleted: z.boolean(),
});

const syncDocSchema = z.object({
  v: z.number().int(),
  records: z.array(syncRecordSchema),
});

/** Why a document could not be turned into a store. Lets the caller message the user precisely. */
export type SyncDecodeError = 'unreadable' | 'unsupported-version' | 'malformed';

export type SyncDecodeResult =
  | { readonly ok: true; readonly store: SyncStore }
  | { readonly ok: false; readonly error: SyncDecodeError };

/** Serialise a merge store to the plaintext document object (before encryption). */
export function toDocument(store: SyncStore): unknown {
  return { v: SYNC_DOC_VERSION, records: toArray(store) };
}

/**
 * Turn a decrypted document object back into a merge store, validating its shape first.
 * - `unsupported-version`: from a newer Lumina than this one understands.
 * - `malformed`: right seed, but the structure isn't a sync document (unexpected/corrupt content).
 * Duplicate/out-of-order records are reconciled by `fromArray`, so a slightly messy document still converges.
 */
export function fromDocument(doc: unknown): SyncDecodeResult {
  const parsed = syncDocSchema.safeParse(doc);
  if (!parsed.success) return { ok: false, error: 'malformed' };
  if (parsed.data.v > SYNC_DOC_VERSION) return { ok: false, error: 'unsupported-version' };
  return { ok: true, store: fromArray(parsed.data.records) };
}
