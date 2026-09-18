// Source control: runs the user's own git against the open folder.
//
// Rules, because this runs a program on the user's repository:
//   * git is spawned with execFile and an argv array — no shell, so a filename can never become a
//     command — and every path goes after `--`, so a file called "-rf" can never become an option.
//   * Every path the renderer sends is checked by the same `resolveInside` guard the file APIs use,
//     then translated to a repository path. Changes outside the open folder are listed read-only.
//   * GIT_TERMINAL_PROMPT=0: git must never sit waiting for a password on a terminal nobody sees.
//   * Nothing here pushes, pulls, resets or deletes a file. Discarding only restores a TRACKED file
//     from the index, and the UI asks first; untracked files are never deleted from here.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { parseStatus, toRepoPath, toWorkspacePath, type GitStatus } from '../../core/git';
import type { GitView } from '../../shared/types';
import { resolveInside, workspaceRoot } from './workspace';
import { logger } from '../log';

const log = logger('git');

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 32 << 20;

interface Result {
  stdout: string;
  stderr: string;
}

function git(args: string[], cwd: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(explain(String(stderr || err.message))));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Turn git's stderr into something a person can act on, keeping git's own words when unsure. */
export function explain(stderr: string): string {
  const text = stderr.trim();
  if (/please tell me who you are|author identity unknown/i.test(text)) {
    return 'Git does not know your name and email yet. In a terminal, run: git config --global user.name "Your Name" and git config --global user.email "you@example.com"';
  }
  if (/nothing to commit|no changes added to commit/i.test(text)) return 'Nothing is staged to commit.';
  if (/index\.lock/i.test(text)) return 'Another git command is running on this repository. Try again in a moment.';
  if (/not a git repository/i.test(text)) return 'This folder is not a git repository.';
  const line = text.split('\n').find((l) => /^(fatal|error):/i.test(l)) ?? text.split('\n')[0] ?? 'Git failed.';
  return line.replace(/^(fatal|error):\s*/i, '').slice(0, 400) || 'Git failed.';
}

let version: string | null | undefined;

async function gitVersion(): Promise<string | null> {
  if (version !== undefined) return version;
  try {
    const { stdout } = await git(['--version'], process.cwd());
    version = stdout.trim().replace(/^git version\s*/, '');
  } catch {
    version = null;
  }
  return version;
}

interface Repo {
  top: string;
  /** The open folder relative to the repository root, e.g. '' or 'app/'. */
  prefix: string;
}

async function repoFor(root: string): Promise<Repo | null> {
  try {
    const { stdout } = await git(['rev-parse', '--show-toplevel', '--show-prefix'], root);
    const [top = '', prefix = ''] = stdout.split('\n').map((l) => l.trim());
    return top ? { top: path.normalize(top), prefix } : null;
  } catch {
    return null;
  }
}

async function requireRepo(): Promise<Repo> {
  const root = workspaceRoot();
  if (!root) throw new Error('No folder is open.');
  const repo = await repoFor(root);
  if (!repo) throw new Error('This folder is not a git repository.');
  return repo;
}

/** Validate workspace paths from the renderer and turn them into repository paths. */
function repoPaths(paths: string[], repo: Repo): string[] {
  if (paths.length === 0) throw new Error('No files were given.');
  return paths.map((p) => {
    resolveInside(p); // throws for anything outside the open folder
    return toRepoPath(p, repo.prefix);
  });
}

export async function gitStatus(): Promise<GitView> {
  const available = await gitVersion();
  if (!available) return { available: false, version: null, repo: null, status: null, files: [] };
  const root = workspaceRoot();
  if (!root) return { available: true, version: available, repo: null, status: null, files: [] };
  const repo = await repoFor(root);
  if (!repo) return { available: true, version: available, repo: null, status: null, files: [] };

  const { stdout } = await git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], repo.top);
  const status: GitStatus = parseStatus(stdout);
  return {
    available: true,
    version: available,
    repo: { top: repo.top, prefix: repo.prefix },
    status,
    files: status.files.map((f) => ({ ...f, workspacePath: toWorkspacePath(f.path, repo.prefix) })),
  };
}

export async function stage(paths: string[]): Promise<GitView> {
  const repo = await requireRepo();
  await git(['add', '--', ...repoPaths(paths, repo)], repo.top);
  log.info(`Staged ${paths.length} file(s)`);
  return gitStatus();
}

export async function unstage(paths: string[]): Promise<GitView> {
  const repo = await requireRepo();
  const targets = repoPaths(paths, repo);
  const view = await gitStatus();
  // `restore --staged` needs a HEAD to restore from; a brand-new repository has none yet.
  if (view.status?.oid) await git(['restore', '--staged', '--', ...targets], repo.top);
  else await git(['rm', '--cached', '-q', '--', ...targets], repo.top);
  log.info(`Unstaged ${paths.length} file(s)`);
  return gitStatus();
}

/**
 * Throw away unstaged edits to TRACKED files by restoring them from the index. The one destructive
 * operation here, so it is narrow on purpose: untracked files are refused, and the UI confirms.
 */
export async function discard(paths: string[]): Promise<GitView> {
  const repo = await requireRepo();
  const targets = repoPaths(paths, repo);
  const view = await gitStatus();
  const untracked = new Set(view.files.filter((f) => f.untracked).map((f) => f.path));
  const refused = targets.filter((t) => untracked.has(t));
  if (refused.length > 0) throw new Error(`${refused[0]} is not tracked by git, so there is nothing to restore it to.`);
  await git(['restore', '--worktree', '--', ...targets], repo.top);
  log.info(`Discarded changes to ${paths.length} file(s)`);
  return gitStatus();
}

export async function commit(message: string): Promise<GitView> {
  const repo = await requireRepo();
  // -m with the message as its own argv entry: multi-line messages survive and nothing is re-parsed.
  await git(['commit', '-m', message], repo.top);
  log.info('Committed');
  return gitStatus();
}

/**
 * The file as HEAD has it — the left side of a diff. Empty for a file that HEAD does not have (new,
 * or no commits yet), which the diff view shows as an all-added file.
 */
export async function original(workspacePath: string): Promise<string> {
  const repo = await requireRepo();
  const [target] = repoPaths([workspacePath], repo);
  try {
    const { stdout } = await git(['show', `HEAD:${target}`], repo.top);
    return stdout;
  } catch {
    return '';
  }
}

export async function init(): Promise<GitView> {
  const root = workspaceRoot();
  if (!root) throw new Error('No folder is open.');
  if (await repoFor(root)) throw new Error('This folder is already inside a git repository.');
  await git(['init'], root);
  log.info(`Initialised a repository in ${root}`);
  return gitStatus();
}
