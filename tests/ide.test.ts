import { describe, it, expect } from 'vitest';
import {
  activateTab, baseName, closeTab, dirtyPaths, emptyTabs, extensionOf, isInsideWorkspace, isNoiseDir,
  languageForFile, normalizePath, openTab, pickShell, relativeToWorkspace, setDirty, shellCandidates,
  sortEntries, fuzzyMatch, fuzzyRank, type TreeEntry,
} from '@core/ide';

describe('normalizePath', () => {
  it('uses forward slashes and upper-cases a Windows drive', () => {
    expect(normalizePath('c:\\Users\\me\\proj')).toBe('C:/Users/me/proj');
    expect(normalizePath('/home/me/proj')).toBe('/home/me/proj');
  });

  it('collapses redundant separators and "." segments', () => {
    expect(normalizePath('/a//b/./c')).toBe('/a/b/c');
  });

  it('resolves ".." and never leaves a traversal segment in an absolute path', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c');
    expect(normalizePath('C:/a/../../../x')).toBe('C:/x');
  });
});

describe('isInsideWorkspace', () => {
  const root = 'C:/Users/me/proj';

  it('accepts the root itself and files within it', () => {
    expect(isInsideWorkspace(root, root)).toBe(true);
    expect(isInsideWorkspace(root, 'C:/Users/me/proj/src/index.ts')).toBe(true);
    expect(isInsideWorkspace(root, 'C:\\Users\\me\\proj\\src\\index.ts')).toBe(true);
  });

  it('is case-insensitive for Windows paths', () => {
    expect(isInsideWorkspace(root, 'c:/users/ME/PROJ/src/a.ts')).toBe(true);
  });

  it('rejects traversal out of the workspace — the whole point of the guard', () => {
    expect(isInsideWorkspace(root, 'C:/Users/me/proj/../secrets.txt')).toBe(false);
    expect(isInsideWorkspace(root, 'C:/Users/me/proj/src/../../../Windows/System32/config')).toBe(false);
    expect(isInsideWorkspace(root, 'C:/Users/me/other/file.ts')).toBe(false);
  });

  it('rejects a sibling folder that merely shares the root’s prefix', () => {
    expect(isInsideWorkspace(root, 'C:/Users/me/proj-evil/file.ts')).toBe(false);
    expect(isInsideWorkspace(root, 'C:/Users/me/project/file.ts')).toBe(false);
  });

  it('is case-sensitive on POSIX, where the filesystem is', () => {
    expect(isInsideWorkspace('/home/me/proj', '/home/me/proj/a.ts')).toBe(true);
    expect(isInsideWorkspace('/home/me/proj', '/home/ME/proj/a.ts')).toBe(false);
  });

  it('refuses empty input rather than defaulting to permissive', () => {
    expect(isInsideWorkspace('', '/anything')).toBe(false);
    expect(isInsideWorkspace('/root', '')).toBe(false);
  });

  it('tolerates a trailing separator on the root', () => {
    expect(isInsideWorkspace('C:/Users/me/proj/', 'C:/Users/me/proj/a.ts')).toBe(true);
  });
});

describe('relativeToWorkspace', () => {
  it('returns the path inside the root, slash-joined', () => {
    expect(relativeToWorkspace('C:/p', 'C:/p/src/a.ts')).toBe('src/a.ts');
    expect(relativeToWorkspace('C:/p', 'C:/p')).toBe('');
  });

  it('leaves an outside path alone rather than inventing a relative one', () => {
    expect(relativeToWorkspace('C:/p', 'D:/other/a.ts')).toBe('D:/other/a.ts');
  });
});

