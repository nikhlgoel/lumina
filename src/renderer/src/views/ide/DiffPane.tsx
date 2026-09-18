// A side-by-side diff of a file against HEAD, using Monaco's own diff editor.
//
// The right-hand side is the LIVE buffer — the same shared model the editor groups use — so editing
// in a diff edits the file, marks it unsaved, and Ctrl+S saves it, exactly as in VS Code. The left
// side is a throwaway read-only model holding HEAD's version, disposed when the diff closes.
import { useCallback, useEffect, useRef } from 'react';
import { GitCompare, X } from 'lucide-react';
import { languageForFile } from '@core/ide';
import { loadMonaco } from './monaco';
import { modelUri, type EditorOptions } from './EditorGroup';

export interface DiffTarget {
  path: string;
  /** HEAD's version of the file; '' for a file HEAD does not have. */
  original: string;
  /** The file no longer exists on disk, so the right side is an empty read-only placeholder. */
  deleted: boolean;
}

type DiffEditor = ReturnType<ReturnType<typeof loadMonaco>['editor']['createDiffEditor']>;

export function DiffPane({ target, options, onClose }: { target: DiffTarget; options: EditorOptions; onClose: () => void }) {
  const diff = useRef<DiffEditor | null>(null);
  /** Models this pane created and must dispose — never the shared live buffer. */
  const owned = useRef<{ dispose: () => void }[]>([]);

  const attach = useCallback(() => {
    const ed = diff.current;
    if (!ed) return;
    const monaco = loadMonaco();
    const language = languageForFile(target.path);
    const previous = owned.current;
    owned.current = [];

    const original = monaco.editor.createModel(target.original, language, monaco.Uri.parse(`lumina-git:/HEAD/${target.path}?${Date.now()}`));
    owned.current.push(original);

    let modified = target.deleted ? null : monaco.editor.getModel(modelUri(target.path));
    if (!modified) {
      modified = monaco.editor.createModel('', language, monaco.Uri.parse(`lumina-git:/deleted/${target.path}?${Date.now()}`));
      owned.current.push(modified);
    }
    ed.setModel({ original, modified });
    ed.getModifiedEditor().updateOptions({ readOnly: target.deleted });
    // Swap first, then dispose: disposing a model still attached to an editor throws.
    for (const m of previous) m.dispose();
  }, [target]);

  const host = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      diff.current?.dispose();
      diff.current = null;
      for (const m of owned.current) m.dispose();
      owned.current = [];
      return;
    }
    if (diff.current) return;
    diff.current = loadMonaco().editor.createDiffEditor(node, {
      theme: 'lumina',
      automaticLayout: true,
      renderSideBySide: true,
      originalEditable: false,
      scrollBeyondLastLine: false,
      renderOverviewRuler: true,
    });
    // Models are attached by the effect below, which runs right after this. Attaching here as well
    // swapped the models twice on open, disposing the first pair while Monaco was still diffing
    // them — the "no diff result available" error seen in the first capture.
  }, []);

  useEffect(() => { attach(); }, [attach]);

  useEffect(() => {
    diff.current?.updateOptions({ fontSize: options.fontSize, wordWrap: options.wordWrap ? 'on' : 'off' });
  }, [options.fontSize, options.wordWrap]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-[33px] shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-[13px]">
        <GitCompare className="size-3.5 text-ink-3" />
        <span className="truncate font-semibold">{target.path.split('/').pop()}</span>
        <span className="truncate text-[12px] text-ink-3">HEAD ↔ {target.deleted ? 'deleted' : 'working copy'}</span>
        <button onClick={onClose} aria-label="Close diff" title="Close diff" className="ml-auto grid size-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
      </div>
    </div>
  );
}
