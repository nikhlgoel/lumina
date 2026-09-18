import { describe, it, expect } from 'vitest';
import {
  SEEK_STEP_S, VOLUME_PRESETS, downloadItems, idlePlayback, isPresetActive, nextVolume, nowPlayingLabel, pauseAllOrder,
  playbackItems, volumeLabel, type TrayItem, type TrayPlayback,
} from '@core/trayMenu';
import { int, pick, rng, str } from './helpers/rng';

const state = (over: Partial<TrayPlayback> = {}): TrayPlayback => ({ ...idlePlayback(), title: 'Song', artist: 'Band', ...over });
const find = (items: TrayItem[], label: string) => items.find((i) => i.label === label);
const byPrefix = (items: TrayItem[], prefix: string) => items.find((i) => i.label?.startsWith(prefix));

describe('playback controls', () => {
  it('offers Play or Pause to match what is happening', () => {
    expect(find(playbackItems(state({ playing: false })), 'Play')).toBeDefined();
    expect(find(playbackItems(state({ playing: true })), 'Pause')).toBeDefined();
  });

  it('disables transport controls when nothing is loaded, but keeps mute and volume usable', () => {
    const items = playbackItems(idlePlayback());
    for (const label of ['Play', 'Next', 'Previous', `Back ${SEEK_STEP_S} seconds`, `Forward ${SEEK_STEP_S} seconds`]) {
      expect(find(items, label)?.enabled, label).toBe(false);
    }
    expect(find(items, 'Mute')?.enabled).not.toBe(false);
    expect(byPrefix(items, 'Volume')?.enabled).not.toBe(false);
  });

  it('seeks back and forward by the step, as commands the player understands', () => {
    const items = playbackItems(state());
    expect(find(items, `Back ${SEEK_STEP_S} seconds`)?.run).toEqual({ command: 'seek-by', value: -SEEK_STEP_S });
    expect(find(items, `Forward ${SEEK_STEP_S} seconds`)?.run).toEqual({ command: 'seek-by', value: SEEK_STEP_S });
  });

  it('shows the now-playing line, and says so when nothing is playing', () => {
    expect(playbackItems(state())[0]!.label).toBe('Song — Band');
    expect(playbackItems(idlePlayback())[0]!.label).toBe('Nothing playing');
  });
});

describe('mute', () => {
  it('is a checkbox ticked exactly when muted', () => {
    expect(find(playbackItems(state({ muted: true })), 'Mute')).toMatchObject({ type: 'checkbox', checked: true, run: { command: 'mute' } });
    expect(find(playbackItems(state({ muted: false })), 'Mute')?.checked).toBe(false);
  });

  it('the volume submenu title never contradicts the mute tick', () => {
    expect(volumeLabel(state({ muted: true, volume: 0.8 }))).toBe('Volume — muted');
    expect(volumeLabel(state({ muted: false, volume: 0.8 }))).toBe('Volume 80%');
  });
});

describe('volume', () => {
  const submenu = (s: TrayPlayback) => byPrefix(playbackItems(s), 'Volume')!.submenu!;

  it('marks the preset in effect, and only that one', () => {
    const radios = submenu(state({ volume: 0.5 })).filter((i) => i.type === 'radio');
    expect(radios.filter((i) => i.checked).map((i) => i.label)).toEqual(['50%']);
  });

  it('marks no preset for a volume between presets', () => {
    expect(submenu(state({ volume: 0.62 })).some((i) => i.checked)).toBe(false);
  });

  it('marks no preset while muted, even at a preset volume', () => {
    expect(submenu(state({ volume: 0.5, muted: true })).some((i) => i.checked)).toBe(false);
  });

  it('disables Louder at full volume and Quieter at silence or while muted', () => {
    expect(byPrefix(submenu(state({ volume: 1 })), 'Louder')?.enabled).toBe(false);
    expect(byPrefix(submenu(state({ volume: 0 })), 'Quieter')?.enabled).toBe(false);
    expect(byPrefix(submenu(state({ volume: 0.5, muted: true })), 'Quieter')?.enabled).toBe(false);
    // Louder stays usable while muted — it is the natural way back to sound.
    expect(byPrefix(submenu(state({ volume: 1, muted: true })), 'Louder')?.enabled).toBe(true);
  });

  it('offers every preset as a command to set that exact volume', () => {
    const cmds = submenu(state()).filter((i) => i.type === 'radio').map((i) => i.run);
    expect(cmds).toEqual(VOLUME_PRESETS.map((value) => ({ command: 'volume', value })));
  });

  it('nextVolume stays inside 0..1 and lands on whole percents', () => {
    expect(nextVolume(0.95, 0.1)).toBe(1);
    expect(nextVolume(0.05, -0.1)).toBe(0);
    expect(nextVolume(0.2, 0.1)).toBe(0.3); // not 0.30000000000000004
  });

  it('property: 10,000 random steps never leave 0..1 and never drift off whole percents', () => {
    const r = rng(901);
    let v = 0.8;
    for (let i = 0; i < 10_000; i++) {
      v = nextVolume(v, pick(r, [0.1, -0.1, 0.1, -0.1, 0.05, -0.3]));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-9);
    }
  });

  it('isPresetActive tolerates float noise but not a real difference', () => {
    expect(isPresetActive(0.5, state({ volume: 0.5000001 }))).toBe(true);
    expect(isPresetActive(0.5, state({ volume: 0.51 }))).toBe(false);
  });
});

