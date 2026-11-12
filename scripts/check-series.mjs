#!/usr/bin/env node
// Checks the result of the real-app series test (LUMINA_PROBE_EPISODES + LUMINA_PROBE_EPISODES_PORT, see src/main/captureEpisodes.ts):
// the series was delivered over the real bridge (accepted with a token, refused without one) and all three episodes were downloaded under their names.
//   node scripts/check-series.mjs <scratch dir> <capture dir>
import fs from 'node:fs';
import path from 'node:path';

const [scratch, cap] = process.argv.slice(2);
const read = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const delivery = read(path.join(scratch, 'bridge-delivery.json'));
const run = read(path.join(cap, 'probe-episodes-run.json'));
const checks = [];
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

add('the series was accepted by the real bridge', delivery?.status === 202 && delivery.answer?.count === 3, JSON.stringify(delivery?.answer));
add('the bridge refuses the same request without the pairing token', delivery?.withoutToken === 401, String(delivery?.withoutToken));
const jobs = run?.jobs ?? [];
add('all three episodes finished', jobs.length === 3 && jobs.every((j) => j.status === 'completed'), jobs.map((j) => j.status).join(','));
const want = ['The Replica Show - S01E01.mp4', 'The Replica Show - S01E02 - The Second One.mp4', 'The Replica Show - S01E03.mp4'];
const dir = path.join(scratch, 'Series', 'The Replica Show', 'Season 01');
const have = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
add('the files are named and placed as a series', JSON.stringify(have) === JSON.stringify(want), have.join(' | '));
add('nothing else was left in the series folder', fs.existsSync(path.join(scratch, 'Series')) && fs.readdirSync(path.join(scratch, 'Series')).join() === 'The Replica Show');

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail.slice(0, 120)})` : ''}`);
}
console.log(`${checks.length - failed} of ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
