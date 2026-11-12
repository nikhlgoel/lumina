// Files a batch is about to download that are already on the computer, and the folder a batch goes into.
//
// Two things went wrong without this: a second batch with the same title was poured into the first one's folder, and downloading a release
// again quietly produced `name (1).rar` copies of every file. Pure, so the choices are tested without a disk.

/** What to do with a file that is already in the folder. Not set means "keep both" (the browser's way: `name (1).ext`). */
export type ExistingMode = 'skip' | 'replace';

export type ExistingAction =
  /** Nothing is there: download it. */
  | 'download'
  /** The same file is there already: do not download it again. */
  | 'reuse'
  /** Download over it (the old copy goes to the Recycle Bin first). */
  | 'replace'
  /** Something else with that name is there: keep it and save the new one beside it. */
  | 'keep-both';

/**
 * Decide for one file. `expected` is the size the link says, when it said; `onDisk` is what is in the folder under that name, or null.
 * "Skip" only trusts a file that is the right size, and only when the size is known: a file of that name with a different size is another version, or a
 * failed earlier try, not the one asked for, and is never mistaken for it.
 */
export function actionForExisting(mode: ExistingMode | undefined, expected: number | null, onDisk: { size: number } | null): ExistingAction {
  if (!onDisk) return 'download';
  if (mode === 'replace') return 'replace';
  if (mode === 'skip') {
    // Only a file of the size the link says is trusted. When the link does not say (a file host's page), nothing can show that a file of that name
    // is the whole file and not an earlier try that stopped half way, so it is not taken for it.
    return expected && expected > 0 && onDisk.size === expected ? 'reuse' : 'keep-both';
  }
  return 'keep-both';
}

export interface FolderChoice {
  /** The folder to use. */
  dir: string;
  /** True when it already holds files of this very batch (so a repeat is recognised) rather than being a fresh or unrelated folder. */
  sameBatch: boolean;
}

/**
 * The folder for a batch: `<base>/<title>`, or `<title> (2)`, `(3)` and so on when that name is taken by something that is not this batch.
 * It is the same batch when the folder already holds at least one of the batch's file names; then it is reused, so a repeat finds its own files.
 * `listDir` returns the names in a folder, or null when there is no such folder.
 */
export function chooseBatchFolder(opts: {
  base: string;
  title: string;
  filenames: readonly string[];
  listDir: (dir: string) => string[] | null;
  join: (dir: string, name: string) => string;
}): FolderChoice {
  const wanted = new Set(opts.filenames.map((n) => n.toLowerCase()).filter(Boolean));
  for (let n = 1; n < 1000; n++) {
    const dir = opts.join(opts.base, n === 1 ? opts.title : `${opts.title} (${n})`);
    const there = opts.listDir(dir);
    if (there === null || there.length === 0) return { dir, sameBatch: false };
    if (there.some((name) => wanted.has(name.toLowerCase()) || wanted.has(name.toLowerCase().replace(/\.aria2$/, '')))) return { dir, sameBatch: true };
  }
  return { dir: opts.join(opts.base, `${opts.title} (${Date.now()})`), sameBatch: false };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A name for a batch whose files are not named by their links: the day and time it was started, which tells two such batches apart. */
export function stampedBatchTitle(now: Date): string {
  return `Batch ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
}
