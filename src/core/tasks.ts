// Running the project you have open: which scripts exist, how to invoke them, and what URL the
// thing you just started is listening on.
//
// All pure so it can be tested hard, because the interesting parts are exactly the fiddly ones:
// picking the right package manager from a lockfile, and pulling a usable URL out of a dev server's
// banner when that banner is full of ANSI colour codes and box-drawing characters.

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

export interface ProjectTask {
  /** Script name as written in package.json. */
  name: string;
  /** The command line the script runs, shown so nobody has to guess what a name does. */
  command: string;
}

/** Lockfile → package manager. The lockfile is the honest signal; `packageManager` is often absent. */
const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/**
 * Work out the package manager from the files in the project root.
 *
 * A `packageManager` field wins when present, since that is the project stating its intent. When
 * several lockfiles exist (it happens), the order above decides, and npm is the fallback because
 * it is the one that always exists.
 */
export function detectPackageManager(files: string[], packageManagerField?: string): PackageManager {
  const declared = (packageManagerField ?? '').trim().toLowerCase();
  for (const pm of ['pnpm', 'yarn', 'bun', 'npm'] as PackageManager[]) {
    if (declared.startsWith(`${pm}@`) || declared === pm) return pm;
  }
  const present = new Set(files.map((f) => f.toLowerCase()));
  for (const [file, pm] of LOCKFILES) {
    if (present.has(file)) return pm;
  }
  return 'npm';
}

/** The scripts from a package.json, in the order the file lists them. */
export function parseScripts(raw: unknown): ProjectTask[] {
  if (!raw || typeof raw !== 'object') return [];
  const scripts = (raw as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return [];
  const out: ProjectTask[] = [];
  for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (!name.trim() || typeof command !== 'string') continue;
    out.push({ name, command: command.slice(0, 500) });
  }
  return out;
}

/**
 * The command line to run a script with.
 *
 * This is a string on purpose: it is typed into the user's own shell, so what they see in the
 * terminal is exactly what they would have typed, and Ctrl+C behaves normally.
 */
export function runCommand(pm: PackageManager, script: string): string {
  // `npm run x` needs "run"; pnpm/yarn/bun accept the bare name, but "run" is valid for all of them
  // and avoids a script named e.g. "add" colliding with a built-in subcommand.
  return `${pm} run ${script}`;
}

/* ---------- reading a dev server's output ---------- */

// Matches CSI sequences (colours, cursor moves) and OSC sequences (window titles, hyperlinks).
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;?]*[ -/]*[@-~]|\][^]*(?:|\\)/g;

/** Remove terminal escape codes so a line can be pattern-matched as plain text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export interface DetectedUrl {
  url: string;
  port: number;
  /** Loopback URLs can be opened in Lumina's own browser; anything else is just reported. */
  local: boolean;
}

// Deliberately narrow: an http(s) URL with an explicit port. Dev servers always print one, and
// requiring it avoids matching every documentation link a build tool happens to log.
const URL_RE = /\bhttps?:\/\/[A-Za-z0-9._-]+:\d{2,5}(?:\/[^\s"'`<>)\]]*)?/g;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '::']);

/**
 * Pull every server URL out of a chunk of terminal output.
 *
 * `0.0.0.0` is rewritten to `localhost`: servers print the address they bound to, but that is not
 * an address a browser can usefully open.
 */
export function detectUrls(chunk: string): DetectedUrl[] {
  const plain = stripAnsi(chunk);
  const seen = new Map<string, DetectedUrl>();
  for (const match of plain.match(URL_RE) ?? []) {
    // Trailing punctuation from prose like "Server at http://localhost:3000." is not part of it.
    const cleaned = match.replace(/[.,;:!?]+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(cleaned);
    } catch {
      continue;
    }
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const host = parsed.hostname.toLowerCase();
    const local = LOCAL_HOSTS.has(host);
    if (host === '0.0.0.0' || host === '::') parsed.hostname = 'localhost';
    const url = parsed.toString();
    if (!seen.has(url)) seen.set(url, { url, port, local });
  }
  return [...seen.values()];
}

/**
 * Merge newly seen URLs into the list already on screen, newest last and without duplicates.
 *
 * Bounded, because a chatty server that prints its banner on every reload must not grow this
 * without limit.
 */
export function mergeUrls(existing: DetectedUrl[], found: DetectedUrl[], limit = 20): DetectedUrl[] {
  const out = [...existing];
  for (const candidate of found) {
    if (out.some((u) => u.url === candidate.url)) continue;
    out.push(candidate);
  }
  return out.length > limit ? out.slice(out.length - limit) : out;
}
