import { describe, it, expect } from 'vitest';
import {
  EDITOR_RESERVE, MAX_SPLIT, MIN_PANE_PX, PART_LIMITS, equalWeights, removeWeightAt, resizeBetween, splitWeightAt, addTerminal, adoptTerminals, allTerminalIds, clampSize, defaultLayout,
  dragPart, emptyGroups, focusTerminal, normalizeLayout, removeTerminal, selectActivity, setVisible,
  sizeAfterDrag, splitTerminal, togglePanelMaximized, togglePart,
} from '@core/ideLayout';

describe('defaultLayout', () => {
  it('opens with the explorer showing and the other parts closed', () => {
    const l = defaultLayout();
    expect(l.primary.visible).toBe(true);
    expect(l.secondary.visible).toBe(false);
    expect(l.panel.visible).toBe(false);
    expect(l.activity).toBe('explorer');
  });
});

describe('clampSize', () => {
  it('keeps a size inside the part limits', () => {
    expect(clampSize('primary', 10)).toBe(PART_LIMITS.primary.min);
    expect(clampSize('primary', 99_999)).toBe(PART_LIMITS.primary.max);
    expect(clampSize('primary', 300.4)).toBe(300);
  });

  it('never lets a part eat the editor reserved space', () => {
    expect(clampSize('secondary', 700, 800)).toBe(800 - EDITOR_RESERVE);
  });

  it('still honours the minimum when the window is tiny', () => {
    expect(clampSize('primary', 400, 100)).toBe(PART_LIMITS.primary.min);
  });

  it('falls back to the initial size for NaN or Infinity', () => {
    expect(clampSize('panel', Number.NaN)).toBe(PART_LIMITS.panel.initial);
    expect(clampSize('panel', Number.POSITIVE_INFINITY)).toBe(PART_LIMITS.panel.initial);
  });
});

describe('sizeAfterDrag: each part grows in its own direction', () => {
  it('primary grows when dragged right', () => expect(sizeAfterDrag('primary', 200, 50)).toBe(250));
  it('secondary grows when dragged left', () => expect(sizeAfterDrag('secondary', 300, -50)).toBe(350));
  it('panel grows when dragged up', () => expect(sizeAfterDrag('panel', 200, -40)).toBe(240));
});

describe('dragPart', () => {
  it('resizes within limits', () => {
    expect(dragPart(defaultLayout(), 'primary', 260, 40).primary).toEqual({ visible: true, size: 300 });
  });

  it('snaps a part closed when dragged well past its minimum, keeping the last size', () => {
    const l = dragPart(defaultLayout(), 'primary', 260, -250);
    expect(l.primary.visible).toBe(false);
    expect(l.primary.size).toBe(260);
  });

  it('stops at the minimum rather than closing for a small overshoot', () => {
    expect(dragPart(defaultLayout(), 'primary', 260, -120).primary).toEqual({ visible: true, size: PART_LIMITS.primary.min });
  });

  it('reopens a closed part when its sash is dragged back out', () => {
    const closed = setVisible(defaultLayout(), 'secondary', false);
    expect(dragPart(closed, 'secondary', 320, -10).secondary.visible).toBe(true);
  });

  it('keeps the panel maximized flag while resizing', () => {
    expect(dragPart(togglePanelMaximized(defaultLayout()), 'panel', 260, -20).panel.maximized).toBe(true);
  });
});

describe('toggles', () => {
  it('toggles each part independently', () => {
    const l = togglePart(togglePart(defaultLayout(), 'secondary'), 'panel');
    expect(l.secondary.visible).toBe(true);
    expect(l.panel.visible).toBe(true);
    expect(l.primary.visible).toBe(true);
  });

  it('hiding the panel also un-maximizes it', () => {
    expect(setVisible(togglePanelMaximized(defaultLayout()), 'panel', false).panel.maximized).toBe(false);
  });

  it('maximizing reveals a hidden panel', () => {
    expect(togglePanelMaximized(defaultLayout()).panel).toMatchObject({ visible: true, maximized: true });
  });
});

describe('selectActivity', () => {
  it('switches views and opens the sidebar', () => {
    const closed = setVisible(defaultLayout(), 'primary', false);
    expect(selectActivity(closed, 'search')).toMatchObject({ activity: 'search', primary: { visible: true } });
  });

  it('clicking the view already showing closes the sidebar', () => {
    expect(selectActivity(defaultLayout(), 'explorer').primary.visible).toBe(false);
  });
});

describe('normalizeLayout', () => {
  it('returns the default for junk', () => {
    expect(normalizeLayout(null)).toEqual(defaultLayout());
    expect(normalizeLayout('nope')).toEqual(defaultLayout());
  });

  it('keeps valid stored values and clamps bad sizes', () => {
    const l = normalizeLayout({ primary: { visible: false, size: 5 }, panel: { visible: true, size: 300, maximized: true }, activity: 'search' });
    expect(l.primary).toEqual({ visible: false, size: PART_LIMITS.primary.min });
    expect(l.panel).toEqual({ visible: true, size: 300, maximized: true });
    expect(l.activity).toBe('search');
  });

  it('keeps the source control view', () => {
    expect(normalizeLayout({ activity: 'scm' }).activity).toBe('scm');
  });

  it('ignores unknown view names', () => {
    expect(normalizeLayout({ activity: 'debug', secondaryView: 'x' })).toMatchObject({ activity: 'explorer', secondaryView: 'open-editors' });
  });
});

