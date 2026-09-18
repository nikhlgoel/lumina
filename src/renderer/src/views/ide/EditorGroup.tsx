// One editor group: a tab strip and a Monaco editor. Several sit side by side when the user splits.
//
// Buffers are Monaco models shared across groups (see @core/editorGroups), so this component never
// creates or destroys a model — it only chooses which one its editor shows. The parent owns the
// models, the files and saving; a group owns its view: cursor, scroll, and which tab is showing.
import { useCallback, useEffect, useRef } from 'react';
import { Columns2, Save, X } from 'lucide-react';
import type { EditorGroup as Group } from '@core/editorGroups';
import { cn } from '@/lib/cn';
import { loadMonaco, type CodeEditor } from './monaco';

export interface EditorOptions {
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  tabSize: number;
}

/** A location to jump to once this group is showing the file — what a search hit asks for. */
export interface Reveal {
  group: string;
  path: string;
  line: number;
  column: number;
}

export const modelUri = (path: string) => loadMonaco().Uri.parse(`lumina-ide:/${path}`);

export function EditorGroupView({
  group, active, options, busy, canSplit, canCloseGroup, dirty, reveal,
  onEditor, onFocus, onSelect, onClose, onSave, onSplit, onCloseGroup,
}: {
  group: Group;
  active: boolean;
  options: EditorOptions;
  busy: boolean;
  canSplit: boolean;
  canCloseGroup: boolean;
  dirty: (path: string) => boolean;
  /** Read (and cleared) when this group switches to the matching file. */
  reveal: React.RefObject<Reveal | null>;
  onEditor: (id: string, editor: CodeEditor | null) => void;
  onFocus: () => void;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onSave: () => void;
  onSplit: () => void;
  onCloseGroup: () => void;
}) {
  const editor = useRef<CodeEditor | null>(null);
  const shown = group.tabs.active;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;

  /** Point the editor at the active tab's model, and honour a pending jump-to-line. */
  const sync = useCallback(() => {
    const ed = editor.current;
    if (!ed) return;
    const path = shownRef.current;
    const model = path ? loadMonaco().editor.getModel(modelUri(path)) : null;
    if (ed.getModel() !== model) ed.setModel(model);
    const jump = reveal.current;
    if (jump && jump.group === group.id && jump.path === path && model) {
      reveal.current = null;
      ed.revealLineInCenter(jump.line);
      ed.setPosition({ lineNumber: jump.line, column: jump.column });
      ed.focus();
    }
  }, [group.id, reveal]);

  /**
   * Build the editor when its container appears. A callback ref, not a mount effect: that exact
   * difference is what once left the whole editor blank (see HANDOVER, "green checks are not proof").
   */
  const host = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      editor.current?.dispose();
      editor.current = null;
      onEditor(group.id, null);
      return;
    }
    if (editor.current) return;
    const ed = loadMonaco().editor.create(node, {
      theme: 'lumina',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      fontLigatures: true,
    });
    ed.onDidFocusEditorText(() => focusRef.current());
    editor.current = ed;
    onEditor(group.id, ed);
    sync();
    // onEditor and sync are stable for the life of a group; rebuilding the editor would lose its view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { sync(); }, [shown, sync]);

  useEffect(() => {
    editor.current?.updateOptions({
      fontSize: options.fontSize,
      wordWrap: options.wordWrap ? 'on' : 'off',
      minimap: { enabled: options.minimap },
      tabSize: options.tabSize,
    });
  }, [options.fontSize, options.wordWrap, options.minimap, options.tabSize]);

  const unsavedHere = shown ? dirty(shown) : false;

  return (
    <div
      onMouseDownCapture={onFocus}
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col', active && canCloseGroup && 'shadow-[inset_0_2px_0_var(--accent)]')}
    >
      <div className="flex shrink-0 items-stretch border-b border-line bg-panel">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {group.tabs.tabs.map((t) => (
            <div
              key={t.path}
              className={cn('group flex max-w-[220px] shrink-0 items-center gap-2 border-r border-line px-3 py-1.5 text-[13px]',
                group.tabs.active === t.path ? 'bg-sunken text-ink' : 'text-ink-3 hover:bg-hover')}
            >
              <button onClick={() => onSelect(t.path)} className={cn('min-w-0 truncate', t.preview && 'italic')} title={t.path}>
                {t.path.split('/').pop()}
              </button>
              <button onClick={() => onClose(t.path)} aria-label={`Close ${t.path}`}
                className="rounded p-0.5 text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100">
                {t.dirty ? <span className="block size-2 rounded-full bg-accent" aria-hidden /> : <X className="size-3.5" />}
              </button>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 px-1.5">
          {shown && (
            <button onClick={onSave} disabled={busy || !unsavedHere} aria-label="Save" title="Save (Ctrl+S)"
              className="grid size-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40">
              <Save className="size-3.5" />
            </button>
          )}
          <button onClick={onSplit} disabled={!canSplit} aria-label="Split editor right" title="Split editor right (Ctrl+\)"
            className="grid size-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40">
            <Columns2 className="size-3.5" />
          </button>
          {canCloseGroup && (
            <button onClick={onCloseGroup} aria-label="Close this editor group" title="Close this editor group"
              className="grid size-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
        {group.tabs.tabs.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-ink-3">
            Pick a file from the tree to open it.
          </div>
        )}
      </div>
    </div>
  );
}
