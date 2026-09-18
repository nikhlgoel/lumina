// The tray menu's playback and download controls, as pure data.
//
// The tray is often the only part of Lumina someone touches while it plays in the background, so it
// has to show the TRUE state — a tick on Mute only when the player really is muted, the radio mark
// on the volume actually in effect. Deciding that is here, unit-tested; src/main/tray.ts only turns
// these items into an Electron menu and sends the commands on.

export type Repeat = 'off' | 'all' | 'one';

/** What the player reports to the main process whenever any of it changes. */
export interface TrayPlayback {
  playing: boolean;
  title: string | null;
  artist: string | null;
  /** 0..1 */
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
}

/** Everything the tray can ask the player to do. Sent to the renderer on `player:command`. */
export type PlayerCommand =
  | { command: 'toggle' }
  | { command: 'next' }
  | { command: 'previous' }
  | { command: 'seek-by'; value: number }
  | { command: 'mute' }
  | { command: 'volume'; value: number }
  | { command: 'volume-by'; value: number }
  | { command: 'shuffle' }
  | { command: 'repeat'; mode: Repeat };

/** Actions the main process carries out itself, without the renderer. */
export type TrayAction = { action: 'downloads-pause-all' } | { action: 'downloads-resume-all' };

export interface TrayItem {
  label?: string;
  type?: 'normal' | 'checkbox' | 'radio' | 'separator';
  checked?: boolean;
  enabled?: boolean;
  run?: PlayerCommand | TrayAction;
  submenu?: TrayItem[];
}

export const idlePlayback = (): TrayPlayback => ({
  playing: false, title: null, artist: null, volume: 0.8, muted: false, shuffle: false, repeat: 'off',
});

/** The volumes offered as one-click choices. */
export const VOLUME_PRESETS = [1, 0.75, 0.5, 0.25, 0.1] as const;

/** How far "Louder"/"Quieter" and the seek items move. */
export const VOLUME_STEP = 0.1;
export const SEEK_STEP_S = 10;

const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** A preset is "the current volume" only when it really is — within rounding, and not muted. */
export const isPresetActive = (preset: number, s: TrayPlayback) => !s.muted && Math.abs(s.volume - preset) < 0.005;

/** "Volume 80%", or "Volume — muted" so the submenu title never contradicts the Mute tick. */
export const volumeLabel = (s: TrayPlayback) => (s.muted ? 'Volume — muted' : `Volume ${pct(s.volume)}`);

/** The now-playing line, trimmed for a menu (Windows menus do not wrap). */
export function nowPlayingLabel(s: TrayPlayback, max = 48): string {
  if (!s.title) return 'Nothing playing';
  const text = s.artist ? `${s.title} — ${s.artist}` : s.title;
  return [...text].length > max ? `${[...text].slice(0, max - 1).join('')}…` : text;
}

export function playbackItems(s: TrayPlayback): TrayItem[] {
  const has = Boolean(s.title);
  const repeatLabels: Record<Repeat, string> = { off: 'Off', all: 'Repeat all', one: 'Repeat one' };

  return [
    { label: nowPlayingLabel(s), enabled: false },
    { label: s.playing ? 'Pause' : 'Play', enabled: has, run: { command: 'toggle' } },
    { label: 'Next', enabled: has, run: { command: 'next' } },
    { label: 'Previous', enabled: has, run: { command: 'previous' } },
    { label: `Back ${SEEK_STEP_S} seconds`, enabled: has, run: { command: 'seek-by', value: -SEEK_STEP_S } },
    { label: `Forward ${SEEK_STEP_S} seconds`, enabled: has, run: { command: 'seek-by', value: SEEK_STEP_S } },
    { type: 'separator' },
    // Mute and volume work with nothing playing too — people set them before pressing play.
    { label: 'Mute', type: 'checkbox', checked: s.muted, run: { command: 'mute' } },
    {
      label: volumeLabel(s),
      submenu: [
        { label: `Louder (+${pct(VOLUME_STEP)})`, enabled: s.muted || s.volume < 1, run: { command: 'volume-by', value: VOLUME_STEP } },
        { label: `Quieter (−${pct(VOLUME_STEP)})`, enabled: !s.muted && s.volume > 0, run: { command: 'volume-by', value: -VOLUME_STEP } },
        { type: 'separator' },
        ...VOLUME_PRESETS.map((v): TrayItem => ({ label: pct(v), type: 'radio', checked: isPresetActive(v, s), run: { command: 'volume', value: v } })),
      ],
    },
    { label: 'Shuffle', type: 'checkbox', checked: s.shuffle, run: { command: 'shuffle' } },
    {
      label: 'Repeat',
      submenu: (['off', 'all', 'one'] as const).map((mode): TrayItem => ({
        label: repeatLabels[mode], type: 'radio', checked: s.repeat === mode, run: { command: 'repeat', mode },
      })),
    },
  ];
}

/**
 * Download status plus pause/resume-all — only the actions that would actually do something.
 * `waiting` jobs count as pausable: "pause all" that left them queued would not pause anything.
 */
export function downloadItems(counts: { active: number; waiting: number; paused: number }): TrayItem[] {
  const { active, waiting, paused } = counts;
  const status = active
    ? `${active} download${active > 1 ? 's' : ''} in progress${waiting ? ` · ${waiting} waiting` : ''}`
    : waiting ? `${waiting} download${waiting > 1 ? 's' : ''} waiting`
      : paused ? `${paused} download${paused > 1 ? 's' : ''} paused` : 'No active downloads';
  const items: TrayItem[] = [{ label: status, enabled: false }];
  if (active + waiting > 0) items.push({ label: 'Pause all downloads', run: { action: 'downloads-pause-all' } });
  if (paused > 0) items.push({ label: 'Resume all downloads', run: { action: 'downloads-resume-all' } });
  return items;
}

type JobStatusLike = { id: string; status: string };

/**
 * The order to pause jobs in for "pause all": everything WAITING first, then everything running.
 * Pausing a running job frees a slot, and the queue immediately starts a waiting job in it — so
 * pausing the running ones first would just start the next download.
 */
export function pauseAllOrder(jobs: JobStatusLike[]): string[] {
  const waiting = jobs.filter((j) => j.status === 'queued').map((j) => j.id);
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'processing').map((j) => j.id);
  return [...waiting, ...running];
}

/**
 * A relative volume change as a person expects it: from the volume they had (even if muted — the
 * player unmutes on any volume change), kept inside 0..1, rounded to whole percent so repeated
 * steps never drift into 0.30000000000000004.
 */
export const nextVolume = (current: number, delta: number): number =>
  Math.round(Math.max(0, Math.min(1, current + delta)) * 100) / 100;
