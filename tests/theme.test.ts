import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_THEMES, TOKEN_ROLES, blend, convertVsCodeTheme, luminance, normalizeColor, opaque,
  roleForScope, themeById, toMonacoTheme, toXtermTheme,
} from '@core/theme';

describe('normalizeColor', () => {
  it('expands the short forms', () => {
    expect(normalizeColor('#abc')).toBe('#aabbcc');
    expect(normalizeColor('#abcd')).toBe('#aabbccdd');
  });

  it('keeps the long forms and lowercases them', () => {
    expect(normalizeColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeColor('#AABBCCDD')).toBe('#aabbccdd');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeColor('  #123456 ')).toBe('#123456');
  });

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['red', 'rgb(1,2,3)', '#12345', '#gggggg', '', '   ', null, 42, {}]) {
      expect(normalizeColor(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe('opaque', () => {
  it('drops an alpha channel and leaves opaque colours alone', () => {
    expect(opaque('#aabbccdd')).toBe('#aabbcc');
    expect(opaque('#aabbcc')).toBe('#aabbcc');
  });
});

describe('luminance', () => {
  it('puts black at 0 and white at 1', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('ignores alpha', () => {
    expect(luminance('#ffffff00')).toBeCloseTo(luminance('#ffffff'), 10);
  });
});

describe('blend', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(blend('#000000', '#ffffff', 0)).toBe('#000000');
    expect(blend('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('mixes halfway', () => {
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('clamps an out-of-range alpha instead of producing nonsense', () => {
    expect(blend('#000000', '#ffffff', -3)).toBe('#000000');
    expect(blend('#000000', '#ffffff', 9)).toBe('#ffffff');
  });
});

describe('built-in themes', () => {
  it('every theme defines every token role and a full ANSI palette', () => {
    for (const theme of BUILT_IN_THEMES) {
      for (const role of TOKEN_ROLES) {
        expect(theme.tokens[role], `${theme.id}.${role}`).toBeTruthy();
        expect(normalizeColor(theme.tokens[role]!.color), `${theme.id}.${role}`).not.toBeNull();
      }
      expect(Object.keys(theme.terminal.ansi)).toHaveLength(16);
      for (const [key, value] of Object.entries(theme.terminal.ansi)) {
        expect(normalizeColor(value), `${theme.id}.ansi.${key}`).not.toBeNull();
      }
    }
  });

  it('declares a kind that matches its own background', () => {
    for (const theme of BUILT_IN_THEMES) {
      const dark = luminance(theme.ui.background) < 0.25;
      expect(dark, theme.id).toBe(theme.kind === 'dark');
    }
  });

  it('has unique ids and can look them up', () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(themeById('midnight')?.name).toBe('Midnight');
    expect(themeById('nope')).toBeNull();
  });
});

describe('roleForScope', () => {
  it('prefers the longer, more specific prefix', () => {
    expect(roleForScope('keyword.operator.arithmetic')).toBe('operator');
    expect(roleForScope('keyword.control.flow')).toBe('keyword');
    expect(roleForScope('string.regexp.js')).toBe('regexp');
    expect(roleForScope('string.quoted.double')).toBe('string');
    expect(roleForScope('constant.numeric.hex')).toBe('number');
    expect(roleForScope('constant.language.boolean')).toBe('constant');
  });

  it('matches an exact scope with no suffix', () => {
    expect(roleForScope('comment')).toBe('comment');
  });

  it('does not match a prefix that is merely a string prefix of another word', () => {
    expect(roleForScope('keywordish.thing')).toBeNull();
  });

  it('is case-insensitive and tolerates padding', () => {
    expect(roleForScope('  COMMENT.LINE  ')).toBe('comment');
  });

  it('returns null for an unmapped or empty scope', () => {
    expect(roleForScope('meta.brace.round')).toBeNull();
    expect(roleForScope('')).toBeNull();
  });
});

describe('convertVsCodeTheme', () => {
  const sample = {
    name: 'Sample Dark',
    type: 'dark',
    colors: {
      'editor.background': '#101010',
      'editor.foreground': '#eeeeee',
      'editorCursor.foreground': '#ff8800',
      'terminal.ansiRed': '#ff0000',
    },
    tokenColors: [
      { scope: 'comment', settings: { foreground: '#555555', fontStyle: 'italic' } },
      { scope: ['keyword', 'storage'], settings: { foreground: '#cc66ff' } },
      { scope: 'string.quoted.double', settings: { foreground: '#88cc88' } },
    ],
  };

  it('reads colours, tokens and ANSI overrides', () => {
    const r = convertVsCodeTheme(sample, 'sample');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.theme).toMatchObject({ id: 'sample', name: 'Sample Dark', kind: 'dark', source: 'imported' });
    expect(r.theme.ui.background).toBe('#101010');
    expect(r.theme.ui.cursor).toBe('#ff8800');
    expect(r.theme.tokens.comment).toEqual({ color: '#555555', fontStyle: 'italic' });
    expect(r.theme.tokens.keyword?.color).toBe('#cc66ff');
    expect(r.theme.tokens.string?.color).toBe('#88cc88');
    expect(r.theme.terminal.ansi.red).toBe('#ff0000');
  });

  it('fills every gap from a built-in, so a sparse theme is still complete', () => {
    const r = convertVsCodeTheme({ tokenColors: [{ scope: 'comment', settings: { foreground: '#123456' } }] }, 'sparse');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const role of TOKEN_ROLES) expect(r.theme.tokens[role], role).toBeTruthy();
    expect(Object.keys(r.theme.terminal.ansi)).toHaveLength(16);
  });

  it('believes the background over a wrong "type" field', () => {
    const r = convertVsCodeTheme({ type: 'dark', colors: { 'editor.background': '#ffffff' } }, 'x');
    expect(r.ok && r.theme.kind).toBe('light');
  });

  it('takes the last scope entry when two set the same role, as VS Code does', () => {
    const r = convertVsCodeTheme({
      colors: { 'editor.background': '#101010' },
      tokenColors: [
        { scope: 'comment', settings: { foreground: '#111111' } },
        { scope: 'comment.line', settings: { foreground: '#222222' } },
      ],
    }, 'x');
    expect(r.ok && r.theme.tokens.comment?.color).toBe('#222222');
  });

  it('uses the leaf of a descendant scope selector', () => {
    const r = convertVsCodeTheme({
      colors: { 'editor.background': '#101010' },
      tokenColors: [{ scope: 'meta.jsx.children string.quoted', settings: { foreground: '#abcdef' } }],
    }, 'x');
    expect(r.ok && r.theme.tokens.string?.color).toBe('#abcdef');
  });

  it('splits a comma-separated scope string', () => {
    const r = convertVsCodeTheme({
      colors: { 'editor.background': '#101010' },
      tokenColors: [{ scope: 'entity.name.tag, entity.other.attribute-name', settings: { foreground: '#0f0f0f' } }],
    }, 'x');
    expect(r.ok && r.theme.tokens.tag?.color).toBe('#0f0f0f');
    expect(r.ok && r.theme.tokens.attribute?.color).toBe('#0f0f0f');
  });

  it('strips alpha from token colours, which Monaco cannot take', () => {
    const r = convertVsCodeTheme({
      colors: { 'editor.background': '#101010' },
      tokenColors: [{ scope: 'comment', settings: { foreground: '#11223344' } }],
    }, 'x');
    expect(r.ok && r.theme.tokens.comment?.color).toBe('#112233');
  });

  it('ignores malformed entries rather than throwing', () => {
    const r = convertVsCodeTheme({
      colors: { 'editor.background': '#101010', 'editor.foreground': 'not-a-colour' },
      tokenColors: [null, 'nope', { scope: 'comment' }, { settings: { foreground: '#fff' } }, { scope: 42 }],
    }, 'x');
    expect(r.ok).toBe(true);
    if (r.ok) expect(normalizeColor(r.theme.ui.foreground)).not.toBeNull();
  });

  it('falls back to the given name, then the id', () => {
    const body = { colors: { 'editor.background': '#101010' } };
    const named = convertVsCodeTheme(body, 'the-id', 'From File');
    const unnamed = convertVsCodeTheme(body, 'the-id');
    expect(named.ok && named.theme.name).toBe('From File');
    expect(unnamed.ok && unnamed.theme.name).toBe('the-id');
  });

  it('refuses input that is not a theme', () => {
    expect(convertVsCodeTheme(null, 'x')).toMatchObject({ ok: false });
    expect(convertVsCodeTheme([], 'x')).toMatchObject({ ok: false });
    expect(convertVsCodeTheme('nope', 'x')).toMatchObject({ ok: false });
    expect(convertVsCodeTheme({}, 'x')).toMatchObject({ ok: false });
    expect(convertVsCodeTheme({ colors: {}, tokenColors: [] }, 'x')).toMatchObject({ ok: false });
  });
});

describe('toMonacoTheme', () => {
  const theme = BUILT_IN_THEMES[0]!;

  it('picks the base Monaco theme from the kind', () => {
    expect(toMonacoTheme(theme).base).toBe('vs-dark');
    expect(toMonacoTheme(BUILT_IN_THEMES.find((t) => t.kind === 'light')!).base).toBe('vs');
  });

  it('emits token colours without the leading hash, which Monaco requires', () => {
    for (const rule of toMonacoTheme(theme).rules) {
      expect(rule.foreground, rule.token).toMatch(/^[0-9a-f]{6}$/);
    }
  });

  it('carries font style through', () => {
    const comment = toMonacoTheme(theme).rules.find((r) => r.token === 'comment');
    expect(comment?.fontStyle).toBe('italic');
  });

  it('gives Monaco only valid colour values', () => {
    for (const [key, value] of Object.entries(toMonacoTheme(theme).colors)) {
      expect(normalizeColor(value), key).not.toBeNull();
    }
  });
});

describe('toXtermTheme', () => {
  it('maps the palette across and keeps everything opaque', () => {
    const x = toXtermTheme(BUILT_IN_THEMES[0]!);
    expect(x.red).toBe(BUILT_IN_THEMES[0]!.terminal.ansi.red);
    for (const [key, value] of Object.entries(x)) {
      expect(value, key).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('flattens a translucent selection onto the background', () => {
    const base = BUILT_IN_THEMES[0]!;
    const theme = { ...base, terminal: { ...base.terminal, background: '#000000', selection: '#ffffff80' } };
    expect(toXtermTheme(theme).selectionBackground).toBe('#808080');
  });
});
