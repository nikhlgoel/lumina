import { EQ_BANDS, EQ_BAND_TYPES, EQ_Q, dbToGain, gainsFor, type UserPreset } from '@core/equalizer';
import { effectiveEq, eqPlan, isFlat, needsLimiter } from '@core/sound';
import { ceilingCurve, limiterSettings } from '@core/volume';
import { call } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { media } from '@/lib/mediaElement';

/**
 * The player's audio pipeline: a Web Audio equalizer graph over the single {@link media} element, plus
 * output-device switching. Both are driven entirely by `settings.player` (so the system-tray menu, which
 * writes those settings, controls them too). The EQ graph is built lazily on first use — until the user
 * turns the equalizer on, the media element's audio path is completely untouched.
 */

type Sinkable = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

let ctx: AudioContext | null = null;
let filters: BiquadFilterNode[] = [];
let normalizer: GainNode | null = null;
let preamp: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let boost: GainNode | null = null;
let limiter: DynamicsCompressorNode | null = null;
let graphBuilt = false;
/** The gain the current track asked for, so rebuilding or re-enabling keeps it. */
let trackGain = 1;
/** The boost the volume control asked for, kept for the same reason. */
let boostGain = 1;
/** "Best sound" is on: the limiter stays engaged and the clarity curve may apply (core/sound.ts). */
let bestSoundOn = false;
/** The curve last asked for, kept for the same reason. */
let eqGains: number[] = EQ_BANDS.map(() => 0);
/** The level taken off before the equalizer so its boosts have room (dB, never positive), and how high the curve lifts (dB). */
let eqHeadroom = 0;
let eqPeak = 0;

export interface ChainOptions { gains: readonly number[]; trackGain: number; boostGain: number; protect: boolean; /** dB, never positive. */ headroomDb?: number }
export interface Chain { output: AudioNode; filters: BiquadFilterNode[]; normalizer: GainNode; preamp: GainNode; boost: GainNode; limiter: DynamicsCompressorNode }

const protecting = () => needsLimiter({ bestSound: bestSoundOn, trackGain, boostGain, eqPeakDb: eqPeak });

function setLimiter(l: DynamicsCompressorNode, gain: number, protect: boolean) {
  const s = limiterSettings(gain, protect);
  l.threshold.value = s.threshold;
  l.ratio.value = s.ratio;
  l.knee.value = s.knee;
  l.attack.value = s.attack;
  l.release.value = s.release;
}

/**
 * The whole signal path after the source, built on any audio context (the player's own, or an offline one for checking it):
 * loudness gain, then the headroom the curve asks for, then the ten equalizer bands (shelves at the ends, peaking between), then the volume boost,
 * then the limiter last of all, so it catches everything above it.
 */
export function buildChain(c: BaseAudioContext, source: AudioNode, o: ChainOptions): Chain {
  const fs = EQ_BANDS.map((freq, i) => {
    const f = c.createBiquadFilter();
    f.type = EQ_BAND_TYPES[i]!;
    f.frequency.value = freq;
    f.Q.value = EQ_Q; // ignored by the two shelves
    f.gain.value = o.gains[i] ?? 0;
    return f;
  });
  const room = c.createGain();
  room.gain.value = dbToGain(o.headroomDb ?? 0);
  // Loudness first, then the equalizer: the gain is a property of the recording, and the EQ is the listener's preference applied on top of it.
  const norm = c.createGain();
  norm.gain.value = o.trackGain;
  const boostNode = c.createGain();
  boostNode.gain.value = o.boostGain;
  const lim = c.createDynamicsCompressor();
  setLimiter(lim, o.boostGain, o.protect);
  let node: AudioNode = source;
  node.connect(norm);
  node = norm;
  node.connect(room);
  node = room;
  for (const f of fs) {
    node.connect(f);
    node = f;
  }
  node.connect(boostNode);
  boostNode.connect(lim);
  // The soft ceiling last of all: whatever the limiter lets through (it is a compressor, not a wall) cannot leave over full scale.
  const ceiling = c.createWaveShaper();
  ceiling.curve = ceilingCurve();
  // No oversampling: it makes a clipped edge ring, and the ring overshoots the very ceiling this is for (measured). Straight sample by sample, nothing goes over.
  ceiling.oversample = 'none';
  lim.connect(ceiling);
  return { output: ceiling, filters: fs, normalizer: norm, preamp: room, boost: boostNode, limiter: lim };
}