describe('shuffle and repeat', () => {
  it('shuffle is a checkbox that mirrors the player', () => {
    expect(find(playbackItems(state({ shuffle: true })), 'Shuffle')).toMatchObject({ type: 'checkbox', checked: true, run: { command: 'shuffle' } });
  });

  it('repeat offers all three modes with exactly the current one marked', () => {
    for (const mode of ['off', 'all', 'one'] as const) {
      const sub = find(playbackItems(state({ repeat: mode })), 'Repeat')!.submenu!;
      expect(sub.map((i) => i.run)).toEqual([{ command: 'repeat', mode: 'off' }, { command: 'repeat', mode: 'all' }, { command: 'repeat', mode: 'one' }]);
      expect(sub.filter((i) => i.checked)).toHaveLength(1);
      expect(sub.find((i) => i.checked)!.run).toEqual({ command: 'repeat', mode });
    }
  });
});

describe('the menu never contradicts the player (property, 10,000 random states)', () => {
  it('holds for every combination of state', () => {
    const r = rng(902);
    for (let i = 0; i < 10_000; i++) {
      const s: TrayPlayback = {
        playing: r() < 0.5,
        title: r() < 0.8 ? str(r, 'ab c漢🙂—', 80) || 'x' : null,
        artist: r() < 0.5 ? str(r, 'ab c', 30) : null,
        volume: pick(r, [...VOLUME_PRESETS, 0, r(), 0.5000001]),
        muted: r() < 0.3,
        shuffle: r() < 0.5,
        repeat: pick(r, ['off', 'all', 'one'] as const),
      };
      const items = playbackItems(s);
      expect(find(items, 'Mute')!.checked).toBe(s.muted);
      expect(find(items, 'Shuffle')!.checked).toBe(s.shuffle);
      expect(find(items, s.playing ? 'Pause' : 'Play')).toBeDefined();
      const vol = byPrefix(items, 'Volume')!.submenu!.filter((x) => x.checked);
      expect(vol.length).toBeLessThanOrEqual(1);
      if (s.muted) expect(vol).toHaveLength(0);
      // The now-playing line always fits a menu, counted in characters people see.
      expect([...items[0]!.label!].length).toBeLessThanOrEqual(48);
    }
  });
});

describe('nowPlayingLabel', () => {
  it('trims long titles without splitting an emoji in half', () => {
    const label = nowPlayingLabel(state({ title: '🙂'.repeat(60), artist: null }), 10);
    expect([...label]).toHaveLength(10);
    expect(label.endsWith('…')).toBe(true);
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no lone high surrogate
  });
});

describe('downloads', () => {
  it('shows the right status and only the actions that would do something', () => {
    expect(downloadItems({ active: 0, waiting: 0, paused: 0 }).map((i) => i.label)).toEqual(['No active downloads']);
    expect(downloadItems({ active: 2, waiting: 1, paused: 0 }).map((i) => i.label)).toEqual(['2 downloads in progress · 1 waiting', 'Pause all downloads']);
    expect(downloadItems({ active: 0, waiting: 0, paused: 3 }).map((i) => i.label)).toEqual(['3 downloads paused', 'Resume all downloads']);
    expect(downloadItems({ active: 1, waiting: 0, paused: 1 }).map((i) => i.label)).toEqual(['1 download in progress', 'Pause all downloads', 'Resume all downloads']);
  });

  it('counts waiting downloads as pausable — otherwise "pause all" would pause nothing', () => {
    expect(downloadItems({ active: 0, waiting: 2, paused: 0 }).map((i) => i.label)).toEqual(['2 downloads waiting', 'Pause all downloads']);
  });

  it('pauses waiting jobs BEFORE running ones, so a freed slot cannot start the next download', () => {
    const jobs = [
      { id: 'r1', status: 'running' }, { id: 'q1', status: 'queued' }, { id: 'p1', status: 'processing' },
      { id: 'q2', status: 'queued' }, { id: 'done', status: 'completed' }, { id: 'x', status: 'paused' },
    ];
    expect(pauseAllOrder(jobs)).toEqual(['q1', 'q2', 'r1', 'p1']);
  });

  it('property: pause order covers exactly the pausable jobs, all waiting ones first', () => {
    const r = rng(903);
    const STATUSES = ['queued', 'running', 'processing', 'paused', 'completed', 'failed', 'cancelled'];
    for (let i = 0; i < 5000; i++) {
      const jobs = Array.from({ length: int(r, 0, 20) }, (_, k) => ({ id: `j${k}`, status: pick(r, STATUSES) }));
      const order = pauseAllOrder(jobs);
      const pausable = jobs.filter((j) => ['queued', 'running', 'processing'].includes(j.status)).map((j) => j.id);
      expect([...order].sort()).toEqual([...pausable].sort());
      const statusOf = (id: string) => jobs.find((j) => j.id === id)!.status;
      const firstRunning = order.findIndex((id) => statusOf(id) !== 'queued');
      if (firstRunning >= 0) expect(order.slice(firstRunning).every((id) => statusOf(id) !== 'queued')).toBe(true);
    }
  });
});