describe('baseName and extensionOf', () => {
  it('reads the last segment and its extension', () => {
    expect(baseName('C:/p/src/App.tsx')).toBe('App.tsx');
    expect(extensionOf('C:/p/src/App.tsx')).toBe('tsx');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('treats a dotfile as having no extension', () => {
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('weird.')).toBe('');
  });
});

describe('languageForFile', () => {
  it('maps the common source extensions', () => {
    expect(languageForFile('a.ts')).toBe('typescript');
    expect(languageForFile('a.tsx')).toBe('typescript');
    expect(languageForFile('a.PY')).toBe('python');
    expect(languageForFile('a.rs')).toBe('rust');
    expect(languageForFile('a.ps1')).toBe('powershell');
  });

  it('recognises files that have no extension by name', () => {
    expect(languageForFile('C:/p/Dockerfile')).toBe('dockerfile');
    expect(languageForFile('/p/Makefile')).toBe('makefile');
    expect(languageForFile('/p/.gitignore')).toBe('ini');
  });

  it('falls back to plaintext instead of guessing', () => {
    expect(languageForFile('notes.qqq')).toBe('plaintext');
    expect(languageForFile('LICENSE')).toBe('plaintext');
  });
});

describe('sortEntries', () => {
  const e = (name: string, kind: TreeEntry['kind']): TreeEntry => ({ name, path: name, kind });

  it('puts directories before files', () => {
    const out = sortEntries([e('b.ts', 'file'), e('a', 'directory')]);
    expect(out.map((x) => x.name)).toEqual(['a', 'b.ts']);
  });

  it('sorts naturally, so file10 comes after file9', () => {
    const out = sortEntries([e('file10.ts', 'file'), e('file9.ts', 'file'), e('file1.ts', 'file')]);
    expect(out.map((x) => x.name)).toEqual(['file1.ts', 'file9.ts', 'file10.ts']);
  });

  it('does not let a leading dot hoist dotfiles to the top', () => {
    const out = sortEntries([e('zebra.ts', 'file'), e('.env', 'file'), e('apple.ts', 'file')]);
    expect(out.map((x) => x.name)).toEqual(['apple.ts', '.env', 'zebra.ts']);
  });

  it('does not mutate its input', () => {
    const input = [e('b', 'file'), e('a', 'file')];
    sortEntries(input);
    expect(input.map((x) => x.name)).toEqual(['b', 'a']);
  });
});

describe('isNoiseDir', () => {
  it('hides build and vendor folders, case-insensitively', () => {
    expect(isNoiseDir('node_modules')).toBe(true);
    expect(isNoiseDir('.GIT')).toBe(true);
    expect(isNoiseDir('dist-electron')).toBe(true);
  });

  it('keeps real source folders', () => {
    expect(isNoiseDir('src')).toBe(false);
    expect(isNoiseDir('distribution')).toBe(false);
  });
});

describe('tabs', () => {
  it('opens, activates and appends', () => {
    let s = openTab(emptyTabs(), 'a.ts');
    s = openTab(s, 'b.ts');
    expect(s.tabs.map((t) => t.path)).toEqual(['a.ts', 'b.ts']);
    expect(s.active).toBe('b.ts');
  });

  it('re-opening an open file just activates it, without duplicating', () => {
    let s = openTab(openTab(emptyTabs(), 'a.ts'), 'b.ts');
    s = openTab(s, 'a.ts');
    expect(s.tabs).toHaveLength(2);
    expect(s.active).toBe('a.ts');
  });

  it('replaces the preview tab instead of piling previews up', () => {
    let s = openTab(emptyTabs(), 'a.ts', { preview: true });
    s = openTab(s, 'b.ts', { preview: true });
    expect(s.tabs.map((t) => t.path)).toEqual(['b.ts']);
    expect(s.active).toBe('b.ts');
  });

  it('promotes a preview tab to permanent when opened for real', () => {
    let s = openTab(emptyTabs(), 'a.ts', { preview: true });
    s = openTab(s, 'a.ts');
    expect(s.tabs[0]).toMatchObject({ path: 'a.ts', preview: false });
  });

  it('never replaces a preview tab that has unsaved edits', () => {
    let s = openTab(emptyTabs(), 'a.ts', { preview: true });
    s = setDirty(s, 'a.ts', true);
    s = openTab(s, 'b.ts', { preview: true });
    expect(s.tabs.map((t) => t.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('marking dirty clears preview, so edits are never silently discarded', () => {
    const s = setDirty(openTab(emptyTabs(), 'a.ts', { preview: true }), 'a.ts', true);
    expect(s.tabs[0]).toMatchObject({ dirty: true, preview: false });
    expect(dirtyPaths(s)).toEqual(['a.ts']);
  });

  it('closing the active tab focuses the tab on its right', () => {
    let s = openTab(openTab(openTab(emptyTabs(), 'a.ts'), 'b.ts'), 'c.ts');
    s = activateTab(s, 'b.ts');
    s = closeTab(s, 'b.ts');
    expect(s.active).toBe('c.ts');
    expect(s.tabs.map((t) => t.path)).toEqual(['a.ts', 'c.ts']);
  });

  it('closing the last tab falls back to the one on its left', () => {
    let s = openTab(openTab(emptyTabs(), 'a.ts'), 'b.ts');
    s = closeTab(s, 'b.ts');
    expect(s.active).toBe('a.ts');
  });

  it('closing an inactive tab leaves focus alone', () => {
    let s = openTab(openTab(emptyTabs(), 'a.ts'), 'b.ts');
    s = closeTab(s, 'a.ts');
    expect(s.active).toBe('b.ts');
  });

  it('closing the only tab leaves nothing active', () => {
    const s = closeTab(openTab(emptyTabs(), 'a.ts'), 'a.ts');
    expect(s.tabs).toEqual([]);
    expect(s.active).toBeNull();
  });

  it('ignores closing or activating an unknown path', () => {
    const s = openTab(emptyTabs(), 'a.ts');
    expect(closeTab(s, 'zzz.ts')).toBe(s);
    expect(activateTab(s, 'zzz.ts')).toBe(s);
  });
});

describe('shell selection', () => {
  it('offers POSIX-first shells on Windows, because the project scripts assume them', () => {
    expect(shellCandidates('win32').map((c) => c.id)).toEqual(['wsl', 'git-bash', 'pwsh', 'powershell', 'cmd']);
  });

  it('picks the best available when there is no preference', () => {
    expect(pickShell('win32', new Set(['powershell', 'cmd']))?.id).toBe('powershell');
    expect(pickShell('win32', new Set(['git-bash', 'cmd']))?.id).toBe('git-bash');
  });

  it('honours a preference that exists', () => {
    expect(pickShell('win32', new Set(['wsl', 'cmd']), 'cmd')?.id).toBe('cmd');
  });

  it('falls back when the preferred shell is not installed', () => {
    expect(pickShell('win32', new Set(['cmd']), 'wsl')?.id).toBe('cmd');
  });

  it('returns null when nothing is available, rather than a broken command', () => {
    expect(pickShell('win32', new Set())).toBeNull();
  });

  it('has sensible defaults on macOS and Linux', () => {
    expect(pickShell('darwin', new Set(['zsh', 'bash']))?.id).toBe('zsh');
    expect(pickShell('linux', new Set(['bash', 'sh']))?.id).toBe('bash');
  });
});

describe('fuzzyMatch', () => {
  it('matches a subsequence and reports where', () => {
    const m = fuzzyMatch('sid', 'src/index.ts');
    expect(m).not.toBeNull();
    expect(m!.positions).toEqual([0, 4, 6]); // s@0, i@4, d@6 in 'src/index.ts'
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('zzz', 'src/index.ts')).toBeNull();
    expect(fuzzyMatch('tsx', 'index.ts')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('IDX', 'index.ts')).not.toBeNull();
  });

  it('treats an empty query as a trivial match', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('scores a consecutive run above a scattered one', () => {
    const run = fuzzyMatch('index', 'src/index.ts')!;
    const scattered = fuzzyMatch('index', 'i-n-d-e-x.ts')!;
    expect(run.score).toBeGreaterThan(scattered.score);
  });

  it('rewards a match right after a separator', () => {
    const afterSep = fuzzyMatch('i', 'src/index.ts')!;
    const midWord = fuzzyMatch('i', 'string.ts')!;
    expect(afterSep.score).toBeGreaterThan(midWord.score);
  });

  it('ignores spaces, so a multi-word query still matches', () => {
    expect(fuzzyMatch('s i', 'src/index.ts')).not.toBeNull();
  });
});

describe('fuzzyRank', () => {
  const files = ['src/index.ts', 'src/main/ipc.ts', 'README.md', 'src/core/ide.ts'];

  it('puts the best match first and drops non-matches', () => {
    const out = fuzzyRank(files, 'ide', (f) => f);
    expect(out[0]!.item).toBe('src/core/ide.ts');
    expect(out.every((r) => r.item.toLowerCase().includes('i'))).toBe(true);
  });

  it('keeps the original order for an empty query', () => {
    expect(fuzzyRank(files, '   ', (f) => f).map((r) => r.item)).toEqual(files);
  });

  it('honours the limit', () => {
    expect(fuzzyRank(files, 's', (f) => f, 2)).toHaveLength(2);
  });

  it('returns nothing when nothing matches', () => {
    expect(fuzzyRank(files, 'qqqq', (f) => f)).toEqual([]);
  });
});
