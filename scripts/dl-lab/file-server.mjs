// Range-capable local file server for stall and display tests. usage: node scripts/dl-lab/file-server.mjs <port> <sizeGB>   env: RATE (MB/s per connection), NOLEN=1 (never says how big the file is: no Content-Length, no ranges)
import http from 'node:http';

const [port = '18555', sizeGb = '6'] = process.argv.slice(2);
const SIZE = Math.round(Number(sizeGb) * 2 ** 30);
const chunk = Buffer.alloc(1 << 20, 0x61);
http.createServer((req, res) => {
  let start = 0, end = SIZE - 1;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (m) { start = Number(m[1]); if (m[2]) end = Number(m[2]); }
  if (process.env.NOLEN) { start = 0; end = SIZE - 1; res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); }
  else res.writeHead(m ? 206 : 200, { 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {}), 'Content-Type': 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  let pos = start;
  const pump = () => {
    while (pos <= end) {
      const n = Math.min(chunk.length, end - pos + 1);
      pos += n;
      const ok = res.write(n === chunk.length ? chunk : chunk.subarray(0, n));
      if (process.env.RATE) return setTimeout(pump, 1000 / Number(process.env.RATE)); // MB/s per connection
      if (!ok) return res.once('drain', pump);
    }
    res.end();
  };
  pump();
  req.on('close', () => { pos = end + 1; });
}).listen(Number(port), '127.0.0.1', () => console.log('serving', port, SIZE));
