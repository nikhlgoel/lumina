// Torrent file lists and the compact index form aria2 wants for `select-file`.
// Pure: aria2's raw rows in, display rows and option strings out. No I/O, so it is unit-tested.

export interface Aria2FileRow {
  index: string;
  path: string;
  length: string;
  completedLength: string;
  selected: string;
}

export interface TorrentFile {
  /** 1-based, as aria2 numbers them — this is what `select-file` takes. */
  index: number;
  /** Path inside the torrent, with the shared top folder stripped for display. */
  name: string;
  sizeBytes: number;
  downloadedBytes: number;
  percent: number;
  selected: boolean;
}

const normalize = (p: string) => p.replace(/\\/g, '/');

/**
 * The folder every file shares, if any — a single-folder torrent shouldn't repeat its own name on
 * every row. Returns '' when the files don't share a top folder (or there is only one file).
 */
export function commonRoot(paths: string[]): string {
  if (paths.length < 2) return '';
  const parts = paths.map((p) => normalize(p).split('/'));
  const first = parts[0]!;
  let shared = 0;
  // Never consume the last segment: that's the file name.
  while (shared < first.length - 1 && parts.every((p) => p.length > shared + 1 && p[shared] === first[shared])) shared++;
  return shared > 0 ? first.slice(0, shared).join('/') : '';
}

/** Turn aria2's rows into display rows, stripping the shared folder and computing each percent. */
export function toTorrentFiles(rows: Aria2FileRow[]): TorrentFile[] {
  const paths = rows.map((r) => normalize(r.path));
  const root = commonRoot(paths);
  return rows.map((r, i) => {
    const size = Number(r.length) || 0;
    const done = Math.min(Number(r.completedLength) || 0, size);
    const full = paths[i]!;
    const name = root && full.startsWith(`${root}/`) ? full.slice(root.length + 1) : full.split('/').pop() || full;
    return {
      index: Number(r.index) || i + 1,
      name,
      sizeBytes: size,
      downloadedBytes: done,
      percent: size > 0 ? (done / size) * 100 : 0,
      selected: r.selected === 'true',
    };
  });
}

/**
 * aria2's `select-file` format: sorted 1-based indices, runs collapsed — "1,3,5-8".
 * An empty selection returns '' , which callers must treat as "select everything" rather than
 * sending to aria2, because aria2 reads an empty value as "all files" anyway.
 */
export function toSelectFileSpec(indices: number[]): string {
  const sorted = [...new Set(indices.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(',');
}

/** Read a spec back — used to show what a resumed torrent already had selected. */
export function fromSelectFileSpec(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(',').map((p) => p.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      // Guard against a malformed huge range from a hand-edited session file.
      if (to >= from && to - from < 100_000) for (let n = from; n <= to; n++) out.add(n);
      continue;
    }
    if (/^\d+$/.test(part)) out.add(Number(part));
  }
  return [...out].sort((a, b) => a - b);
}

/** Bytes still to fetch for the chosen files — what the Download-selected button should promise. */
export function selectedBytes(files: TorrentFile[], indices: number[]): { total: number; remaining: number } {
  const want = new Set(indices);
  let total = 0;
  let remaining = 0;
  for (const f of files) {
    if (!want.has(f.index)) continue;
    total += f.sizeBytes;
    remaining += Math.max(0, f.sizeBytes - f.downloadedBytes);
  }
  return { total, remaining };
}
