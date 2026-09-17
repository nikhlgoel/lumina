import { useEffect, useRef, useState } from 'react';
import { EQ_BANDS, EQ_BAND_LABELS, EQ_GAIN_LIMIT, EQ_PROFILES, gainsFor, normalizeBands, profileById } from '@core/equalizer';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';

/**
 * The player's Sound panel: switch audio output device and pick an equalizer profile (or dial in a custom
 * curve). Everything writes to `settings.player`, which the audio engine and the system tray both follow.
 */
export function AudioPanel({ onClose }: { onClose: () => void }) {
  const player = useApp((s) => s.settings?.player);
  const update = useApp((s) => s.updateSettings);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label }))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('mousedown', onDown);
    addEventListener('keydown', onKey, true);
    return () => { removeEventListener('mousedown', onDown); removeEventListener('keydown', onKey, true); };
  }, [onClose]);

  if (!player) return null;

  const gains = gainsFor(player.eqProfile, player.eqBands);
  const setProfile = (id: string) => update({ player: { eqEnabled: true, eqProfile: id } });
  const setBand = (i: number, v: number) => {
    const base = normalizeBands(gains);
    update({ player: { eqEnabled: true, eqProfile: 'custom', eqBands: base.map((g, j) => (j === i ? v : g)) } });
  };
  const description = !player.eqEnabled
    ? 'Equalizer is off — sound plays as recorded.'
    : player.eqProfile === 'custom' ? 'Your own custom curve.' : profileById(player.eqProfile)?.description ?? '';

  const realDevices = devices.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');

  return (
    <div ref={ref} role="dialog" aria-label="Sound" className="p-menu absolute right-0 bottom-full mb-3 w-[330px] rounded-2xl p-4 text-[var(--p-ink)] animate-rise">
      <div className="mb-3">
        <label htmlFor="eq-output" className="mb-1.5 block text-[11px] font-semibold tracking-[0.08em] text-[var(--p-ink-3)] uppercase">Output device</label>
        <select
          id="eq-output"
          value={player.outputDeviceId}
          onChange={(e) => update({ player: { outputDeviceId: e.target.value } })}
          className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-accent)]"
        >
          <option value="">System default</option>
          {realDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Audio device'}</option>)}
        </select>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-[var(--p-ink-3)] uppercase">Equalizer</span>
        <button
          role="switch"
          aria-checked={player.eqEnabled}
          onClick={() => update({ player: { eqEnabled: !player.eqEnabled } })}
          className={cn('relative h-5 w-9 rounded-full transition-colors', player.eqEnabled ? 'bg-[var(--p-accent)]' : 'bg-white/15')}
        >
          <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-transform', player.eqEnabled ? 'translate-x-[18px]' : 'translate-x-0.5')} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {EQ_PROFILES.map((prof) => {
          const active = player.eqEnabled && player.eqProfile === prof.id;
          return (
            <button
              key={prof.id}
              onClick={() => setProfile(prof.id)}
              aria-pressed={active}
              title={prof.description}
              className={cn('rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors', active ? 'bg-white/16 text-[var(--p-ink)]' : 'bg-white/6 text-[var(--p-ink-3)] hover:text-[var(--p-ink-2)]')}
            >
              {prof.name}
            </button>
          );
        })}
        <button
          onClick={() => setProfile('custom')}
          aria-pressed={player.eqEnabled && player.eqProfile === 'custom'}
          className={cn('rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors', player.eqEnabled && player.eqProfile === 'custom' ? 'bg-white/16 text-[var(--p-ink)]' : 'bg-white/6 text-[var(--p-ink-3)] hover:text-[var(--p-ink-2)]')}
        >
          Custom
        </button>
      </div>

      <div className={cn('mt-4 grid grid-cols-5 gap-2 transition-opacity', !player.eqEnabled && 'pointer-events-none opacity-40')}>
        {EQ_BANDS.map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <input
              type="range"
              min={-EQ_GAIN_LIMIT}
              max={EQ_GAIN_LIMIT}
              step={1}
              value={gains[i] ?? 0}
              aria-label={`${EQ_BAND_LABELS[i]} Hz gain`}
              onChange={(e) => setBand(i, Number(e.target.value))}
              className="p-range h-24 w-4 accent-[var(--p-accent)]"
              style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
            />
            <span className="text-[10px] text-[var(--p-ink-3)] tabular">{EQ_BAND_LABELS[i]}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[12px] leading-snug text-[var(--p-ink-3)]">{description}</p>
    </div>
  );
}
