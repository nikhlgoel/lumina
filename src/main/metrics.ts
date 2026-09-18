// Resource measurement (dev only). Run: LUMINA_METRICS=<file.jsonl> electron . --user-data-dir=<scratch>
//
// Walks the app through each screen, lets it settle, and records what every process costs: memory
// per Electron process (main, renderer, GPU, helpers) from app.getAppMetrics(), the renderer's JS
// heap and DOM size, and the helper programs Lumina starts itself (aria2c, shells). The point is to
// optimise against numbers rather than impressions.
//
// Honesty about the method: the window is created hidden so nothing appears on screen. Memory is
// therefore close to real use, but CPU is a LOWER BOUND — a hidden window does not paint, so any
// cost of drawing (animations, video frames) is missing from these figures.
import { app, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { goto, openSettings } from './capture';
import { logger } from './log';

const log = logger('metrics');

interface Step {
  name: string;
  script: string;
  /** How long to let the screen settle before measuring. */
  settleMs: number;
}

const STEPS: Step[] = [
  { name: 'startup-idle', script: '', settleMs: 10_000 },
  { name: 'library', script: goto('Library'), settleMs: 6_000 },
  { name: 'queue', script: goto('Queue'), settleMs: 4_000 },
  { name: 'settings', script: openSettings('Connected tools'), settleMs: 4_000 },
  { name: 'browser', script: goto('Browser'), settleMs: 6_000 },
  { name: 'code-editor', script: `${goto('Code')}; setTimeout(() => [...document.querySelectorAll('[aria-label="Primary sidebar"] button')].find((b) => b.textContent.trim() === 'README.md')?.click(), 1500)`, settleMs: 7_000 },
  { name: 'code-terminal', script: "(() => { if (!document.querySelector('.xterm')) document.querySelector('[aria-label=\"Show panel (Ctrl+J)\"]')?.click(); })()", settleMs: 6_000 },
  // Leave the heavy screens and come back to the start: does memory come back down?
  { name: 'back-to-download', script: goto('Download'), settleMs: 10_000 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Memory of processes Lumina starts itself, by image name (Windows tasklist; dev tool only). */
function helperMemoryMb(image: string): Promise<number[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
      if (err) return resolve([]);
      const rows = String(out).split(/\r?\n/).filter((l) => l.startsWith('"'));
      resolve(rows.map((l) => {
        const kb = l.split('","')[4]?.replace(/[^\d]/g, '') ?? '0';
        return Math.round(Number(kb) / 1024);
      }));
    });
  });
}

async function sample(win: BrowserWindow, step: string) {
  // percentCPUUsage is measured since the previous call, so prime it and measure a fixed window.
  app.getAppMetrics();
  await sleep(3_000);
  const metrics = app.getAppMetrics();

  const byType: Record<string, { count: number; workingSetMb: number; privateMb: number; cpuPct: number }> = {};
  for (const m of metrics) {
    const e = byType[m.type] ?? { count: 0, workingSetMb: 0, privateMb: 0, cpuPct: 0 };
    e.count += 1;
    e.workingSetMb += m.memory.workingSetSize / 1024;
    e.privateMb += (m.memory.privateBytes ?? 0) / 1024;
    e.cpuPct += m.cpu.percentCPUUsage;
    byType[m.type] = e;
  }
  for (const e of Object.values(byType)) {
    e.workingSetMb = Math.round(e.workingSetMb);
    e.privateMb = Math.round(e.privateMb);
    e.cpuPct = Math.round(e.cpuPct * 10) / 10;
  }

  const page = await win.webContents.executeJavaScript(`({
    jsHeapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    domNodes: document.getElementsByTagName('*').length,
  })`).catch(() => ({ jsHeapMb: null, domNodes: null }));

  const helpers = {
    aria2c: await helperMemoryMb('aria2c.exe'),
    shells: [...await helperMemoryMb('wsl.exe'), ...await helperMemoryMb('powershell.exe')],
  };

  const totalWorkingSetMb = Object.values(byType).reduce((a, e) => a + e.workingSetMb, 0);
  const totalCpuPct = Math.round(Object.values(byType).reduce((a, e) => a + e.cpuPct, 0) * 10) / 10;
  return { step, t: Date.now(), totalWorkingSetMb, totalCpuPct, byType, page, helpers };
}

export async function runMetrics(win: BrowserWindow, file: string) {
  writeFileSync(file, '');
  log.info(`Measuring ${STEPS.length} screens into ${file} (hidden window: memory is realistic, CPU is a lower bound)`);
  for (const step of STEPS) {
    if (step.script) await win.webContents.executeJavaScript(step.script).catch((err) => log.warn(`${step.name}: ${String(err)}`));
    await sleep(step.settleMs);
    const row = await sample(win, step.name);
    appendFileSync(file, `${JSON.stringify(row)}\n`);
    process.stdout.write(`[metrics] ${step.name.padEnd(17)} total=${row.totalWorkingSetMb}MB cpu=${row.totalCpuPct}% heap=${row.page.jsHeapMb}MB dom=${row.page.domNodes} ${Object.entries(row.byType).map(([k, v]) => `${k}:${v.workingSetMb}MB/${v.cpuPct}%`).join(' ')} aria2c=${JSON.stringify(row.helpers.aria2c)} shells=${JSON.stringify(row.helpers.shells)}\n`);
  }
  log.info('Metrics done');
}
