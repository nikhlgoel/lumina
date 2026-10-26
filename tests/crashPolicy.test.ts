import { describe, it, expect } from 'vitest';
import {
  RELOAD_LIMIT, RELOAD_WINDOW_MS, decideRendererGone, describeThrown, isHarmlessStreamError, noteError,
} from '@core/crashPolicy';

describe('a renderer that died', () => {
  const T = 5_000_000;

  it('is reloaded the first time, whatever killed it', () => {
    for (const reason of ['crashed', 'abnormal-exit', 'killed', 'oom', 'launch-failed', 'integrity-failure']) {
      expect(decideRendererGone(reason, [], T).action, reason).toBe('reload');
    }
  });

  it('is left alone when the window was simply closed', () => {
    expect(decideRendererGone('clean-exit', [], T)).toEqual({ action: 'ignore', history: [] });
  });

  it('is reloaded a few times, then given up on, instead of flashing forever', () => {
    let history: number[] = [];
    const actions: string[] = [];
    for (let i = 0; i <= RELOAD_LIMIT; i++) {
      const d = decideRendererGone('crashed', history, T + i * 1000);
      actions.push(d.action);
      history = d.history;
    }
    expect(actions).toEqual(['reload', 'reload', 'reload', 'give-up']);
  });

  it('forgets old crashes: one an hour ago does not count against a new one', () => {
    const old = [T - 3_600_000, T - 3_000_000, T - 2_000_000];
    const d = decideRendererGone('crashed', old, T);
    expect(d.action).toBe('reload');
    expect(d.history).toEqual([T]);
  });

  it('counts only the window, exactly', () => {
    const history = [T - RELOAD_WINDOW_MS + 1, T - 10, T - 5];
    expect(decideRendererGone('crashed', history, T).action).toBe('give-up');
    expect(decideRendererGone('crashed', [T - RELOAD_WINDOW_MS, T - 10, T - 5], T).action).toBe('reload');
  });
});

describe('errors from a console nobody reads', () => {
  it('treats a broken pipe as harmless, and nothing else', () => {
    expect(isHarmlessStreamError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true);
    expect(isHarmlessStreamError(new Error('write EPIPE'))).toBe(true);
    expect(isHarmlessStreamError(Object.assign(new Error('x'), { code: 'ERR_STREAM_DESTROYED' }))).toBe(true);
    expect(isHarmlessStreamError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isHarmlessStreamError('EPIPE')).toBe(false);
  });
});

describe('one bug throwing in a loop', () => {
  it('logs the first twenty a minute and holds the rest back', () => {
    let times: number[] = [];
    let logged = 0;
    for (let i = 0; i < 50; i++) {
      const b = noteError(times, 1_000 + i * 10);
      times = b.times;
      if (b.log) logged++;
    }
    expect(logged).toBe(20);
  });

  it('starts logging again once the minute has passed', () => {
    let times: number[] = [];
    for (let i = 0; i < 30; i++) times = noteError(times, 1_000 + i).times;
    expect(noteError(times, 1_000 + 61_000).log).toBe(true);
  });
});

describe('describing whatever was thrown', () => {
  it('gives an error its stack, and anything else something readable', () => {
    expect(describeThrown(new Error('boom'))).toContain('boom');
    expect(describeThrown('plain text')).toBe('plain text');
    expect(describeThrown({ code: 7 })).toBe('{"code":7}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeThrown(circular)).toBe('[object Object]');
    expect(describeThrown(undefined)).toBe('undefined');
  });
});
