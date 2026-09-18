// The embedded code editor: a folder tree, open tabs and a Monaco editor.
//
// Buffers live in Monaco's own models, keyed by workspace-relative path, so switching tabs keeps
// undo history and the cursor where they were. Tab bookkeeping is the pure logic in @core/ide, so
// the fiddly rules (preview tabs, focus after close, dirty never previews) are unit-tested there
// rather than tangled up with React state here.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, File as FileIcon, FolderOpen, FolderTree, GitBranch,
} from 'lucide-react';
import type { FileContent, GitFileView, GitView, TreeEntry } from '@shared/types';
import { branchSummary } from '@core/git';
import { languageForFile } from '@core/ide';
import {
  MAX_EDITOR_GROUPS, activeGroup, allDirty, closeGroup, closeIn, focusGroup, initialGroups, isDirtyAnywhere,
  openIn, orphanedBy, setDirtyEverywhere, splitGroup, type EditorGroups,
} from '@core/editorGroups';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Button, EmptyState } from '@/components/ui';
import { TitleBar } from '@/components/Shell';
import { loadMonaco, refreshTheme, type CodeEditor } from './monaco';
import { EditorGroupView, modelUri, type EditorOptions, type Reveal } from './EditorGroup';
import { SourceControl } from './SourceControl';
import { DiffPane, type DiffTarget } from './DiffPane';
import { CommandPalette, QuickOpen, SearchPanel, type Command } from './Palette';
import { TerminalPanel } from './TerminalPanel';
import { LayoutToggles, OpenEditors, PartHeader, Sash, ViewSwitcher } from './IdeChrome';
import {
  dragPart, normalizeLayout, resizeBetween, selectActivity, setVisible, togglePanelMaximized, togglePart,
  type ActivityView, type IdeLayout, type PartId,
} from '@core/ideLayout';

interface Loaded {
  /** mtime the buffer was read at, sent back on save so a change on disk is caught. */
  mtimeMs: number;
  large: boolean;
}

