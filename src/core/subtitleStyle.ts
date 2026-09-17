import type { Settings } from '../shared/settings';

export type SubtitleStyle = Settings['subtitles']['style'];

const FONT_STACKS: Record<SubtitleStyle['font'], { css: string; ass: string }> = {
  sans: { css: '"Hanken Grotesk Variable", "Segoe UI", Arial, sans-serif', ass: 'Arial' },
  serif: { css: 'Georgia, "Times New Roman", serif', ass: 'Georgia' },
  rounded: { css: '"Trebuchet MS", "Segoe UI", sans-serif', ass: 'Trebuchet MS' },
  mono: { css: 'Consolas, "Cascadia Mono", ui-monospace, monospace', ass: 'Consolas' },
};

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Inline style for rendering a subtitle line in HTML (settings preview) at a given frame height. */
export function subtitleCss(style: SubtitleStyle, frameHeight: number): Record<string, string> {
  const px = Math.round(frameHeight * 0.052 * style.size);
  const alpha = style.backgroundOpacity;
  const css: Record<string, string> = {
    fontFamily: FONT_STACKS[style.font].css,
    fontSize: `${px}px`,
    fontWeight: style.bold ? '700' : '500',
    color: style.color,
    lineHeight: '1.3',
    padding: style.background === 'box' ? `${px * 0.12}px ${px * 0.35}px` : '0',
    borderRadius: style.background === 'box' ? `${px * 0.15}px` : '0',
    backgroundColor: style.background === 'box' ? `rgb(0 0 0 / ${alpha})` : 'transparent',
    textShadow: 'none',
  };
  const o = Math.max(1, Math.round(px / 16));
  if (style.background === 'outline') {
    css.textShadow = [`${o}px ${o}px`, `-${o}px ${o}px`, `${o}px -${o}px`, `-${o}px -${o}px`, `0 ${o}px`, `0 -${o}px`, `${o}px 0`, `-${o}px 0`]
      .map((p) => `${p} 0 rgb(0 0 0 / ${Math.max(alpha, 0.85)})`).join(', ');
  } else if (style.background === 'shadow') {
    css.textShadow = `0 ${o * 2}px ${o * 5}px rgb(0 0 0 / ${Math.max(alpha, 0.7)})`;
  }
  return css;
}

/** CSS for the player's video::cue rule (only a few properties are allowed on cues). */
export function cueCss(style: SubtitleStyle): string {
  const decl = subtitleCss(style, 1080);
  const size = `calc(var(--cue-base, 26px) * ${style.size})`;
  return [
    `font-family:${decl.fontFamily}`,
    `font-size:${size}`,
    `font-weight:${decl.fontWeight}`,
    `color:${decl.color}`,
    `background-color:${decl.backgroundColor}`,
    `text-shadow:${style.background === 'box' || style.background === 'none' ? 'none' : decl.textShadow!.replace(/\d+px/g, (m) => `${Math.max(1, Math.round(Number.parseInt(m) / 20))}px`)}`,
  ].join(';');
}

/** libass force_style for burning subtitles with ffmpeg's subtitles filter (SRT uses PlayResY 288). */
export function assForceStyle(style: SubtitleStyle): string {
  const [r, g, b] = hexToRgb(style.color);
  const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  // ASS colours are &HAABBGGRR, where AA is transparency (00 = opaque).
  const primary = `&H00${hex(b)}${hex(g)}${hex(r)}`;
  const backAlpha = hex(Math.round((1 - style.backgroundOpacity) * 255));
  const parts = [
    `FontName=${FONT_STACKS[style.font].ass}`,
    `FontSize=${Math.round(16 * style.size)}`,
    `PrimaryColour=${primary}`,
    `Bold=${style.bold ? 1 : 0}`,
    `Alignment=${style.position === 'top' ? 8 : 2}`,
    'MarginV=18',
  ];
  if (style.background === 'box') parts.push('BorderStyle=3', `OutlineColour=&H${backAlpha}000000`, `BackColour=&H${backAlpha}000000`, 'Outline=2', 'Shadow=0');
  else if (style.background === 'outline') parts.push('BorderStyle=1', 'OutlineColour=&H00000000', 'Outline=1.6', 'Shadow=0');
  else if (style.background === 'shadow') parts.push('BorderStyle=1', 'Outline=0', `BackColour=&H${backAlpha}000000`, 'Shadow=1.5');
  else parts.push('BorderStyle=1', 'Outline=0', 'Shadow=0');
  return parts.join(',');
}
