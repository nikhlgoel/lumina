// The IDE's shell layout, as pure data: which parts are showing, how big they are, and how the
// terminals are grouped. The React side only renders this — every rule about sizes, snapping and
// splitting lives here so it can be unit-tested rather than tuned by dragging things around.
//
// The parts follow the VS Code shell the user pointed at:
//
//   ┌────┬──────────┬───────────────────────┬─────────────┐
//   │act.│ primary  │  editor               │  secondary  │
//   │bar │ sidebar  ├───────────────────────┤  sidebar    │
//   │    │          │  panel (terminals…)   │             │
//   └────┴──────────┴───────────────────────┴─────────────┘

export type PartId = 'primary' | 'secondary' | 'panel';

/** What the primary sidebar is showing — chosen from the activity bar. */
export type ActivityView = 'explorer' | 'search' | 'scm';

/** What the secondary (right-hand) sidebar is showing. */
export type SecondaryView = 'open-editors' | 'search';

export interface PartState {
  visible: boolean;
  /** Width for the sidebars, height for the panel, in CSS pixels. */
  size: number;
}

export interface IdeLayout {
  primary: PartState;
  secondary: PartState;
  panel: PartState & { maximized: boolean };
  activity: ActivityView;
  secondaryView: SecondaryView;
}

interface Limit {
  min: number;
  max: number;
  initial: number;
}

export const PART_LIMITS: Record<PartId, Limit> = {
  primary: { min: 170, max: 640, initial: 260 },
  secondary: { min: 200, max: 720, initial: 320 },
  panel: { min: 90, max: 1600, initial: 260 },
};

/**
 * Space the editor always keeps, so no combination of sidebars and panel can squeeze it to nothing.
 * A part is never allowed to grow past `available - EDITOR_RESERVE`.
 */
export const EDITOR_RESERVE = 220;

export function defaultLayout(): IdeLayout {
  return {
    primary: { visible: true, size: PART_LIMITS.primary.initial },
    secondary: { visible: false, size: PART_LIMITS.secondary.initial },
    panel: { visible: false, size: PART_LIMITS.panel.initial, maximized: false },
    activity: 'explorer',
    secondaryView: 'open-editors',
  };
}

/**
 * Clamp a size to the part's own limits and to the room actually available. `available` is the
 * length of the axis the part lives on (container width for sidebars, height for the panel).
 */
export function clampSize(part: PartId, size: number, available = Infinity): number {
  const { min, max, initial } = PART_LIMITS[part];
  if (!Number.isFinite(size)) return initial;
  const ceiling = Math.max(min, Math.min(max, available - EDITOR_RESERVE));
  return Math.round(Math.max(min, Math.min(ceiling, size)));
}

/**
 * Which way a drag grows a part. The primary sidebar sits on the left, so dragging its sash right
 * makes it wider; the secondary sidebar sits on the right, so dragging left makes it wider; the
 * panel sits at the bottom, so dragging up makes it taller.
 */
export function sizeAfterDrag(part: PartId, startSize: number, deltaPx: number): number {
  return part === 'primary' ? startSize + deltaPx : startSize - deltaPx;
}

export function setVisible(layout: IdeLayout, part: PartId, visible: boolean): IdeLayout {
  if (part === 'panel') {
    // A maximized panel that gets hidden should come back at its normal size.
    return { ...layout, panel: { ...layout.panel, visible, maximized: visible ? layout.panel.maximized : false } };
  }
  return { ...layout, [part]: { ...layout[part], visible } };
}

/**
 * Apply a sash drag. Dragging a part well past its minimum closes it, the way VS Code does — that
 * is what makes a sash feel like a real control rather than a wall. Letting go before that point
 * leaves the part at its minimum.
 */
export function dragPart(layout: IdeLayout, part: PartId, startSize: number, deltaPx: number, available = Infinity): IdeLayout {
  const raw = sizeAfterDrag(part, startSize, deltaPx);
  if (raw < PART_LIMITS[part].min / 2) return setVisible(layout, part, false);
  const size = clampSize(part, raw, available);
  if (part === 'panel') return { ...layout, panel: { ...layout.panel, visible: true, size } };
  return { ...layout, [part]: { visible: true, size } };
}

export const togglePart = (layout: IdeLayout, part: PartId): IdeLayout => setVisible(layout, part, !layout[part].visible);

/** Maximizing the panel also reveals it; restoring leaves it open at its previous height. */
export function togglePanelMaximized(layout: IdeLayout): IdeLayout {
  return { ...layout, panel: { ...layout.panel, visible: true, maximized: !layout.panel.maximized } };
}

/**
 * Clicking an activity-bar icon: a different view switches to it (and opens the sidebar); the view
 * that is already showing toggles the sidebar closed. Same behaviour as VS Code.
 */
export function selectActivity(layout: IdeLayout, view: ActivityView): IdeLayout {
  if (layout.activity === view) return togglePart(layout, 'primary');
  return { ...layout, activity: view, primary: { ...layout.primary, visible: true } };
}

/** Read a stored layout defensively — settings files get hand-edited and old versions linger. */
export function normalizeLayout(raw: unknown): IdeLayout {
  const base = defaultLayout();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  const part = (id: PartId): PartState => {
    const p = r[id];
    if (!p || typeof p !== 'object') return { visible: base[id].visible, size: base[id].size };
    const q = p as Record<string, unknown>;
    return {
      visible: typeof q.visible === 'boolean' ? q.visible : base[id].visible,
      size: clampSize(id, typeof q.size === 'number' ? q.size : base[id].size),
    };
  };

  const panelRaw = r.panel as Record<string, unknown> | undefined;
  return {
    primary: part('primary'),
    secondary: part('secondary'),
    panel: { ...part('panel'), maximized: panelRaw?.maximized === true },
    activity: r.activity === 'search' || r.activity === 'scm' ? r.activity : 'explorer',
    secondaryView: r.secondaryView === 'search' ? 'search' : 'open-editors',
  };
}