describe('terminal groups', () => {
  it('adds each new terminal as its own group and focuses it', () => {
    expect(addTerminal(addTerminal(emptyGroups(), 't1'), 't2')).toEqual({ groups: [['t1'], ['t2']], active: 1, focused: 't2' });
  });

  it('splitting puts the new terminal beside the focused one', () => {
    expect(splitTerminal(addTerminal(emptyGroups(), 't1'), 't2')).toEqual({ groups: [['t1', 't2']], active: 0, focused: 't2' });
  });

  it('splits next to the focused terminal, not at the end', () => {
    let s = splitTerminal(splitTerminal(addTerminal(emptyGroups(), 'a'), 'b'), 'c');
    s = splitTerminal(focusTerminal(s, 'a'), 'd');
    expect(s.groups[0]).toEqual(['a', 'd', 'b', 'c']);
  });

  it('opens a new group once a split is full', () => {
    let s = addTerminal(emptyGroups(), 't0');
    for (let i = 1; i < MAX_SPLIT; i++) s = splitTerminal(s, `t${i}`);
    s = splitTerminal(s, 'overflow');
    expect(s.groups).toHaveLength(2);
    expect(s.groups[1]).toEqual(['overflow']);
  });

  it('splitting with no terminals just adds one', () => {
    expect(splitTerminal(emptyGroups(), 't1')).toEqual({ groups: [['t1']], active: 0, focused: 't1' });
  });

  it('removing a split terminal focuses its left neighbour', () => {
    const s = splitTerminal(splitTerminal(addTerminal(emptyGroups(), 'a'), 'b'), 'c');
    expect(removeTerminal(s, 'c')).toEqual({ groups: [['a', 'b']], active: 0, focused: 'b' });
  });

  it('removing the first terminal of a split focuses the next one', () => {
    const s = focusTerminal(splitTerminal(addTerminal(emptyGroups(), 'a'), 'b'), 'a');
    expect(removeTerminal(s, 'a').focused).toBe('b');
  });

  it('removing a whole earlier group keeps the same group on screen', () => {
    const s = removeTerminal(addTerminal(addTerminal(addTerminal(emptyGroups(), 'a'), 'b'), 'c'), 'a');
    expect(s).toEqual({ groups: [['b'], ['c']], active: 1, focused: 'c' });
  });

  it('removing the active last group falls back to the previous one', () => {
    expect(removeTerminal(addTerminal(addTerminal(emptyGroups(), 'a'), 'b'), 'b')).toEqual({ groups: [['a']], active: 0, focused: 'a' });
  });

  it('removing the last terminal empties everything', () => {
    expect(removeTerminal(addTerminal(emptyGroups(), 'a'), 'a')).toEqual(emptyGroups());
  });

  it('removing an unknown id changes nothing', () => {
    const s = addTerminal(emptyGroups(), 'a');
    expect(removeTerminal(s, 'zzz')).toBe(s);
  });

  it('focusing a terminal in another group switches to that group', () => {
    expect(focusTerminal(addTerminal(addTerminal(emptyGroups(), 'a'), 'b'), 'a')).toMatchObject({ active: 0, focused: 'a' });
  });

  it('adopts existing sessions one group each, and lists every id in order', () => {
    const s = adoptTerminals(['t1', 't2']);
    expect(s.groups).toEqual([['t1'], ['t2']]);
    expect(allTerminalIds(splitTerminal(s, 't3'))).toEqual(['t1', 't2', 't3']);
  });
});

describe('resizeBetween: dragging the sash between two panes', () => {
  const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);
  const px = (w: number[], total: number) => w.map((x) => Math.round((x / sum(w)) * total));

  it('moves space from one neighbour to the other', () => {
    expect(px(resizeBetween([1, 1], 0, 100, 1000), 1000)).toEqual([600, 400]);
  });

  it('leaves every other pane exactly where it was', () => {
    const next = resizeBetween([1, 1, 1, 1], 1, 50, 1200);
    expect(px(next, 1200)).toEqual([300, 350, 250, 300]);
  });

  it('keeps the total unchanged', () => {
    const w = [2, 1, 3];
    expect(sum(resizeBetween(w, 1, -40, 900))).toBeCloseTo(sum(w));
  });

  it('never squeezes either pane below the minimum', () => {
    expect(px(resizeBetween([1, 1], 0, 5000, 1000), 1000)).toEqual([1000 - MIN_PANE_PX, MIN_PANE_PX]);
    expect(px(resizeBetween([1, 1], 0, -5000, 1000), 1000)).toEqual([MIN_PANE_PX, 1000 - MIN_PANE_PX]);
  });

  it('splits a pair evenly when it is too small for two minimums', () => {
    expect(px(resizeBetween([1, 1], 0, 80, 150), 150)).toEqual([75, 75]);
  });

  it('ignores a sash index that does not exist, or a zero-size container', () => {
    const w = [1, 1];
    expect(resizeBetween(w, 1, 50, 1000)).toBe(w);
    expect(resizeBetween(w, -1, 50, 1000)).toBe(w);
    expect(resizeBetween(w, 0, 50, 0)).toBe(w);
  });
});

describe('split weights', () => {
  it('equalWeights gives n equal panes', () => {
    expect(equalWeights(3)).toEqual([1, 1, 1]);
    expect(equalWeights(0)).toEqual([]);
  });

  it('a new pane takes half of the one it splits, leaving the rest alone', () => {
    expect(splitWeightAt([2, 4, 2], 1)).toEqual([2, 2, 2, 2]);
    expect(splitWeightAt([], 0)).toEqual([1]);
  });

  it('a closed pane gives its space to its left neighbour, or right if it was first', () => {
    expect(removeWeightAt([1, 2, 3], 1)).toEqual([3, 3]);
    expect(removeWeightAt([1, 2, 3], 0)).toEqual([3, 3]);
    expect(removeWeightAt([5], 0)).toEqual([]);
    expect(removeWeightAt([1, 2], 9)).toEqual([1, 2]);
  });
});
