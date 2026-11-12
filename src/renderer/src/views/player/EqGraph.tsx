import { useEffect, useMemo, useRef, useState } from 'react';
import { EQ_BANDS, EQ_BAND_LABELS, EQ_GAIN_LIMIT, EQ_GAIN_STEP, gainForTarget, responseDb, snapGain } from '@core/equalizer';
import { readSpectrum, spectrumOn } from '@/lib/audio';

const W = 296;
const H = 112;
const PAD_X = 10;
const TOP = 8;
const BOTTOM = 18;
const LOW = EQ_BANDS[0];
// The picture runs to 16 kHz, a little past the last band, so the plateau of the top shelf is in it.
const HIGH = 16000;
const SPAN = Math.log2(HIGH / LOW);

const xOf = (hz: number) => PAD_X + ((W - PAD_X * 2) * Math.log2(hz / LOW)) / SPAN;
const yOf = (db: number) => TOP + (H - TOP - BOTTOM) * (1 - (db + EQ_GAIN_LIMIT) / (EQ_GAIN_LIMIT * 2));
const dbOf = (y: number) => EQ_GAIN_LIMIT * 2 * (1 - (y - TOP) / (H - TOP - BOTTOM)) - EQ_GAIN_LIMIT;
const CURVE_HZ = Array.from({ length: 90 }, (_, i) => LOW * (HIGH / LOW) ** (i / 89));
const BARS = 44;

const fmt = (db: number) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

/**
 * The equalizer as a picture: the curve the ten bands really make (computed with the same filter maths the audio uses, core/equalizer), a dot on it
 * for each band, and behind it, while music plays, a faint live spectrum. Drag a dot up or down and its band moves by whatever brings the curve to the
 * pointer; the arrow keys move a focused dot by half a decibel (Shift: two, Page Up and Down: three).
 */
