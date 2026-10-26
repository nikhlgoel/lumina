// How long does ONE small write take when it lands far past the end of a fresh file on this disk?
// usage: node scripts/dl-lab/disk-gap.mjs <dir> <gapGB> [sparse]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [dir, gapGb = '20', sparse] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `gap-${sparse ? 'sparse' : 'plain'}.bin`);
let fd = fs.openSync(file, 'w+');
if (sparse) { fs.closeSync(fd); execFileSync('fsutil', ['sparse', 'setflag', file]); fd = fs.openSync(file, 'r+'); }
const buf = Buffer.alloc(1 << 20, 1);
const t = Date.now();
fs.writeSync(fd, buf, 0, buf.length, 0);
const first = Date.now() - t;
const t2 = Date.now();
fs.writeSync(fd, buf, 0, buf.length, Math.round(Number(gapGb) * 2 ** 30));
const jump = Date.now() - t2;
fs.closeSync(fd);
fs.rmSync(file, { force: true });
console.log(JSON.stringify({ mode: sparse ? 'sparse' : 'plain', gapGb, firstWriteMs: first, jumpWriteMs: jump }));
