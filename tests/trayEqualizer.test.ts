import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tray's equalizer submenu is built from the settings and the preset list; everything else the tray module imports is stubbed.
const state = vi.hoisted(() => ({
  player: { eqEnabled: true, eqProfile: 'flat', eqPresets: [] as unknown[] },
  updates: [] as unknown[],
}));

vi.mock('electron', () => ({ app: { isPackaged: false }, Menu: { buildFromTemplate: (t: unknown) => t }, Tray: class {}, nativeImage: {} }));
vi.mock('../src/main/settings', () => ({
  settings: { get: () => ({ player: state.player }), update: (patch: unknown) => { state.updates.push(patch); }, on: () => undefined },
}));
vi.mock('../src/main/paths', () => ({ iconPath: (n: string) => n }));
vi.mock('../src/main/window', () => ({ mainWindow: () => null, showWindow: () => undefined }));
vi.mock('../src/main/jobs/queue', () => ({ queue: { list: () => [], on: () => undefined } }));
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));

import { equalizerSubmenu } from '../src/main/tray';
import { EQ_PROFILES } from '../src/core/equalizer';

type Item = { label?: string; type?: string; checked?: boolean; enabled?: boolean; click?: () => void; submenu?: Item[] };
const flat = (items: Item[]): Item[] => items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu) : [])]);

beforeEach(() => {
  state.player = { eqEnabled: true, eqProfile: 'flat', eqPresets: [] };
  state.updates.length = 0;
});

describe('the tray’s equalizer menu', () => {
  it('offers Off, the everyday presets, a submenu each for genres and situations, and every preset exactly once', () => {
    const menu = equalizerSubmenu() as Item[];
    expect(menu[0]).toMatchObject({ label: 'Off', type: 'radio' });
    expect(menu.filter((i) => i.submenu).map((i) => i.label)).toEqual(['Genres', 'Situations']);
    const labels = flat(menu).map((i) => i.label);
    for (const p of EQ_PROFILES) expect(labels.filter((l) => l === p.name), p.name).toHaveLength(1);
  });

  it('marks the preset in use, and Off when the equalizer is off', () => {
    state.player.eqProfile = 'jazz';
    const on = flat(equalizerSubmenu() as Item[]).filter((i) => i.checked);
    expect(on.map((i) => i.label)).toEqual(['Jazz']);
    state.player.eqEnabled = false;
    expect(flat(equalizerSubmenu() as Item[]).filter((i) => i.checked).map((i) => i.label)).toEqual(['Off']);
  });

  it('turns the equalizer on and picks the preset when one is chosen', () => {
    const rock = flat(equalizerSubmenu() as Item[]).find((i) => i.label === 'Rock')!;
    rock.click?.();
    expect(state.updates).toEqual([{ player: { eqEnabled: true, eqProfile: 'rock' } }]);
  });

  it('lists the person’s own presets, ignoring junk, and chooses them by their id', () => {
    state.player.eqProfile = 'u-abc123';
    state.player.eqPresets = [{ id: 'u-abc123', name: 'Night', bands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, { id: 'bad', name: 'x', bands: [] }, null];
    const items = flat(equalizerSubmenu() as Item[]);
    expect(items.map((i) => i.label)).toContain('Night');
    expect(items.map((i) => i.label)).not.toContain('x');
    expect(items.find((i) => i.label === 'Night')?.checked).toBe(true);
    items.find((i) => i.label === 'Night')!.click?.();
    expect(state.updates.at(-1)).toEqual({ player: { eqEnabled: true, eqProfile: 'u-abc123' } });
  });

  it('says so, and cannot be picked, when the curve has been edited', () => {
    state.player.eqProfile = 'custom';
    const edited = flat(equalizerSubmenu() as Item[]).find((i) => /^Edited/.test(i.label ?? ''));
    expect(edited).toMatchObject({ checked: true, enabled: false });
  });
});
