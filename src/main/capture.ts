// Development-only: screenshot each screen for visual review.
// Run: LUMINA_CAPTURE=<dir> electron . (never active in packaged builds).
import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const openSettings = (label: string) =>
  `[...document.querySelectorAll('nav[aria-label=Main] button')][3].click(); setTimeout(() => [...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click(), 400)`;

const STEPS: { name: string; script: string; delay?: number }[] = [
  { name: '01-download-light', script: "document.documentElement.dataset.theme='light'" },
  { name: '02-download-dark', script: "document.documentElement.dataset.theme='dark'" },
  { name: '03-inspect', script: `(() => { const i = document.querySelector('input[aria-label="Link to download"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'https://www.youtube.com/watch?v=jNQXAC9IVRw'); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); })()`, delay: 9000 },
  { name: '04-queue', script: "[...document.querySelectorAll('nav[aria-label=Main] button')][1].click()" },
  { name: '05-library', script: "[...document.querySelectorAll('nav[aria-label=Main] button')][2].click()", delay: 2500 },
  { name: '06-settings', script: "[...document.querySelectorAll('nav[aria-label=Main] button')][3].click()" },
  { name: '06b-settings-subtitles', script: openSettings('Subtitles'), delay: 1600 },
  { name: '06c-settings-downloads', script: openSettings('Downloads'), delay: 1400 },
  { name: '06d-settings-accounts', script: openSettings('Accounts'), delay: 1400 },
  { name: '06e-settings-extension', script: openSettings('Browser extension'), delay: 1400 },
  { name: '06f-settings-appearance', script: openSettings('Appearance'), delay: 1400 },
  { name: '06g-settings-storage', script: openSettings('Storage & library'), delay: 1800 },
  { name: '06h-settings-search', script: "(() => { const i = document.querySelector('input[aria-label=\"Search settings\"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'speed'); i.dispatchEvent(new Event('input', { bubbles: true })); })()", delay: 900 },
  { name: '07-library-light', script: "document.documentElement.dataset.theme='light'; [...document.querySelectorAll('nav[aria-label=Main] button')][2].click()", delay: 2000 },
  { name: '08-minibar', script: "document.querySelector('[data-play]').click()", delay: 2500 },
  { name: '09-player-aurora', script: "document.querySelector('[aria-label^=\"Open player\"]').click()", delay: 3000 },
  { name: '10-player-lyrics', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))", delay: 2500 },
  { name: '11-player-vinyl', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 'l' })); dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))", delay: 2500 },
  { name: '12-player-pocket', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))", delay: 2500 },
  { name: '13-player-queue', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 't' })); dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))", delay: 1500 },
  { name: '14-video', script: "dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); setTimeout(() => { [...document.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Videos')?.click(); setTimeout(() => document.querySelector('article button')?.click(), 1500); }, 800)", delay: 5000 },
  { name: '15-batch', script: "document.documentElement.dataset.theme='dark'; dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); [...document.querySelectorAll('nav[aria-label=Main] button')][0].click(); setTimeout(() => { const nl = String.fromCharCode(10); const h = 'https://files.example.net/'; const parts = Array.from({ length: 24 }, (_, i) => h + 'k' + i + '/Sample_Release_--_example-site.net_--_.part' + String(i + 1).padStart(2, '0') + '.rar').filter((_, i) => i !== 17); const extra = ['german', 'japanese', 'spanish'].map((l) => h + l + '/fg-optional-' + l + '-vo.bin').concat([h + 'v1/fg-optional-hd-videos.part1.rar', h + 'v2/fg-optional-hd-videos.part2.rar', h + 'm/Sample_Release.md5']); const dt = new DataTransfer(); dt.setData('text/plain', parts.concat(extra).join(nl)); document.querySelector('input[aria-label=\"Link to download\"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, 600)", delay: 2000 },
  { name: '16-batch-expanded', script: "document.querySelector('button[aria-label=\"Show parts\"]').click(); document.querySelector('button[aria-label^=\"Include German\"]').click()", delay: 900 },
  { name: '17-batch-light', script: "document.documentElement.dataset.theme='light'", delay: 700 },
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
}
