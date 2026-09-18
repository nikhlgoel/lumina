// The dependency-free heart of the embedded IDE: what counts as a safe path inside the open folder,
// how files are named and sorted, which language a file is, and how the open-tab strip behaves.
// Pure, so all of it is unit-tested before a single pixel of editor exists.

/* ---------- path safety ---------- */

/** Normalise separators and collapse '.' / '..' without touching the filesystem. */
export function normalizePath(p: string): string {
  const win = /^[a-zA-Z]:[\\/]/.test(p);
  const drive = win ? p.slice(0, 2).toUpperCase() : '';
  const rest = win ? p.slice(2) : p;
  const absolute = /^[\\/]/.test(rest);
  const out: string[] = [];
  for (const seg of rest.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      // A '..' that would escape the root is dropped, not applied — callers treat the result as
      // untrusted anyway, but this keeps the normalised form free of traversal segments.
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute && !win) out.push('..');
      continue;
    }
    out.push(seg);
  }
  const joined = out.join('/');
  if (win) return `${drive}/${joined}`;
  return absolute ? `/${joined}` : joined;
}

/**
 * True only when `target` is the workspace root itself or genuinely inside it.
 * This is the guard every file read and write goes through: without it, a crafted path from the
 * renderer could reach anywhere on the disk. Comparison is case-insensitive on Windows paths.
 */
export function isInsideWorkspace(root: string, target: string): boolean {
  if (!root || !target) return false;
  const win = /^[a-zA-Z]:[\\/]/.test(root);
  const fold = (s: string) => (win ? normalizePath(s).toLowerCase() : normalizePath(s));
  const r = fold(root).replace(/\/+$/, '');
  const t = fold(target);
  if (!r) return false;
  return t === r || t.startsWith(`${r}/`);
}

/** Path relative to the root, using '/' — what the UI shows and what tabs are keyed by. */
export function relativeToWorkspace(root: string, target: string): string {
  if (!isInsideWorkspace(root, target)) return normalizePath(target);
  const r = normalizePath(root).replace(/\/+$/, '');
  const t = normalizePath(target);
  return t === r ? '' : t.slice(r.length + 1);
}

/* ---------- naming and language ---------- */

export const baseName = (p: string) => normalizePath(p).split('/').filter(Boolean).pop() ?? '';

/** Extension without the dot, lower-cased; '' for a dotfile or a file with no extension. */
export function extensionOf(p: string): string {
  const name = baseName(p);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  md: 'markdown', markdown: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', swift: 'swift', dart: 'dart', lua: 'lua', r: 'r', sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', env: 'ini',
  dockerfile: 'dockerfile', gradle: 'groovy', vue: 'html', svelte: 'html',
};

/** Files recognised by name rather than extension. */
const LANGUAGE_BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile', makefile: 'makefile', '.gitignore': 'ini', '.env': 'ini',
  '.editorconfig': 'ini', 'cargo.lock': 'ini', 'go.sum': 'ini',
};

/** Monaco language id for a file, or 'plaintext' when nothing matches. */
export function languageForFile(p: string): string {
  const name = baseName(p).toLowerCase();
  const byName = LANGUAGE_BY_NAME[name];
  if (byName) return byName;
  return LANGUAGE_BY_EXT[extensionOf(p)] ?? 'plaintext';
}

/* ---------- the file tree ---------- */

export interface TreeEntry {
  name: string;
  /** Path relative to the workspace root, '/'-joined. */
  path: string;
  kind: 'file' | 'directory';
}

/** Folders that only ever add noise to a project tree. */
export const NOISE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', 'target', '.next', '.nuxt',
  '.cache', '.turbo', '.venv', '__pycache__', '.gradle', '.idea', 'coverage', 'release',
]);

export const isNoiseDir = (name: string) => NOISE_DIRS.has(name.toLowerCase());

/**
 * Directories first, then files, each naturally sorted so "file10" follows "file9" and a leading
 * dot doesn't push dotfiles to the top of the list.
 */
export function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  const key = (e: TreeEntry) => e.name.replace(/^\./, '').toLowerCase();
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: 'base' });
  });
}

/* ---------- open tabs ---------- */

export interface Tab {
  /** Workspace-relative path; unique, and what the editor model is keyed by. */
  path: string;
  /** Unsaved edits are in the buffer. */
  dirty: boolean;
  /** A preview tab is replaced by the next single-click open, the way VS Code's italic tabs work. */
  preview: boolean;
}

export interface TabState {
  tabs: Tab[];
  /** Path of the active tab, or null when nothing is open. */
  active: string | null;
}

export const emptyTabs = (): TabState => ({ tabs: [], active: null });

/**
 * Open a file. An already-open tab is just activated (and promoted out of preview when the open is
 * permanent). A new preview tab replaces the existing preview tab rather than piling up.
 */
export function openTab(state: TabState, path: string, opts: { preview?: boolean } = {}): TabState {
  const preview = opts.preview ?? false;
  const existing = state.tabs.find((t) => t.path === path);
  if (existing) {
    return {
      tabs: state.tabs.map((t) => (t.path === path && !preview ? { ...t, preview: false } : t)),
      active: path,
    };
  }
  const next: Tab = { path, dirty: false, preview };
  if (preview) {
    const replaceAt = state.tabs.findIndex((t) => t.preview && !t.dirty);
    if (replaceAt >= 0) {
      const tabs = [...state.tabs];
      tabs[replaceAt] = next;
      return { tabs, active: path };
    }
  }
  return { tabs: [...state.tabs, next], active: path };
}

