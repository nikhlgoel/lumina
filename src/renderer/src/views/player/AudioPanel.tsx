import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Headphones, X } from 'lucide-react';
import {
  EQ_GROUP_LABELS, EQ_PROFILES, QUICK_PROFILE_IDS, freshPresetName, gainsFor, headroomDb, newPresetId, normalizeBands, profileById, profileName, sanitizeUserPresets,
  type EqGroup,
} from '@core/equalizer';
import { cn } from '@/lib/cn';
import { spectrumOn } from '@/lib/audio';
import { useApp } from '@/stores/app';
import { EqGraph } from './EqGraph';

/** A switch in the panel's own glass style. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="p-switch" />;
}

/**
 * The player's Sound panel: output device, the two sound switches, and the equalizer.
 *
 * Frosted glass over whatever the player is showing, sized to what it holds: a heading line, two switches, five preset chips, the curve, and one
 * line for the preset and what can be done with it. The longer preset list opens in place and scrolls, and the panel never grows past the window.
 * Everything writes to `settings.player`, which the audio engine and the system tray both follow.
 */
export function AudioPanel({ onClose, lift = false }: { onClose: () => void; /** Sit higher: in the video player the progress bar runs just above the buttons. */ lift?: boolean }) {
  const player = useApp((s) => s.settings?.player);
  const update = useApp((s) => s.updateSettings);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [more, setMore] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // The curve is written to settings (a file write and a tray rebuild each time) at most about ten times a second while a dot is dragged.
  const pendingCurve = useRef<number[] | null>(null);
  const curveTimer = useRef(0);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label }))))
      .catch(() => undefined);
  }, []);

  // The spectrum behind the curve needs a tap on the audio path; it is there only while the panel is.
  useEffect(() => {
    spectrumOn(true);
    return () => spectrumOn(false);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('mousedown', onDown);
    addEventListener('keydown', onKey, true);
    return () => { removeEventListener('mousedown', onDown); removeEventListener('keydown', onKey, true); };
  }, [onClose]);

  const saved = useMemo(() => sanitizeUserPresets(player?.eqPresets), [player?.eqPresets]);
  const baseNow = player?.eqProfile === 'custom' ? player.eqBase : player?.eqProfile;
  const writeCurve = (next: number[]) => void update({ player: { eqEnabled: true, eqProfile: 'custom', eqBands: next, eqBase: baseNow ?? 'flat' } });
  const flushCurve = () => {
    window.clearTimeout(curveTimer.current);
    curveTimer.current = 0;
    const next = pendingCurve.current;
    pendingCurve.current = null;
    if (next) writeCurve(next);
  };
  const queueCurve = (next: number[]) => {
    pendingCurve.current = next;
    if (!curveTimer.current) curveTimer.current = window.setTimeout(flushCurve, 100);
  };
  // Closing the panel mid-drag must not lose the last position.
  const flushRef = useRef(flushCurve);
  flushRef.current = flushCurve;
  useEffect(() => () => flushRef.current(), []);
  if (!player) return null;

  const gains = gainsFor(player.eqProfile, player.eqBands, saved);
  const edited = player.eqProfile === 'custom';
  const base = edited ? player.eqBase : player.eqProfile;
  const baseSaved = saved.find((p) => p.id === base);
  const builtin = profileById(edited ? base : player.eqProfile);
  const headroom = headroomDb(gains);

  const setProfile = (id: string) => { void update({ player: { eqEnabled: true, eqProfile: id, eqBase: id } }); setNaming(null); };
  const reset = () => void update({ player: { eqProfile: base || 'flat' } });
  const saveAs = (name: string) => {
    const label = freshPresetName(name, saved.map((p) => p.name));
    const id = newPresetId(saved.map((p) => p.id));
    void update({ player: { eqPresets: [...saved, { id, name: label, bands: normalizeBands(gains) }], eqProfile: id, eqBase: id, eqEnabled: true } });
    setNaming(null);
  };
  const overwrite = () => {
    if (!baseSaved) return;
    void update({ player: { eqPresets: saved.map((p) => (p.id === baseSaved.id ? { ...p, bands: normalizeBands(gains) } : p)), eqProfile: baseSaved.id } });
  };
  const remove = (id: string) => void update({ player: { eqPresets: saved.filter((p) => p.id !== id), ...(player.eqProfile === id || (edited && base === id) ? { eqProfile: 'flat', eqBase: 'flat' } : {}) } });

  const description = !player.eqEnabled
    ? (player.bestSound ? 'Equalizer is off. Best sound’s clarity curve is in use.' : 'Equalizer is off. Sound plays as recorded.')
    : edited ? `Edited from ${profileName(base, saved)}.` : (builtin?.description ?? (saved.find((p) => p.id === player.eqProfile) ? 'Your own preset.' : ''));
  const realDevices = devices.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const quick = QUICK_PROFILE_IDS.map((id) => profileById(id)!);
  const current = !edited && !QUICK_PROFILE_IDS.includes(player.eqProfile as (typeof QUICK_PROFILE_IDS)[number]) ? player.eqProfile : null;

  const chip = (id: string, label: string, key = id) => (
    <button key={key} type="button" onClick={() => setProfile(id)} aria-pressed={player.eqEnabled && !edited && player.eqProfile === id} title={profileById(id)?.description} className="p-chip">{label}</button>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Sound"
      className={cn('p-glass absolute right-0 bottom-full flex w-[320px] max-w-[calc(100vw-24px)] flex-col rounded-[22px] text-[var(--p-ink)] animate-rise', lift ? 'mb-12' : 'mb-3')}
      style={{ maxHeight: `calc(100vh - ${lift ? 150 : 120}px)` }}
    >
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-medium tracking-[0.01em]">Sound</span>
          <label className="relative flex min-w-0 items-center gap-1.5 rounded-full bg-white/8 py-1 pr-2.5 pl-2.5 text-[12px] text-white/75 shadow-[inset_0_1px_0_rgb(255_255_255_/_.12)] focus-within:ring-2 focus-within:ring-[var(--p-accent)]">
            <Headphones className="size-3.5 shrink-0" aria-hidden />
            <select
              aria-label="Output device"
              value={player.outputDeviceId}
              onChange={(e) => update({ player: { outputDeviceId: e.target.value } })}
              className="min-w-0 max-w-[150px] cursor-pointer appearance-none truncate bg-transparent pr-4 outline-none [&>option]:bg-[#1b1a22] [&>option]:text-white"
            >
              <option value="">System default</option>
              {realDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Audio device'}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 size-3 shrink-0" aria-hidden />
          </label>
        </div>

        <div className="flex flex-col gap-2.5 border-y border-white/10 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px]">Best sound</div>
              <div className="text-[11px] leading-snug text-white/58">{player.bestSound ? 'Clear, a little louder, never distorted' : 'Plays as recorded'}</div>
            </div>
            <Switch checked={player.bestSound} onChange={(on) => update({ player: { bestSound: on } })} label="Best sound" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px]">Even volume</div>
              <div className="text-[11px] leading-snug text-white/58">{player.normalizeLoudness ? 'Quiet songs come up, loud ones come down' : 'Big jumps between tracks'}</div>
            </div>
            <Switch checked={player.normalizeLoudness} onChange={(on) => update({ player: { normalizeLoudness: on } })} label="Even volume across tracks" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium">Equalizer</span>
          <Switch checked={player.eqEnabled} onChange={(on) => update({ player: { eqEnabled: on } })} label="Equalizer" />
        </div>

        <div className="-mt-1 flex flex-wrap gap-1.5">
          {quick.map((p) => chip(p.id, p.name))}
          {current && chip(current, profileName(current, saved))}
          {edited && <button type="button" aria-pressed={player.eqEnabled} className="p-chip">Edited</button>}
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="p-chip border-dashed">{more ? 'Less' : 'More'}</button>
        </div>

        {more && (
          <div className="p-fade -mt-1 flex max-h-[128px] flex-col gap-2 overflow-y-auto pr-1 pb-5">
            {(Object.keys(EQ_GROUP_LABELS) as EqGroup[]).map((group) => (
              <div key={group}>
                <div className="mb-1 text-[10px] tracking-[0.09em] text-white/50 uppercase">{EQ_GROUP_LABELS[group]}</div>
                <div className="flex flex-wrap gap-1.5">
                  {EQ_PROFILES.filter((p) => p.group === group && !QUICK_PROFILE_IDS.includes(p.id as (typeof QUICK_PROFILE_IDS)[number])).map((p) => chip(p.id, p.name))}
                </div>
              </div>
            ))}
            <div>
              <div className="mb-1 text-[10px] tracking-[0.09em] text-white/50 uppercase">Mine</div>
              {saved.length === 0 ? (
                <div className="text-[11px] text-white/50">Shape the curve, then Save as to keep it here.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {saved.map((p) => (
                    <span key={p.id} className="inline-flex items-center">
                      <button type="button" onClick={() => setProfile(p.id)} aria-pressed={player.eqEnabled && !edited && player.eqProfile === p.id} className="p-chip rounded-r-none pr-2">{p.name}</button>
                      <button type="button" onClick={() => remove(p.id)} aria-label={`Delete ${p.name}`} title="Delete" className="p-chip grid rounded-l-none border-l-0 px-1.5 py-[5px]"><X className="size-3" aria-hidden /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <EqGraph
          gains={gains}
          enabled={player.eqEnabled}
          onChange={queueCurve}
          onCommit={flushCurve}
        />

        {naming !== null ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); saveAs(naming); }}
          >
            <input
              autoFocus
              value={naming}
              maxLength={30}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }}
              placeholder="Name this preset"
              aria-label="Preset name"
              className="h-8 min-w-0 flex-1 rounded-lg border border-white/15 bg-black/25 px-2.5 text-[12px] text-[var(--p-ink)] outline-none placeholder:text-white/40 focus:border-[var(--p-accent)]"
            />
            <button type="submit" className="p-link text-[12px] font-medium">Save</button>
            <button type="button" onClick={() => setNaming(null)} className="p-link text-[12px]">Cancel</button>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-[11px] leading-snug text-white/62">
              {description}
              {player.eqEnabled && headroom < 0 && <span className="text-white/42"> Headroom {headroom.toFixed(1)} dB.</span>}
            </span>
            {player.eqEnabled && (
              <span className="flex flex-none gap-3 text-[12px]">
                {edited && <button type="button" onClick={reset} className="p-link">Reset</button>}
                {edited && baseSaved && <button type="button" onClick={overwrite} className="p-link">Save</button>}
                {(edited || !builtin || builtin.id !== 'flat') && saved.length < 24 && <button type="button" onClick={() => setNaming(edited ? '' : profileName(player.eqProfile, saved))} className="p-link">Save as…</button>}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
