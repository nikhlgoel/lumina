// Monaco setup for the embedded IDE.
//
// Two constraints shape this file:
//   1. The renderer's CSP is `script-src 'self'` with no blob:, so Monaco's default worker loader
//      (which builds a blob: URL) would be blocked. Vite's `?worker` imports emit real same-origin
//      files instead, which the existing policy already allows — no CSP loosening needed.
//   2. Monaco ships every language; importing all of them would add megabytes for languages nobody
//      opens here. We pull in the editor core plus the handful of workers that give real IntelliSense
//      and let everything else fall back to plain syntax highlighting.
// `editor.api` is types + API only: no contributions, no CSS, so the editor mounts blank.
// `editor.main` is the real standalone entry — it pulls in the widgets, commands, the
// Monarch tokenizers for every bundled language, and the stylesheet.
import * as monaco from 'monaco-editor/editor/editor.main';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
// In Monaco 0.56 the TypeScript defaults live in the language contribution, not on the editor API.
import { javascriptDefaults, typescriptDefaults } from 'monaco-editor/language/typescript/monaco.contribution';

let ready = false;

/** Monaco asks for a worker per language service; hand it the right one, or the generic editor one. */
function workerFor(label: string): Worker {
  switch (label) {
    case 'json':
      return new JsonWorker();
    case 'css':
    case 'scss':
    case 'less':
      return new CssWorker();
    case 'html':
    case 'handlebars':
    case 'razor':
      return new HtmlWorker();
    case 'typescript':
    case 'javascript':
      return new TsWorker();
    default:
      return new EditorWorker();
  }
}

/**
 * Lumina's own colours as a Monaco theme, so the editor doesn't look like a foreign window pasted
 * into the app. Reads the live CSS custom properties, so it follows the user's accent and theme.
 */
function defineTheme(dark: boolean) {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  monaco.editor.defineTheme('lumina', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': read('--color-panel', dark ? '#16151a' : '#ffffff'),
      'editor.foreground': read('--color-ink', dark ? '#e9e7ef' : '#1b1a1f'),
      'editorLineNumber.foreground': read('--color-ink-3', '#8b8794'),
      'editorGutter.background': read('--color-panel', dark ? '#16151a' : '#ffffff'),
      'editor.lineHighlightBackground': read('--color-hover', dark ? '#1e1d24' : '#f4f2ef'),
      'editorCursor.foreground': read('--color-accent', '#e8752f'),
      'editor.selectionBackground': read('--color-accent-soft', dark ? '#3a2a1e' : '#fbe6d6'),
    },
  });
}

/** True when the app is currently in dark mode, by the same signal the rest of the UI uses. */
const isDark = () => document.documentElement.dataset.theme !== 'light';

/**
 * Prepare Monaco once, then hand back the API. Safe to call repeatedly — the worker wiring and
 * theme definition only happen on the first call.
 */
export function loadMonaco(): typeof monaco {
  if (!ready) {
    (self as unknown as { MonacoEnvironment: { getWorker: (id: string, label: string) => Worker } }).MonacoEnvironment = {
      getWorker: (_id, label) => workerFor(label),
    };
    defineTheme(isDark());
    // Editing a project on disk: the in-browser TypeScript service has no node_modules, so its
    // "cannot find module" noise would be wrong far more often than right. Syntax errors still show.
    for (const defaults of [typescriptDefaults, javascriptDefaults]) {
      defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    }
    ready = true;
  }
  return monaco;
}

/** Re-read the app's colours after a theme switch and re-apply them to every open editor. */
export function refreshTheme() {
  if (!ready) return;
  defineTheme(isDark());
  monaco.editor.setTheme('lumina');
}

export type MonacoApi = typeof monaco;
export type CodeEditor = monaco.editor.IStandaloneCodeEditor;
export type TextModel = monaco.editor.ITextModel;
