// Range server with an outage and optional content change, for resume tests.
// usage: node scripts/dl-lab/range-server.mjs <port> <sizeMB>   env: RATE (MB/s per connection), OUTAGE="downS,upS" (after first request), CHANGE=1 (new content+ETag after the outage)
import http from 'node:http';
import fs from 'node:fs';

const [port = '18570', sizeMb = '250'] = process.argv.slice(2);
const SIZE = Number(sizeMb) * 2 ** 20;
const [downS, upS] = (process.env.OUTAGE ?? '').split(',').map(Number);
let version = 1, t0 = 0;
const sockets = new Set();
const log = (m) => { fs.appendFileSync(process.env.LOG ?? 'range-server.log', `${t0 ? ((Date.now() - t0) / 1000).toFixed(1) : '-'}s v${version} ${m}\n`); };
const chunks = { 1: Buffer.alloc(1 << 20, 0x61), 2: Buffer.alloc(1 << 20, 0x62) };
const etag = () => `"v${version}"`;

const server = http.createServer((req, res) => {
  if (!t0 && Number.isFinite(downS)) {
    t0 = Date.now();
    setTimeout(() => { log('OUTAGE START'); server.close(); for (const s of sockets) s.destroy(); }, downS * 1000);
    setTimeout(() => { if (process.env.CHANGE) version = 2; log('OUTAGE END'); server.listen(Number(port), '127.0.0.1'); }, upS * 1000);
  }
  const range = req.headers.range;
  const ifRange = req.headers['if-range'];
  let start = 0, end = SIZE - 1, partial = false;
  const m = /bytes=(\d+)-(\d*)/.exec(range ?? '');
  // A conforming server answers a conditional range with the whole file when the validator no longer matches.
  if (m && (!ifRange || ifRange === etag())) { start = Number(m[1]); if (m[2]) end = Number(m[2]); partial = true; }
  log(`${req.method} range=${range ?? '-'} if-range=${ifRange ?? '-'} -> ${partial ? 206 : 200}`);
  res.writeHead(partial ? 206 : 200, { 'Accept-Ranges': 'bytes', ETag: etag(), 'Last-Modified': new Date(Date.UTC(2026, 0, version)).toUTCString(), 'Content-Length': end - start + 1, ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {}), 'Content-Type': 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  const chunk = chunks[version];
  let pos = start;
  const pump = () => {
    while (pos <= end) {
      const n = Math.min(chunk.length, end - pos + 1);
      pos += n;
      const ok = res.write(n === chunk.length ? chunk : chunk.subarray(0, n));
      if (process.env.RATE) return setTimeout(pump, 1000 / Number(process.env.RATE));
      if (!ok) return res.once('drain', pump);
    }
    res.end();
  };
  pump();
  req.on('close', () => { pos = end + 1; });
});
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
server.listen(Number(port), '127.0.0.1', () => console.log('serving', port, SIZE));