/* ---------- terminal groups ---------- */

/**
 * Terminals are arranged in groups. Every terminal in the active group is on screen at once, side
 * by side; the tab strip picks which group that is. "Split" adds a terminal to the current group —
 * the "multiple terminals seen together" the user asked for.
 */
export interface TerminalGroups {
  groups: string[][];
  /** Index into `groups` of the group on screen. */
  active: number;
  /** The terminal that has focus, inside the active group. */
  focused: string | null;
}

/** Past this a split just becomes unreadable, so a further split opens a new group instead. */
export const MAX_SPLIT = 4;

export const emptyGroups = (): TerminalGroups => ({ groups: [], active: 0, focused: null });

/** A brand-new terminal in a group of its own, made current. */
export function addTerminal(state: TerminalGroups, id: string): TerminalGroups {
  const groups = [...state.groups, [id]];
  return { groups, active: groups.length - 1, focused: id };
}

/** Put a new terminal beside the focused one, in the same group. */
export function splitTerminal(state: TerminalGroups, id: string): TerminalGroups {
  if (state.groups.length === 0) return addTerminal(state, id);
  const current = state.groups[state.active] ?? [];
  if (current.length >= MAX_SPLIT) return addTerminal(state, id);
  const at = state.focused ? current.indexOf(state.focused) : -1;
  const next = at === -1 ? [...current, id] : [...current.slice(0, at + 1), id, ...current.slice(at + 1)];
  return { groups: state.groups.map((g, i) => (i === state.active ? next : g)), active: state.active, focused: id };
}

/** Remove a terminal wherever it is; empty groups disappear and focus lands on a neighbour. */
export function removeTerminal(state: TerminalGroups, id: string): TerminalGroups {
  const at = state.groups.findIndex((g) => g.includes(id));
  if (at === -1) return state;

  const before = state.groups[at]!;
  const index = before.indexOf(id);
  const shrunk = before.filter((t) => t !== id);
  const groups = shrunk.length > 0
    ? state.groups.map((g, i) => (i === at ? shrunk : g))
    : state.groups.filter((_, i) => i !== at);
  if (groups.length === 0) return emptyGroups();

  // Losing a whole group before (or at) the active one shifts the active index down by one.
  let active = state.active;
  if (shrunk.length === 0 && at <= state.active) active = state.active - 1;
  active = Math.max(0, Math.min(active, groups.length - 1));

  const group = groups[active]!;
  let focused: string;
  if (state.focused && state.focused !== id && group.includes(state.focused)) focused = state.focused;
  else if (at === active && shrunk.length > 0) focused = shrunk[Math.max(0, index - 1)]!;
  else focused = group[0]!;

  return { groups, active, focused };
}

export function focusTerminal(state: TerminalGroups, id: string): TerminalGroups {
  const at = state.groups.findIndex((g) => g.includes(id));
  if (at === -1) return state;
  return { ...state, active: at, focused: id };
}

/** Adopt terminals that already exist (the panel was closed and reopened), one group each. */
export function adoptTerminals(ids: string[]): TerminalGroups {
  return ids.reduce<TerminalGroups>((s, id) => addTerminal(s, id), emptyGroups());
}

/** Every terminal id, in display order — for keeping xterms alive while their group is hidden. */
export const allTerminalIds = (state: TerminalGroups): string[] => state.groups.flat();

/* ---------- resizable splits ---------- */

/**
 * The one rule behind every resizable split in the IDE — terminals side by side, editor groups side
 * by side. Panes carry relative weights (used as flex-grow), and dragging the sash between pane `i`
 * and pane `i + 1` moves space from one to the other and nothing else, so every other pane stays
 * exactly where the user put it. Freedom is the point: any boundary can go anywhere, as long as
 * neither pane is squeezed below `minPx`.
 */
export const MIN_PANE_PX = 120;

export function resizeBetween(weights: number[], index: number, deltaPx: number, totalPx: number, minPx = MIN_PANE_PX): number[] {
  if (index < 0 || index >= weights.length - 1 || !(totalPx > 0)) return weights;
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return weights;

  const px = weights.map((w) => (w / sum) * totalPx);
  const pair = px[index]! + px[index + 1]!;
  // If the pair is too small to honour the minimum on both sides, split what there is evenly.
  const floor = Math.min(minPx, pair / 2);
  const left = Math.max(floor, Math.min(pair - floor, px[index]! + deltaPx));

  const next = [...px];
  next[index] = left;
  next[index + 1] = pair - left;
  return next.map((p) => (p / totalPx) * sum);
}

/** Weights for `n` equal panes — what a double-click on a sash restores. */
export const equalWeights = (n: number): number[] => Array.from({ length: Math.max(0, n) }, () => 1);

/**
 * A new pane opened beside pane `at` takes half of that pane's space, the way VS Code splits — the
 * rest of the layout the user arranged is left alone.
 */
export function splitWeightAt(weights: number[], at: number): number[] {
  if (weights.length === 0) return [1];
  const i = Math.max(0, Math.min(at, weights.length - 1));
  const half = weights[i]! / 2;
  return [...weights.slice(0, i), half, half, ...weights.slice(i + 1)];
}

/** Closing a pane hands its space to the neighbour on its left (or right, if it was first). */
export function removeWeightAt(weights: number[], at: number): number[] {
  if (at < 0 || at >= weights.length) return weights;
  if (weights.length === 1) return [];
  const next = weights.filter((_, i) => i !== at);
  const heir = at > 0 ? at - 1 : 0;
  next[heir] = next[heir]! + weights[at]!;
  return next;
}
