// Plans a pasted batch of links: groups split archives into sets, separates optional extras,
import type { ReleaseTag } from '../shared/types';
// and orders checksum manifests first so every file can be verified the moment it finishes.

export type BatchGroupKind = 'archive-set' | 'optional' | 'checksum' | 'file';

export interface BatchItem {
  url: string;
  filename: string;
  /** 1-based volume number inside a split archive; null for single files. */
  part: number | null;
}

export interface BatchGroup {
  key: string;
  kind: BatchGroupKind;
  /** Human label, e.g. "German voice-over" or the archive name. */
  label: string;
  items: BatchItem[];
  /** Volume numbers absent from a split archive; the set can't be extracted without them. */
  missingParts: number[];
  /** Optional extras start unticked; everything else starts ticked. */
  defaultSelected: boolean;
}

export interface BatchPlan {
  title: string;
  groups: BatchGroup[];
  /** Links whose file name couldn't be read from the URL (pages, redirectors). */
  unnamed: number;
}

export const CHECKSUM_FILE = /\.(md5|sfv|sha1|sha256|sha512)$|^(md5|sha1|sha256|sha512)sums(\.txt)?$/i;
const OPTIONAL = /^(fg-)?(optional|selective)[-_]|[-_.](optional|selective)[-_.]/i;

/** File name as the link shows it: magnet dn=, otherwise the last URL path segment. */
export function fileNameFromUrl(url: string): string {
  try {
    if (/^magnet:/i.test(url)) return new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('dn') ?? '';
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const name = decodeURIComponent(last);
    return /\.[a-z0-9]{1,5}$/i.test(name) ? name : '';
  } catch {
    return '';
  }
}

/** Recognise split-archive volumes: name.part01.rar, name.7z.001, name.r00 (+ name.rar), name.z01 (+ name.zip). */
export function splitVolume(filename: string): { base: string; part: number } | null {
  let m = filename.match(/^(.*)\.part0*(\d+)\.rar$/i);
  if (m) return { base: `${m[1]}.rar`, part: Number(m[2]) };
  m = filename.match(/^(.*\.(?:7z|zip|rar|tar|iso|bin|img))\.0*(\d{1,3})$/i);
  if (m && /\.\d{3}$/.test(filename)) return { base: m[1]!, part: Number(m[2]) };
  m = filename.match(/^(.*)\.r(\d{2})$/i);
  if (m) return { base: `${m[1]}.rar`, part: Number(m[2]) + 2 };
  m = filename.match(/^(.*)\.z(\d{2})$/i);
  if (m) return { base: `${m[1]}.zip`, part: Number(m[2]) };
  return null;
}

