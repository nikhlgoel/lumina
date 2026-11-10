// A stand-in for a file host's download pages, for testing how Lumina gets through a release of many parts (AGENTS.md rule 2: generated
// data only, nothing real). Each page /f/<n> looks like the pages in the owner's log: a human check, then (once it is solved) a countdown,
// then a Download button that starts the file.
//
//   node scripts/dl-lab/host-standin.mjs <port> [waitSeconds=4]
//
// The page has no real check: a test plays the person by calling window.__solve() in it, exactly as the person's solving fills in the
// widget's response token (see core/hosts.ts PAGE_DRIVER, which looks for that token).
import http from 'node:http';

const [port = '18590', waitArg = '4'] = process.argv.slice(2);
const WAIT = Number(waitArg);
const page = (n) => `<!doctype html><meta charset="utf-8"><title>Part ${n}</title>
<body style="font-family:sans-serif">
<h2>Release.part${String(n).padStart(2, '0')}.rar</h2>
<div class="cf-turnstile" data-sitekey="stand-in" style="width:300px;height:65px;border:1px solid #888;background:#f4f4f4">Verify you are human</div>
<input type="hidden" name="cf-turnstile-response" value="">
<p id="timer" hidden>Please wait <span id="count">${WAIT}</span> seconds</p>
<button id="downloadBtn" disabled style="padding:12px 24px;font-size:18px">Download</button>
<script>
  const token = document.querySelector('[name=cf-turnstile-response]');
  const btn = document.getElementById('downloadBtn');
  window.__solve = () => {
    token.value = 'stand-in-response-token-0123456789-abcdefghij'; // the driver treats a token over 20 characters as a solved check
    document.querySelector('.cf-turnstile').textContent = 'Success!';
    document.getElementById('timer').hidden = false;
    let left = ${WAIT};
    const t = setInterval(() => {
      left -= 1;
      document.getElementById('count').textContent = String(left);
      if (left <= 0) { clearInterval(t); document.getElementById('timer').hidden = true; btn.disabled = false; }
    }, 1000);
  };
  btn.onclick = () => { location.href = '/dl/${n}'; };
</script>`;

http.createServer((req, res) => {
  const f = /^\/f\/(\d+)/.exec(req.url ?? '');
  const d = /^\/dl\/(\d+)/.exec(req.url ?? '');
  if (f) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page(Number(f[1]))); }
  if (d) {
    const body = Buffer.alloc(1 << 20, 0x61);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, 'Content-Disposition': `attachment; filename="Release.part${String(Number(d[1])).padStart(2, '0')}.rar"` });
    return res.end(body);
  }
  res.writeHead(404); res.end();
}).listen(Number(port), '127.0.0.1', () => console.log(`stand-in host on ${port}, countdown ${WAIT}s`));
