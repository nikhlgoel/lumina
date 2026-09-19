// Editor themes, the pure half: the theme model, Lumina's built-ins, and the conversion from a
// VS Code colour-theme JSON into something Monaco and xterm can actually use.
//
// Why this shape:
//   * One theme drives THREE surfaces — the editor, the terminal and (optionally) the app chrome.
//     Keeping them in one object is the only way they stay in step; previously each read its own
//     colours and a terminal opened in dark mode stayed a black box after switching to light.
//   * A VS Code *colour theme* is plain JSON with no executable code, so importing one is safe in a
//     way that importing an extension is not. Nothing here runs anything.
//
// Honest limitation, stated once and repeated in the UI: **Monaco is not TextMate.** VS Code colours
// by TextMate scope (`entity.name.function.js`); Monaco's Monarch grammars emit a much coarser token
// set (`keyword`, `string`, `type`…). So an imported theme's editor background, gutter, selection and
// terminal colours are exact, and its token colours are mapped to the nearest role. Full fidelity
// needs a TextMate grammar engine (shiki/onigasm + WASM), which is a separate, deliberate decision.

/** The token roles Lumina colours. Deliberately coarse — this is what Monarch can actually tell apart. */
export type TokenRole =
  | 'comment' | 'string' | 'regexp' | 'number' | 'keyword' | 'operator'
  | 'type' | 'function' | 'variable' | 'constant' | 'tag' | 'attribute'
  | 'punctuation' | 'invalid';

export const TOKEN_ROLES: TokenRole[] = [
  'comment', 'string', 'regexp', 'number', 'keyword', 'operator',
  'type', 'function', 'variable', 'constant', 'tag', 'attribute',
  'punctuation', 'invalid',
];

/** The 16 ANSI colours a terminal needs, in the conventional order. */
export interface AnsiPalette {
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

export interface EditorTheme {
  id: string;
  name: string;
  kind: 'dark' | 'light';
  /** Where it came from, so the UI can say so and offer "remove" only for imports. */
  source: 'built-in' | 'imported';
  /** Chrome colours for the editor surface itself. */
  ui: {
    background: string;
    foreground: string;
    lineHighlight: string;
    selection: string;
    cursor: string;
    lineNumber: string;
    lineNumberActive: string;
    /** Used for the gutter and any editor-adjacent strip. */
    gutter: string;
    border: string;
  };
  /** Token colour per role. A role may carry font style, as VS Code themes often italicise comments. */
  tokens: Partial<Record<TokenRole, { color: string; fontStyle?: string }>>;
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    selection: string;
    ansi: AnsiPalette;
  };
}

/* ---------- colour parsing ---------- */

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX8 = /^#[0-9a-f]{8}$/i;

/**
 * Normalise a colour to `#rrggbb` or `#rrggbbaa`, or return null.
 *
 * VS Code themes use every hex form including 4- and 8-digit alpha, and a malformed entry must not
 * be allowed through — Monaco throws on an invalid colour and would take the whole editor down.
 */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const m3 = HEX3.exec(v);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  const m4 = HEX4.exec(v);
  if (m4) return `#${m4[1]}${m4[1]}${m4[2]}${m4[2]}${m4[3]}${m4[3]}${m4[4]}${m4[4]}`.toLowerCase();
  if (HEX6.test(v) || HEX8.test(v)) return v.toLowerCase();
  return null;
}

/** Drop the alpha channel. Monaco accepts `#rrggbbaa` for some keys but not for token colours. */
export function opaque(color: string): string {
  return color.length === 9 ? color.slice(0, 7) : color;
}

