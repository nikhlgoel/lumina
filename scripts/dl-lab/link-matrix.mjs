// Runs a list of links through the REAL app, one at a time, and prints what each did: did it read the link, did it download,
// at what speed, did it finish, and what it said if it failed. For checking that the downloader copes with many kinds of link.
//
//   node scripts/dl-lab/link-matrix.mjs <workdir> <list-file> [maxSecsPerLink=90]
//
// list-file: one link per line as   name|url|maxSecs(optional)   (blank lines and # comments are ignored).
// Use only links to material that may be downloaded freely (AGENTS.md rule 2): Blender's open movies, Apple/Mux/Akamai test streams,
// Creative Commons items. Needs `npx vite build` first. A link that is still running at its limit is reported as "still going"
// with the bytes it had, not as a failure, so a big file can be tested without downloading all of it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [work, listFile, defaultSecs = '90'] = process.argv.slice(2);
if (!work || !listFile) {
  console.error('usage: node scripts/dl-lab/link-matrix.mjs <workdir> <list-file> [maxSecsPerLink]');
  process.exit(2);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electron = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron');
const lines = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const fmt = (n) => (n == null ? '-' : n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(2)} GB` : n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

console.log('name'.padEnd(18), 'result'.padEnd(14), 'time'.padEnd(6), 'bytes'.padEnd(10), 'peak speed'.padEnd(12), 'note');
for (const [i, line] of lines.entries()) {
  const [name, url, secs] = line.split('|').map((s) => s.trim());
  const maxSecs = Number(secs) || Number(defaultSecs);
  const dir = path.join(work, `${String(i + 1).padStart(2, '0')}-${name}`);
  fs.mkdirSync(path.join(dir, 'dl'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'cap'), { recursive: true });
  const started = Date.now();
  const env = {
    ...process.env, LUMINA_PROBE_URL: url, LUMINA_PROBE_DIR: path.join(dir, 'dl'), LUMINA_CAPTURE: path.join(dir, 'cap'),
    LUMINA_CAPTURE_ONLY: 'probe-', LUMINA_PROBE_SECS: String(maxSecs),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  spawnSync(electron, ['.', `--user-data-dir=${path.join(dir, 'prof')}`], { cwd: root, timeout: (maxSecs + 90) * 1000, stdio: 'ignore', env });
  let result = 'no result';
  let note = '';
  let bytes = null;
  let peak = 0;
  try {
    const samples = JSON.parse(fs.readFileSync(path.join(dir, 'cap', 'probe-download-url.json'), 'utf8'));
    const last = samples.at(-1);
    peak = Math.max(0, ...samples.map((s) => s.speedBps ?? 0));
    bytes = last?.totalBytes ?? null;
    const files = fs.readdirSync(path.join(dir, 'dl')).filter((f) => !f.endsWith('.aria2') && !f.endsWith('.part'));
    const onDisk = files.reduce((n, f) => n + fs.statSync(path.join(dir, 'dl', f)).size, 0);
    if (last?.status === 'completed') { result = 'COMPLETED'; bytes = onDisk || bytes; note = files.join(', ').slice(0, 100); }
    else if (last?.status === 'failed') { result = 'FAILED'; note = (last.stage ?? '').toString().slice(0, 140); }
    else { result = 'still going'; bytes = onDisk || bytes; note = `${Math.round(last?.percent ?? 0)}% at the time limit`; }
  } catch {
    // No probe file: the link could not even be read. The log says why.
    try {
      const log = fs.readFileSync(path.join(dir, 'prof', 'logs', 'lumina.log'), 'utf8').split('\n').filter((l) => /media:inspect failed|Inspect failed/.test(l)).at(-1) ?? '';
      result = 'NOT READ';
      note = log.replace(/^\S+ \S+\s+/, '').slice(0, 150);
    } catch { /* nothing */ }
  }
  console.log(name.padEnd(18), result.padEnd(14), `${Math.round((Date.now() - started) / 1000)}s`.padEnd(6), fmt(bytes).padEnd(10), `${fmt(peak)}/s`.padEnd(12), note);
}
