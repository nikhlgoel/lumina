import { EQ_BANDS, gainsFor } from '@core/equalizer';
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
let graphBuilt = false;

function buildGraph() {
  if (graphBuilt) return;
  graphBuilt = true;
  ctx = new AudioContext();
  const source = ctx.createMediaElementSource(media);
  filters = EQ_BANDS.map((freq) => {
    const f = ctx!.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1.1;
    f.gain.value = 0;
    return f;
  });
  let node: AudioNode = source;
  for (const f of filters) {
    node.connect(f);
    node = f;
  }
  node.connect(ctx.destination);
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