/** Close a tab, moving focus to its neighbour — the one on the right, else the one on the left. */
export function closeTab(state: TabState, path: string): TabState {
  const index = state.tabs.findIndex((t) => t.path === path);
  if (index < 0) return state;
  const tabs = state.tabs.filter((t) => t.path !== path);
  if (state.active !== path) return { tabs, active: state.active };
  const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
  return { tabs, active: neighbour ? neighbour.path : null };
}

export function activateTab(state: TabState, path: string): TabState {
  return state.tabs.some((t) => t.path === path) ? { ...state, active: path } : state;
}

/** Flag or clear unsaved changes. A dirty tab is never a preview tab. */
export function setDirty(state: TabState, path: string, dirty: boolean): TabState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.path === path ? { ...t, dirty, preview: dirty ? false : t.preview } : t)),
  };
}

export const dirtyPaths = (state: TabState): string[] => state.tabs.filter((t) => t.dirty).map((t) => t.path);

/* ---------- terminal shell choice ---------- */

export interface ShellChoice {
  id: string;
  label: string;
  /** Executable to run; resolved against the candidates that actually exist. */
  command: string;
  args: string[];
}

/**
 * The shells worth offering on each platform, best first. On Windows the order deliberately puts
 * WSL and Git Bash above PowerShell: this is a developer terminal, and POSIX tooling is what the
 * project's own scripts assume.
 */
export function shellCandidates(platform: NodeJS.Platform): ShellChoice[] {
  if (platform === 'win32') {
    return [
      { id: 'wsl', label: 'WSL', command: 'wsl.exe', args: [] },
      { id: 'git-bash', label: 'Git Bash', command: 'C:/Program Files/Git/bin/bash.exe', args: ['--login', '-i'] },
      { id: 'pwsh', label: 'PowerShell 7', command: 'pwsh.exe', args: ['-NoLogo'] },
      { id: 'powershell', label: 'Windows PowerShell', command: 'powershell.exe', args: ['-NoLogo'] },
      { id: 'cmd', label: 'Command Prompt', command: 'cmd.exe', args: [] },
    ];
  }
  if (platform === 'darwin') {
    return [
      { id: 'zsh', label: 'zsh', command: '/bin/zsh', args: ['-l'] },
      { id: 'bash', label: 'bash', command: '/bin/bash', args: ['-l'] },
      { id: 'sh', label: 'sh', command: '/bin/sh', args: [] },
    ];
  }
  return [
    { id: 'bash', label: 'bash', command: '/bin/bash', args: ['-l'] },
    { id: 'zsh', label: 'zsh', command: '/usr/bin/zsh', args: ['-l'] },
    { id: 'sh', label: 'sh', command: '/bin/sh', args: [] },
  ];
}

/**
 * Pick the shell to launch: the user's preference when it's actually available, otherwise the best
 * candidate that is. `available` is the set of ids the main process confirmed exist on this machine.
 */
export function pickShell(platform: NodeJS.Platform, available: Set<string>, preferred?: string): ShellChoice | null {
  const candidates = shellCandidates(platform);
  if (preferred) {
    const wanted = candidates.find((c) => c.id === preferred && available.has(c.id));
    if (wanted) return wanted;
  }
  return candidates.find((c) => available.has(c.id)) ?? null;
}

/* ---------- fuzzy matching (quick open, command palette) ---------- */

export interface FuzzyMatch {
  /** Higher is better. */
  score: number;
  /** Indices in the target that matched, for highlighting. */
  positions: number[];
}

/**
 * Subsequence match with the scoring people expect from a quick-open box: consecutive characters
 * and matches right after a separator (/, -, _, .) or at a camelCase boundary count for much more,
 * so "sid" finds "src/index.ts" ahead of an incidental scatter of those letters.
 * Returns null when the query isn't a subsequence of the target at all.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, positions: [] };
  // Work in code points, comparing one character at a time on the ORIGINAL strings. Lowercasing the
  // whole target first looked equivalent but was not: some characters grow when lowercased ('İ'
  // becomes two code units), which shifted every index after them — and crashed on an index past
  // the end. Positions are code-point indices, which is also what the highlighter iterates.
  // Both bugs were found by the property tests in tests/properties.test.ts.
  const t = [...target];
  const lower = t.map((c) => c.toLowerCase());
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let lastMatch = -2;

  for (const qc of query) {
    // Spaces in a query are just separators between fragments.
    if (qc === ' ') continue;
    const ql = qc.toLowerCase();
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === qc || lower[i] === ql) { found = i; break; }
    }
    if (found < 0) return null;

    let bonus = 1;
    if (found === lastMatch + 1) bonus += 8;          // consecutive run
    const prev = found > 0 ? t[found - 1]! : '';
    const cur = t[found]!;
    if (found === 0) bonus += 10;                      // start of the string
    else if ('/\-_. '.includes(prev)) bonus += 7;   // after a separator
    else if (prev === prev.toLowerCase() && cur === cur.toUpperCase() && /[a-z]/i.test(prev)) bonus += 5; // camelCase hump
    // Later matches are worth slightly less, so earlier hits win an otherwise equal race.
    score += bonus - Math.min(found * 0.01, 3);

    positions.push(found);
    lastMatch = found;
    ti = found + 1;
  }

  // A short target that used most of its characters is a tighter match than a long one.
  score += Math.max(0, 10 - (t.length - positions.length) * 0.05);
  return { score, positions };
}

export interface Ranked<T> {
  item: T;
  score: number;
  positions: number[];
}

/** Filter and rank a list by a fuzzy query, best first. An empty query keeps the original order. */
export function fuzzyRank<T>(items: T[], query: string, textOf: (item: T) => string, limit = 50): Ranked<T>[] {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }));
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const m = fuzzyMatch(query, textOf(item));
    if (m) out.push({ item, score: m.score, positions: m.positions });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
