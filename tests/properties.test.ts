// Property tests: thousands of seeded random inputs per rule, checked against an independent oracle
// or an invariant that must always hold. Aimed first at the code where a bug is a security hole —
// the workspace path guard, the MCP command validator, the parsers that read other programs'
// output — and then at the state machines behind the IDE layout, where a bug loses someone's work.
//
// Every generator is seeded (tests/helpers/rng.ts), so a failure is reproducible exactly.
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyRank, isInsideWorkspace } from '@core/ide';
import { decodeFrames, encodeFrame, parseCommandLine, validateServerConfig } from '@core/mcp';
import { parseStatus } from '@core/git';
import {
  MAX_SPLIT, MIN_PANE_PX, PART_LIMITS, addTerminal, emptyGroups, focusTerminal, normalizeLayout, removeTerminal,
  resizeBetween, splitTerminal, type TerminalGroups,
} from '@core/ideLayout';
import {
  MAX_EDITOR_GROUPS, closeGroup, closeIn, focusGroup, initialGroups, openIn, setDirtyEverywhere, splitGroup,
  type EditorGroups,
} from '@core/editorGroups';
import { int, pick, rng, str } from './helpers/rng';

/* ------------------------------------------------------------------ */
/* The workspace guard — every IDE file read/write goes through this.  */
/* ------------------------------------------------------------------ */

