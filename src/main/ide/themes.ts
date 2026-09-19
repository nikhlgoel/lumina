// Imported editor themes: reading a VS Code colour theme off disk and keeping it.
//
// A VS Code *colour theme* is data, not code — a JSON file of hex values. That is the whole reason
// this is safe to support when running actual extensions is not:
//
//   * Nothing from an imported file is ever executed. It is parsed as JSON, run through
//     `convertVsCodeTheme` in @core/theme (which validates every colour), and stored as our own
//     normalised shape. A malformed colour is dropped, not passed to Monaco, which would throw.
//   * A `.vsix` is just a zip. We extract ONLY `themes/*.json` (and the manifest, to read the
//     theme's declared name), using the 7-Zip we already bundle, into a scratch folder that is
//     removed afterwards. Nothing from the archive is installed or run.
//   * Imported themes live in `userData/themes/<id>.json` as *our* format, so a later Lumina never
//     has to re-parse a foreign file.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { app } from 'electron';
import { convertVsCodeTheme, BUILT_IN_THEMES, type EditorTheme } from '../../core/theme';
import { dataDir } from '../paths';
import { tools } from '../tools';
import { logger } from '../log';

const log = logger('themes');

/** A theme file bigger than this is not a theme; refuse it rather than parsing megabytes. */
const MAX_THEME_BYTES = 2 << 20;

const themesDir = () => {
  const dir = path.join(dataDir(), 'themes');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

/** Filesystem-safe, collision-resistant id derived from the theme's name. */
function idFor(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'theme';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function listImportedThemes(): EditorTheme[] {
  const out: EditorTheme[] = [];
  let entries: string[];
  try {
    entries = readdirSync(themesDir());
  } catch {
    return out;
  }
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    try {
      const theme = JSON.parse(readFileSync(path.join(themesDir(), file), 'utf8')) as EditorTheme;
      // Trust nothing on disk: it must still look like one of ours.
      if (theme && typeof theme.id === 'string' && theme.ui && theme.tokens && theme.terminal) {
        out.push({ ...theme, source: 'imported' });
      }
    } catch (err) {
      log.warn(`Ignoring unreadable theme ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Built-ins first, then imports — the order the picker shows. */
export const listThemes = (): EditorTheme[] => [...BUILT_IN_THEMES, ...listImportedThemes()];

function takenIds(): Set<string> {
  return new Set(listThemes().map((t) => t.id));
}

function save(theme: EditorTheme): EditorTheme {
  writeFileSync(path.join(themesDir(), `${theme.id}.json`), JSON.stringify(theme, null, 2), 'utf8');
  log.info(`Imported theme "${theme.name}" (${theme.id}, ${theme.kind})`);
  return theme;
}

/** Pull `themes/*.json` out of a .vsix with the bundled 7-Zip. Returns the extraction directory. */
function extractVsix(file: string): string {
  const seven = tools.require('7z');
  const out = path.join(app.getPath('temp'), `lumina-theme-${Date.now()}`);
  mkdirSync(out, { recursive: true });
  // -y assume yes, -o output dir. Only the paths we name are extracted.
  const res = spawnSync(seven, ['x', file, `-o${out}`, 'extension/themes/*', 'extension/package.json', '-y'], {
    windowsHide: true,
    timeout: 60_000,
  });
  if (res.error) throw new Error(`Could not open that .vsix: ${res.error.message}`);
  return out;
}

function themeJsonFilesIn(dir: string): string[] {
  const themes = path.join(dir, 'extension', 'themes');
  if (!existsSync(themes)) return [];
  return readdirSync(themes)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(themes, f));
}

/** Read one JSON file as a theme, tolerating the comments VS Code themes are allowed to contain. */
function parseThemeFile(file: string): unknown {
  const raw = readFileSync(file, 'utf8');
  if (raw.length > MAX_THEME_BYTES) throw new Error('That file is too large to be a colour theme.');
  try {
    return JSON.parse(raw);
  } catch {
    // Many published themes are JSONC. Strip line comments and trailing commas, then retry once.
    const stripped = raw
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
  }
}

export interface ImportResult {
  imported: EditorTheme[];
  skipped: string[];
}

/**
 * Import every colour theme in a `.json` or `.vsix` the user picked.
 *
 * A .vsix can legitimately contain several themes (light and dark variants), so this returns a list
 * rather than one theme, and reports what it could not read instead of failing the whole import.
 */
export function importThemeFile(file: string): ImportResult {
  const ext = path.extname(file).toLowerCase();
  const imported: EditorTheme[] = [];
  const skipped: string[] = [];
  const taken = takenIds();

  const absorb = (jsonFile: string) => {
    const label = path.basename(jsonFile);
    try {
      const raw = parseThemeFile(jsonFile);
      const name = (raw as { name?: string })?.name || path.parse(jsonFile).name;
      const id = idFor(String(name), taken);
      const result = convertVsCodeTheme(raw, id, String(name));
      if (!result.ok) {
        skipped.push(`${label}: ${result.reason}`);
        return;
      }
      taken.add(id);
      imported.push(save(result.theme));
    } catch (err) {
      skipped.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (ext === '.vsix') {
    const dir = extractVsix(file);
    try {
      const files = themeJsonFilesIn(dir);
      if (files.length === 0) throw new Error('That extension contains no colour themes.');
      for (const f of files) absorb(f);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else if (ext === '.json' || ext === '.jsonc') {
    absorb(file);
  } else {
    throw new Error('Pick a VS Code colour theme (.json) or a theme extension (.vsix).');
  }

  if (imported.length === 0) {
    throw new Error(skipped[0] ?? 'Nothing in that file could be read as a colour theme.');
  }
  return { imported, skipped };
}

/** Remove an imported theme. Built-ins cannot be removed, so this quietly ignores them. */
export function removeTheme(id: string): boolean {
  if (BUILT_IN_THEMES.some((t) => t.id === id)) return false;
  const file = path.join(themesDir(), `${path.basename(id)}.json`);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  log.info(`Removed theme "${id}"`);
  return true;
}
