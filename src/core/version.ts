// Semver comparison for the update check. Lumina ships prereleases (3.0.0-alpha.0), so the rules
// that matter most here are the prerelease ones: alpha.2 < beta.0 < 3.0.0. Pure, so it is tested.

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a stable release. */
  prerelease: (string | number)[];
}

/** Parse "v3.0.0-alpha.1+build" leniently; returns null when it isn't a version at all. */
export function parseVersion(raw: string): ParsedVersion | null {
  const m = raw.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  const prerelease = m[4]
    ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease };
}

/** Semver precedence for one prerelease identifier: numbers sort below strings. */
function compareIdentifier(a: string | number, b: string | number): number {
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  if (aNum && bNum) return a < b ? -1 : a > b ? 1 : 0;
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** -1 / 0 / 1, following semver precedence. Unparseable versions sort last (treated as older). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  // A version with a prerelease tag ranks below the same version without one.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const c = compareIdentifier(x, y);
    if (c !== 0) return c;
  }
  return 0;
}

export const isNewerVersion = (candidate: string, current: string) => compareVersions(candidate, current) > 0;

export interface ReleaseInfo {
  version: string;
  url: string;
  notes: string;
  publishedAt: number | null;
  prerelease: boolean;
}

/** The shape of a GitHub release we care about; everything is optional because it's remote data. */
interface GithubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/**
 * Pick the update to offer from a GitHub releases listing: the highest version newer than the one
 * running, skipping drafts, anything the user chose to skip, and — unless they opted in —
 * prereleases. Remote data, so every field is validated rather than trusted.
 */
export function pickUpdate(
  releases: unknown,
  current: string,
  opts: { allowPrerelease?: boolean; skipVersion?: string } = {},
): ReleaseInfo | null {
  if (!Array.isArray(releases)) return null;
  let best: ReleaseInfo | null = null;
  for (const raw of releases as GithubRelease[]) {
    if (!raw || typeof raw !== 'object' || raw.draft === true) continue;
    const tag = typeof raw.tag_name === 'string' ? raw.tag_name : '';
    const parsed = parseVersion(tag);
    if (!parsed) continue;
    const prerelease = raw.prerelease === true || parsed.prerelease.length > 0;
    if (prerelease && !opts.allowPrerelease) continue;
    const version = tag.replace(/^v/i, '');
    if (opts.skipVersion && version === opts.skipVersion) continue;
    if (!isNewerVersion(version, current)) continue;
    if (best && !isNewerVersion(version, best.version)) continue;
    const publishedAt = typeof raw.published_at === 'string' ? Date.parse(raw.published_at) : NaN;
    best = {
      version,
      url: typeof raw.html_url === 'string' ? raw.html_url : '',
      notes: typeof raw.body === 'string' ? raw.body.slice(0, 4000) : '',
      publishedAt: Number.isNaN(publishedAt) ? null : publishedAt,
      prerelease,
    };
  }
  return best;
}
