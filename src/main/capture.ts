// Development-only: screenshot each screen for visual review.
// Run: LUMINA_CAPTURE=<dir> electron . (never active in packaged builds).
import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Click a main-nav destination by its visible label. Positional indexes were used here and silently
 * went stale when Browser was added, so several steps screenshotted the wrong screen. A nav item can
 * also carry a count badge ("Queue" + "1"), hence the startsWith fallback.
 */
export const goto = (label: string) =>
  `(() => { const want = ${JSON.stringify(label)};`
  + ` const nav = [...document.querySelectorAll('nav[aria-label=Main] button'), ...document.querySelectorAll('button')];`
  + ` (nav.find((b) => b.textContent.trim() === want) ?? nav.find((b) => b.textContent.trim().startsWith(want)))?.click(); })()`;

export const openSettings = (label: string) =>
  `${goto('Settings')}; setTimeout(() => [...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click(), 400)`;

const STEPS: { name: string; script: string; delay?: number }[] = [
  { name: '01-download-light', script: "document.documentElement.dataset.theme='light'" },
  { name: '02-download-dark', script: "document.documentElement.dataset.theme='dark'" },
  { name: '03-inspect', script: `(() => { const i = document.querySelector('input[aria-label^="Link to download"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'https://www.youtube.com/watch?v=jNQXAC9IVRw'); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); })()`, delay: 9000 },
  { name: '04-queue', script: goto('Queue') },
  { name: '05-library', script: goto('Library'), delay: 2500 },
  { name: '06-settings', script: goto('Settings') },
  { name: '06b-settings-subtitles', script: openSettings('Subtitles'), delay: 1600 },
  { name: '06c-settings-downloads', script: openSettings('Downloads'), delay: 1400 },
  // The integrated terminal, driven the way a person would: open it, type a command, press Enter.
  { name: '07a-ide-terminal', script: `document.documentElement.dataset.theme='dark'; ${goto('Code')}; setTimeout(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '\u0060', ctrlKey: true, bubbles: true })); }, 1500); setTimeout(() => { const ta = document.querySelector('.xterm-helper-textarea'); if (ta) { ta.focus(); } }, 3000)`, delay: 5000 },
  // Prove the pty round-trip, not just the panel: send a real command and screenshot its output.
  // Prove the pty round-trip, not just the panel: send a real command and screenshot its output.
  // Driven through the status-bar button and the IPC bridge, so no synthetic key events are needed.
  { name: '07b-ide-terminal-run', script: `document.documentElement.dataset.theme='dark'; ${goto('Code')}; setTimeout(() => { if (!document.querySelector('.xterm')) [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Terminal')?.click(); }, 1500); setTimeout(async () => { const list = await window.lumina.invoke('ide:term-list'); const id = list[0] && list[0].id; if (id) await window.lumina.invoke('ide:term-write', { id, data: 'echo HELLO_FROM_LUMINA_TERMINAL' + String.fromCharCode(13) }); }, 4000)`, delay: 8000 },
  // The IDE shell from HANDOVER §14.1: both sidebars, the bottom panel, and two terminals split side by side.
  { name: '08a-ide-layout', script: `document.documentElement.dataset.theme='dark'; ${goto('Code')}; (() => { const click = (label) => document.querySelector('[aria-label="' + label + '"]')?.click(); setTimeout(() => click('Restore panel size'), 900); setTimeout(() => { [...document.querySelectorAll('[aria-label="Primary sidebar"] button')].find((b) => b.textContent.trim() === 'README.md')?.click(); }, 1200); setTimeout(() => click('Show secondary sidebar (Ctrl+Alt+B)'), 1800); setTimeout(() => click('Show panel (Ctrl+J)'), 2200); setTimeout(() => click('Split terminal (side by side)'), 4500); })()`, delay: 8000 },
  // Maximize the panel, then show search in the right-hand sidebar instead of Open Editors.
  { name: '08b-ide-panel-max', script: `document.documentElement.dataset.theme='dark'; ${goto('Code')}; (() => { const click = (label) => document.querySelector('[aria-label="' + label + '"]')?.click(); setTimeout(() => click('Maximize panel'), 1200); })()`, delay: 3000 },
  // Flip the app to light with terminals already open: xterm and Monaco must both follow (they read
  // their colours at creation, so this is exactly the case that used to leave black boxes behind).
  { name: '08c-ide-theme-follow', script: `(() => { document.querySelector('[aria-label="Restore panel size"]')?.click(); setTimeout(() => { document.documentElement.dataset.theme = 'light'; }, 800); })()`, delay: 2500 },
  // "Freedom": split the editor, open a different file on the right, then drag both the editor sash and
  // the terminal sash, logging the measured widths so the resize is checked by numbers, not by eye.
  { name: '09a-ide-freedom', script: `document.documentElement.dataset.theme='dark'; ${goto('Code')}; (() => {
    const q = (sel) => document.querySelector(sel);
    const click = (label) => q('[aria-label="' + label + '"]')?.click();
    const tree = (name) => [...document.querySelectorAll('[aria-label="Primary sidebar"] button')].find((b) => b.textContent.trim() === name)?.click();
    const drag = (label, dx) => {
      const el = q('[aria-label="' + label + '"]');
      if (!el) { console.log('[freedom] no sash: ' + label); return; }
      const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      const ev = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 7, clientX: cx, clientY: y }));
      ev('pointerdown', x); ev('pointermove', x + dx / 2); ev('pointermove', x + dx); ev('pointerup', x + dx);
    };
    const widths = (sel) => [...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().width));
    setTimeout(() => click('Restore panel size'), 700);
    setTimeout(() => tree('README.md'), 1200);
    setTimeout(() => click('Split editor right'), 1700);
    setTimeout(() => tree('package.json'), 2300);
    setTimeout(() => { if (!q('.xterm')) click('Show panel (Ctrl+J)'); }, 2700);
    setTimeout(() => { if (document.querySelectorAll('.xterm').length < 2) click('Split terminal (side by side)'); }, 4200);
    setTimeout(() => {
      const ed = () => widths('[aria-label^="Resize editors"]').length ? [...document.querySelectorAll('.monaco-editor')].map((e) => Math.round(e.getBoundingClientRect().width)) : [];
      const tm = () => [...document.querySelectorAll('.xterm')].map((e) => Math.round(e.getBoundingClientRect().width)).filter((w) => w > 0);
      console.log('[freedom] before editors=' + JSON.stringify(ed()) + ' terminals=' + JSON.stringify(tm()));
      drag('Resize editors 1 and 2', -180);
      drag('Resize terminals 1 and 2', 160);
      setTimeout(() => console.log('[freedom] after  editors=' + JSON.stringify(ed()) + ' terminals=' + JSON.stringify(tm())), 400);
    }, 6500);
  })()`, delay: 8200 },
  // Source control against a real repository (run with a profile whose folder is a git repo).
  { name: '10a-ide-scm', script: `document.documentElement.dataset.theme='dark'; ${goto('Code')}`, delay: 3000 },
  { name: '10b-ide-diff', script: `(() => { const row = [...document.querySelectorAll('[aria-label="Primary sidebar"] li button')].find((b) => b.textContent.trim().startsWith('README.md')); row?.click(); })()`, delay: 3000 },
  // Stage everything, write a message and press Commit — the real buttons, then read the result back.
  { name: '10c-ide-commit', script: `(() => {
    document.querySelector('[aria-label="Close diff"]')?.click();
    setTimeout(() => document.querySelector('[aria-label="Stage all"]')?.click(), 500);
    setTimeout(() => {
      const t = document.querySelector('textarea[aria-label="Commit message"]');
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(t, 'Commit made from the Lumina IDE'); t.dispatchEvent(new Event('input', { bubbles: true }));
    }, 1800);
    // Wait until the button is enabled (it is disabled while git runs) rather than guessing a delay.
    // No regex here: this whole script is a template literal, where \d silently becomes a plain d.
    const tryCommit = (left) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Commit ') && x.textContent.trim().endsWith('file' + (x.textContent.includes(' 1 file') ? '' : 's')));
      if (b && !b.disabled) { console.log('[scm] clicking ' + b.textContent.trim()); b.click(); return; }
      if (left > 0) setTimeout(() => tryCommit(left - 1), 250); else console.log('[scm] commit button never enabled');
    };
    setTimeout(() => tryCommit(40), 2000);
  })()`, delay: 9000 },
  { name: '06d-settings-mcp', script: openSettings('Connected tools'), delay: 2500 },
  // Open the add sheet too — the command preview is the part that has to be right.
  { name: '06f-settings-mcp-import', script: `${openSettings('Connected tools')}; setTimeout(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Import JSON')?.click(); }, 1200); setTimeout(() => { const t = document.querySelector('textarea[aria-label="MCP JSON"]'); if (!t) return; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, JSON.stringify({ mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] }, notes: { command: 'uvx', args: ['mcp-server-notes'] } } }, null, 2)); t.dispatchEvent(new Event('input', { bubbles: true })); }, 2000)`, delay: 3200 },
  { name: '06e-settings-mcp-add', script: `${openSettings('Connected tools')}; setTimeout(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add server')?.click(); }, 1200); setTimeout(() => { const i = document.querySelector('input[aria-label="Command line"]'); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'node server.js --root "C:/My Files" $NOTEXPANDED'); i.dispatchEvent(new Event('input', { bubbles: true })); }, 2000)`, delay: 3200 },
  { name: '06d-settings-accounts', script: openSettings('Accounts'), delay: 1400 },
  { name: '06e-settings-extension', script: openSettings('Browser extension'), delay: 1400 },
  { name: '06f-settings-appearance', script: openSettings('Appearance'), delay: 1400 },
  { name: '06g-settings-storage', script: openSettings('Storage & library'), delay: 1800 },
  { name: '06h-settings-search', script: "(() => { const i = document.querySelector('input[aria-label=\"Search settings\"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'speed'); i.dispatchEvent(new Event('input', { bubbles: true })); })()", delay: 900 },
  { name: '07-library-light', script: `document.documentElement.dataset.theme='light'; ${goto('Library')}`, delay: 2000 },
  { name: '08-minibar', script: "document.querySelector('[data-play]').click()", delay: 2500 },
  { name: '09-player-aurora', script: "document.querySelector('[aria-label^=\"Open player\"]').click()", delay: 3000 },
  { name: '10-player-lyrics', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))", delay: 2500 },
  { name: '11-player-vinyl', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 'l' })); dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))", delay: 2500 },
  { name: '12-player-pocket', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))", delay: 2500 },
  { name: '13-player-queue', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 't' })); dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))", delay: 1500 },
  { name: '14-video', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); setTimeout(() => { [...document.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Videos')?.click(); setTimeout(() => document.querySelector('article button')?.click(), 1500); }, 800)", delay: 5000 },
  { name: '15-batch', script: "document.documentElement.dataset.theme='dark'; dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); [...document.querySelectorAll('nav[aria-label=Main] button')][0].click(); setTimeout(() => { const nl = String.fromCharCode(10); const h = 'https://files.example.net/'; const parts = Array.from({ length: 24 }, (_, i) => h + 'k' + i + '/Sample_Release_--_example-site.net_--_.part' + String(i + 1).padStart(2, '0') + '.rar').filter((_, i) => i !== 17); const extra = ['german', 'japanese', 'spanish'].map((l) => h + l + '/fg-optional-' + l + '-vo.bin').concat([h + 'v1/fg-optional-hd-videos.part1.rar', h + 'v2/fg-optional-hd-videos.part2.rar', h + 'm/Sample_Release.md5']); const dt = new DataTransfer(); dt.setData('text/plain', parts.concat(extra).join(nl)); document.querySelector('input[aria-label^=\"Link to download\"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, 600)", delay: 2000 },
  { name: '16-batch-expanded', script: "document.querySelector('button[aria-label=\"Show parts\"]').click(); document.querySelector('button[aria-label^=\"Include German\"]').click()", delay: 900 },
  { name: '17-batch-light', script: "document.documentElement.dataset.theme='light'", delay: 700 },
  { name: '30-about', script: `document.documentElement.dataset.theme='dark'; ${goto('About')}`, delay: 1400 },
  { name: '31-sidebar-collapsed', script: "document.querySelector('button[aria-label=\"Collapse sidebar\"]').click()", delay: 1000 },
  { name: '32-sidebar-expanded', script: "document.querySelector('button[aria-label=\"Expand sidebar\"]').click()", delay: 900 },
  { name: '33-about-bottom', script: `document.documentElement.dataset.theme='dark'; ${goto('About')}; setTimeout(() => { const s = document.querySelector('main .overflow-auto'); if (s) s.scrollTop = s.scrollHeight; }, 500)`, delay: 1400 },
  { name: '40-shortcuts', script: "document.documentElement.dataset.theme='dark'; dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))", delay: 900 },
  { name: '50-browser', script: `document.documentElement.dataset.theme='dark'; ${goto('Browser')}`, delay: 2500 },
  { name: '41-supported-sites', script: `document.documentElement.dataset.theme='dark'; ${goto('About')}; setTimeout(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('every site')); if (b) b.click(); }, 600)`, delay: 4000 },
  { name: '42-supported-sites-search', script: "(() => { const i = document.querySelector('input[aria-label=\"Search supported sites\"]'); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'tube'); i.dispatchEvent(new Event('input', { bubbles: true })); })()", delay: 900 },
  { name: '20-splash-a', script: 'location.reload()', delay: 380 },
  { name: '21-splash-b', script: 'location.reload()', delay: 720 },
  { name: '22-splash-c', script: 'location.reload()', delay: 1050 },
  { name: '23-app-after-splash', script: "document.documentElement.dataset.theme='dark'", delay: 2500 },
];

export async function runCapture(win: BrowserWindow, dir: string, extra: { name: string; script: string; delay?: number }[] = []) {
  fs.mkdirSync(dir, { recursive: true });
  await wait(3500);
  const only = process.env.LUMINA_CAPTURE_ONLY ? new RegExp(process.env.LUMINA_CAPTURE_ONLY) : null;
  for (const step of [...STEPS, ...extra].filter((s) => !only || only.test(s.name))) {
    try {
      await win.webContents.executeJavaScript(step.script, true);
    } catch (err) {
      process.stdout.write(`[capture] ${step.name} script failed: ${err}\n`);
    }
    await wait(step.delay ?? 1200);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${step.name}.png`), image.toPNG());
    process.stdout.write(`[capture] ${step.name}\n`);
  }
  if (!only || only.test('tray-roundtrip')) await trayRoundTrip(win);
}

/**
 * The tray menu is native, so it can't be screenshotted. This drives the same path a click takes —
 * the exact command the menu item carries, sent to the renderer — and then reads back what the player
 * reported to the tray, proving each control changes the player AND that the tray's ticks follow.
 */
async function trayRoundTrip(win: BrowserWindow) {
  const { trayPlayback, trayPlaybackItems } = await import('./tray');
  type Item = ReturnType<typeof trayPlaybackItems>[number];
  const find = (list: Item[], label: string): Item | undefined => {
    for (const i of list) {
      if (i.label === label || i.label?.startsWith(label)) return i;
      const sub = i.submenu ? find(i.submenu, label) : undefined;
      if (sub) return sub;
    }
    return undefined;
  };
  const item = (label: string) => find(trayPlaybackItems(), label);
  const click = async (label: string) => {
    const run = item(label)?.run;
    if (!run || !('command' in run)) { process.stdout.write(`[tray] no item "${label}"\n`); return; }
    win.webContents.send('player:command', run);
    await wait(900); // past the 250ms report debounce and the round trip
  };
  const show = (what: string) => {
    const s = trayPlayback();
    process.stdout.write(`[tray] ${what.padEnd(22)} player: vol=${s.volume} muted=${s.muted} shuffle=${s.shuffle} repeat=${s.repeat} playing=${s.playing} | menu: Mute ticked=${item('Mute')?.checked} title="${item('Volume')?.label}"\n`);
  };
  // The media element is created in code and never attached to the page, so read the position (in
  // seconds) from the full player's seek slider, which exposes it exactly as aria-valuenow.
  const mediaTime = () => win.webContents.executeJavaScript(
    "Number(document.querySelector('[role=slider][aria-label=Seek]')?.getAttribute('aria-valuenow') ?? NaN)",
  );


  show('initial');
  await click('Mute'); show('after Mute');
  await click('Mute'); show('after Mute again');
  await click('25%'); show('after volume 25%');
  await click('Louder'); show('after Louder');
  await click('Shuffle'); show('after Shuffle');
  await click('Repeat one'); show('after Repeat one');
  await click('Repeat all'); show('after Repeat all');
  await win.webContents.executeJavaScript("document.querySelector('[aria-label^=\"Open player\"]')?.click()");
  await wait(1500);
  const before = await mediaTime();
  await click('Forward 10');
  process.stdout.write(`[tray] Forward 10 seconds     media time ${before} -> ${await mediaTime()}\n`);
}
