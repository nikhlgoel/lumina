// Source control, the pure half: parsing what git reports and deciding what to show. Running git
// lives in src/main/ide/git.ts; everything here is unit-tested against real porcelain output.
//
// We read `git status --porcelain=v2 --branch -z` because it is git's machine format: stable across
// versions and locales, NUL-separated so filenames with spaces, quotes or newlines come through
// intact. Parsing the human-readable output would break on the first translated git install.

export type GitCode =
  | 'unmodified' | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked' | 'conflict';

export interface GitFile {
  /** Path relative to the repository root, forward slashes. */
  path: string;
  /** For a rename or copy, where it came from. */
  origPath?: string;
  /** Change recorded in the index (what "staged" means). */
  index: GitCode;
  /** Change in the working tree that is not staged yet. */
  worktree: GitCode;
  conflicted: boolean;
  untracked: boolean;
}

export interface GitStatus {
  /** Branch name, or null when HEAD is detached. */
  branch: string | null;
  /** Current commit, or null in a repository with no commits yet. */
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

const CODE: Record<string, GitCode> = {
  '.': 'unmodified', M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechange',
  U: 'conflict',
};

const code = (c: string | undefined): GitCode => CODE[c ?? '.'] ?? 'modified';

/**
 * Parse `git status --porcelain=v2 --branch -z`. Unknown record types are skipped rather than
 * failing, so a future git that adds one degrades gracefully instead of blanking the view.
 */
export function parseStatus(raw: string): GitStatus {
  const status: GitStatus = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const tokens = raw.split('\0');

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t) continue;

    if (t.startsWith('# ')) {
      const [, key, ...rest] = t.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') status.oid = value === '(initial)' ? null : value;
      else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') status.upstream = value || null;
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) { status.ahead = Number(m[1]); status.behind = Number(m[2]); }
      }
      continue;
    }

    const kind = t[0];
    if (kind === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = t.split(' ');
      const xy = parts[1] ?? '..';
      status.files.push({
        path: parts.slice(8).join(' '),
        index: code(xy[0]), worktree: code(xy[1]), conflicted: false, untracked: false,
      });
    } else if (kind === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>, then the original path as the next token.
      const parts = t.split(' ');
      const xy = parts[1] ?? '..';
      const origPath = tokens[++i] ?? '';
      status.files.push({
        path: parts.slice(9).join(' '), origPath,
        index: code(xy[0]), worktree: code(xy[1]), conflicted: false, untracked: false,
      });
    } else if (kind === 'u') {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = t.split(' ');
      status.files.push({
        path: parts.slice(10).join(' '),
        index: 'conflict', worktree: 'conflict', conflicted: true, untracked: false,
      });
    } else if (kind === '?') {
      status.files.push({ path: t.slice(2), index: 'unmodified', worktree: 'untracked', conflicted: false, untracked: true });
    }
    // '!' (ignored) and anything unknown: not shown.
  }
  return status;
}

/** Files with something staged — what the next commit would contain. */
export const stagedFiles = (s: GitStatus): GitFile[] =>
  s.files.filter((f) => !f.conflicted && !f.untracked && f.index !== 'unmodified');

/** Files with changes not yet staged, including brand-new untracked files. */
export const unstagedFiles = (s: GitStatus): GitFile[] =>
  s.files.filter((f) => !f.conflicted && (f.untracked || f.worktree !== 'unmodified'));

export const conflictedFiles = (s: GitStatus): GitFile[] => s.files.filter((f) => f.conflicted);

/** The one-letter badge VS Code users already read at a glance. */
export function letterFor(c: GitCode): string {
  switch (c) {
    case 'modified': return 'M';
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'copied': return 'C';
    case 'typechange': return 'T';
    case 'untracked': return 'U';
    case 'conflict': return '!';
    default: return '';
  }
}

/**
 * The open folder can be a subfolder of the repository. Git speaks in repo-root paths; the IDE only
 * works inside its folder. This maps one to the other — or returns null for a change that lives
 * outside the open folder, which is shown in the list but cannot be opened or touched from here.
 *
 * `prefix` is what `git rev-parse --show-prefix` prints: '' at the root, otherwise e.g. 'app/src/'.
 */
export function toWorkspacePath(repoPath: string, prefix: string): string | null {
  const p = prefix.replace(/\\/g, '/');
  if (!p) return repoPath;
  return repoPath.startsWith(p) ? repoPath.slice(p.length) : null;
}

export const toRepoPath = (workspacePath: string, prefix: string): string =>
  `${prefix.replace(/\\/g, '/')}${workspacePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;

/** A commit message worth sending: trimmed, and not just whitespace or comment lines. */
export function commitMessageProblem(message: string): string | null {
  const meaningful = message.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n').trim();
  if (!meaningful) return 'Write a commit message first.';
  if (meaningful.length > 10_000) return 'That commit message is unusually long — shorten it.';
  return null;
}

/** "main ↑2 ↓1" — the status-bar summary. */
export function branchSummary(s: GitStatus): string {
  const name = s.branch ?? (s.oid ? `detached @ ${s.oid.slice(0, 7)}` : 'no commits yet');
  const sync = [s.ahead ? `↑${s.ahead}` : '', s.behind ? `↓${s.behind}` : ''].filter(Boolean).join(' ');
  return sync ? `${name} ${sync}` : name;
}