export function EqGraph({ gains: saved, enabled, onChange, onCommit }: { gains: number[]; enabled: boolean; onChange: (gains: number[]) => void; onCommit: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [levels, setLevels] = useState<number[] | null>(null);
  // While a dot is dragged the picture follows the pointer at once; the settings behind it are written a moment later (the panel throttles them).
  const [local, setLocal] = useState<number[] | null>(null);
  const gains = local ?? saved;
  const live = useRef(gains);
  live.current = gains;

  // The moving picture behind the curve, only while the panel is open and the window is showing.
  useEffect(() => {
    if (!enabled) { setLevels(null); return; }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50 || document.hidden) return;
      last = t;
      // The tap can only be made once the audio path exists, which may be after the panel opened (the equalizer was just switched on).
      spectrumOn(true);
      setLevels(readSpectrum(BARS));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  const curve = useMemo(() => CURVE_HZ.map((f) => [xOf(f), yOf(Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, responseDb(gains, f))))] as const), [gains]);
  const line = curve.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xOf(HIGH)} ${yOf(-EQ_GAIN_LIMIT)} L${xOf(LOW)} ${yOf(-EQ_GAIN_LIMIT)} Z`;

  const move = (band: number, target: number) => {
    const next = live.current.slice();
    next[band] = gainForTarget(live.current, band, Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, target)));
    live.current = next;
    setLocal(next);
    onChange(next);
  };
  const finish = () => {
    onCommit();
    setLocal(null);
  };
  const pointerY = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return dbOf(((e.clientY - r.top) / r.height) * H);
  };
  const nudge = (band: number, step: number) => {
    const next = live.current.slice();
    next[band] = snapGain((next[band] ?? 0) + step);
    live.current = next;
    onChange(next);
    onCommit();
  };

  const shown = drag ?? focus;

  return (
    <div className="p-screen relative px-1 pt-2" style={{ opacity: enabled ? 1 : 0.55 }}>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="group"
        aria-label="Equalizer curve. Drag a dot, or focus one and use the arrow keys."
        style={{ display: 'block', touchAction: 'none', overflow: 'visible' }}
        onPointerMove={(e) => { if (drag !== null) move(drag, pointerY(e)); }}
        onPointerUp={() => { if (drag !== null) { setDrag(null); finish(); } }}
        onPointerCancel={() => { if (drag !== null) { setDrag(null); finish(); } }}
      >
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--p-accent)" stopOpacity=".34" />
            <stop offset="1" stopColor="var(--p-accent)" stopOpacity="0" />
          </linearGradient>
          <filter id="eq-glow" x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[-12, -6, 0, 6, 12].map((v) => (
          <line key={v} x1={PAD_X} x2={W - PAD_X} y1={yOf(v)} y2={yOf(v)} stroke={`rgba(255,255,255,${v === 0 ? 0.28 : 0.08})`} strokeDasharray={v === 0 ? undefined : '2 4'} />
        ))}
        {levels && levels.map((l, i) => {
          const w = (W - PAD_X * 2) / BARS;
          const h = l * (H - TOP - BOTTOM) * 0.9;
          return <rect key={i} x={PAD_X + i * w + 1} y={H - BOTTOM - h} width={w - 2} height={h} rx={1.5} fill="rgba(255,255,255,.09)" />;
        })}
        <path d={area} fill="url(#eq-fill)" />
        <path d={line} fill="none" stroke="var(--p-accent)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" filter="url(#eq-glow)" />
        {EQ_BANDS.map((hz, i) => {
          const cx = xOf(hz);
          const cy = yOf(Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, responseDb(gains, hz))));
          const active = shown === i;
          return (
            <g
              key={hz}
              className="p-eq-dot"
              tabIndex={0}
              role="slider"
              aria-label={`${EQ_BAND_LABELS[i]} Hz`}
              aria-valuemin={-EQ_GAIN_LIMIT}
              aria-valuemax={EQ_GAIN_LIMIT}
              aria-valuenow={gains[i] ?? 0}
              aria-valuetext={fmt(gains[i] ?? 0)}
              style={{ cursor: 'ns-resize', outline: 'none' }}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus((f) => (f === i ? null : f))}
              onKeyDown={(e) => {
                const big = e.shiftKey ? 4 : 1;
                if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); nudge(i, EQ_GAIN_STEP * big); }
                else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); nudge(i, -EQ_GAIN_STEP * big); }
                else if (e.key === 'PageUp') { e.preventDefault(); nudge(i, 3); }
                else if (e.key === 'PageDown') { e.preventDefault(); nudge(i, -3); }
                else if (e.key === 'Home' || e.key === 'Delete') { e.preventDefault(); nudge(i, -(gains[i] ?? 0)); }
              }}
              onPointerDown={(e) => {
                // Touching a dot turns the equalizer on, as choosing a preset does.
                e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                setDrag(i);
                move(i, pointerY(e));
              }}
            >
              <circle cx={cx} cy={cy} r={active ? 11 : 8} fill="var(--p-accent)" fillOpacity={active ? 0.28 : 0.14} style={{ transition: 'r .12s, fill-opacity .12s' }} />
              <circle className="ring" cx={cx} cy={cy} r={active ? 5.5 : 4.2} fill={active ? '#fff' : '#fff4d9'} stroke="var(--p-accent)" strokeWidth={1.6} />
              <circle cx={cx} cy={cy} r={14} fill="transparent" />
            </g>
          );
        })}
        {EQ_BAND_LABELS.map((t, i) => (
          <text key={t} x={xOf(EQ_BANDS[i]!)} y={H - 4} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,.55)">{t}</text>
        ))}
      </svg>
      {shown !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[140%] rounded-lg border border-white/20 bg-[rgb(20_18_28_/_.85)] px-2 py-0.5 text-[11px] whitespace-nowrap tabular text-[var(--p-ink)]"
          style={{ left: `${(xOf(EQ_BANDS[shown]!) / W) * 100}%`, top: `${((yOf(responseDb(gains, EQ_BANDS[shown]!)) / H) * 100).toFixed(1)}%` }}
        >
          {EQ_BAND_LABELS[shown]} Hz · {fmt(gains[shown] ?? 0)}
        </div>
      )}
    </div>
  );
}
