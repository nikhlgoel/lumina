import { describe, it, expect } from 'vitest';
import {
  detectPackageManager, detectUrls, mergeUrls, parseScripts, runCommand, stripAnsi,
} from '@core/tasks';

const ESC = String.fromCharCode(27);

describe('detectPackageManager', () => {
  it('reads the lockfile', () => {
    expect(detectPackageManager(['pnpm-lock.yaml', 'package.json'])).toBe('pnpm');
    expect(detectPackageManager(['yarn.lock'])).toBe('yarn');
    expect(detectPackageManager(['bun.lockb'])).toBe('bun');
    expect(detectPackageManager(['package-lock.json'])).toBe('npm');
  });

  it('falls back to npm when there is no lockfile', () => {
    expect(detectPackageManager(['package.json', 'README.md'])).toBe('npm');
    expect(detectPackageManager([])).toBe('npm');
  });

  it('believes an explicit packageManager field over the lockfile', () => {
    expect(detectPackageManager(['package-lock.json'], 'pnpm@9.1.0')).toBe('pnpm');
    expect(detectPackageManager([], 'yarn@4.0.0')).toBe('yarn');
    expect(detectPackageManager([], 'bun')).toBe('bun');
  });

  it('ignores a packageManager field naming something we do not know', () => {
    expect(detectPackageManager(['pnpm-lock.yaml'], 'cnpm@1.0.0')).toBe('pnpm');
  });

  it('picks deterministically when several lockfiles are present', () => {
    expect(detectPackageManager(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'])).toBe('pnpm');
  });

  it('is case-insensitive about filenames', () => {
    expect(detectPackageManager(['PNPM-LOCK.YAML'])).toBe('pnpm');
  });
});

describe('parseScripts', () => {
  it('keeps the order package.json used', () => {
    const tasks = parseScripts({ scripts: { dev: 'vite', build: 'tsc && vite build', test: 'vitest run' } });
    expect(tasks.map((t) => t.name)).toEqual(['dev', 'build', 'test']);
    expect(tasks[1]!.command).toBe('tsc && vite build');
  });

  it('drops entries that are not string commands', () => {
    const tasks = parseScripts({ scripts: { ok: 'run me', bad: 42, worse: null, '': 'no name' } });
    expect(tasks.map((t) => t.name)).toEqual(['ok']);
  });

  it('returns nothing for junk instead of throwing', () => {
    expect(parseScripts(null)).toEqual([]);
    expect(parseScripts({})).toEqual([]);
    expect(parseScripts({ scripts: 'nope' })).toEqual([]);
    expect(parseScripts({ scripts: ['a'] })).toEqual([]);
  });

  it('truncates an absurdly long command rather than carrying it around', () => {
    expect(parseScripts({ scripts: { x: 'a'.repeat(5000) } })[0]!.command).toHaveLength(500);
  });
});

describe('runCommand', () => {
  it('always uses "run", so a script cannot collide with a built-in subcommand', () => {
    expect(runCommand('pnpm', 'dev')).toBe('pnpm run dev');
    expect(runCommand('npm', 'build')).toBe('npm run build');
    expect(runCommand('yarn', 'add')).toBe('yarn run add');
    expect(runCommand('bun', 'test')).toBe('bun run test');
  });
});

describe('stripAnsi', () => {
  it('removes colour codes', () => {
    expect(stripAnsi(`${ESC}[32mready${ESC}[0m`)).toBe('ready');
  });

  it('removes an OSC window-title sequence', () => {
    expect(stripAnsi(`${ESC}]0;a title${String.fromCharCode(7)}done`)).toBe('done');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });
});

describe('detectUrls', () => {
  it('finds a Vite-style banner through the colour codes', () => {
    const line = `  ${ESC}[32m>${ESC}[0m  ${ESC}[1mLocal${ESC}[0m:   ${ESC}[36mhttp://localhost:5173/${ESC}[0m`;
    expect(detectUrls(line)).toEqual([{ url: 'http://localhost:5173/', port: 5173, local: true }]);
  });

  it('rewrites 0.0.0.0 to localhost, which is what a browser can actually open', () => {
    const [found] = detectUrls('Listening on http://0.0.0.0:8080');
    expect(found!.url).toBe('http://localhost:8080/');
    expect(found!.port).toBe(8080);
  });

  it('marks a non-loopback host as not local', () => {
    const [found] = detectUrls('Network: http://192.168.1.20:5173/');
    expect(found).toMatchObject({ port: 5173, local: false });
  });

  it('strips trailing prose punctuation', () => {
    expect(detectUrls('Server started at http://localhost:3000.')[0]!.url).toBe('http://localhost:3000/');
  });

  it('keeps a path on the URL', () => {
    expect(detectUrls('open http://localhost:4200/app/dashboard')[0]!.url)
      .toBe('http://localhost:4200/app/dashboard');
  });

  it('reports each distinct URL once, in the order seen', () => {
    const found = detectUrls('a http://localhost:3000 b http://localhost:3000 c http://localhost:4000');
    expect(found.map((u) => u.port)).toEqual([3000, 4000]);
  });

  it('ignores URLs without a port, so documentation links are not treated as servers', () => {
    expect(detectUrls('see https://vitejs.dev/guide/ for help')).toEqual([]);
  });

  it('ignores an impossible port', () => {
    expect(detectUrls('http://localhost:99999')).toEqual([]);
  });

  it('returns nothing for output with no URLs', () => {
    expect(detectUrls('building...\ncompiled 42 modules')).toEqual([]);
    expect(detectUrls('')).toEqual([]);
  });

  it('handles https', () => {
    expect(detectUrls('https://localhost:8443/')[0]).toMatchObject({ port: 8443, local: true });
  });
});

describe('mergeUrls', () => {
  const u = (port: number) => ({ url: `http://localhost:${port}/`, port, local: true });

  it('adds new entries and ignores repeats', () => {
    expect(mergeUrls([u(3000)], [u(3000), u(4000)]).map((x) => x.port)).toEqual([3000, 4000]);
  });

  it('keeps the existing list when nothing is new', () => {
    expect(mergeUrls([u(3000)], [])).toEqual([u(3000)]);
  });

  it('drops the oldest once the cap is reached', () => {
    const existing = [u(1000), u(2000), u(3000)];
    expect(mergeUrls(existing, [u(4000)], 3).map((x) => x.port)).toEqual([2000, 3000, 4000]);
  });

  it('does not mutate the list it was given', () => {
    const existing = [u(3000)];
    mergeUrls(existing, [u(4000)]);
    expect(existing).toHaveLength(1);
  });
});
