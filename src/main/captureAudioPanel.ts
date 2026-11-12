// Development-only, part of the equalizer checks (captureAudio.ts): the panel over the playing player. How it looks and how big it is, a dot dragged with real
// mouse events, the keyboard, and saving a preset, with the settings read back after each.
import type { BrowserWindow } from 'electron';

type Step = { name: string; script: string; delay?: number; before?: (win: BrowserWindow) => void };

const OPEN_PLAYER = "document.querySelector('[aria-label^=\"Open player\"]')?.click()";
const SOUND_BUTTON = "document.querySelector('button[aria-label=\"Sound and equalizer\"]')?.click()";
const dlg = "document.querySelector('[role=dialog][aria-label=Sound]')";
const dots = "document.querySelectorAll('[role=slider][aria-label$=\" Hz\"]')";
const settingsNow = "window.lumina.invoke('settings:get').then((s) => ({ eqEnabled: s.player.eqEnabled, eqProfile: s.player.eqProfile, eqBase: s.player.eqBase, eqBands: s.player.eqBands, eqPresets: s.player.eqPresets }))";
const dotCentre = (index: number) => `(() => { const g = ${dots}[${index}]; if (!g) return null; const r = g.querySelector('.ring').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function panelSteps(axe: string | null = null): Step[] {
  const audit = (name: string): Step[] => (axe ? [{ name, script: axe, delay: 300 }] : []);
  return [
    { name: '9100-eq-panel', script: `${OPEN_PLAYER}; setTimeout(() => { ${SOUND_BUTTON} }, 1500)`, delay: 4500 },
    { name: '9101-eq-panel-more', script: "[...document.querySelectorAll('[role=dialog][aria-label=Sound] button')].find((b) => b.textContent.trim() === 'More')?.click()", delay: 1200 },
    ...audit('probe-axe-sound-panel'),
    {
      name: 'probe-audio-panel-size',
      script: `(() => { const d = ${dlg}; if (!d) return JSON.stringify({ open: false }); const r = d.getBoundingClientRect(); return JSON.stringify({ open: true, x: r.x, y: r.y, width: r.width, height: r.height, window: [innerWidth, innerHeight], fits: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, blur: getComputedStyle(d).backdropFilter }); })()`,
      delay: 300,
    },
    {
      // A small window: the panel must shrink to fit it (its body scrolls) and never run off the edge.
      name: 'probe-audio-panel-small',
      delay: 1800,
      before: (win) => { win.setContentSize(900, 560); },
      script: `(() => { const d = ${dlg}; if (!d) return JSON.stringify({ open: false }); const r = d.getBoundingClientRect(); return JSON.stringify({ open: true, y: r.y, height: r.height, window: [innerWidth, innerHeight], fits: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }); })()`,
    },
    { name: '9101b-eq-panel-small-window', script: '0', delay: 400 },
    {
      name: 'probe-audio-panel-restore',
      delay: 1200,
      before: (win) => { win.setContentSize(1360, 860); },
      script: `(() => JSON.stringify({ window: [innerWidth, innerHeight] }))()`,
    },
    {
      // A real drag: mouse down on the 250 Hz dot, move it up, release. The settings must then hold an edited curve whose 250 Hz band went up.
      name: 'probe-audio-drag',
      delay: 3500,
      before: (win) => {
        void (async () => {
          const wc = win.webContents;
          const p = (await wc.executeJavaScript(dotCentre(3))) as { x: number; y: number } | null;
          if (!p) return;
          const [x, y] = [Math.round(p.x), Math.round(p.y)];
          wc.sendInputEvent({ type: 'mouseMove', x, y });
          wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          for (let k = 1; k <= 8; k++) {
            await sleep(40);
            wc.sendInputEvent({ type: 'mouseMove', x, y: y - k * 4, modifiers: ['leftbuttondown'] });
          }
          await sleep(200);
          wc.sendInputEvent({ type: 'mouseUp', x, y: y - 32, button: 'left', clickCount: 1 });
        })();
      },
      script: `(async () => { await new Promise((r) => setTimeout(r, 2500)); const s = await ${settingsNow}; const dot = ${dots}[3]; return JSON.stringify({ settings: s, dotValue: dot && dot.getAttribute('aria-valuenow') }); })()`,
    },
    { name: '9102-eq-panel-edited', script: '0', delay: 800 },
    {
      // The keyboard: focus the 2 kHz dot, press Up three times (+1.5 dB), then Shift+Down once (-2 dB).
      name: 'probe-audio-keys',
      delay: 500,
      script: `(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const g = ${dots}[6]; g.focus(); const before = +g.getAttribute('aria-valuenow'); for (let i = 0; i < 3; i++) g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await sleep(400); const up = +${dots}[6].getAttribute('aria-valuenow'); ${dots}[6].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })); await sleep(400); const down = +${dots}[6].getAttribute('aria-valuenow'); return JSON.stringify({ before, up, down, saved: await ${settingsNow} }); })()`,
    },
    {
      // Save the edited curve as "My night mix" and read it back.
      name: 'probe-audio-save-as',
      delay: 500,
      script: `(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); [...${dlg}.querySelectorAll('button')].find((b) => /^Save as/.test(b.textContent.trim()))?.click(); await sleep(400); const input = ${dlg}.querySelector('input[aria-label="Preset name"]'); if (!input) return JSON.stringify({ error: 'no name field' }); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'My night mix'); input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200); input.form.requestSubmit(); await sleep(900); return JSON.stringify({ saved: await ${settingsNow}, chips: [...${dlg}.querySelectorAll('.p-chip')].map((b) => b.textContent.trim()) }); })()`,
    },
    { name: '9103-eq-panel-saved', script: "[...document.querySelectorAll('[role=dialog][aria-label=Sound] button')].find((b) => b.textContent.trim() === 'More')?.click()", delay: 1200 },
    {
      // The same panel in the video player (it sits higher there, above the progress bar), over a real picture.
      name: 'probe-audio-video',
      delay: 500,
      script: `(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); document.querySelector('[role=dialog][aria-label=Sound]') && dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sleep(400); __luminaPlayer.getState().playQueue([{ id: 'vid', kind: 'video', title: 'Test video', artist: 'Test', album: '', durationSec: 90, src: '', artworkUrl: null, path: null, lazyUrl: 'http://127.0.0.1:8796/test.mp4' }]); await sleep(9000); document.querySelector('[aria-label^="Open player"]')?.click(); await sleep(2500); return JSON.stringify({ kind: __luminaPlayer.getState().queue[0] && __luminaPlayer.getState().queue[0].kind, playing: __luminaPlayer.getState().playing, hasVideo: !!document.querySelector('video') }); })()`,
    },
    {
      name: 'probe-audio-video-panel',
      delay: 3500,
      before: (win) => {
        void (async () => {
          const wc = win.webContents;
          await sleep(300);
          wc.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 });
          await sleep(300);
          wc.sendInputEvent({ type: 'mouseMove', x: 720, y: 520 });
          await sleep(500);
          await wc.executeJavaScript(`${SOUND_BUTTON}`);
        })();
      },
      script: `(async () => { await new Promise((r) => setTimeout(r, 1800)); const d = ${dlg}; if (!d) return JSON.stringify({ open: false }); const r = d.getBoundingClientRect(); return JSON.stringify({ open: true, y: r.y, height: r.height, bottom: r.bottom, window: [innerWidth, innerHeight], fits: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }); })()`,
    },
    { name: '9104-eq-panel-video', script: '0', delay: 500 },
    ...audit('probe-axe-video-player'),
    {
      // Delete the saved preset, and leave the settings as they were found.
      name: 'probe-audio-cleanup',
      delay: 300,
      script: `(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${dlg}?.querySelector('button[aria-label^="Delete"]')?.click(); await sleep(700); const s = await ${settingsNow}; await window.lumina.invoke('settings:update', { player: { eqEnabled: false, eqProfile: 'flat', eqBase: 'flat', eqBands: [0,0,0,0,0,0,0,0,0,0], bestSound: true, normalizeLoudness: true } }); return JSON.stringify({ afterDelete: s }); })()`,
    },
  ];
}
