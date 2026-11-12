// Development-only: a leak and stability soak of the renderer. Run: LUMINA_CAPTURE=<dir> LUMINA_PROBE_LEAK=1 LUMINA_CAPTURE_ONLY='probe-leak' electron . --user-data-dir=<scratch>
//
// Every main screen and every settings page is visited many times, with a pause to let things settle. The DOM size and the JavaScript heap are read before and after
// (heap is noisy without a forced collection, so it is judged over several rounds, not one reading). A screen that leaves listeners, timers or nodes behind shows
// as growth that does not level off. Also checked: no error was thrown to the console on the way.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';

type Step = { name: string; script: string; delay?: number; before?: (win: BrowserWindow) => void };

const script = (laps: number) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  addEventListener('error', (e) => errors.push(String(e.message).slice(0, 120)));
  addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason).slice(0, 120)));
  const nodes = () => document.getElementsByTagName('*').length;
  const heapMb = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null);
  const click = (root, label) => { const b = [...document.querySelectorAll(root + ' button')].find((x) => x.textContent.trim().startsWith(label)); if (b) b.click(); return Boolean(b); };
  const views = ['Download', 'Queue', 'Library', 'Settings', 'About'];
  const pages = ['General', 'Appearance', 'Player', 'Downloads', 'Formats', 'Subtitles', 'Torrents', 'Storage', 'Privacy', 'Network', 'Accounts', 'Browser extension', 'Share to TV', 'Sync', 'Connected tools'];
  const reached = new Set();
  const here = () => (document.querySelector('nav[aria-label=Main] [aria-current=page]') || {}).textContent || '?';
  const lap = async () => {
    for (const v of views) { click('nav[aria-label=Main]', v); await sleep(120); reached.add(here().trim()); }
    click('nav[aria-label=Main]', 'Settings'); await sleep(200);
    for (const p of pages) { click('nav, aside, main', p); await sleep(90); reached.add('page:' + (document.querySelector('main h1, main h2, [data-settings-title]') || {}).textContent); }
    click('nav[aria-label=Main]', 'Download'); await sleep(150);
  };
  const start = { nodes: nodes() };
  for (let i = 0; i < ${laps}; i++) await lap();
  await sleep(3000);
  const end = { nodes: nodes() };
  return JSON.stringify({ laps: ${laps}, start, end, nodeGrowth: end.nodes - start.nodes, screensReached: [...reached].sort(), errors: errors.slice(0, 5) });
})()`;

/** The renderer processes' working set in MB, as the operating system counts it (unlike performance.memory, which the browser rounds and coarsens). */
const rendererMb = () => app.getAppMetrics().filter((m) => m.type === 'Tab').reduce((n, m) => n + m.memory.workingSetSize, 0) / 1024;

export function leakSteps(scratch: string): Step[] {
  const readings: { after: string; mb: number }[] = [];
  const note = (after: string) => () => {
    readings.push({ after, mb: Math.round(rendererMb()) });
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(path.join(scratch, 'leak-memory.json'), JSON.stringify(readings));
  };
  // A first batch to get past what any first visit costs (lazy screens, caches), then equal batches: a leak keeps growing by the same amount in each.
  return [
    { name: 'probe-leak-a-warmup', script: script(3), delay: 300, before: note('start') },
    { name: 'probe-leak-b', script: script(30), delay: 300, before: note('warm-up (3 laps)') },
    { name: 'probe-leak-c', script: script(30), delay: 300, before: note('batch 1 (30 laps)') },
    { name: 'probe-leak-d', script: script(30), delay: 300, before: note('batch 2 (30 laps)') },
    { name: 'probe-leak-e', script: script(30), delay: 300, before: note('batch 3 (30 laps)') },
    { name: 'probe-leak-z', script: '0', delay: 3000, before: note('batch 4 (30 laps)') },
  ];
}
