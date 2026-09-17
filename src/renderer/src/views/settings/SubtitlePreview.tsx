import { useLayoutEffect, useRef, useState } from 'react';
import { subtitleCss, type SubtitleStyle } from '@core/subtitleStyle';
import { cn } from '@/lib/cn';

/** Fractal noise tile; renders as fine film grain without the banding CSS gradients produce. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .9 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}")`;

const LINES = [
  'I didn’t think we’d make it this far.',
  'Keep the lights low. They’re still watching the road.',
  'Tomorrow, we take the long way home.',
];

/**
 * A painted film frame with a caption rendered from the same style rules the player and burn-in use,
 * so what you pick here is what you get.
 */
export function SubtitlePreview({ style, burned }: { style: SubtitleStyle; burned: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(270);
  const [scene, setScene] = useState<'dusk' | 'snow'>('dusk');
  const [line, setLine] = useState(0);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const css = subtitleCss(style, height);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-black shadow-md">
      <div ref={frame} className="relative aspect-video w-full overflow-hidden" onClick={() => setLine((l) => (l + 1) % LINES.length)} title="Click for another line">
        {scene === 'dusk' ? (
          <>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#1b2340 0%,#4b3a5e 38%,#c46a4a 62%,#2a1c1a 63%,#120c0b 100%)' }} />
            <div className="absolute top-[36%] left-[62%] aspect-square w-[6%] rounded-full bg-[#ffd9a0] blur-[1px]" style={{ boxShadow: '0 0 60px 20px rgb(255 190 120 / .35)' }} />
            <svg className="absolute inset-x-0 bottom-[34%] h-[22%] w-full" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 60 L0 38 L30 30 L55 36 L90 18 L120 32 L150 26 L185 40 L220 22 L260 34 L300 16 L335 30 L370 24 L400 36 L400 60 Z" fill="#1d1418" />
            </svg>
            <div className="absolute bottom-[12%] left-[18%] h-[26%] w-[3%] rounded-t-full bg-[#0b0706]" />
            <div className="absolute bottom-[12%] left-[23%] h-[22%] w-[2.6%] rounded-t-full bg-[#0b0706]" />
          </>
        ) : (
          <>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#dfe8ef 0%,#f4f6f8 55%,#ffffff 56%,#e9eef2 100%)' }} />
            <svg className="absolute inset-x-0 bottom-[44%] h-[26%] w-full" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 60 L40 20 L70 40 L120 6 L170 44 L210 24 L260 50 L300 14 L350 42 L400 26 L400 60 Z" fill="#c7d3dc" />
            </svg>
          </>
        )}
        {/* Soft film grain so the caption is judged against texture, not a flat color */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />

        <div className={cn('absolute inset-x-[6%] flex justify-center text-center', style.position === 'top' ? 'top-[7%]' : 'bottom-[8%]')}>
          <span key={line} style={css} className="max-w-[88%] animate-rise whitespace-pre-line">{LINES[line]}</span>
        </div>

        <div className="absolute top-3 right-3 flex gap-1">
          {(['dusk', 'snow'] as const).map((sc) => (
            <button key={sc} onClick={(e) => { e.stopPropagation(); setScene(sc); }} aria-pressed={scene === sc}
              className={cn('rounded-md px-2 py-1 text-[11px] font-semibold backdrop-blur transition-colors', scene === sc ? 'bg-white/85 text-black' : 'bg-black/35 text-white/85 hover:bg-black/50')}>
              {sc === 'dusk' ? 'Dark scene' : 'Bright scene'}
            </button>
          ))}
        </div>
        {burned && <span className="absolute top-3 left-3 rounded-md bg-black/45 px-2 py-1 text-[11px] font-semibold text-white/85 backdrop-blur">Burned into the video</span>}
      </div>
      <div className="flex items-center gap-3 bg-[#0e0d0c] px-3 py-2 text-[11px] text-white/55 tabular">
        <span>0:42</span>
        <span className="relative h-1 flex-1 rounded-full bg-white/15"><span className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-white/80" /></span>
        <span>1:52:10</span>
      </div>
    </div>
  );
}