function buildGraph() {
  if (graphBuilt) return;
  graphBuilt = true;
  // 'playback' asks the OS for larger output buffers: a little more latency (irrelevant for a
  // player, which is not an instrument) in exchange for far fewer underruns — the crackle and
  // dropouts heard when the main thread is busy drawing lyrics or an Aurora background.
  // No sample rate is asked for: the context then runs at the output device's own rate, so nothing is resampled on the way to the speakers.
  ctx = new AudioContext({ latencyHint: 'playback' });
  const source = ctx.createMediaElementSource(media);
  const chain = buildChain(ctx, source, { gains: eqGains, trackGain, boostGain, protect: protecting(), headroomDb: eqHeadroom });
  filters = chain.filters;
  normalizer = chain.normalizer;
  preamp = chain.preamp;
  boost = chain.boost;
  limiter = chain.limiter;
  chain.output.connect(ctx.destination);
  // Once the element's sound goes through the graph, a graph that is not running is silence: keep it running whenever something plays, and after the
  // system suspends it (a device change, sleep).
  media.addEventListener('play', () => void ctx?.resume().catch(() => undefined));
  ctx.addEventListener('statechange', () => { if (ctx && ctx.state !== 'running' && !media.paused) void ctx.resume().catch(() => undefined); });
  void ctx.resume().catch(() => undefined);
}

function applyLimiter() {
  if (limiter) setLimiter(limiter, boostGain, protecting());
}

/**
 * Play louder than the media element can on its own.
 *
 * Anything up to 100% is left entirely to `media.volume`, so the ordinary case never touches the
 * Web Audio graph at all. Above it the element sits at unity and this makes up the difference, with
 * the limiter engaged so the extra gain cannot turn into clipping. See D18.
 */
export function applyVolumeBoost(gain: number) {
  const next = Number.isFinite(gain) && gain > 0 ? gain : 1;
  boostGain = next;
  if (next !== 1) buildGraph();
  if (!boost || !ctx) return;
  void ctx.resume().catch(() => undefined);
  applyLimiter();
  const now = ctx.currentTime;
  boost.gain.cancelScheduledValues(now);
  boost.gain.setValueAtTime(boost.gain.value, now);
  boost.gain.linearRampToValueAtTime(next, now + 0.05);
}

/**
 * Apply the sound settings: the equalizer (the person's own when it is on, otherwise best sound's clarity curve, otherwise flat) and whether the
 * limiter is engaged. Leaves the audio path completely alone while nothing needs it, so plain playback has nothing of ours in it.
 */
export function applySound(p: { bestSound: boolean; eqEnabled: boolean; eqProfile: string; eqBands: number[]; eqPresets?: UserPreset[] }) {
  bestSoundOn = p.bestSound;
  const plan = eqPlan(p.bestSound, p.eqEnabled, gainsFor(p.eqProfile, p.eqBands, p.eqPresets ?? []));
  eqGains = plan.gains;
  eqHeadroom = plan.headroomDb;
  eqPeak = plan.peakDb;
  if (!graphBuilt && isFlat(eqGains) && !protecting()) return;
  buildGraph();
  void ctx?.resume().catch(() => undefined);
  const now = ctx?.currentTime ?? 0;
  // A short glide: stepping a filter's gain in one go can click.
  filters.forEach((f, i) => f.gain.setTargetAtTime(eqGains[i] ?? 0, now, 0.03));
  preamp?.gain.setTargetAtTime(dbToGain(eqHeadroom), now, 0.03);
  applyLimiter();
}

/**
 * A look at what is being played, for the equalizer's moving background. The tap hangs off the end of the chain and is only there while the
 * panel is open; nothing is built for it (the audio path stays untouched while nothing needs it), so there is simply no picture then.
 */
export function spectrumOn(on: boolean) {
  if (!on) {
    analyser?.disconnect();
    analyser = null;
    return;
  }
  if (analyser || !ctx || !limiter) return;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.82;
  limiter.connect(analyser);
}

/** Levels (0 to 1) across `bins` log-spaced steps from 30 Hz to 16 kHz, or null while there is no tap. */
export function readSpectrum(bins: number): number[] | null {
  if (!analyser || !ctx) return null;
  const data = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(data);
  const nyquist = ctx.sampleRate / 2;
  const out: number[] = [];
  for (let i = 0; i < bins; i++) {
    const lo = 30 * (16000 / 30) ** (i / bins);
    const hi = 30 * (16000 / 30) ** ((i + 1) / bins);
    const a = Math.max(1, Math.floor((lo / nyquist) * data.length));
    const b = Math.max(a + 1, Math.ceil((hi / nyquist) * data.length));
    let peak = -140;
    for (let k = a; k < b && k < data.length; k++) peak = Math.max(peak, data[k]!);
    // -90 dB is the floor of the picture, -20 dB the top.
    out.push(Math.max(0, Math.min(1, (peak + 90) / 70)));
  }
  return out;
}

