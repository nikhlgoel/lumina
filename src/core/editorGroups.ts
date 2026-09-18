// Editor groups — two or more editors side by side, each with its own tabs.
//
// Monaco models are global (one per file URI), so the same file open in two groups is ONE buffer:
// typing in either shows up in both, exactly like VS Code. What this module owns is the bookkeeping
// around that: tabs per group, which group is active, and — because a buffer is shared — unsaved
// state tracked per *file* across every group, plus knowing when a file is closed everywhere so its
// model can finally be released.
import { closeTab, emptyTabs, openTab, setDirty, type TabState } from './ide';

export interface EditorGroup {
  id: string;
  tabs: TabState;
}

export interface EditorGroups {
  groups: EditorGroup[];
  /** Id of the group that has focus — where opens, saves and palette commands go. */
  active: string;
}

/** Three side by side is already narrow on a laptop; past that a split stops being useful. */
export const MAX_EDITOR_GROUPS = 3;

export const initialGroups = (id = 'g1'): EditorGroups => ({ groups: [{ id, tabs: emptyTabs() }], active: id });

export const activeGroup = (state: EditorGroups): EditorGroup =>
  state.groups.find((g) => g.id === state.active) ?? state.groups[0]!;

const update = (state: EditorGroups, id: string, fn: (tabs: TabState) => TabState): EditorGroups => ({
  ...state,
  groups: state.groups.map((g) => (g.id === id ? { ...g, tabs: fn(g.tabs) } : g)),
});

export const isOpenAnywhere = (state: EditorGroups, path: string): boolean =>
  state.groups.some((g) => g.tabs.tabs.some((t) => t.path === path));

export const isDirtyAnywhere = (state: EditorGroups, path: string): boolean =>
  state.groups.some((g) => g.tabs.tabs.some((t) => t.path === path && t.dirty));

/** Open a file in a group (the active one by default) and make that group active. */
export function openIn(state: EditorGroups, path: string, opts: { preview?: boolean; group?: string } = {}): EditorGroups {
  const id = opts.group && state.groups.some((g) => g.id === opts.group) ? opts.group : state.active;
  // A file with unsaved edits in another group is the same buffer, so it is unsaved here too.
  const dirtyElsewhere = isDirtyAnywhere(state, path);
  let next = update(state, id, (tabs) => openTab(tabs, path, { preview: opts.preview }));
  if (dirtyElsewhere) next = update(next, id, (tabs) => setDirty(tabs, path, true));
  return { ...next, active: id };
}

export function focusGroup(state: EditorGroups, id: string): EditorGroups {
  return state.groups.some((g) => g.id === id) ? { ...state, active: id } : state;
}

/**
 * Split right: a new group beside `from`, showing the same file as a permanent tab, since the
 * point of splitting is to keep it. Refused past MAX_EDITOR_GROUPS.
 */
export function splitGroup(state: EditorGroups, from: string, newId: string): EditorGroups {
  if (state.groups.length >= MAX_EDITOR_GROUPS) return state;
  const at = state.groups.findIndex((g) => g.id === from);
  if (at === -1) return state;
  const path = state.groups[at]!.tabs.active;
  let tabs = emptyTabs();
  if (path) {
    tabs = openTab(tabs, path, { preview: false });
    if (isDirtyAnywhere(state, path)) tabs = setDirty(tabs, path, true);
  }
  const groups = [...state.groups.slice(0, at + 1), { id: newId, tabs }, ...state.groups.slice(at + 1)];
  return { groups, active: newId };
}

/** Close a whole group; focus moves to its left neighbour (or right, if it was first). */
export function closeGroup(state: EditorGroups, id: string): EditorGroups {
  if (state.groups.length <= 1) return state;
  const at = state.groups.findIndex((g) => g.id === id);
  if (at === -1) return state;
  const groups = state.groups.filter((g) => g.id !== id);
  const active = state.active === id ? groups[Math.max(0, at - 1)]!.id : state.active;
  return { groups, active };
}

/**
 * Close a tab in one group. Reports whether the file is still open anywhere, because only when it
 * is not can its shared buffer be released. An emptied group closes itself, unless it is the last.
 */
export function closeIn(state: EditorGroups, group: string, path: string): { state: EditorGroups; stillOpen: boolean } {
  let next = update(state, group, (tabs) => closeTab(tabs, path));
  const emptied = next.groups.find((g) => g.id === group);
  if (emptied && emptied.tabs.tabs.length === 0 && next.groups.length > 1) next = closeGroup(next, group);
  return { state: next, stillOpen: isOpenAnywhere(next, path) };
}

/** Files open only in this group — the ones a group closure would leave with no editor. */
export function orphanedBy(state: EditorGroups, id: string): string[] {
  const group = state.groups.find((g) => g.id === id);
  if (!group) return [];
  return group.tabs.tabs
    .map((t) => t.path)
    .filter((p) => !state.groups.some((g) => g.id !== id && g.tabs.tabs.some((t) => t.path === p)));
}

/** Unsaved state belongs to the file, so it is set in every group showing it. */
export function setDirtyEverywhere(state: EditorGroups, path: string, dirty: boolean): EditorGroups {
  return { ...state, groups: state.groups.map((g) => ({ ...g, tabs: setDirty(g.tabs, path, dirty) })) };
}

/** Every file with unsaved changes, once each, in first-seen order. */
export function allDirty(state: EditorGroups): string[] {
  const seen = new Set<string>();
  for (const g of state.groups) for (const t of g.tabs.tabs) if (t.dirty) seen.add(t.path);
  return [...seen];
}