/** "Some_Game_--_example-site.net_--_" -> "Some Game". Strips site tags and separators. */
export function prettyTitle(name: string): string {
  return name
    .replace(/\.(part\d+\.)?(rar|zip|7z|bin|iso|exe|tar|gz)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\b[\w-]+\.(site|com|net|org|to|io|cc|ru|me|info|xyz)\b/gi, '')
    .replace(/(\s*-{2,}\s*)+/g, ' ')
    .replace(/[\s.\-–]+$/g, '')
    .replace(/^[\s.\-–]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function optionalLabel(base: string): string {
  const core = base
    .replace(/\.(part\d+\.)?(rar|zip|7z|bin)$/i, '')
    .replace(/^(fg-)?(optional|selective)[-_]/i, '')
    .replace(/[-_.](optional|selective)(?=[-_.]|$)/i, '');
  const words = core.split(/[-_.\s]+/).filter(Boolean).map((w) => {
    const lw = w.toLowerCase();
    if (lw === 'vo') return 'voice-over';
    if (lw === 'hd' || lw === '4k' || lw === 'dlc') return w.toUpperCase();
    return lw;
  });
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function missing(parts: number[], firstPart: number): number[] {
  const have = new Set(parts);
  const max = Math.max(...parts);
  const gaps: number[] = [];
  for (let i = firstPart; i <= max; i++) if (!have.has(i)) gaps.push(i);
  return gaps;
}

export function planBatch(links: string[]): BatchPlan {
  const groups = new Map<string, BatchGroup>();
  const order: string[] = [];
  let unnamed = 0;
  const seen = new Set<string>();

  const groupFor = (key: string, init: () => Omit<BatchGroup, 'key' | 'items' | 'missingParts'>) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, items: [], missingParts: [], ...init() };
      groups.set(key, g);
      order.push(key);
    }
    return g;
  };

  for (const url of links) {
    if (seen.has(url)) continue;
    seen.add(url);
    const filename = fileNameFromUrl(url);
    if (!filename) unnamed++;
    const optional = OPTIONAL.test(filename);
    const vol = filename ? splitVolume(filename) : null;

    if (filename && CHECKSUM_FILE.test(filename)) {
      groupFor(`sum:${filename.toLowerCase()}`, () => ({ kind: 'checksum', label: filename, defaultSelected: true })).items.push({ url, filename, part: null });
    } else if (vol) {
      const key = `set:${vol.base.toLowerCase()}`;
      groupFor(key, () => ({
        kind: optional ? 'optional' : 'archive-set',
        label: optional ? optionalLabel(vol.base) : prettyTitle(vol.base) || vol.base,
        defaultSelected: !optional,
      })).items.push({ url, filename, part: vol.part });
    } else if (optional) {
      groupFor(`opt:${filename.toLowerCase()}`, () => ({ kind: 'optional', label: optionalLabel(filename), defaultSelected: false })).items.push({ url, filename, part: null });
    } else {
      groupFor(`file:${url}`, () => ({ kind: 'file', label: filename || url, defaultSelected: true })).items.push({ url, filename, part: null });
    }
  }

  const list = order.map((k) => groups.get(k)!);
  // Old-style volumes (.r00 / .z01) have a head file with a plain .rar/.zip name: fold it into its set.
  for (const g of [...list]) {
    if (g.kind !== 'file' && g.kind !== 'optional') continue;
    const item = g.items[0];
    if (!item?.filename || item.part !== null) continue;
    const set = groups.get(`set:${item.filename.toLowerCase()}`);
    if (!set || set === g) continue;
    const parts = set.items.map((i) => i.part ?? 0);
    const isZip = /\.zip$/i.test(item.filename);
    set.items.push({ ...item, part: isZip ? Math.max(...parts) + 1 : 1 });
    list.splice(list.indexOf(g), 1);
  }
  for (const g of list) {
    const parts = g.items.map((i) => i.part).filter((p): p is number => p !== null);
    if (!parts.length) continue;
    g.items.sort((a, b) => (a.part ?? 0) - (b.part ?? 0));
    // .r00-style sets number the .rar head as volume 1; everything else counts from 1 too.
    g.missingParts = missing(parts, 1);
  }

  const rank: Record<BatchGroupKind, number> = { checksum: 0, 'archive-set': 1, file: 2, optional: 3 };
  list.sort((a, b) => rank[a.kind] - rank[b.kind]);

  // The release is named after its biggest archive set (the game or main package), not whichever came first.
  const main = list.filter((g) => g.kind === 'archive-set').sort((a, b) => b.items.length - a.items.length)[0] ?? list.find((g) => g.kind === 'file');
  const title = (main?.kind === 'archive-set' ? main.label : prettyTitle(main?.items[0]?.filename ?? '')) || 'Batch download';
  return { title, groups: list, unnamed };
}

/** The release tag a queued file carries, so its archive set can be unpacked and assembled when complete. */
export function releaseTagFor(
  group: BatchGroup,
  item: BatchItem,
  release: { id: string; title: string; dir: string; unpack: boolean; deleteArchives: boolean },
): ReleaseTag {
  const split = group.items.some((x) => x.part !== null);
  return {
    ...release,
    role: group.kind === 'archive-set' ? 'archive' : group.kind,
    set: split ? group.key : undefined,
    part: item.part ?? undefined,
    parts: split ? group.items.length : undefined,
  };
}
