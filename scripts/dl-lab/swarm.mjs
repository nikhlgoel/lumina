// A local BitTorrent swarm for testing the download engine: one tracker and N throttled aria2 seeders on 127.0.0.1.
//
//   node scripts/dl-lab/swarm.mjs <workdir> [sizeMB=120]
//
// env:  SEEDERS=3         how many seeders (default 1). Each is limited to SEED_KBPS, so N seeders give a leecher up to
//                         N x that if it really opens several peer connections at once: the test for "parallel connections".
//       SEED_KBPS=1024    upload limit per seeder
//       READY_AFTER_S=10  seeders hash the data first; the tracker only starts answering after this, because a leecher that
//                         arrives while the seeders are still hashing is told "no seeds" and, with a 30 min announce interval,
//                         does not ask again (this cost hours the first time)
//       DOWN_AT / UP_AT   seconds after the first announce at which ALL seeders go away / come back (for stall tests)
//       TOTAL_S=420       stop everything after this many seconds
//       ARIA2C            path to aria2c (default: the one bundled in resources/bin)
//
// Writes <workdir>/swarm.torrent (open it in Lumina) and <workdir>/swarm.log. Prints "tracker up" when ready.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [work, sizeMb = '120'] = process.argv.slice(2);
if (!work) {
  console.error('usage: node scripts/dl-lab/swarm.mjs <workdir> [sizeMB]');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const exe = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
const ARIA = process.env.ARIA2C ?? path.join(here, '..', '..', 'resources', 'bin', `${process.platform}-${process.arch}`, exe);
const SEEDERS = Math.max(1, Number(process.env.SEEDERS ?? 1));
const KBPS = process.env.SEED_KBPS ?? '1024';
const READY_AFTER_S = Number(process.env.READY_AFTER_S ?? 10);
const TOTAL_S = Number(process.env.TOTAL_S ?? 420);
const DOWN_AT = process.env.DOWN_AT ? Number(process.env.DOWN_AT) : null;
const UP_AT = process.env.UP_AT ? Number(process.env.UP_AT) : null;
const PIECE = 256 * 1024;
const TRACKER = Number(process.env.TRACKER_PORT ?? 18600);
const SEED_BASE = Number(process.env.SEED_PORT_BASE ?? 18601);

fs.mkdirSync(work, { recursive: true });
const dataDir = path.join(work, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// --- data and torrent (deterministic, so a re-run reuses it) -------------------------------------------------------
const dataFile = path.join(dataDir, 'swarm.bin');
const size = Number(sizeMb) * 2 ** 20;
if (!fs.existsSync(dataFile) || fs.statSync(dataFile).size !== size) {
  const fd = fs.openSync(dataFile, 'w');
  for (let off = 0; off < size; off += PIECE) {
    // Written at its own offset: `fs.writeSync(fd, string, 0, 'latin1')` takes the 0 as the file POSITION, so every block
    // landed at the start and the file stayed one block long, which gave the seeders one valid piece (their log said
    // "Checksum error detected") and a leecher that could never get past it.
    const block = Buffer.from(crypto.createHash('sha256').update(String(off)).digest().subarray(0, 16).toString('hex').repeat(PIECE / 32).slice(0, PIECE), 'latin1');
    fs.writeSync(fd, block, 0, block.length, off);
  }
  fs.closeSync(fd);
}
const enc = (v) => {
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (typeof v === 'string') return enc(Buffer.from(v));
  if (typeof v === 'number') return Buffer.from(`i${v}e`);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(enc), Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'), ...Object.keys(v).sort().flatMap((k) => [enc(k), enc(v[k])]), Buffer.from('e')]);
};
const pieces = [];
{
  const fd = fs.openSync(dataFile, 'r');
  const b = Buffer.alloc(PIECE);
  for (let off = 0; off < size; off += PIECE) {
    const n = fs.readSync(fd, b, 0, PIECE, off);
    pieces.push(crypto.createHash('sha1').update(b.subarray(0, n)).digest());
  }
  fs.closeSync(fd);
}
const torrentPath = path.join(work, 'swarm.torrent');
fs.writeFileSync(torrentPath, enc({
  announce: `http://127.0.0.1:${TRACKER}/announce`,
  info: { length: size, name: 'swarm.bin', 'piece length': PIECE, pieces: Buffer.concat(pieces) },
}));

// --- log -----------------------------------------------------------------------------------------------------------
const logFile = path.join(work, 'swarm.log');
fs.writeFileSync(logFile, '');
let t0 = 0;
const log = (m) => fs.appendFileSync(logFile, `${t0 ? Date.now() - t0 : -1} ${m}\n`);

// --- seeders: separate folders (hard links to the one data file), so they do not share control files ----------------
const seeders = [];
let seedersUp = false;
const startSeeders = () => {
  for (let i = 0; i < SEEDERS; i++) {
    const dir = path.join(work, `seed${i + 1}`);
    fs.mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, 'swarm.bin');
    if (!fs.existsSync(copy)) fs.copyFileSync(dataFile, copy);
    const child = spawn(ARIA, ['-d', dir, '--enable-dht=false', '--enable-dht6=false', '--bt-enable-lpd=false', '--enable-peer-exchange=false',
      `--listen-port=${SEED_BASE + i}`, '--seed-ratio=0.0', '--continue=true', '--check-integrity=true', '--bt-hash-check-seed=true',
      '--allow-overwrite=true', `--max-overall-upload-limit=${KBPS}K`, '--console-log-level=warn',
      `--log=${path.join(work, `seeder${i + 1}.aria2.log`)}`, '--log-level=info', torrentPath], { windowsHide: true });
    child.stderr.on('data', (d) => log(`seeder${i + 1}: ${d.toString().trim().slice(0, 160)}`));
    seeders.push(child);
  }
  seedersUp = true;
  log(`SEEDERS UP (${SEEDERS} x ${KBPS} KB/s)`);
};
const stopSeeders = () => {
  seedersUp = false;
  for (const s of seeders.splice(0)) s.kill();
  log('SEEDERS DOWN');
};
startSeeders();

// --- tracker (starts answering only once the seeders have had time to hash) ---------------------------------------
let announces = 0;
const peers = () => Buffer.concat(Array.from({ length: SEEDERS }, (_, i) => Buffer.from([127, 0, 0, 1, (SEED_BASE + i) >> 8, (SEED_BASE + i) & 255])));
setTimeout(() => {
  http.createServer((req, res) => {
    if (!req.url.startsWith('/announce')) { res.writeHead(404); return res.end(); }
    if (!t0) {
      t0 = Date.now();
      if (DOWN_AT !== null) setTimeout(stopSeeders, DOWN_AT * 1000);
      if (UP_AT !== null) setTimeout(() => { if (!seedersUp) startSeeders(); }, UP_AT * 1000);
      setTimeout(() => { log('END'); stopSeeders(); process.exit(0); }, TOTAL_S * 1000);
    }
    announces++;
    log(`announce #${announces} ${/event=(\w+)/.exec(req.url)?.[1] ?? 'periodic'} -> ${seedersUp ? `${SEEDERS} peer(s)` : 'no peers'}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(enc({ interval: 1800, 'min interval': 1800, complete: seedersUp ? SEEDERS : 0, incomplete: 1, peers: seedersUp ? peers() : Buffer.alloc(0) }));
  }).listen(TRACKER, '127.0.0.1', () => console.log(`tracker up; ${SEEDERS} seeder(s); torrent ${torrentPath}`));
}, READY_AFTER_S * 1000);

process.on('SIGINT', () => { stopSeeders(); process.exit(0); });
