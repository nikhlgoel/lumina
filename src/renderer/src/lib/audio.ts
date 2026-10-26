import { EQ_BANDS, gainsFor } from '@core/equalizer';
import { limiterSettings } from '@core/volume';
import { call } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { media } from '@/stores/player';

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
let boost: GainNode | null = null;
let limiter: DynamicsCompressorNode | null = null;
let graphBuilt = false;
/** The gain the current track asked for, so rebuilding or re-enabling keeps it. */
let trackGain = 1;
/** The boost the volume control asked for, kept for the same reason. */
let boostGain = 1;

function buildGraph() {
  if (graphBuilt) return;
  graphBuilt = true;
  // 'playback' asks the OS for larger output buffers: a little more latency (irrelevant for a
  // player, which is not an instrument) in exchange for far fewer underruns — the crackle and
  // dropouts heard when the main thread is busy drawing lyrics or an Aurora background.
  ctx = new AudioContext({ latencyHint: 'playback' });
  const source = ctx.createMediaElementSource(media);
  filters = EQ_BANDS.map((freq) => {
    const f = ctx!.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1.1;
    f.gain.value = 0;
    return f;
  });
  // Loudness first, then the equalizer: the gain is a property of the recording, and the EQ is the
  // listener's preference applied on top of it.
  normalizer = ctx.createGain();
  normalizer.gain.value = trackGain;

  // Then the volume boost, and the limiter last of all — so it catches everything above it,
  // including a bass band the listener pushed up. Both are transparent below 100%.
  boost = ctx.createGain();
  boost.gain.value = boostGain;
  limiter = ctx.createDynamicsCompressor();
  applyLimiter(boostGain);

  let node: AudioNode = source;
  node.connect(normalizer);
  node = normalizer;
  for (const f of filters) {
    node.connect(f);
    node = f;
  }
  node.connect(boost);
  boost.connect(limiter);
  limiter.connect(ctx.destination);
}

function applyLimiter(gain: number) {
  if (!limiter) return;
  const s = limiterSettings(gain);
  limiter.threshold.value = s.threshold;
  limiter.ratio.value = s.ratio;
  limiter.knee.value = s.knee;
  limiter.attack.value = s.attack;
  limiter.release.value = s.release;
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
  applyLimiter(next);
  const now = ctx.currentTime;
  boost.gain.cancelScheduledValues(now);
  boost.gain.setValueAtTime(boost.gain.value, now);
  boost.gain.linearRampToValueAtTime(next, now + 0.05);
}

/** Apply equalizer gains. When off, leaves the audio path alone if the graph was never built. */
export function applyEq(enabled: boolean, gains: number[]) {
  if (!enabled && !graphBuilt) return;
  buildGraph();
  void ctx?.resume().catch(() => undefined);
  const applied = enabled ? gains : EQ_BANDS.map(() => 0);
  filters.forEach((f, i) => { f.gain.value = applied[i] ?? 0; });
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
    applyEq(player.eqEnabled, gainsFor(player.eqProfile, player.eqBands));
  };

  let prev = useApp.getState().settings?.player ?? null;
  if (prev) apply(prev);

  useApp.subscribe((s) => {
    const player = s.settings?.player;
    if (!player || player === prev) return;
    const changed = !prev
      || player.outputDeviceId !== prev.outputDeviceId
      || player.eqEnabled !== prev.eqEnabled
      || player.eqProfile !== prev.eqProfile
      || player.eqBands !== prev.eqBands;
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
  const now = ctx.currentTime;
  normalizer.gain.cancelScheduledValues(now);
  normalizer.gain.setValueAtTime(normalizer.gain.value, now);
  normalizer.gain.linearRampToValueAtTime(next, now + 0.05);
}
