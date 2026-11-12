import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));

let resolveLinkNames: (typeof import('../src/main/linkNames'))['resolveLinkNames'];
beforeAll(async () => { ({ resolveLinkNames } = await import('../src/main/linkNames')); });
afterEach(() => vi.unstubAllGlobals());

const pd = (id: string) => `https://pixeldrain.com/u/${id}`;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('names for share links, from the host that knows them', () => {
  it('asks the host for each share link’s file name', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      const id = /file\/([^/]+)\/info/.exec(url)?.[1] ?? '';
      return reply({ name: `Game.part0${id.length}.rar`, size: 5 });
    });
    const names = await resolveLinkNames([pd('a'), pd('bb'), pd('ccc')]);
    expect(names).toEqual({ [pd('a')]: 'Game.part01.rar', [pd('bb')]: 'Game.part02.rar', [pd('ccc')]: 'Game.part03.rar' });
    expect(asked.sort()).toEqual(['https://pixeldrain.com/api/file/a/info', 'https://pixeldrain.com/api/file/bb/info', 'https://pixeldrain.com/api/file/ccc/info']);
  });

  it('leaves out what the host does not answer for, instead of failing the list', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/bad/')) throw new Error('connection reset');
      if (url.includes('/gone/')) return reply({ success: false }, 404);
      return reply({ name: 'Real.name.zip' });
    });
    const names = await resolveLinkNames([pd('ok'), pd('bad'), pd('gone')]);
    expect(names).toEqual({ [pd('ok')]: 'Real.name.zip' });
  });

  it('asks again once when a reset interrupts it', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      if (calls === 1) throw new Error('forcibly closed');
      return reply({ name: 'Second.try.rar' });
    });
    expect(await resolveLinkNames([pd('x')])).toEqual({ [pd('x')]: 'Second.try.rar' });
    expect(calls).toBe(2);
  });

  it('does not take text that is not a file name, and does not touch other hosts at all', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      return reply({ name: 'Untitled' });
    });
    const names = await resolveLinkNames([pd('p'), 'https://example.com/get/abc', 'https://gofile.io/d/AbC123']);
    expect(names).toEqual({});
    expect(asked).toEqual(['https://pixeldrain.com/api/file/p/info']);
  });

  it('never has more than three questions open at once', async () => {
    let open = 0;
    let most = 0;
    vi.stubGlobal('fetch', async () => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 15));
      open--;
      return reply({ name: 'A.rar' });
    });
    await resolveLinkNames(Array.from({ length: 10 }, (_, i) => pd(`id${i}`)));
    expect(most).toBeLessThanOrEqual(3);
    expect(most).toBeGreaterThan(1);
  });
});
