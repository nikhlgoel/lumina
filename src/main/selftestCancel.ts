// Development-only: what happens when downloads that are running are cancelled. Against a slow local server, in the real app (aria2 and all).
// The owner saw "download failed" style messages when cancelling a batch; a cancel must end as "Cancelled" and never pass through "failed".
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Job } from '../shared/types';
import { inspect } from './inspect';
import { queue } from './jobs/queue';

const out = (m: string) => {
  const line = `[selftest] ${m}\n`;
  try { process.stdout.write(line); } catch { /* a closed output must not end the test */ }
  if (process.env.LUMINA_SELFTEST_LOG) { try { fs.appendFileSync(process.env.LUMINA_SELFTEST_LOG, line); } catch { /* best effort */ } }
};

/** Big enough that no cancel can come after the end, whatever the speed. */
const SIZE = 3 * 1024 * 1024 * 1024;
const CHUNK = 65_536;

export async function runCancelSelftest(dir: string): Promise<void> {
  // The bytes are made up as they are sent (nothing is held in memory); only the first eight say "RAR", so the file passes the type check.
  const block = Buffer.alloc(CHUNK, 7);
  const first = Buffer.from(block);
  Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]).copy(first, 0);
  // Served slowly, so a download is still running when it is cancelled.
  const server = http.createServer((req, res) => {
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), SIZE - 1) : SIZE - 1;
    const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'application/x-rar-compressed', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
    if (m) headers['Content-Range'] = `bytes ${start}-${end}/${SIZE}`;
    res.writeHead(m ? 206 : 200, headers);
    let at = start;
    const timer = setInterval(() => {
      if (at > end) { clearInterval(timer); res.end(); return; }
      const len = Math.min(CHUNK, end + 1 - at);
      res.write(at === 0 ? first.subarray(0, len) : block.subarray(0, len));
      at += len;
    }, 50);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const target = path.join(dir, 'Other', 'Cancel test');

  const seen = new Map<string, string[]>(); // job id -> every status it passed through
  const failedEvents: string[] = [];
  queue.on('updated', (j: Job) => {
    const list = seen.get(j.id) ?? [];
    if (list[list.length - 1] !== j.status) list.push(j.status);
    seen.set(j.id, list);
  });
  queue.on('failed', (j: Job) => failedEvents.push(`${j.title}: ${j.error?.message ?? ''}`));

  let ok = 0;
  let total = 0;
  const check = (name: string, pass: boolean, detail = '') => {
    total++;
    if (pass) ok++;
    out(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const waitFor = async (what: () => boolean, ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (what()) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return what();
  };

  const add = async (n: number) => {
    const jobs: Job[] = [];
    for (let i = 0; i < n; i++) {
      const url = `${base}/s${i}/Cancel_Test.part${String(i + 1).padStart(2, '0')}.rar`;
      const info = await inspect(url);
      jobs.push(queue.addFromInfo(url, info, {
        contentType: 'video', format: { kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false },
        englishSubtitles: false, subtitleOutput: [], embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [], targetDir: target,
        release: { id: 'cancel-test', title: 'Cancel test', dir: target, unpack: false, deleteArchives: false, role: 'archive', set: 'set:cancel_test.rar', part: i + 1, parts: n },
      }, target));
    }
    return jobs;
  };
  const status = (j: Job) => queue.get(j.id)!.status;

  // Round 1: cancel one running download; the others must carry on untouched.
  const jobs = await add(5);
  const running = await waitFor(() => jobs.some((j) => status(j) === 'running'), 30_000);
  check('a download is running before the cancel', running);
  await new Promise((r) => setTimeout(r, 2500)); // let it move some bytes
  const one = jobs.find((j) => status(j) === 'running')!;
  queue.cancel(one.id);
  const oneDone = await waitFor(() => status(one) === 'cancelled', 30_000);
  check('cancelling one running download ends as Cancelled', oneDone, status(one));
  check('the others were not touched', jobs.filter((j) => j.id !== one.id).every((j) => ['running', 'queued'].includes(status(j))), jobs.map(status).join(','));

  // Round 2: cancel everything left, the way "cancel all files" does.
  for (const j of jobs) queue.cancel(j.id);
  const allDone = await waitFor(() => jobs.every((j) => status(j) === 'cancelled'), 40_000);
  check('cancelling all of them ends with every one Cancelled', allDone, jobs.map(status).join(','));
  await new Promise((r) => setTimeout(r, 6000)); // a late "failed" from a run that was still winding down would show now
  check('none of them ever passed through "failed"', [...seen.values()].every((list) => !list.includes('failed')), [...seen.values()].map((l) => l.join('>')).join(' | '));
  check('no failure was announced', failedEvents.length === 0, failedEvents.join('; '));
  check('they stay Cancelled', jobs.every((j) => status(j) === 'cancelled' && queue.get(j.id)!.progress.stage === 'Cancelled'), jobs.map((j) => queue.get(j.id)!.progress.stage).join(','));

  server.close();
  out(`${ok}/${total} checks passed`);
}
