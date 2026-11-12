// Development-only: the series screen, in the real app, with the real download path behind it.
// Run: LUMINA_CAPTURE=<dir> LUMINA_PROBE_EPISODES=<scratch dir> LUMINA_CAPTURE_ONLY='8100|probe-episodes|8101' electron . --user-data-dir=<scratch>
//
// A local server holds three "episodes": two streams (HLS made with the bundled ffmpeg) and one plain video file. Like many video hosts, it
// answers 403 unless the request carries the page it is played on as Referer, so an episode only downloads if the headers the extension saw
// really travel with it. The series is sent to the app as the bridge would, the Download button is pressed like a person would, and what
// lands on disk is read back.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import { settings } from './settings';
import { tools } from './tools';
import { axeNow } from './captureAxe';

const PORT = 8791;
let started: Promise<void> | null = null;

function makeMedia(dir: string): void {
  const ffmpeg = tools.require('ffmpeg');
  const run = (args: string[]) => spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { cwd: dir, encoding: 'utf8' });
  for (const n of [1, 3]) {
    fs.mkdirSync(path.join(dir, `e${n}`), { recursive: true });
    run(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', `e${n}/seg%d.ts`, `e${n}/master.m3u8`]);
  }
  run(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=550', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'e2.mp4']);
}

function serve(dir: string): Promise<void> {
  const server = http.createServer((req, res) => {
    // The video host's rule: only a request that says it comes from the series page is answered.
    if (!/127\.0\.0\.1/.test(String(req.headers.referer ?? ''))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const file = path.join(dir, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    const type = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : file.endsWith('.ts') ? 'video/mp2t' : 'video/mp4';
    const size = fs.statSync(file).size;
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(m ? 206 : 200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    fs.createReadStream(file, { start, end }).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
}

function prepare(dir: string): Promise<void> {
  started ??= (async () => {
    // The app finds its tools a few seconds after it starts; the video is made with one of them.
    for (let i = 0; i < 80 && !tools.has('ffmpeg'); i++) await new Promise((r) => setTimeout(r, 500));
    const media = path.join(dir, 'site');
    fs.mkdirSync(media, { recursive: true });
    makeMedia(media);
    await serve(media);
  })();
  return started;
}

const clickAndWait = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const button = [...document.querySelectorAll('button')].find((b) => /^Download [0-9]+ episodes?$/.test(b.textContent.trim()));
  if (!button) return JSON.stringify({ clicked: false, buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 30) });
  const label = button.textContent.trim();
  button.click();
  const until = Date.now() + 120000;
  let jobs = [];
  while (Date.now() < until) {
    await sleep(1500);
    jobs = await window.lumina.invoke('jobs:list');
    if (jobs.length >= 3 && jobs.every((j) => ['completed', 'failed', 'cancelled'].includes(j.status))) break;
  }
  return JSON.stringify({ clicked: true, label, jobs: jobs.map((j) => ({ title: j.title, status: j.status, files: j.outputPaths, error: j.error && j.error.message })) });
})()`;

/** Pair with the app's own bridge as the extension does, and send the series to it. Writes what the bridge answered next to the other results. */
async function deliverOverBridge(port: number, batch: unknown, scratch: string): Promise<void> {
  const headers = { 'Content-Type': 'application/json', 'X-Lumina-Client': 'extension' };
  const out: Record<string, unknown> = { port };
  try {
    await new Promise((r) => setTimeout(r, 1500)); // the bridge starts a moment after the window
    const hello = await fetch(`http://127.0.0.1:${port}/v1/hello`, { headers });
    out.hello = await hello.json();
    const pair = await fetch(`http://127.0.0.1:${port}/v1/pair`, { method: 'POST', headers, body: JSON.stringify({ browser: 'Probe' }) });
    const { token } = (await pair.json()) as { token?: string };
    out.paired = Boolean(token);
    const res = await fetch(`http://127.0.0.1:${port}/v1/capture-episodes`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(batch) });
    out.status = res.status;
    out.answer = await res.json();
    // And the same without the pairing token, which must be refused.
    const noAuth = await fetch(`http://127.0.0.1:${port}/v1/capture-episodes`, { method: 'POST', headers, body: JSON.stringify(batch) });
    out.withoutToken = noAuth.status;
  } catch (err) {
    out.error = String(err);
  }
  fs.writeFileSync(path.join(scratch, 'bridge-delivery.json'), JSON.stringify(out, null, 1));
}

export function episodeSteps(scratch: string): { name: string; script: string; delay?: number; before?: (win: BrowserWindow) => void }[] {
  const base = `http://127.0.0.1:${PORT}`;
  const headers = { Referer: `${base}/watch/the-show?e=1` };
  const item = (number: number, title: string, url: string, kind: 'stream' | 'media') => ({ number, season: 1, title, url, kind, pageUrl: `${base}/watch/the-show?e=${number}`, headers });
  return [
    {
      name: '8100-episodes-picker', script: '0', delay: 9000,
      before: (win) => {
        void prepare(scratch);
        settings.update({ storage: { seriesDir: path.join(scratch, 'Series') } });
        const batch = {
          show: 'The Replica Show',
          items: [item(1, '', `${base}/e1/master.m3u8`, 'stream'), item(2, 'The Second One', `${base}/e2.mp4`, 'media'), item(3, 'Episode 3', `${base}/e3/master.m3u8`, 'stream')],
          request: { pageUrl: `${base}/watch/the-show?e=1`, pageTitle: 'The Replica Show', headers: { Referer: `${base}/watch/the-show?e=1` }, cookies: [], fromLink: true },
        };
        const port = Number(process.env.LUMINA_PROBE_EPISODES_PORT);
        // With a bridge port given, the series arrives the way it does from the extension: over the real HTTP bridge, paired and authorised, through its
        // validation and clean-up, and from there to the window. Without one the window is handed the event directly.
        if (port > 0) void deliverOverBridge(port, batch, scratch);
        else setTimeout(() => win.webContents.send('app:open-episodes', batch), 800);
      },
    },
    ...(axeNow(process.env.LUMINA_AXE) ? [{ name: 'probe-axe-series-picker', script: axeNow(process.env.LUMINA_AXE)!, delay: 500 }] : []),
    { name: 'probe-episodes-run', script: clickAndWait, delay: 500 },
    { name: '8101-episodes-after', script: '0', delay: 1500 },
  ];
}
