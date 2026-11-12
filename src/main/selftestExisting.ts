// Development-only: downloading files that are already in the folder. In the real app, against a local server, in a scratch folder.
// Skip must not download a file that is already there, replace must replace it, and anything in between must never lose a file.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Job } from '../shared/types';
import { planBatchFolder } from './batchFolder';
import { inspect } from './inspect';
import { queue } from './jobs/queue';

const out = (m: string) => {
  const line = `[selftest] ${m}\n`;
  process.stdout.write(line);
  if (process.env.LUMINA_SELFTEST_LOG) { try { fs.appendFileSync(process.env.LUMINA_SELFTEST_LOG, line); } catch { /* best effort */ } }
};

const SIZE = 2 * 1024 * 1024;
/** The bytes the server sends for a file: a RAR header, then the file's own letter. */
const served = (name: string): Buffer => {
  const b = Buffer.alloc(SIZE, name.charCodeAt(name.length - 5)); // the digit before ".rar"
  Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]).copy(b, 0);
  return b;
};

export async function runExistingSelftest(dir: string): Promise<void> {
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(path.basename(new URL(req.url ?? '/', 'http://x').pathname));
    const body = served(name);
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    // A one-byte probe is not a download; only count requests that ask for the whole file or a real slice.
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), SIZE - 1) : SIZE - 1;
    if (!(m && start === 0 && end === 0)) hits.set(name, (hits.get(name) ?? 0) + 1);
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'application/x-rar-compressed', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {}) });
    res.end(body.subarray(start, end + 1));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const names = ['Exist_Test.part1.rar', 'Exist_Test.part2.rar', 'Exist_Test.part3.rar'];

  let ok = 0;
  let total = 0;
  const check = (name: string, pass: boolean, detail = '') => {
    total++;
    if (pass) ok++;
    out(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const waitDone = async (jobs: Job[]) => {
    const until = Date.now() + 60_000;
    while (Date.now() < until && !jobs.every((j) => ['completed', 'failed', 'cancelled'].includes(queue.get(j.id)!.status))) await new Promise((r) => setTimeout(r, 250));
  };
  const run = async (target: string, mode: 'skip' | 'replace' | undefined, planned: string[] = names) => {
    const jobs: Job[] = [];
    for (const n of names) {
      const url = `${base}/x/${n}`;
      const info = await inspect(url);
      jobs.push(queue.addFromInfo(url, info, {
        contentType: 'video', format: { kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false },
        englishSubtitles: false, subtitleOutput: [], embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [], targetDir: target,
        ...(mode ? { existingFiles: mode, existingNames: planned } : {}),
      }, target));
    }
    await waitDone(jobs);
    return jobs.map((j) => queue.get(j.id)!);
  };
  const files = (d: string) => fs.readdirSync(d).filter((f) => !f.endsWith('.aria2')).sort();

  // --- the folder a batch goes into
  const base1 = path.join(dir, 'Other');
  fs.mkdirSync(path.join(base1, 'Release'), { recursive: true });
  fs.writeFileSync(path.join(base1, 'Release', 'unrelated.txt'), 'x');
  const first = planBatchFolder(base1, 'Release', names);
  check('another batch with the same title gets its own folder', path.basename(first.dir) === 'Release (2)' && !first.sameBatch, first.dir);

  // --- skip: A is complete and the right size, B has the right name but another size, C is not there
  const T = path.join(dir, 'Other', 'Existing test');
  fs.mkdirSync(T, { recursive: true });
  fs.writeFileSync(path.join(T, names[0]!), served(names[0]!)); // the same file
  fs.writeFileSync(path.join(T, names[1]!), Buffer.from('an older, smaller version')); // same name, not the same file
  const plan = planBatchFolder(base1, 'Existing test', names);
  check('a repeat finds its own folder and the files already complete in it', plan.sameBatch && plan.dir === T && plan.existing.length === 2, `${plan.existing.map((e) => e.filename).join(',')}`);

  const skipped = await run(T, 'skip');
  check('skip: all three jobs finish', skipped.every((j) => j.status === 'completed'), skipped.map((j) => j.status).join(','));
  check('skip: the file that was already there was not downloaded', (hits.get(names[0]!) ?? 0) === 0, `requests ${hits.get(names[0]!) ?? 0}`);
  check('skip: it says so', skipped[0]!.compat?.summary === 'Already on this computer' && skipped[0]!.outputPaths[0] === path.join(T, names[0]!), skipped[0]!.compat?.summary ?? '');
  check('skip: the file that is not there was downloaded', (hits.get(names[2]!) ?? 0) > 0 && fs.statSync(path.join(T, names[2]!)).size === SIZE);
  check('skip: the same-name file of another size was kept, and the new one saved beside it', fs.readFileSync(path.join(T, names[1]!), 'utf8') === 'an older, smaller version' && fs.existsSync(path.join(T, 'Exist_Test.part2 (1).rar')), files(T).join(' | '));

  // --- replace: everything is downloaded again over what is there ("delete" stands in for a working Recycle Bin, so the real one is not filled)
  process.env.LUMINA_TRASH_TEST = 'delete';
  hits.clear();
  const replaced = await run(T, 'replace');
  check('replace: all three jobs finish', replaced.every((j) => j.status === 'completed'), replaced.map((j) => j.status).join(','));
  check('replace: every file was downloaded again', names.every((n) => (hits.get(n) ?? 0) > 0), names.map((n) => hits.get(n) ?? 0).join(','));
  check('replace: the names are the same, with no "(1)" copies of them', fs.readFileSync(path.join(T, names[1]!)).length === SIZE && !fs.existsSync(path.join(T, 'Exist_Test.part1 (1).rar')) && !fs.existsSync(path.join(T, 'Exist_Test.part3 (1).rar')), files(T).join(' | '));

  // --- replace, but the Recycle Bin cannot take the old file: it must never be deleted for good; the new one is saved beside it
  process.env.LUMINA_TRASH_TEST = 'fail';
  const T2 = path.join(dir, 'Other', 'Bin fails');
  fs.mkdirSync(T2, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(T2, n), served(n));
  hits.clear();
  const failed = await run(T2, 'replace');
  check('replace with a Recycle Bin that cannot take the file: the jobs finish', failed.every((j) => j.status === 'completed'), failed.map((j) => j.status).join(','));
  check('and every old file is still there, with the new one saved beside it', names.every((n) => fs.existsSync(path.join(T2, n)) && fs.existsSync(path.join(T2, n.replace('.rar', ' (1).rar')))), files(T2).join(' | '));

  // --- replace applies only to files that were there when the batch was planned
  process.env.LUMINA_TRASH_TEST = 'delete';
  const T3 = path.join(dir, 'Other', 'Planned only');
  fs.mkdirSync(T3, { recursive: true });
  fs.writeFileSync(path.join(T3, names[0]!), served(names[0]!));
  fs.writeFileSync(path.join(T3, names[1]!), 'MARKER'); // there, but not named when the batch was planned
  hits.clear();
  const only = await run(T3, 'replace', [names[0]!]);
  check('planned-only: the jobs finish', only.every((j) => j.status === 'completed'), only.map((j) => j.status).join(','));
  check('planned-only: a file that was not planned is never touched (the new one goes beside it)', fs.readFileSync(path.join(T3, names[1]!), 'utf8') === 'MARKER' && fs.existsSync(path.join(T3, 'Exist_Test.part2 (1).rar')), files(T3).join(' | '));
  check('planned-only: the planned file was replaced under its own name', (hits.get(names[0]!) ?? 0) > 0 && !fs.existsSync(path.join(T3, 'Exist_Test.part1 (1).rar')) && fs.statSync(path.join(T3, names[0]!)).size === SIZE);

  // --- nothing chosen: the old way, both are kept
  hits.clear();
  const both = await run(T, undefined);
  check('no choice: everything is downloaded and each earlier copy is kept beside the new one', both.every((j) => j.status === 'completed') && fs.existsSync(path.join(T, 'Exist_Test.part1 (1).rar')), files(T).join(' | '));

  server.close();
  out(`${ok}/${total} checks passed`);
}
