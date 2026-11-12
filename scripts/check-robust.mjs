#!/usr/bin/env node
// Checks the results of the two robustness runs in the real app, written by the capture harness (src/main/captureFuzz.ts, captureLeak.ts):
//   node scripts/check-robust.mjs fuzz <fuzz scratch dir> <fuzz capture dir>
//   node scripts/check-robust.mjs leak <leak scratch dir> <leak capture dir>
import fs from 'node:fs';
import path from 'node:path';

const [kind, scratch, cap] = process.argv.slice(2);
const read = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const checks = [];
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

if (kind === 'fuzz') {
  const r = read(path.join(cap, 'probe-ipc-fuzz.json'));
  const log = read(path.join(scratch, 'ipc-fuzz-log.json'));
  add('the fuzz ran', r && r.total > 500, r ? `${r.channels} channels, ${r.total} calls` : 'no result');
  add('every hostile call settled (refused or answered, none hung)', r && r.settled === r.total && r.hung.length === 0, r ? `${r.settled}/${r.total}, hung: ${r.hung.join(',') || 'none'}` : '');
  add('the main process still answered afterwards', r?.alive === true);
  add('nothing was added to Object.prototype', r?.prototypeClean === true);
  add('paths outside anything opened were refused', r && r.leaks.length === 0, r ? r.leaks.join('; ') || 'none accepted' : '');
  add('the log shows no new unhandled error', log && log.badAfter === log.badBefore, log ? `${log.badBefore} -> ${log.badAfter}` : 'no log result');
} else if (kind === 'leak') {
  const mem = read(path.join(scratch, 'leak-memory.json')) ?? [];
  const batches = ['probe-leak-a-warmup', 'probe-leak-b', 'probe-leak-c', 'probe-leak-d', 'probe-leak-e'].map((n) => read(path.join(cap, `${n}.json`)));
  add('every batch ran', batches.every(Boolean) && mem.length >= 6, `${batches.filter(Boolean).length} batches, ${mem.length} readings`);
  add('the page never grew (the DOM was the same size after each batch)', batches.every((b) => b && b.nodeGrowth === 0), batches.map((b) => b?.nodeGrowth).join(','));
  add('no error reached the console', batches.every((b) => b && b.errors.length === 0), batches.flatMap((b) => b?.errors ?? []).join('; ') || 'none');
  const afterWarm = mem.find((m) => m.after.startsWith('batch 1'))?.mb;
  const last = mem.at(-1)?.mb;
  // The first visit to each screen costs memory once (lazy modules, caches); what matters is that 120 more laps cost almost nothing.
  add('memory is level after the first visit (growth over 120 more laps is small)', afterWarm !== undefined && last !== undefined && last - afterWarm <= 20, `${afterWarm} MB -> ${last} MB`);
}

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${String(c.detail).slice(0, 120)})` : ''}`);
}
console.log(`${checks.length - failed} of ${checks.length} checks passed`);
process.exit(failed || !checks.length ? 1 : 0);
