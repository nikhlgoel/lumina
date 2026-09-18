import { describe, it, expect } from 'vitest';
import {
  MAX_EDITOR_GROUPS, activeGroup, allDirty, closeGroup, closeIn, focusGroup, initialGroups, isDirtyAnywhere,
  isOpenAnywhere, openIn, orphanedBy, setDirtyEverywhere, splitGroup,
} from '@core/editorGroups';

const paths = (s: ReturnType<typeof initialGroups>, id: string) =>
  s.groups.find((g) => g.id === id)!.tabs.tabs.map((t) => t.path);

describe('editor groups', () => {
  it('starts with one empty group that is active', () => {
    const s = initialGroups();
    expect(s.groups).toHaveLength(1);
    expect(activeGroup(s).tabs.tabs).toEqual([]);
  });

  it('opens into the active group by default', () => {
    const s = openIn(initialGroups(), 'a.ts', { preview: false });
    expect(paths(s, 'g1')).toEqual(['a.ts']);
  });

  it('split right puts the same file in a new group to the right, as a permanent tab', () => {
    let s = openIn(initialGroups(), 'a.ts');
    s = splitGroup(s, 'g1', 'g2');
    expect(s.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(s.active).toBe('g2');
    expect(s.groups[1]!.tabs.tabs[0]).toMatchObject({ path: 'a.ts', preview: false });
  });

  it('split inserts beside the source group, not at the end', () => {
    let s = splitGroup(splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2'), 'g1', 'g3');
    expect(s.groups.map((g) => g.id)).toEqual(['g1', 'g3', 'g2']);
    s = focusGroup(s, 'g2');
    expect(s.active).toBe('g2');
  });

  it('refuses to split past the maximum', () => {
    let s = openIn(initialGroups(), 'a.ts');
    for (let i = 2; i <= MAX_EDITOR_GROUPS; i++) s = splitGroup(s, 'g1', `g${i}`);
    expect(splitGroup(s, 'g1', 'extra')).toBe(s);
  });

  it('an empty group can still be split, giving an empty neighbour', () => {
    expect(splitGroup(initialGroups(), 'g1', 'g2').groups[1]!.tabs.tabs).toEqual([]);
  });

  it('opening into a named group makes it active', () => {
    const s = openIn(splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2'), 'b.ts', { group: 'g1' });
    expect(s.active).toBe('g1');
    expect(paths(s, 'g1')).toContain('b.ts');
  });
});

describe('shared buffers: unsaved state belongs to the file', () => {
  it('marking a file dirty marks it in every group that shows it', () => {
    const s = setDirtyEverywhere(splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2'), 'a.ts', true);
    expect(s.groups.every((g) => g.tabs.tabs[0]!.dirty)).toBe(true);
    expect(allDirty(s)).toEqual(['a.ts']);
  });

  it('opening an already-dirty file in another group shows it as dirty there', () => {
    let s = splitGroup(openIn(initialGroups(), 'x.ts'), 'g1', 'g2');
    s = openIn(s, 'a.ts', { group: 'g1', preview: false });
    s = setDirtyEverywhere(s, 'a.ts', true);
    s = openIn(s, 'a.ts', { group: 'g2' });
    expect(s.groups[1]!.tabs.tabs.find((t) => t.path === 'a.ts')!.dirty).toBe(true);
  });

  it('saving clears it everywhere', () => {
    let s = setDirtyEverywhere(splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2'), 'a.ts', true);
    s = setDirtyEverywhere(s, 'a.ts', false);
    expect(isDirtyAnywhere(s, 'a.ts')).toBe(false);
  });
});

describe('closing', () => {
  it('a file open in two groups stays open when closed in one, so its buffer is kept', () => {
    expect(closeIn(splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2'), 'g2', 'a.ts').stillOpen).toBe(true);
  });

  it('closing the last copy reports the file closed everywhere, so its buffer can go', () => {
    const r = closeIn(openIn(initialGroups(), 'a.ts'), 'g1', 'a.ts');
    expect(r.stillOpen).toBe(false);
    expect(isOpenAnywhere(r.state, 'a.ts')).toBe(false);
  });

  it('an emptied group closes itself and focus moves left', () => {
    const r = closeIn(splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2'), 'g2', 'a.ts');
    expect(r.state.groups.map((g) => g.id)).toEqual(['g1']);
    expect(r.state.active).toBe('g1');
  });

  it('the last group never closes itself, even when empty', () => {
    expect(closeIn(openIn(initialGroups(), 'a.ts'), 'g1', 'a.ts').state.groups).toHaveLength(1);
  });

  it('closing the first group moves focus to the new first group', () => {
    const s = focusGroup(splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2'), 'g1');
    expect(closeGroup(s, 'g1')).toMatchObject({ active: 'g2', groups: [{ id: 'g2' }] });
  });

  it('closing an inactive group keeps focus where it was', () => {
    const s = splitGroup(splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2'), 'g2', 'g3');
    expect(closeGroup(s, 'g1').active).toBe('g3');
  });

  it('orphanedBy lists only files that no other group shows', () => {
    let s = splitGroup(openIn(initialGroups(), 'a.ts'), 'g1', 'g2');
    s = openIn(s, 'b.ts', { group: 'g2', preview: false });
    expect(orphanedBy(s, 'g2')).toEqual(['b.ts']);
    expect(orphanedBy(s, 'nope')).toEqual([]);
  });
});
