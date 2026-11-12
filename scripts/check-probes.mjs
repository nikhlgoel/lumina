#!/usr/bin/env node
// Reads the JSON files the capture harness writes for `probe-` steps ({ checks: [{ name, pass, detail }] }), prints each check, and exits 1 if any failed or a file is missing.
//   node scripts/check-probes.mjs <file.json> [more.json ...]
import fs from 'node:fs';

let total = 0;
let failed = 0;
for (const file of process.argv.slice(2)) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.log(`FAIL  ${file}: ${err.message}`);
    failed++;
    total++;
    continue;
  }
  for (const c of data.checks ?? []) {
    total++;
    if (!c.pass) failed++;
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${String(c.detail).slice(0, 140)})` : ''}`);
  }
  if (data.error) {
    total++;
    failed++;
    console.log(`FAIL  ${file}: ${data.error}`);
  }
}
console.log(`${total - failed} of ${total} checks passed`);
process.exit(failed ? 1 : 0);
