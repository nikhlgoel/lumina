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
import { toMonacoTheme } from '@core/theme';
import { activeTheme } from '@/lib/editorTheme';

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
 * Apply the active editor theme. The colours come from @core/theme, which is also what the terminal
 * reads, so the editor and the shell below it can never drift apart.
 */
function defineTheme() {
  monaco.editor.defineTheme('lumina', toMonacoTheme(activeTheme()));
}

/**
 * Prepare Monaco once, then hand back the API. Safe to call repeatedly — the worker wiring and
 * theme definition only happen on the first call.
 */
export function loadMonaco(): typeof monaco {
  if (!ready) {
    (self as unknown as { MonacoEnvironment: { getWorker: (id: string, label: string) => Worker } }).MonacoEnvironment = {
      getWorker: (_id, label) => workerFor(label),
    };
    defineTheme();
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
  defineTheme();
  monaco.editor.setTheme('lumina');
}

export type MonacoApi = typeof monaco;
export type CodeEditor = monaco.editor.IStandaloneCodeEditor;
export type TextModel = monaco.editor.ITextModel;
