// Does aria2 (with Lumina's daemon flags) stall its RPC while writing a big file on this disk?
// usage: node scripts/dl-lab/rpc-stall.mjs <allocation: none|prealloc|falloc|trunc> <sizeGB> <seconds> <outDir> [split]
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [alloc = 'none', sizeGb = '4', secs = '90', outDir, splitArg = '16'] = process.argv.slice(2);
const SIZE = Math.round(Number(sizeGb) * 2 ** 30);
const ARIA = 'D:/main/projects/temp/lumina-media/resources/bin/win32-x64/aria2c.exe';
fs.mkdirSync(outDir, { recursive: true });

const chunk = Buffer.alloc(1 << 20, 0x61);
const srv = http.createServer((req, res) => {
  let start = 0, end = SIZE - 1;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (m) { start = Number(m[1]); if (m[2]) end = Number(m[2]); }
  res.writeHead(m ? 206 : 200, { 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {}), 'Content-Type': 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  let pos = start;
  const pump = () => {
    while (pos <= end) {
      const n = Math.min(chunk.length, end - pos + 1);
      pos += n;
      if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return res.once('drain', pump);
    }
    res.end();
  };
  pump();
  req.on('close', () => { pos = end + 1; });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/big.bin`;

const rpcPort = 6800 + Math.floor(Math.random() * 1000);
const args = ['--enable-rpc', `--rpc-listen-port=${rpcPort}`, '--rpc-secret=x', '--continue=true', '--allow-overwrite=true',
  `--file-allocation=${alloc}`, '--summary-interval=0', '--console-log-level=warn', '--disk-cache=251M',
  `--max-connection-per-server=${splitArg}`, `--split=${splitArg}`, '--min-split-size=1M', '--dir=' + outDir];
const child = spawn(ARIA, args);
child.stderr.on('data', (d) => process.stderr.write('[aria2] ' + d));
const call = async (method, ...params) => {
  const t = Date.now();
  const res = await fetch(`http://127.0.0.1:${rpcPort}/jsonrpc`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params: ['token:x', ...params] }), signal: AbortSignal.timeout(10000) });
  const b = await res.json();
  return { r: b.result, ms: Date.now() - t };
};
for (let i = 0; i < 40; i++) { try { await call('aria2.getVersion'); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
const t0 = Date.now();
const { r: gid } = await call('aria2.addUri', [url], process.env.PAUSE ? { pause: 'true' } : {});
if (process.env.SPARSE) {
  // Mark the file sparse as soon as aria2 has created it; report how late we were.
  const f = path.join(outDir, 'big.bin');
  const tw = Date.now();
  if (process.env.PAUSE) await call('aria2.unpause', gid);
  while (!fs.existsSync(f) && Date.now() - tw < 5000) await new Promise((r) => setTimeout(r, 2));
  const created = Date.now() - tw;
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('fsutil', ['sparse', 'setflag', f]); console.log('sparse set', created, 'ms after add; size then', fs.statSync(f).size); } catch (e) { console.log('sparse failed', String(e.message).slice(0, 120)); }
}
const rows = []; let worstMs = 0, timeouts = 0, zero = 0, maxZero = 0;
while (Date.now() - t0 < Number(secs) * 1000) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const { r, ms } = await call('aria2.tellStatus', gid, ['status', 'completedLength', 'downloadSpeed', 'connections']);
    worstMs = Math.max(worstMs, ms);
    const sp = Number(r.downloadSpeed);
    zero = sp === 0 ? zero + 1 : 0; maxZero = Math.max(maxZero, zero);
    rows.push(`${Date.now() - t0},${ms},${sp},${r.completedLength},${r.connections},${r.status}`);
    if (r.status === 'complete' || r.status === 'error') break;
  } catch { timeouts++; rows.push(`${Date.now() - t0},TIMEOUT,,,,`); }
}
fs.writeFileSync(path.join(outDir, `..`, `stall-${alloc}-${splitArg}.csv`), 't_ms,rpc_ms,speed,completed,conns,status\n' + rows.join('\n'));
const last = rows.at(-1);
console.log(JSON.stringify({ alloc, split: splitArg, sizeGb, samples: rows.length, worstRpcMs: worstMs, rpcTimeouts: timeouts, longestZeroSpeedSamples: maxZero, last }));
child.kill(); srv.close();
setTimeout(() => process.exit(0), 500);
