import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ read: (() => '') as () => string, watcher: true }));

vi.mock('electron', () => ({ clipboard: { readText: () => state.read() }, globalShortcut: { register: () => true, unregister: () => undefined } }));
vi.mock('../src/main/settings', () => ({ settings: { get: () => ({ general: { clipboardWatcher: state.watcher, globalShortcut: '' } }) } }));
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));

import { watchClipboard } from '../src/main/shortcuts';

const rejections: unknown[] = [];
const onRejection = (e: unknown) => rejections.push(e);

beforeEach(() => {
  vi.useFakeTimers();
  state.read = () => '';
  state.watcher = true;
  rejections.length = 0;
  process.on('unhandledRejection', onRejection);
});
afterEach(() => {
  process.off('unhandledRejection', onRejection);
  vi.useRealTimers();
});

describe('watching the clipboard for links', () => {
  it('reports a link copied after Lumina started, once, and not the one that was already there', async () => {
    const found: string[] = [];
    let text = 'https://example.org/already/there';
    state.read = () => text;
    const stop = watchClipboard((u) => found.push(u));
    await vi.advanceTimersByTimeAsync(1300);
    expect(found).toEqual([]);
    text = 'https://example.org/new/file.zip';
    await vi.advanceTimersByTimeAsync(1300);
    await vi.advanceTimersByTimeAsync(1300);
    expect(found).toEqual(['https://example.org/new/file.zip']);
    stop();
  });

  it('carries on quietly when another program has the clipboard open (the read throws), and picks the link up when it lets go', async () => {
    const found: string[] = [];
    let locked = true;
    let text = 'start';
    state.read = () => { if (locked) throw new Error('OpenClipboard failed'); return text; };
    const stop = watchClipboard((u) => found.push(u));
    await vi.advanceTimersByTimeAsync(5000); // several ticks, all refused
    expect(rejections).toEqual([]);
    locked = false;
    await vi.advanceTimersByTimeAsync(1300); // the first successful read only records what is there
    text = 'magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12';
    await vi.advanceTimersByTimeAsync(1300);
    expect(found).toHaveLength(1);
    expect(rejections).toEqual([]);
    stop();
  });

  it('does not let a failing handler stop the watching', async () => {
    let calls = 0;
    let text = 'a';
    state.read = () => text;
    const stop = watchClipboard(() => { calls++; throw new Error('handler failed'); });
    await vi.advanceTimersByTimeAsync(1300);
    text = 'https://example.org/one/file.zip';
    await vi.advanceTimersByTimeAsync(1300);
    text = 'https://example.org/two/file.zip';
    await vi.advanceTimersByTimeAsync(1300);
    expect(calls).toBe(2);
    expect(rejections).toEqual([]);
    stop();
  });

  it('reads nothing while the watcher is switched off', async () => {
    state.watcher = false;
    const read = vi.fn(() => 'https://example.org/x/file.zip');
    state.read = read;
    const stop = watchClipboard(() => undefined);
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).not.toHaveBeenCalled();
    stop();
  });
});