describe('isInsideWorkspace agrees with an independent oracle (node:path)', () => {
  const SEGMENTS = ['a', 'b', 'src', '..', '.', 'ws', 'WS', 'ws-evil', 'ws.bak', 'sub dir', 'x.txt', '..\\..', '../..', 'a/../..'];

  it('win32: 20,000 random relative paths, including traversal and case tricks', () => {
    const root = 'C:\\Users\\me\\ws';
    const r = rng(101);
    for (let i = 0; i < 20_000; i++) {
      const n = int(r, 0, 6);
      const parts = Array.from({ length: n }, () => pick(r, SEGMENTS));
      const rel = parts.join(pick(r, ['/', '\\']));
      const abs = path.win32.resolve(root, rel);
      const oracleRel = path.win32.relative(root, abs);
      const oracle = oracleRel === '' || (!oracleRel.startsWith('..') && !path.win32.isAbsolute(oracleRel));
      expect(isInsideWorkspace(root, abs), `${rel} → ${abs}`).toBe(oracle);
    }
  });

  it('win32: absolute paths elsewhere — other drives, sibling folders sharing a prefix — are refused', () => {
    const root = 'C:\\Users\\me\\ws';
    for (const abs of ['D:\\Users\\me\\ws', 'C:\\Users\\me\\ws-evil\\x', 'C:\\Users\\me\\wsx', 'C:\\Users\\me', 'C:\\', 'C:\\Users\\me\\ws..\\x']) {
      expect(isInsideWorkspace(root, abs), abs).toBe(false);
    }
    for (const abs of ['C:\\Users\\me\\ws', 'c:\\users\\ME\\WS\\a', 'C:/Users/me/ws/deep/er']) {
      expect(isInsideWorkspace(root, abs), abs).toBe(true);
    }
  });

  it('posix: 20,000 random relative paths, case-sensitive', () => {
    const root = '/home/me/ws';
    const r = rng(102);
    for (let i = 0; i < 20_000; i++) {
      const n = int(r, 0, 6);
      const rel = Array.from({ length: n }, () => pick(r, SEGMENTS.filter((s) => !s.includes('\\')))).join('/');
      const abs = path.posix.resolve(root, rel);
      const oracleRel = path.posix.relative(root, abs);
      const oracle = oracleRel === '' || (!oracleRel.startsWith('..') && !path.posix.isAbsolute(oracleRel));
      expect(isInsideWorkspace(root, abs), `${rel} → ${abs}`).toBe(oracle);
    }
  });

  it('never throws, and refuses empty input', () => {
    const r = rng(103);
    for (let i = 0; i < 5000; i++) {
      const a = str(r, 'C:\\/.a b~%$\0é', 40);
      const b = str(r, 'C:\\/.a b~%$\0é', 40);
      expect(() => isInsideWorkspace(a, b)).not.toThrow();
    }
    expect(isInsideWorkspace('', 'C:\\x')).toBe(false);
    expect(isInsideWorkspace('C:\\x', '')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* MCP — the parts that decide what program Lumina will run.           */
/* ------------------------------------------------------------------ */

describe('parseCommandLine', () => {
  const SAFE = 'abcXYZ019-_./\\:=@$%&|;<>*~';

  it('round-trips plain tokens joined by spaces (5,000 cases)', () => {
    const r = rng(201);
    for (let i = 0; i < 5000; i++) {
      const tokens = Array.from({ length: int(r, 1, 8) }, () => str(r, SAFE, 12)).filter((t) => t.length > 0);
      if (tokens.length === 0) continue;
      expect(parseCommandLine(tokens.join(' '.repeat(int(r, 1, 3))))).toEqual(tokens);
    }
  });

  it('round-trips quoted tokens, including spaces and empty arguments (5,000 cases)', () => {
    const r = rng(202);
    for (let i = 0; i < 5000; i++) {
      const tokens = Array.from({ length: int(r, 1, 6) }, () => str(r, `${SAFE} '`, 12));
      const line = tokens.map((t) => `"${t}"`).join(' ');
      expect(parseCommandLine(line)).toEqual(tokens);
    }
  });

  it('never throws and never yields undefined, whatever it is given', () => {
    const r = rng(203);
    for (let i = 0; i < 10_000; i++) {
      const out = parseCommandLine(str(r, `ab "'\\\t\n$;|`, 60));
      expect(Array.isArray(out)).toBe(true);
      for (const t of out) expect(typeof t).toBe('string');
    }
  });
});

describe('validateServerConfig never lets an unsafe server through (20,000 random configs)', () => {
  const COMMANDS = ['npx', 'node', 'uvx', 'C:\\tools\\srv.exe', 'rm -rf /', 'a;b', 'a && b', 'x | y', '`id`', '$(id)', 'a > b', '{a}', '', '   ', 'python3'];
  const URLS = ['https://ok.example/mcp', 'http://127.0.0.1:3000/', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x', 'data:text/plain,hi', 'not a url', '', 'HTTPS://UPPER.example/'];

  it('holds every invariant on random input', () => {
    const r = rng(301);
    for (let i = 0; i < 20_000; i++) {
      const raw = {
        id: pick(r, ['fs', 'a-b_c', '', ' spaced id', '-lead', 'x'.repeat(60), 'ok1', '../evil']),
        name: pick(r, [undefined, 'Name', '', 'x'.repeat(200)]),
        transport: pick(r, ['stdio', 'http', 'sse', undefined, 'carrier-pigeon']),
        command: pick(r, [...COMMANDS, undefined]),
        args: pick(r, [undefined, [], ['-y', 'pkg'], Array.from({ length: 100 }, (_, k) => `a${k}`), ['', 'x']]),
        env: pick(r, [undefined, {}, { GOOD: '1', 'bad key': '2', '9x': '3', _ok: '4' }]),
        url: pick(r, [...URLS, undefined]),
        enabled: pick(r, [true, false, 'yes', 1, undefined, 'true']),
      } as Record<string, unknown>;

      let result: ReturnType<typeof validateServerConfig> | undefined;
      expect(() => { result = validateServerConfig(raw as never); }).not.toThrow();
      if (!result!.ok) continue;
      const c = result!.config;

      // Only an explicit boolean true switches a server on.
      expect(c.enabled).toBe(raw.enabled === true);
      expect(c.id).toMatch(/^[a-z0-9][a-z0-9-_]{0,48}$/i);

      if (c.transport === 'stdio') {
        expect(c.command!.trim().length).toBeGreaterThan(0);
        expect(c.command).not.toMatch(/[;&|><`$(){}]/);
        expect((c.args ?? []).length).toBeLessThanOrEqual(64);
        for (const k of Object.keys(c.env ?? {})) expect(k).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      } else {
        expect(['http:', 'https:']).toContain(new URL(c.url!).protocol);
      }
    }
  });
});

describe('MCP framing survives a stream cut at arbitrary points', () => {
  it('decoding chunk by chunk yields exactly what was sent (2,000 streams)', () => {
    const r = rng(401);
    for (let i = 0; i < 2000; i++) {
      const sent = Array.from({ length: int(r, 1, 8) }, (_, k) => ({
        jsonrpc: '2.0', id: k, method: pick(r, ['tools/list', 'initialize', 'tools/call']),
        params: { text: str(r, 'ab \n\t"\\{}漢🙂', 30) },
      }));
      const stream = sent.map((m) => encodeFrame(m)).join('');
      // Cut the stream into random pieces, as a pipe would deliver it.
      const received: unknown[] = [];
      let buffer = '';
      let at = 0;
      while (at < stream.length) {
        const next = Math.min(stream.length, at + int(r, 1, 40));
        const { messages, rest } = decodeFrames(buffer + stream.slice(at, next));
        received.push(...messages);
        buffer = rest;
        at = next;
      }
      expect(received).toEqual(sent);
      expect(buffer).toBe('');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Parsing another program's output: must never throw, never corrupt. */
/* ------------------------------------------------------------------ */

describe('parseStatus on hostile or truncated git output', () => {
  it('never throws and keeps its numbers sane (10,000 random outputs)', () => {
    const r = rng(501);
    const LINES = ['# branch.head main', '# branch.oid (initial)', '# branch.ab +3 -1', '# branch.ab +x -y', '# branch.upstream ', '1 MM N... 1 2 3 a b c.txt', '1', '2 R. N... 1 2 3 a b R100 new.txt', '2', 'u UU N...', '? a b.txt', '?', '! x', 'garbage', '', '# ', '#'];
    for (let i = 0; i < 10_000; i++) {
      const raw = Array.from({ length: int(r, 0, 12) }, () => pick(r, LINES)).join('\0') + (r() < 0.5 ? '\0' : '');
      let s: ReturnType<typeof parseStatus> | undefined;
      expect(() => { s = parseStatus(raw); }).not.toThrow();
      expect(Number.isInteger(s!.ahead) && s!.ahead >= 0).toBe(true);
      expect(Number.isInteger(s!.behind) && s!.behind >= 0).toBe(true);
      for (const f of s!.files) {
        expect(typeof f.path).toBe('string');
        expect(['unmodified', 'modified', 'added', 'deleted', 'renamed', 'copied', 'typechange', 'untracked', 'conflict']).toContain(f.index);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Quick Open ranking.                                                 */
/* ------------------------------------------------------------------ */

describe('fuzzyMatch', () => {
  // Deliberately includes characters whose lowercase form is longer (İ) and astral-plane emoji.
  const ALPHA = 'abcdefABCDEF_-./ 0123éÉİ漢🙂';

  it('finds any query made of characters taken in order from the name (5,000 cases)', () => {
    const r = rng(601);
    for (let i = 0; i < 5000; i++) {
      const target = str(r, ALPHA, 30);
      const chars = [...target].filter((c) => c !== ' ');
      const query = chars.filter(() => r() < 0.4).join('');
      if (!query) continue;
      expect(fuzzyMatch(query, target), `${JSON.stringify(query)} in ${JSON.stringify(target)}`).not.toBeNull();
    }
  });

  it('highlights the letters it actually matched, in order, never past the end (5,000 cases)', () => {
    const r = rng(602);
    for (let i = 0; i < 5000; i++) {
      const target = str(r, ALPHA, 30);
      const query = str(r, ALPHA, 4).replace(/ /g, '');
      const m = fuzzyMatch(query, target);
      if (!m) continue;
      // Positions are code-point indices — the same unit the highlighter iterates.
      const chars = [...target];
      const qchars = [...query];
      expect(m.positions).toHaveLength(qchars.length);
      m.positions.forEach((p, k) => {
        if (k > 0) expect(p).toBeGreaterThan(m.positions[k - 1]!);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(chars.length);
        // The highlighted character really is the query character (ignoring case).
        const [hit, want] = [chars[p]!, qchars[k]!];
        expect(hit === want || hit.toLowerCase() === want.toLowerCase(), `${want} at ${p} in ${target}`).toBe(true);
      });
    }
  });

  // The two counterexamples the property tests found, kept as named regressions.
  it('regression: a name containing İ neither crashes nor loses its highlight', () => {
    expect(() => fuzzyMatch('İb', 'aİb')).not.toThrow();
    expect(fuzzyMatch('İb', 'aİb')?.positions).toEqual([1, 2]);
    expect(fuzzyMatch('x', 'İİİİx')?.positions).toEqual([4]);
  });

  it('regression: an emoji in a name can be matched, and later highlights stay aligned', () => {
    expect(fuzzyMatch('🙂b', 'a🙂b')?.positions).toEqual([1, 2]);
    // Code points of '🙂 notes.ts': 🙂=0, ' '=1, n=2, o=3, t=4, e=5, s=6 …
    expect(fuzzyMatch('ts', '🙂 notes.ts')?.positions).toEqual([4, 6]);
  });

  it('fuzzyRank returns at most `limit`, best first (2,000 lists)', () => {
    const r = rng(603);
    for (let i = 0; i < 2000; i++) {
      const items = Array.from({ length: int(r, 0, 40) }, () => str(r, 'abcdef/._', 20));
      const limit = int(r, 1, 30);
      const ranked = fuzzyRank(items, str(r, 'abc', 3), (x) => x, limit);
      expect(ranked.length).toBeLessThanOrEqual(limit);
      for (let k = 1; k < ranked.length; k++) expect(ranked[k]!.score).toBeLessThanOrEqual(ranked[k - 1]!.score);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Layout state machines: random sequences of user actions.            */
/* ------------------------------------------------------------------ */

describe('resizeBetween: dragging any sash, any distance', () => {
  it('keeps the total, touches only the two neighbours, and honours the minimum (20,000 drags)', () => {
    const r = rng(701);
    for (let i = 0; i < 20_000; i++) {
      const n = int(r, 2, 5);
      const weights = Array.from({ length: n }, () => 0.2 + r() * 3);
      const total = int(r, 300, 3000);
      const index = int(r, 0, n - 2);
      const delta = (r() - 0.5) * 4000;
      const next = resizeBetween(weights, index, delta, total);

      const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);
      expect(sum(next)).toBeCloseTo(sum(weights), 6);
      for (let k = 0; k < n; k++) if (k !== index && k !== index + 1) expect(next[k]).toBeCloseTo(weights[k]!, 9);

      const px = (w: number) => (w / sum(weights)) * total;
      const pair = px(weights[index]!) + px(weights[index + 1]!);
      const floor = Math.min(MIN_PANE_PX, pair / 2);
      expect(px(next[index]!)).toBeGreaterThanOrEqual(floor - 1e-6);
      expect(px(next[index + 1]!)).toBeGreaterThanOrEqual(floor - 1e-6);
    }
  });
});

describe('normalizeLayout on junk', () => {
  it('never throws and always yields sizes within limits (5,000 inputs)', () => {
    const r = rng(702);
    const JUNK: unknown[] = [null, undefined, 1, 'x', [], {}, { primary: 'x' }, { panel: { size: 'big' } }, { primary: { size: -1e9, visible: 'yes' } }, { secondary: { size: 1e12 } }, { activity: 42 }];
    for (let i = 0; i < 5000; i++) {
      const raw = r() < 0.5 ? pick(r, JUNK) : { primary: { size: (r() - 0.5) * 1e5, visible: r() < 0.5 }, panel: { size: r() * 1e5, maximized: pick(r, [true, 'x', 1]) } };
      const l = normalizeLayout(raw);
      for (const part of ['primary', 'secondary', 'panel'] as const) {
        expect(l[part].size).toBeGreaterThanOrEqual(PART_LIMITS[part].min);
        expect(l[part].size).toBeLessThanOrEqual(PART_LIMITS[part].max);
        expect(typeof l[part].visible).toBe('boolean');
      }
      expect(typeof l.panel.maximized).toBe('boolean');
    }
  });
});

describe('terminal groups under random use', () => {
  /** Every broken rule, as text — collected and asserted once per step, which keeps 40,000 steps fast. */
  function violations(s: TerminalGroups): string[] {
    const out: string[] = [];
    const all = s.groups.flat();
    if (new Set(all).size !== all.length) out.push('a terminal is in two places');
    for (const g of s.groups) {
      if (g.length === 0) out.push('empty group');
      if (g.length > MAX_SPLIT) out.push('split past the maximum');
    }
    if (s.groups.length === 0) {
      if (s.focused !== null) out.push('focus with no terminals');
    } else {
      if (s.active < 0 || s.active >= s.groups.length) out.push(`active ${s.active} out of range`);
      else if (!s.groups[s.active]!.includes(s.focused ?? '')) out.push('focused terminal is not in the active group');
    }
    return out;
  }

  it('keeps every invariant through 1,000 random sessions of 40 actions', () => {
    const r = rng(801);
    for (let run = 0; run < 1000; run++) {
      let s = emptyGroups();
      let next = 0;
      for (let step = 0; step < 40; step++) {
        const ids = s.groups.flat();
        const op = pick(r, ['add', 'split', 'split', 'remove', 'focus']);
        if (op === 'add') s = addTerminal(s, `t${next++}`);
        else if (op === 'split') s = splitTerminal(s, `t${next++}`);
        else if (op === 'remove' && ids.length) s = removeTerminal(s, pick(r, ids));
        else if (op === 'focus' && ids.length) s = focusTerminal(s, pick(r, ids));
        const broken = violations(s);
        if (broken.length) expect(broken, `run ${run} step ${step} after ${op}: ${JSON.stringify(s)}`).toEqual([]);
      }
    }
  });
});

describe('editor groups under random use', () => {
  const PATHS = ['a.ts', 'b.ts', 'src/c.ts', 'README.md', 'x y.txt'];

  function violations(s: EditorGroups): string[] {
    const out: string[] = [];
    if (s.groups.length < 1 || s.groups.length > MAX_EDITOR_GROUPS) out.push(`${s.groups.length} groups`);
    const ids = s.groups.map((g) => g.id);
    if (new Set(ids).size !== ids.length) out.push('duplicate group id');
    if (!ids.includes(s.active)) out.push('active group does not exist');

    for (const g of s.groups) {
      const paths = g.tabs.tabs.map((t) => t.path);
      if (new Set(paths).size !== paths.length) out.push(`${g.id}: a file is open twice`);
      if ((g.tabs.active === null) !== (paths.length === 0)) out.push(`${g.id}: active tab disagrees with tab list`);
      if (g.tabs.active && !paths.includes(g.tabs.active)) out.push(`${g.id}: active tab is not open`);
      if (g.tabs.tabs.filter((t) => t.preview).length > 1) out.push(`${g.id}: more than one preview tab`);
    }

    // One buffer per file: every tab showing a file agrees on whether it is unsaved.
    for (const p of PATHS) {
      const flags = new Set(s.groups.flatMap((g) => g.tabs.tabs.filter((t) => t.path === p).map((t) => t.dirty)));
      if (flags.size > 1) out.push(`${p}: saved in one group, unsaved in another`);
    }
    return out;
  }

  it('keeps every invariant through 1,000 random sessions of 40 actions', () => {
    const r = rng(802);
    for (let run = 0; run < 1000; run++) {
      let s = initialGroups();
      let next = 2;
      for (let step = 0; step < 40; step++) {
        const group = pick(r, s.groups);
        const op = pick(r, ['open', 'open', 'openPerm', 'split', 'close', 'closeGroup', 'focus', 'dirty', 'save']);
        if (op === 'open') s = openIn(s, pick(r, PATHS), { preview: true, group: group.id });
        else if (op === 'openPerm') s = openIn(s, pick(r, PATHS), { preview: false, group: group.id });
        else if (op === 'split') s = splitGroup(s, group.id, `g${next++}`);
        else if (op === 'close' && group.tabs.tabs.length) s = closeIn(s, group.id, pick(r, group.tabs.tabs).path).state;
        else if (op === 'closeGroup') s = closeGroup(s, group.id);
        else if (op === 'focus') s = focusGroup(s, group.id);
        else if (op === 'dirty') s = setDirtyEverywhere(s, pick(r, PATHS), true);
        else if (op === 'save') s = setDirtyEverywhere(s, pick(r, PATHS), false);
        const broken = violations(s);
        if (broken.length) expect(broken, `run ${run} step ${step} after ${op}: ${JSON.stringify(s)}`).toEqual([]);
      }
    }
  });
});
