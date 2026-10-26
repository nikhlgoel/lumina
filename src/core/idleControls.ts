// When should a video's controls get out of the way?
//
// The rule people expect from YouTube and Netflix: while a video plays, the controls fade after a
// few seconds of stillness so the picture is clear, and come straight back on any movement. They
// must never vanish under a hand that is using them, and never while paused.

/** How long the pointer and keyboard must be still before the controls hide. */
export const CONTROLS_IDLE_MS = 3000;

export interface ControlsState {
  /** The idle timer has run out since the last movement or key press. */
  idle: boolean;
  playing: boolean;
  /** The pointer is on the control bar, the header or a menu — hiding now would pull them from under it. */
  pointerOverChrome: boolean;
  /** The settings menu is open. */
  menuOpen: boolean;
  /** The queue sheet is open. */
  queueOpen: boolean;
}

export function controlsHidden(s: ControlsState): boolean {
  return s.idle && s.playing && !s.pointerOverChrome && !s.menuOpen && !s.queueOpen;
}