/** The average level in dB of what comes out of the chain, in octave-wide bands, for checking the real signal path from outside. Null when it is not built. */
export function probeBands(centres: readonly number[]): number[] | null {
  spectrumOn(true);
  if (!analyser || !ctx) return null;
  analyser.smoothingTimeConstant = 0;
  analyser.fftSize = 16384; // finer bins: a 44 to 88 Hz band is only four bins wide at the panel's 4096
  const data = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(data);
  const nyquist = ctx.sampleRate / 2;
  return centres.map((c) => {
    const a = Math.max(1, Math.floor((c / Math.SQRT2 / nyquist) * data.length));
    const b = Math.max(a + 1, Math.ceil(((c * Math.SQRT2) / nyquist) * data.length));
    let power = 0;
    for (let k = a; k < b && k < data.length; k++) power += 10 ** (data[k]! / 10);
    return 10 * Math.log10(power / (b - a));
  });
}

/** Route audio to a specific output device ('' / 'default' = system default). Silently ignored if unsupported. */
export async function applyOutputDevice(deviceId: string) {
  const el = media as Sinkable;
  if (typeof el.setSinkId !== 'function') return;
  try {
    await el.setSinkId(deviceId || 'default');
  } catch {
    // Device unplugged or not permitted — fall back to whatever the OS chooses.
  }
}

/** Tell the main process which audio outputs exist, so the tray can offer them. */
export async function reportDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    await call('audio:report-devices', { devices: outputs });
  } catch {
    // enumerateDevices unavailable (e.g. no media backend) — the tray just shows System default.
  }
}

let started = false;

/** Wire the audio pipeline to settings. Call once, after settings have loaded. */
export function initAudio() {
  if (started) return;
  started = true;

  const apply = (player: NonNullable<ReturnType<typeof useApp.getState>['settings']>['player']) => {
    void applyOutputDevice(player.outputDeviceId);
    applySound(player);
  };

  let prev = useApp.getState().settings?.player ?? null;
  if (prev) apply(prev);

  useApp.subscribe((s) => {
    const player = s.settings?.player;
    if (!player || player === prev) return;
    const changed = !prev
      || player.outputDeviceId !== prev.outputDeviceId
      || player.bestSound !== prev.bestSound
      || player.eqEnabled !== prev.eqEnabled
      || player.eqProfile !== prev.eqProfile
      || player.eqBands !== prev.eqBands
      || player.eqPresets !== prev.eqPresets;
    prev = player;
    if (changed) apply(player);
  });

  void reportDevices();
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void reportDevices());
}

/** The gains currently applied, for the stats panel: what loudness matching and the boost are doing. */
export const audioGains = () => ({ track: trackGain, boost: boostGain });

/**
 * Play the current track at the level everything else plays at.
 *
 * Applied as a gain on the audio graph rather than by touching `media.volume`, so the volume
 * slider keeps meaning what the listener set it to. The ramp is short but not instant: stepping
 * a gain node discontinuously makes an audible click.
 *
 * Measuring a real library found seven tracks in eight peaking above full scale, one at
 * +5.6 dBFS. Those clip on playback, which is heard as harsh and flat — so this is as much about
 * the distortion as it is about matching levels.
 */
export function applyTrackGain(gainLinear: number) {
  const next = Number.isFinite(gainLinear) && gainLinear > 0 ? gainLinear : 1;
  trackGain = next;
  if (next !== 1) buildGraph();
  if (!normalizer || !ctx) return;
  void ctx.resume().catch(() => undefined);
  applyLimiter();
  const now = ctx.currentTime;
  normalizer.gain.cancelScheduledValues(now);
  normalizer.gain.setValueAtTime(normalizer.gain.value, now);
  normalizer.gain.linearRampToValueAtTime(next, now + 0.05);
}

// A hook for checking the signal path from outside the app's own code (the capture harness builds the same chain on an offline context and measures it).
(window as unknown as { __luminaAudio?: unknown }).__luminaAudio = { buildChain, effectiveEq, probeBands, spectrumOn, graphReady: () => graphBuilt, headroom: () => eqHeadroom };
