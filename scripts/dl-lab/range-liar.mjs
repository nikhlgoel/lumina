// A server that answers a request for one slice of a file with the WHOLE REST of it, like a file host in the owner's log did:
//   "Invalid range header. Request: 1479540736-1561329663/2097152000, Response: 1479540736-2097151999/2097152000"
// aria2 splits a download into slices and gives up on that answer; one connection (no slices) is fine.
//
//   node scripts/dl-lab/range-liar.mjs <port> <sizeMB> [<MB per second per connection>]
//   then download http://127.0.0.1:<port>/file.bin
// Without a pace the first connection finishes the whole file before aria2 compares the other slices with what it asked for, so
// the lie is never noticed on loopback. A real host is slower than that; give it a pace (e.g. 4) to see the same error.
// Generated data only (AGENTS.md rule 2).
import http from 'node:http';

const [port = '18580', sizeMb = '40', pace = '0'] = process.argv.slice(2);
const SIZE = Number(sizeMb) * 2 ** 20;
const MB_PER_S = Number(pace);
const block = Buffer.alloc(1 << 20, 0x61);

http.createServer((req, res) => {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  const start = m ? Number(m[1]) : 0;
  // The lie: whatever end was asked for, the answer runs to the end of the file. A slice that starts at 0 is answered as asked.
  // MEASURED (aria2c 1.37.0, 40 MB, with and without a pace): this makes aria2 log "Invalid range header" (errorCode=8) on the extra
  // connections, but the download still FINISHES, because the first connection carries on. It did not reproduce the fatal case in
  // the owner's log (2 GB, failing at 1.4 GB); that one is unproven here, see HANDOVER.
  const asked = m && m[2] !== '' ? Number(m[2]) : SIZE - 1;
  const end = m && start === 0 ? Math.min(asked, SIZE - 1) : SIZE - 1;
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start + 1) };
  if (m) Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${SIZE}` });
  res.writeHead(m ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  let sent = start;
  const pump = () => {
    while (sent <= end) {
      const n = Math.min(block.length, end + 1 - sent);
      sent += n;
      const more = res.write(n === block.length ? block : block.subarray(0, n));
      if (MB_PER_S > 0) return void setTimeout(pump, (n / (MB_PER_S * 2 ** 20)) * 1000);
      if (!more) return void res.once('drain', pump);
    }
    res.end();
  };
  pump();
}).listen(Number(port), '127.0.0.1', () => console.log(`range liar on ${port}, ${sizeMb} MB`));