export function IdeView() {
  const toast = useApp((s) => s.toast);
  const colorMode = useApp((s) => s.settings?.appearance.colorMode);
  const ide = useApp((s) => s.settings?.ide);
  const updateSettings = useApp((s) => s.updateSettings);

  const [root, setRoot] = useState('');
  const [name, setName] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  /** Editors side by side, each with its own tabs; buffers are shared (see @core/editorGroups). */
  const [groups, setGroups] = useState<EditorGroups>(() => initialGroups());
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const groupCounter = useRef(1);
  /** Each editor group's share of the row (flex-grow), keyed by group id so a resize sticks. */
  const [groupWeights, setGroupWeights] = useState<Record<string, number>>({});
  const groupsRowRef = useRef<HTMLDivElement | null>(null);
  const groupDrag = useRef<{ ids: string[]; weights: number[]; total: number } | null>(null);
  /** What the active group shows — the status bar, Open Editors and palette read this. */
  const tabs = activeGroup(groups).tabs;
  const [busy, setBusy] = useState(false);
  /** Which overlay is up, if any — only one at a time. */
  const [overlay, setOverlay] = useState<'none' | 'quick-open' | 'commands'>('none');
  /** Which sidebars/panel are open and how big — see @core/ideLayout for every rule. */
  const [layout, setLayout] = useState<IdeLayout>(() => normalizeLayout(ide?.layout));
  const layoutSeeded = useRef(ide !== undefined);
  /** The part's size when the current sash drag began; drags are applied relative to it. */
  const dragOrigin = useRef<{ part: PartId; size: number } | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);

  /** The Monaco instance of each group, so commands can act on whichever one has focus. */
  const editors = useRef(new Map<string, CodeEditor>());
  const loaded = useRef(new Map<string, Loaded>());
  /** A jump-to-line waiting for its group to show the file. */
  const reveal = useRef<Reveal | null>(null);

  /** Git state for the open folder — held here so the status bar shows the branch even when the view is closed. */
  const [gitView, setGitView] = useState<GitView | null>(null);
  /** A diff being shown in place of the editors, or null. */
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);

  /** Re-read git. Cheap, and git is the only source of truth, so this is called freely. */
  const refreshGit = useCallback(() => {
    void call('git:status').then(setGitView).catch(() => setGitView(null));
  }, []);

  /* ---------- workspace ---------- */

  const applyInfo = (info: { root: string; name: string; recent: string[] } | null) => {
    if (!info) return;
    setRoot(info.root);
    setName(info.name);
    setRecent(info.recent);
  };

  useEffect(() => { void call('ide:info').then(applyInfo).catch(() => {}); }, []);

  useEffect(() => {
    if (!root) { setGitView(null); return; }
    refreshGit();
    const onFocus = () => refreshGit();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [root, refreshGit]);

  const openFolder = async (folder?: string) => {
    try {
      const info = await call('ide:open', folder ? { folder } : {});
      if (!info) return; // cancelled
      // A different folder invalidates every open buffer.
      for (const model of loadMonaco().editor.getModels()) model.dispose();
      loaded.current.clear();
      setDiffTarget(null);
      setGroups(initialGroups());
      setGroupWeights({});
      applyInfo(info);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  /* ---------- the editors ---------- */

  const registerEditor = useCallback((id: string, ed: CodeEditor | null) => {
    if (ed) editors.current.set(id, ed);
    else editors.current.delete(id);
  }, []);

  // Settings changes apply live to every group rather than needing the view reopened.
  const editorOptions: EditorOptions = useMemo(() => ({
    fontSize: ide?.fontSize ?? 13,
    wordWrap: ide?.wordWrap ?? false,
    minimap: ide?.minimap ?? true,
    tabSize: ide?.tabSize ?? 2,
  }), [ide?.fontSize, ide?.wordWrap, ide?.minimap, ide?.tabSize]);

  useEffect(() => { refreshTheme(); }, [colorMode]);

  // Colour mode "system" flips the theme without the setting changing, so also follow the attribute
  // App.tsx actually sets — the terminal panel does the same.
  useEffect(() => {
    const observer = new MutationObserver(() => requestAnimationFrame(() => refreshTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  /* ---------- layout ---------- */

  // Settings may arrive after the first render; adopt the stored layout once, then this view owns it.
  useEffect(() => {
    if (layoutSeeded.current || !ide) return;
    layoutSeeded.current = true;
    setLayout(normalizeLayout(ide.layout));
  }, [ide]);

  /** Change the layout and remember it. Drags call `setLayout` directly and persist once, on release. */
  const commitLayout = useCallback((next: IdeLayout | ((l: IdeLayout) => IdeLayout)) => {
    setLayout((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      void updateSettings({ ide: { layout: value as unknown as Record<string, unknown> } });
      return value;
    });
  }, [updateSettings]);

  const toggle = useCallback((part: PartId) => commitLayout((l) => togglePart(l, part)), [commitLayout]);

  /** Open a view in the primary sidebar, never closing it — for shortcuts like Ctrl+Shift+F. */
  const showView = useCallback((view: ActivityView) => {
    commitLayout((l) => ({ ...l, activity: view, primary: { ...l.primary, visible: true } }));
  }, [commitLayout]);

  /** Room the part can grow into: the shell's width for sidebars, the editor column's height for the panel. */
  const available = (part: PartId) => {
    const el = part === 'panel' ? columnRef.current : shellRef.current;
    if (!el) return Infinity;
    return part === 'panel' ? el.clientHeight : el.clientWidth;
  };

  const sashFor = (part: PartId) => ({
    onDragStart: () => { dragOrigin.current = { part, size: layout[part].size }; },
    onDrag: (delta: number) => {
      const origin = dragOrigin.current;
      if (!origin) return;
      setLayout((l) => dragPart(l, part, origin.size, delta, available(part)));
    },
    onDragEnd: () => {
      dragOrigin.current = null;
      commitLayout((l) => l);
    },
  });

  /* ---------- opening and saving files ---------- */

  /** A model is created once per file and shared by every group showing it. */
  const ensureModel = useCallback(async (path: string): Promise<boolean> => {
    const monaco = loadMonaco();
    const uri = modelUri(path);
    if (monaco.editor.getModel(uri)) return true;
    try {
      const file: FileContent = await call('ide:read', { path });
      const model = monaco.editor.createModel(file.text, languageForFile(path), uri);
      loaded.current.set(path, { mtimeMs: file.mtimeMs, large: file.large });
      // One buffer, so one unsaved flag — shown in every group that has the file open.
      model.onDidChangeContent(() => setGroups((g) => setDirtyEverywhere(g, path, true)));
      if (file.large) toast(`${path} is large — the editor may feel slow.`, 'info');
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    }
  }, [toast]);

  const openFile = useCallback(async (path: string, preview = true, group?: string) => {
    if (!(await ensureModel(path))) return;
    setGroups((g) => openIn(g, path, { preview, group }));
  }, [ensureModel]);

  const saveFile = useCallback(async (path?: string) => {
    const target = path ?? activeGroup(groupsRef.current).tabs.active;
    if (!target) return;
    const model = loadMonaco().editor.getModel(modelUri(target));
    if (!model) return;
    setBusy(true);
    try {
      const saved = await call('ide:write', {
        path: target,
        text: model.getValue(),
        mtimeMs: loaded.current.get(target)?.mtimeMs,
      });
      loaded.current.set(target, { mtimeMs: saved.mtimeMs, large: saved.large });
      setGroups((g) => setDirtyEverywhere(g, target, false));
      refreshGit();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }, [refreshGit, toast]);

  /** Open a file and put the cursor on a specific line — what a search hit needs. */
  const revealAt = useCallback(async (path: string, line: number, column: number) => {
    reveal.current = { group: groupsRef.current.active, path, line, column };
    await openFile(path, false);
  }, [openFile]);

  /** Release a buffer — only ever called once no group shows the file any more. */
  const releaseModel = (path: string) => {
    loadMonaco().editor.getModel(modelUri(path))?.dispose();
    loaded.current.delete(path);
  };

  // The handlers below read the current groups from a ref, compute the next state, then apply it
  // and its side effects exactly once. Doing that work inside a setState updater would be wrong:
  // React may run updaters twice, which would halve a split twice or release a buffer early.

  const closeFile = useCallback((path: string, group?: string) => {
    const g = groupsRef.current;
    const { state, stillOpen } = closeIn(g, group ?? g.active, path);
    if (!stillOpen) releaseModel(path);
    setGroups(state);
  }, []);

  const splitEditor = useCallback(() => {
    const g = groupsRef.current;
    if (g.groups.length >= MAX_EDITOR_GROUPS) {
      toast(`${MAX_EDITOR_GROUPS} editors side by side is the most that stays readable.`, 'info');
      return;
    }
    const id = `g${++groupCounter.current}`;
    // The new group takes half of the one it splits, leaving the others exactly as sized.
    setGroupWeights((w) => {
      const half = (w[g.active] ?? 1) / 2;
      return { ...w, [g.active]: half, [id]: half };
    });
    setGroups(splitGroup(g, g.active, id));
  }, [toast]);

  const closeEditorGroup = useCallback((id: string) => {
    const g = groupsRef.current;
    const orphans = orphanedBy(g, id);
    const unsaved = orphans.filter((p) => isDirtyAnywhere(g, p));
    if (unsaved.length > 0) {
      toast(`Save or close ${unsaved[0]} first — it is only open in that group.`, 'error');
      return;
    }
    for (const p of orphans) releaseModel(p);
    const at = g.groups.findIndex((x) => x.id === id);
    const heir = g.groups[at > 0 ? at - 1 : 1]?.id;
    // The closed group's width goes to its neighbour, so nothing else moves.
    setGroupWeights((w) => {
      const next = { ...w };
      if (heir) next[heir] = (next[heir] ?? 1) + (next[id] ?? 1);
      delete next[id];
      return next;
    });
    setGroups(closeGroup(g, id));
  }, [toast]);

  const activeEditor = () => editors.current.get(groupsRef.current.active) ?? null;

  /** Show a changed file against HEAD. The right side is the live buffer, so it is loaded first. */
  const openDiff = useCallback(async (file: GitFileView) => {
    const path = file.workspacePath;
    if (!path) return;
    const deleted = file.worktree === 'deleted' || file.index === 'deleted';
    try {
      if (!deleted && !(await ensureModel(path))) return;
      const original = await call('git:original', { path });
      setDiffTarget({ path, original, deleted });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }, [ensureModel, toast]);

  const commands: Command[] = useMemo(() => [
    { id: 'file.save', label: 'File: Save', hint: 'Ctrl+S', run: () => void saveFile() },
    { id: 'file.quickOpen', label: 'Go to File…', hint: 'Ctrl+P', run: () => setOverlay('quick-open') },
    { id: 'file.openFolder', label: 'Open Folder…', run: () => void openFolder() },
    { id: 'search.findInFiles', label: 'Find in Files', hint: 'Ctrl+Shift+F', run: () => showView('search') },
    { id: 'view.explorer', label: 'Show Explorer', hint: 'Ctrl+Shift+E', run: () => showView('explorer') },
    { id: 'view.scm', label: 'Show Source Control', hint: 'Ctrl+Shift+G', run: () => showView('scm') },
    { id: 'git.refresh', label: 'Git: Refresh', run: refreshGit },
    { id: 'view.primary', label: 'Toggle Primary Sidebar', hint: 'Ctrl+B', run: () => toggle('primary') },
    { id: 'view.secondary', label: 'Toggle Secondary Sidebar', hint: 'Ctrl+Alt+B', run: () => toggle('secondary') },
    { id: 'view.panel', label: 'Toggle Panel', hint: 'Ctrl+J', run: () => toggle('panel') },
    { id: 'view.panelMax', label: 'Maximize / Restore Panel', run: () => commitLayout(togglePanelMaximized) },
    { id: 'view.secondarySearch', label: 'Show Search in Secondary Sidebar', run: () => commitLayout((l) => ({ ...l, secondaryView: 'search', secondary: { ...l.secondary, visible: true } })) },
    { id: 'view.secondaryEditors', label: 'Show Open Editors in Secondary Sidebar', run: () => commitLayout((l) => ({ ...l, secondaryView: 'open-editors', secondary: { ...l.secondary, visible: true } })) },
    { id: 'editor.find', label: 'Find in This File', hint: 'Ctrl+F', run: () => activeEditor()?.getAction('actions.find')?.run() },
    { id: 'editor.format', label: 'Format Document', run: () => void activeEditor()?.getAction('editor.action.formatDocument')?.run() },
    { id: 'editor.commentLine', label: 'Toggle Line Comment', hint: 'Ctrl+/', run: () => void activeEditor()?.getAction('editor.action.commentLine')?.run() },
    { id: 'editor.gotoLine', label: 'Go to Line…', hint: 'Ctrl+G', run: () => void activeEditor()?.getAction('editor.action.gotoLine')?.run() },
    { id: 'view.wordWrap', label: `Toggle Word Wrap (now ${ide?.wordWrap ? 'on' : 'off'})`, run: () => void updateSettings({ ide: { wordWrap: !ide?.wordWrap } }) },
    { id: 'view.minimap', label: `Toggle Minimap (now ${ide?.minimap ? 'on' : 'off'})`, run: () => void updateSettings({ ide: { minimap: !ide?.minimap } }) },
    { id: 'view.fontBigger', label: 'Increase Font Size', run: () => void updateSettings({ ide: { fontSize: Math.min(24, (ide?.fontSize ?? 13) + 1) } }) },
    { id: 'view.fontSmaller', label: 'Decrease Font Size', run: () => void updateSettings({ ide: { fontSize: Math.max(10, (ide?.fontSize ?? 13) - 1) } }) },
    { id: 'view.terminal', label: 'Toggle Terminal', hint: 'Ctrl+`', run: () => toggle('panel') },
    { id: 'file.closeTab', label: 'Close Editor', run: () => { if (tabs.active) closeFile(tabs.active); } },
    { id: 'view.splitEditor', label: 'Split Editor Right', hint: 'Ctrl+\\', run: splitEditor },
    { id: 'view.closeGroup', label: 'Close Editor Group', run: () => closeEditorGroup(groups.active) },
    { id: 'view.evenEditors', label: 'Reset Editor Widths', run: () => setGroupWeights({}) },
  ], [saveFile, ide?.wordWrap, ide?.minimap, ide?.fontSize, updateSettings, tabs.active, closeFile, showView, toggle, commitLayout, splitEditor, closeEditorGroup, groups.active, refreshGit]);

  // Editor shortcuts, on the window so they work whether or not Monaco has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') { e.preventDefault(); void saveFile(); return; }
      if (e.shiftKey && key === 'p') { e.preventDefault(); setOverlay('commands'); return; }
      if (e.key === '\\' && !e.shiftKey) { e.preventDefault(); splitEditor(); return; }
      if (e.shiftKey && key === 'f') { e.preventDefault(); showView('search'); return; }
      if (e.shiftKey && key === 'e') { e.preventDefault(); showView('explorer'); return; }
      if (e.shiftKey && key === 'g') { e.preventDefault(); showView('scm'); return; }
      if (e.key === '`' || (!e.shiftKey && !e.altKey && key === 'j')) { e.preventDefault(); toggle('panel'); return; }
      if (key === 'b' && !e.shiftKey) { e.preventDefault(); toggle(e.altKey ? 'secondary' : 'primary'); return; }
      if (!e.shiftKey && key === 'p') { e.preventDefault(); setOverlay('quick-open'); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveFile, showView, toggle, splitEditor]);

  const unsaved = allDirty(groups);

  /** Sash between editor group `index` and `index + 1`: moves space between those two only. */
  const groupSash = (index: number) => ({
    onDragStart: () => {
      const ids = groupsRef.current.groups.map((g) => g.id);
      groupDrag.current = { ids, weights: ids.map((id) => groupWeights[id] ?? 1), total: groupsRowRef.current?.clientWidth ?? 0 };
    },
    onDrag: (delta: number) => {
      const start = groupDrag.current;
      if (!start) return;
      const next = resizeBetween(start.weights, index, delta, start.total);
      setGroupWeights((w) => ({ ...w, ...Object.fromEntries(start.ids.map((id, i) => [id, next[i]!])) }));
    },
    onDragEnd: () => { groupDrag.current = null; },
    onDoubleClick: () => setGroupWeights({}),
  });

  if (!root) {
    return (
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="grid min-h-0 flex-1 place-items-center px-8">
          <EmptyState
            icon={<FolderTree />}
            title="Open a folder to start editing"
            action={<Button variant="primary" icon={<FolderOpen className="size-4" />} onClick={() => void openFolder()}>Open folder</Button>}
          >
            <span className="block">Lumina’s editor opens one folder at a time and can only read and write inside it.</span>
            {recent.length > 0 && (
              <span className="mt-4 block text-left">
                <span className="mb-1 block text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">Recent</span>
                {recent.slice(0, 5).map((f) => (
                  <button key={f} onClick={() => void openFolder(f)} className="block max-w-full truncate rounded px-1 py-0.5 text-[13px] text-accent hover:bg-hover" title={f}>
                    {f}
                  </button>
                ))}
              </span>
            )}
          </EmptyState>
        </div>
      </div>
    );
  }

  const explorer = (
    <>
      <PartHeader title={name}>
        <button onClick={() => void openFolder()} aria-label="Open a different folder" title={`${root}\nOpen a different folder`}
          className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
          <FolderOpen className="size-3.5" />
        </button>
      </PartHeader>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <Tree path="" depth={0} activePath={tabs.active} onOpen={openFile} />
      </div>
    </>
  );

  const search = (onClose: () => void) => (
    <SearchPanel onOpen={(p, l, c) => void revealAt(p, l, c)} onClose={onClose} />
  );

  const selectTab = (path: string) => setGroups((s) => openIn(s, path));
  const panelMax = layout.panel.visible && layout.panel.maximized;

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        className="border-b border-line"
        right={<LayoutToggles visible={{ primary: layout.primary.visible, panel: layout.panel.visible, secondary: layout.secondary.visible }} onToggle={toggle} />}
      >
        <ViewSwitcher active={layout.activity} sidebarOpen={layout.primary.visible} onSelect={(v) => commitLayout((l) => selectActivity(l, v))} />
        <span className="ml-2 truncate text-[13px] font-semibold text-ink-2" title={root}>{name}</span>
      </TitleBar>

      <div ref={shellRef} className="flex min-h-0 flex-1">
        {layout.primary.visible && (
          <>
            <aside style={{ width: layout.primary.size }} className="flex shrink-0 flex-col bg-panel" aria-label="Primary sidebar">
              {layout.activity === 'search'
                ? search(() => commitLayout((l) => setVisible(l, 'primary', false)))
                : layout.activity === 'scm'
                  ? <SourceControl view={gitView} onChange={setGitView} onRefresh={refreshGit} onOpenDiff={(f) => void openDiff(f)} />
                  : explorer}
            </aside>
            <Sash orientation="vertical" label="Resize primary sidebar" {...sashFor('primary')}
              onDoubleClick={() => commitLayout((l) => ({ ...l, primary: { ...l.primary, size: 260 } }))} />
          </>
        )}
        {!layout.primary.visible && <div className="w-px shrink-0 bg-line" />}

        <div ref={columnRef} className="flex min-w-0 flex-1 flex-col">
          {/* Editor groups side by side, with a draggable sash between each pair. Hidden, never
              unmounted, while the panel is maximized: unmounting would tear down every editor. */}
          {diffTarget && !panelMax && (
            <DiffPane target={diffTarget} options={editorOptions} onClose={() => setDiffTarget(null)} />
          )}
          <div ref={groupsRowRef} className={cn('flex min-h-0 flex-1', (panelMax || diffTarget) && 'hidden')}>
            {groups.groups.map((g, i) => (
              <Fragment key={g.id}>
                {i > 0 && (
                  <div className="flex shrink-0 border-l border-line">
                    <Sash orientation="vertical" label={`Resize editors ${i} and ${i + 1}`} {...groupSash(i - 1)} />
                  </div>
                )}
                <div style={{ flex: `${groupWeights[g.id] ?? 1} 1 0px` }} className="flex min-w-0">
                  <EditorGroupView
                    group={g}
                    active={groups.active === g.id}
                    options={editorOptions}
                    busy={busy}
                    canSplit={groups.groups.length < MAX_EDITOR_GROUPS}
                    canCloseGroup={groups.groups.length > 1}
                    dirty={(p) => isDirtyAnywhere(groups, p)}
                    reveal={reveal}
                    onEditor={registerEditor}
                    onFocus={() => setGroups((s) => (s.active === g.id ? s : focusGroup(s, g.id)))}
                    onSelect={(p) => setGroups((s) => openIn(s, p, { group: g.id }))}
                    onClose={(p) => closeFile(p, g.id)}
                    onSave={() => void saveFile()}
                    onSplit={splitEditor}
                    onCloseGroup={() => closeEditorGroup(g.id)}
                  />
                </div>
              </Fragment>
            ))}
          </div>

          {layout.panel.visible && (
            <>
              {!panelMax && (
                <Sash orientation="horizontal" label="Resize panel" {...sashFor('panel')}
                  onDoubleClick={() => commitLayout(togglePanelMaximized)} />
              )}
              <div style={panelMax ? undefined : { height: layout.panel.size }} className={cn('flex min-h-0 flex-col border-t border-line', panelMax ? 'flex-1' : 'shrink-0')}>
                <TerminalPanel
                  maximized={panelMax}
                  onToggleMaximize={() => commitLayout(togglePanelMaximized)}
                  onClose={() => commitLayout((l) => setVisible(l, 'panel', false))}
                />
              </div>
            </>
          )}

          {overlay === 'quick-open' && <QuickOpen onOpen={(p) => void openFile(p, false)} onClose={() => setOverlay('none')} />}
          {overlay === 'commands' && <CommandPalette commands={commands} onClose={() => setOverlay('none')} />}

          <div className="flex shrink-0 items-center gap-3 border-t border-line bg-panel px-3 py-1 text-[11px] text-ink-3">
            {gitView?.status && (
              <button onClick={() => showView('scm')} className="flex shrink-0 items-center gap-1 rounded px-1.5 hover:bg-hover hover:text-ink" title="Source control (Ctrl+Shift+G)">
                <GitBranch className="size-3" />
                {branchSummary(gitView.status)}
                {gitView.files.length > 0 && <span className="text-ink-3">· {gitView.files.length}</span>}
              </button>
            )}
            <span className="truncate">{tabs.active ?? 'No file open'}</span>
            {tabs.active && <span>{languageForFile(tabs.active)}</span>}
            <button onClick={() => toggle('panel')} className="ml-auto rounded px-1.5 hover:bg-hover hover:text-ink">Terminal</button>
            <button onClick={() => setOverlay('commands')} className="rounded px-1.5 hover:bg-hover hover:text-ink">Ctrl+Shift+P</button>
            <span>{unsaved.length > 0 ? `${unsaved.length} unsaved` : 'All changes saved'}</span>
          </div>
        </div>

        {layout.secondary.visible && (
          <>
            <Sash orientation="vertical" label="Resize secondary sidebar" {...sashFor('secondary')}
              onDoubleClick={() => commitLayout((l) => ({ ...l, secondary: { ...l.secondary, size: 320 } }))} />
            <aside style={{ width: layout.secondary.size }} className="flex shrink-0 flex-col bg-panel" aria-label="Secondary sidebar">
              {layout.secondaryView === 'search'
                ? search(() => commitLayout((l) => ({ ...l, secondaryView: 'open-editors' })))
                : (
                  <>
                    <PartHeader title="Open editors">
                      <button onClick={() => commitLayout((l) => ({ ...l, secondaryView: 'search' }))}
                        className="rounded px-1.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink" title="Show search here instead">
                        Search
                      </button>
                    </PartHeader>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <OpenEditors tabs={tabs} onSelect={selectTab} onClose={closeFile} />
                    </div>
                  </>
                )}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

/** One lazily-expanded level of the folder tree. Children are fetched only when a folder is opened. */
function Tree({ path, depth, activePath, onOpen }: {
  path: string; depth: number; activePath: string | null; onOpen: (p: string, preview?: boolean) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let live = true;
    void call('ide:list', { path })
      .then((list) => { if (live) setEntries(list); })
      .catch((err) => { if (live) { setEntries([]); toast(errorMessage(err), 'error'); } });
    return () => { live = false; };
  }, [path, toast]);

  if (!entries) return <p className="px-3 py-1 text-[12px] text-ink-3">Loading…</p>;

  return (
    <ul role="group">
      {entries.map((e) => {
        const expanded = open.has(e.path);
        return (
          <li key={e.path}>
            <button
              onClick={() => {
                if (e.kind === 'directory') {
                  setOpen((s) => {
                    const next = new Set(s);
                    if (next.has(e.path)) next.delete(e.path);
                    else next.add(e.path);
                    return next;
                  });
                } else {
                  onOpen(e.path);
                }
              }}
              onDoubleClick={() => e.kind === 'file' && onOpen(e.path, false)}
              className={cn('flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[13px] hover:bg-hover',
                activePath === e.path && 'bg-accent-soft text-accent')}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              title={e.path}
            >
              {e.kind === 'directory'
                ? (expanded ? <ChevronDown className="size-3.5 shrink-0 text-ink-3" /> : <ChevronRight className="size-3.5 shrink-0 text-ink-3" />)
                : <FileIcon className="size-3.5 shrink-0 text-ink-3" />}
              <span className="truncate">{e.name}</span>
            </button>
            {e.kind === 'directory' && expanded && (
              <Tree path={e.path} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