/** Relative luminance (WCAG). Used to decide whether a theme reads as dark or light. */
export function luminance(color: string): number {
  const hex = opaque(color);
  if (!HEX6.test(hex)) return 0;
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Blend `over` onto `under` by `alpha`, so a translucent selection can be given to xterm opaquely. */
export function blend(under: string, over: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  const part = (hex: string, i: number) => parseInt(opaque(hex).slice(1 + i * 2, 3 + i * 2), 16);
  const mix = (i: number) => Math.round(part(under, i) * (1 - a) + part(over, i) * a);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(mix(0))}${hex(mix(1))}${hex(mix(2))}`;
}

/* ---------- built-in themes ---------- */

const DARK_ANSI: AnsiPalette = {
  black: '#3b3a38', red: '#f0735a', green: '#45c08a', yellow: '#e8a33d',
  blue: '#5aaef0', magenta: '#c79bf0', cyan: '#4fc4c4', white: '#d8d3c8',
  brightBlack: '#6b6862', brightRed: '#ff9280', brightGreen: '#6fd6a7', brightYellow: '#ffc46b',
  brightBlue: '#85c6ff', brightMagenta: '#dcb8ff', brightCyan: '#7fdcdc', brightWhite: '#f5f1e8',
};

const LIGHT_ANSI: AnsiPalette = {
  black: '#2b2824', red: '#c2412d', green: '#1f8a5b', yellow: '#b86e00',
  blue: '#1f78c8', magenta: '#8a4bbd', cyan: '#12807f', white: '#d6d1c7',
  brightBlack: '#6a655d', brightRed: '#e2573f', brightGreen: '#2aa771', brightYellow: '#d98a16',
  brightBlue: '#3b92dd', brightMagenta: '#a465d4', brightCyan: '#1f9c9a', brightWhite: '#f7f5f0',
};

export const BUILT_IN_THEMES: EditorTheme[] = [
  {
    id: 'lumina-dark',
    name: 'Lumina Dark',
    kind: 'dark',
    source: 'built-in',
    ui: {
      background: '#141312', foreground: '#f1ede6', lineHighlight: '#1b1a18',
      selection: '#3a2e20', cursor: '#f08a3e', lineNumber: '#6b6862',
      lineNumberActive: '#cfc8bb', gutter: '#141312', border: '#26241f',
    },
    tokens: {
      comment: { color: '#7b766c', fontStyle: 'italic' },
      string: { color: '#9ccf8a' },
      regexp: { color: '#6fd6a7' },
      number: { color: '#e8a33d' },
      keyword: { color: '#f08a3e' },
      operator: { color: '#d8d3c8' },
      type: { color: '#5aaef0' },
      function: { color: '#c79bf0' },
      variable: { color: '#f1ede6' },
      constant: { color: '#ffc46b' },
      tag: { color: '#f0735a' },
      attribute: { color: '#e8a33d' },
      punctuation: { color: '#a29b90' },
      invalid: { color: '#ff9280' },
    },
    terminal: {
      background: '#141312', foreground: '#f1ede6', cursor: '#f08a3e',
      selection: '#3a2e20', ansi: DARK_ANSI,
    },
  },
  {
    id: 'lumina-light',
    name: 'Lumina Light',
    kind: 'light',
    source: 'built-in',
    ui: {
      background: '#fbfaf8', foreground: '#1b1813', lineHighlight: '#f2efe9',
      selection: '#f7ddc6', cursor: '#d9641e', lineNumber: '#9c958a',
      lineNumberActive: '#403a31', gutter: '#fbfaf8', border: '#e4e0d7',
    },
    tokens: {
      comment: { color: '#8a8478', fontStyle: 'italic' },
      string: { color: '#1f8a5b' },
      regexp: { color: '#12807f' },
      number: { color: '#b86e00' },
      keyword: { color: '#c2541e' },
      operator: { color: '#4a443b' },
      type: { color: '#1f78c8' },
      function: { color: '#8a4bbd' },
      variable: { color: '#1b1813' },
      constant: { color: '#a65a00' },
      tag: { color: '#c2412d' },
      attribute: { color: '#b86e00' },
      punctuation: { color: '#6a655d' },
      invalid: { color: '#c2412d' },
    },
    terminal: {
      background: '#fbfaf8', foreground: '#1b1813', cursor: '#d9641e',
      selection: '#f7ddc6', ansi: LIGHT_ANSI,
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    kind: 'dark',
    source: 'built-in',
    ui: {
      background: '#0f1117', foreground: '#dbe1f0', lineHighlight: '#171a23',
      selection: '#26304a', cursor: '#7aa2f7', lineNumber: '#565f7e',
      lineNumberActive: '#aab4d4', gutter: '#0f1117', border: '#1e2230',
    },
    tokens: {
      comment: { color: '#5b6485', fontStyle: 'italic' },
      string: { color: '#9ece6a' },
      regexp: { color: '#73daca' },
      number: { color: '#ff9e64' },
      keyword: { color: '#bb9af7' },
      operator: { color: '#89ddff' },
      type: { color: '#2ac3de' },
      function: { color: '#7aa2f7' },
      variable: { color: '#dbe1f0' },
      constant: { color: '#ff9e64' },
      tag: { color: '#f7768e' },
      attribute: { color: '#e0af68' },
      punctuation: { color: '#9aa5ce' },
      invalid: { color: '#f7768e' },
    },
    terminal: {
      background: '#0f1117', foreground: '#dbe1f0', cursor: '#7aa2f7', selection: '#26304a',
      ansi: {
        black: '#32344a', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
        blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#2ac3de', white: '#c0caf5',
        brightBlack: '#565f89', brightRed: '#ff7a93', brightGreen: '#b9f27c', brightYellow: '#ff9e64',
        brightBlue: '#7da6ff', brightMagenta: '#d2a6ff', brightCyan: '#73daca', brightWhite: '#e6eaf5',
      },
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    kind: 'light',
    source: 'built-in',
    ui: {
      background: '#fdfcf7', foreground: '#2c2a26', lineHighlight: '#f3f0e6',
      selection: '#dfe7d5', cursor: '#3c6e47', lineNumber: '#a8a293',
      lineNumberActive: '#4a463d', gutter: '#fdfcf7', border: '#e6e1d3',
    },
    tokens: {
      comment: { color: '#9a9482', fontStyle: 'italic' },
      string: { color: '#3c6e47' },
      regexp: { color: '#2f6b6b' },
      number: { color: '#96591b' },
      keyword: { color: '#8a3a52' },
      operator: { color: '#5a554b' },
      type: { color: '#2a5d8f' },
      function: { color: '#6b4796' },
      variable: { color: '#2c2a26' },
      constant: { color: '#96591b' },
      tag: { color: '#8a3a52' },
      attribute: { color: '#96591b' },
      punctuation: { color: '#7a746a' },
      invalid: { color: '#a8342a' },
    },
    terminal: {
      background: '#fdfcf7', foreground: '#2c2a26', cursor: '#3c6e47',
      selection: '#dfe7d5', ansi: LIGHT_ANSI,
    },
  },
];

export const themeById = (id: string): EditorTheme | null =>
  BUILT_IN_THEMES.find((t) => t.id === id) ?? null;

/* ---------- VS Code theme import ---------- */

/**
 * TextMate scope prefix → our role. Order matters: the FIRST match wins for a given scope, and the
 * list is written longest-prefix-first so `keyword.operator` beats `keyword`.
 */
const SCOPE_ROLES: [string, TokenRole][] = [
  ['comment', 'comment'],
  ['string.regexp', 'regexp'],
  ['string', 'string'],
  ['constant.numeric', 'number'],
  ['constant.character', 'constant'],
  ['constant.language', 'constant'],
  ['constant.other', 'constant'],
  ['constant', 'constant'],
  ['keyword.operator', 'operator'],
  ['keyword', 'keyword'],
  ['storage.type', 'type'],
  ['storage', 'keyword'],
  ['entity.name.function', 'function'],
  ['entity.name.tag', 'tag'],
  ['entity.name.type', 'type'],
  ['entity.name.class', 'type'],
  ['entity.other.attribute-name', 'attribute'],
  ['support.function', 'function'],
  ['support.type', 'type'],
  ['support.class', 'type'],
  ['support.constant', 'constant'],
  ['variable.parameter', 'variable'],
  ['variable', 'variable'],
  ['meta.function-call', 'function'],
  ['punctuation', 'punctuation'],
  ['invalid', 'invalid'],
];

/** The role a TextMate scope belongs to, or null when we have no sensible mapping. */
export function roleForScope(scope: string): TokenRole | null {
  const s = scope.trim().toLowerCase();
  if (!s) return null;
  for (const [prefix, role] of SCOPE_ROLES) {
    if (s === prefix || s.startsWith(`${prefix}.`)) return role;
  }
  return null;
}

interface VsCodeTokenColor {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string };
}

interface VsCodeTheme {
  name?: string;
  type?: string;
  colors?: Record<string, unknown>;
  tokenColors?: VsCodeTokenColor[];
}

export type ThemeImport = { ok: true; theme: EditorTheme } | { ok: false; reason: string };

const ANSI_KEYS: [keyof AnsiPalette, string][] = [
  ['black', 'terminal.ansiBlack'], ['red', 'terminal.ansiRed'], ['green', 'terminal.ansiGreen'],
  ['yellow', 'terminal.ansiYellow'], ['blue', 'terminal.ansiBlue'], ['magenta', 'terminal.ansiMagenta'],
  ['cyan', 'terminal.ansiCyan'], ['white', 'terminal.ansiWhite'],
  ['brightBlack', 'terminal.ansiBrightBlack'], ['brightRed', 'terminal.ansiBrightRed'],
  ['brightGreen', 'terminal.ansiBrightGreen'], ['brightYellow', 'terminal.ansiBrightYellow'],
  ['brightBlue', 'terminal.ansiBrightBlue'], ['brightMagenta', 'terminal.ansiBrightMagenta'],
  ['brightCyan', 'terminal.ansiBrightCyan'], ['brightWhite', 'terminal.ansiBrightWhite'],
];

/**
 * Turn a VS Code colour-theme JSON into an EditorTheme.
 *
 * Everything missing falls back to the matching built-in, so a sparse theme (many only define
 * `tokenColors`) still produces a complete, usable result rather than a half-black editor.
 */
export function convertVsCodeTheme(raw: unknown, id: string, fallbackName?: string): ThemeImport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'That file isn’t a VS Code colour theme.' };
  }
  const theme = raw as VsCodeTheme;
  const colors = (theme.colors ?? {}) as Record<string, unknown>;
  const tokenColors = Array.isArray(theme.tokenColors) ? theme.tokenColors : [];
  if (Object.keys(colors).length === 0 && tokenColors.length === 0) {
    return { ok: false, reason: 'That theme has no colours in it.' };
  }

  const pick = (key: string): string | null => normalizeColor(colors[key]);
  const background = pick('editor.background');

  // `type` is advisory and often missing or wrong; the background is the honest signal.
  const declared = typeof theme.type === 'string' ? theme.type.toLowerCase() : '';
  const kind: 'dark' | 'light' = background
    ? (luminance(background) < 0.25 ? 'dark' : 'light')
    : (declared === 'light' ? 'light' : 'dark');

  const base = BUILT_IN_THEMES.find((t) => t.id === (kind === 'dark' ? 'lumina-dark' : 'lumina-light'))!;

  const ui: EditorTheme['ui'] = {
    background: background ?? base.ui.background,
    foreground: pick('editor.foreground') ?? base.ui.foreground,
    lineHighlight: pick('editor.lineHighlightBackground') ?? base.ui.lineHighlight,
    selection: pick('editor.selectionBackground') ?? base.ui.selection,
    cursor: pick('editorCursor.foreground') ?? base.ui.cursor,
    lineNumber: pick('editorLineNumber.foreground') ?? base.ui.lineNumber,
    lineNumberActive: pick('editorLineNumber.activeForeground') ?? base.ui.lineNumberActive,
    gutter: pick('editorGutter.background') ?? background ?? base.ui.gutter,
    border: pick('editorGroup.border') ?? pick('panel.border') ?? base.ui.border,
  };

  // Later entries in tokenColors win in VS Code, so walk forwards and overwrite.
  const tokens: EditorTheme['tokens'] = { ...base.tokens };
  for (const entry of tokenColors) {
    if (!entry || typeof entry !== 'object') continue;
    const color = normalizeColor(entry.settings?.foreground);
    if (!color) continue;
    const fontStyle = typeof entry.settings?.fontStyle === 'string' ? entry.settings.fontStyle.trim() : '';
    const scopes = typeof entry.scope === 'string'
      ? entry.scope.split(',')
      : Array.isArray(entry.scope) ? entry.scope : [];
    for (const scope of scopes) {
      if (typeof scope !== 'string') continue;
      // A scope selector can be a descendant path ("meta.jsx string"); the last part is the token.
      const leaf = scope.trim().split(/\s+/).pop() ?? '';
      const role = roleForScope(leaf);
      if (!role) continue;
      tokens[role] = fontStyle ? { color: opaque(color), fontStyle } : { color: opaque(color) };
    }
  }

  const ansi = { ...base.terminal.ansi };
  for (const [key, vsKey] of ANSI_KEYS) {
    const value = pick(vsKey);
    if (value) ansi[key] = opaque(value);
  }

  const name = (typeof theme.name === 'string' && theme.name.trim()) || fallbackName || id;

  return {
    ok: true,
    theme: {
      id,
      name: name.slice(0, 60),
      kind,
      source: 'imported',
      ui,
      tokens,
      terminal: {
        background: pick('terminal.background') ?? ui.background,
        foreground: pick('terminal.foreground') ?? ui.foreground,
        cursor: pick('terminalCursor.foreground') ?? ui.cursor,
        selection: pick('terminal.selectionBackground') ?? ui.selection,
        ansi,
      },
    },
  };
}

/* ---------- output adapters ---------- */

/** Monarch token names each role should colour. One role legitimately covers several. */
const ROLE_TOKENS: Record<TokenRole, string[]> = {
  comment: ['comment'],
  string: ['string'],
  regexp: ['regexp'],
  number: ['number'],
  keyword: ['keyword', 'keyword.control', 'storage'],
  operator: ['operator', 'delimiter'],
  type: ['type', 'type.identifier', 'entity.name.type'],
  function: ['entity.name.function', 'support.function'],
  variable: ['identifier', 'variable'],
  constant: ['constant'],
  tag: ['tag', 'metatag'],
  attribute: ['attribute.name', 'attribute.value'],
  punctuation: ['delimiter.bracket', 'delimiter.parenthesis', 'delimiter.square'],
  invalid: ['invalid'],
};

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: { token: string; foreground: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

/** Monaco's theme format. Note it wants token colours WITHOUT the leading `#`. */
export function toMonacoTheme(theme: EditorTheme): MonacoThemeData {
  const rules: MonacoThemeData['rules'] = [];
  for (const role of TOKEN_ROLES) {
    const style = theme.tokens[role];
    if (!style) continue;
    for (const token of ROLE_TOKENS[role]) {
      rules.push({
        token,
        foreground: opaque(style.color).slice(1),
        ...(style.fontStyle ? { fontStyle: style.fontStyle } : {}),
      });
    }
  }
  return {
    base: theme.kind === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    colors: {
      'editor.background': theme.ui.background,
      'editor.foreground': theme.ui.foreground,
      'editor.lineHighlightBackground': theme.ui.lineHighlight,
      'editor.selectionBackground': theme.ui.selection,
      'editorCursor.foreground': theme.ui.cursor,
      'editorLineNumber.foreground': theme.ui.lineNumber,
      'editorLineNumber.activeForeground': theme.ui.lineNumberActive,
      'editorGutter.background': theme.ui.gutter,
      'editorWidget.background': theme.ui.lineHighlight,
      'editorWidget.border': theme.ui.border,
    },
  };
}

export interface XtermTheme {
  background: string; foreground: string; cursor: string; selectionBackground: string;
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

/**
 * xterm's theme. Its selection may be translucent, but a `#rrggbbaa` that some themes ship can
 * render as invisible text, so anything with alpha is blended onto the background first.
 */
export function toXtermTheme(theme: EditorTheme): XtermTheme {
  const { terminal } = theme;
  const selection = terminal.selection.length === 9
    ? blend(terminal.background, terminal.selection, parseInt(terminal.selection.slice(7, 9), 16) / 255)
    : terminal.selection;
  return {
    background: opaque(terminal.background),
    foreground: opaque(terminal.foreground),
    cursor: opaque(terminal.cursor),
    selectionBackground: selection,
    ...terminal.ansi,
  };
}
