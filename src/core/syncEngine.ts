// Lumina Sync — the provider engine (pure orchestration; the impurity lives in the providers it drives).
//
// A "provider" is the adapter between one kind of domain data (bookmarks, likes, cookies, history…) and the
// chain's record store. It knows how to read its domain as `SyncRecord`s (`snapshot`) and how to write a merged
// set of records back into its domain (`apply`). The engine here just fans those calls out and folds the results
// through the already-tested merge layer — so the whole collect → merge → distribute pipeline is unit-testable
// with in-memory fake providers, and the real (fs/session-backed) providers only have to get their own read/write
// right.

import { mergeStores, fromArray, type SyncRecord, type SyncStore, type SyncType } from './syncMerge';

export interface SyncProvider {
  /** The single record type this provider owns. One provider per type. */
  readonly type: SyncType;
  /** Current domain state as stamped records (each with `updatedAt`/`deviceId`, tombstones for local deletes). */
  snapshot(): Promise<SyncRecord[]> | SyncRecord[];
  /**
   * Reconcile the domain with the merged records of this type — **including tombstones**, so exact delete
   * timestamps are preserved rather than re-stamped. The provider merges these into its own state and shows the
   * live (non-deleted) ones. The set passed is the merged truth for this type, not a delta.
   */
  apply(records: readonly SyncRecord[]): Promise<void> | void;
}

/** All records of one type (live + tombstones) — what a provider's `apply` receives. */
export function recordsOfType(store: SyncStore, type: SyncType): SyncRecord[] {
  return [...store.values()].filter((r) => r.type === type);
}

/**
 * Merge every provider's current domain state into `base`, returning the updated store. This is how local changes
 * (a bookmark added, a like removed) enter the chain before a sync. Providers are read in order; the merge is
 * order-independent anyway.
 */
export async function collect(providers: readonly SyncProvider[], base: SyncStore): Promise<SyncStore> {
  let store = base;
  for (const provider of providers) {
    store = mergeStores(store, fromArray(await provider.snapshot()));
  }
  return store;
}

/** Push the merged records of each provider's type (live + tombstones) back into its domain. */
export async function distribute(providers: readonly SyncProvider[], store: SyncStore): Promise<void> {
  for (const provider of providers) {
    await provider.apply(recordsOfType(store, provider.type));
  }
}
