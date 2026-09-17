// Development-only end-to-end test of file-host downloads and release assembly against a local mock host
// that behaves like an XFileSharing-style site (cookie redirect, disabled button until "File Ready", ad
// overlay and redirect, trusted-click check, countdown, cookie-bound CDN link with range support).
// Run: LUMINA_SELFTEST=1 LUMINA_SELFTEST_HOSTS=1 electron . --user-data-dir=<scratch>
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Job } from '../shared/types';
import { planBatch, releaseTagFor } from '../core/batch';
import { inspect } from './inspect';
import { queue } from './jobs/queue';
import { challengeEvents, resolveHostedLink } from './hosters';
import { createWindow } from './window';
import { runTool } from './process';
import { tools } from './tools';

const out = (m: string) => process.stdout.write(`[selftest] ${m}\n`);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  out(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const BS = String.fromCharCode(92);

async function buildFixtures(dir: string) {
  const sevenZip = tools.require('7z');
  const src = path.join(dir, 'src');
  const pub = path.join(dir, 'pub');
  fs.rmSync(dir, { recursive: true, force: true });
  const game = path.join(src, 'main', 'Mock Release');
  fs.mkdirSync(path.join(game, 'MD5'), { recursive: true });
  fs.mkdirSync(pub, { recursive: true });
  fs.writeFileSync(path.join(game, 'setup.exe'), Buffer.concat([Buffer.from('MZ'), randomBytes(200_000)]));
  const bin1 = randomBytes(24 << 20);
  fs.writeFileSync(path.join(game, 'fg-01.bin'), bin1);
  fs.writeFileSync(path.join(game, 'fg-02.bin'), randomBytes(6 << 20));
  const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
  // Repack-style checksum list inside an MD5 folder, pointing one level up with backslashes.
  fs.writeFileSync(path.join(game, 'MD5', 'fitgirl-bins.md5'), `${md5(bin1)} *..${BS}fg-01.bin\r\n${md5(fs.readFileSync(path.join(game, 'fg-02.bin')))} *..${BS}fg-02.bin\r\n`);

  const hd = path.join(src, 'hd');
  fs.mkdirSync(hd, { recursive: true });
  fs.writeFileSync(path.join(hd, 'hd-intro.bik'), randomBytes(6 << 20));
  const broken = path.join(src, 'broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'data.bin'), randomBytes(5 << 20));

  const pack = async (archive: string, input: string, volume: string) => {
    const r = await runTool(sevenZip, ['a', '-mx0', `-v${volume}`, path.join(pub, archive), input], { timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`7z a failed: ${r.stderr}`);
  };
  await pack('Mock_Release_--_example-site.net_--_.7z', game, '10m');
  await pack('fg-optional-hd-videos.7z', path.join(hd, 'hd-intro.bik'), '4m');
  await pack('Broken_Pack.7z', path.join(broken, 'data.bin'), '2m');
  fs.writeFileSync(path.join(pub, 'fg-optional-german-vo.bin'), randomBytes(2 << 20));

  // Damage the middle of the broken set's second volume (headers intact, so only unpacking can notice).
  const vol = path.join(pub, 'Broken_Pack.7z.002');
  const buf = fs.readFileSync(vol);
  for (let i = 1000; i < 1064; i++) buf[i] = buf[i]! ^ 0xff;
  fs.writeFileSync(vol, buf);
  return { pub, files: fs.readdirSync(pub).sort() };
}

function mockHost(pub: string) {
  const tokens = new Map<string, string>(); // token -> file name
  const stats = { ranged: 0, cdnNoCookie: 0, trustedClicks: 0, untrustedClicks: 0, adRedirects: 0, served: new Set<string>() };
  let adOrigin = '';
  const cookie = (req: http.IncomingMessage, name: string) => req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  const html = (res: http.ServerResponse, body: string) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><head><meta charset="utf-8"><title>Mock host</title><style>body{font:16px sans-serif;padding:40px}button{padding:14px 30px;font-size:16px;margin:10px}</style></head><body>${body}</body></html>`);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (parts[0] === 'ad') return html(res, '<h1>Win a prize!</h1>');
    if (parts[0] === 'beacon') {
      if (url.searchParams.get('trusted') === 'true') stats.trustedClicks++;
      else stats.untrustedClicks++;
      return void res.writeHead(204).end();
    }
    if (parts[0] === 'gone') return html(res, '<h2>File Not Found</h2><p>The file was deleted by its owner.</p>');
    if (parts[0] === 'captcha') {
      return html(res, `<h2>${parts[2]}</h2><div class="g-recaptcha" style="width:304px;height:78px;border:1px solid #ccc">I'm not a robot</div><button id="method_free">Free Download</button>`);
    }
    if (parts[0] === 'q' && parts.length === 3) {
      return void res.writeHead(302, { 'Set-Cookie': `file_code=${parts[1]}; Path=/`, Location: '/qcheck' }).end();
    }
    if (url.pathname === '/qcheck') {
      const code = cookie(req, 'file_code');
      const name = fileByCode.get(code ?? '');
      if (!name) return void res.writeHead(403).end('no file');
      const rand = randomBytes(8).toString('hex');
      tokens.set(`pending:${rand}`, name);
      return html(res, `
        <h2>${name}</h2>
        <div class="g-recaptcha" id="captcha" style="width:304px;height:78px;border:1px solid #d3d3d3;border-radius:3px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#f9f9f9">
          <input type="checkbox" id="robot" style="width:28px;height:28px"><label for="robot">I'm not a robot</label>
        </div>
        <form method="POST" action="/download" id="f" style="display:none">
          <input type="hidden" name="op" value="download2"><input type="hidden" name="id" value="${code}"><input type="hidden" name="rand" value="${rand}">
          <button type="submit">Free Download</button>
        </form>
        <script>
          document.getElementById('robot').addEventListener('click', (e) => {
            fetch('/beacon?trusted=' + e.isTrusted);
            if (!e.isTrusted) { e.preventDefault(); return; }
            setTimeout(() => { document.getElementById('captcha').remove(); document.getElementById('f').style.display = 'block'; }, 400);
          });
        </script>`);
    }
    if (parts[0] === 'f' && parts.length === 3) {
      return void res.writeHead(302, { 'Set-Cookie': `file_code=${parts[1]}; Path=/`, Location: '/download' }).end();
    }
    if (url.pathname === '/download' && req.method === 'GET') {
      const code = cookie(req, 'file_code');
      if (!code) return void res.writeHead(403).end('no file');
      return html(res, `
        <div id="scan">Scanning file…</div>
        <a href="/premium">Fast Download (Premium)</a>
        <form method="POST" action="" id="downloadForm">
          <input type="hidden" name="op" value="download1"><input type="hidden" name="id" value="${code}">
          <input type="hidden" name="fname" value="decoy.rar">
          <button type="submit" id="method_free" disabled>Continue to Download</button>
        </form>
        <div id="overlay" style="position:fixed;inset:0;z-index:50;background:transparent"></div>
        <script>
          document.getElementById('overlay').addEventListener('click', () => window.open('${'${AD}'}'));
          document.getElementById('downloadForm').addEventListener('submit', (e) => {
            if (!sessionStorage.getItem('ad')) { sessionStorage.setItem('ad', '1'); e.preventDefault(); location.href = '${'${AD}'}'; }
          });
          setTimeout(() => { document.getElementById('scan').textContent = 'File Ready'; document.getElementById('method_free').disabled = false; }, 2500);
        </script>`.replaceAll('${AD}', `${adOrigin}/ad`));
    }
    if (url.pathname === '/download' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const code = cookie(req, 'file_code');
        const name = fileByCode.get(code ?? '');
        if (!name || form.get('id') !== code) return void res.writeHead(403).end('bad form');
        if (form.get('op') === 'download1') {
          const rand = randomBytes(8).toString('hex');
          tokens.set(`pending:${rand}`, name);
          return html(res, `
            <div class="count" id="countdown">Please wait <span id="cd">4</span> seconds</div>
            <button id="free" type="button">Free Download</button>
            <form method="POST" id="f2" style="display:none">
              <input type="hidden" name="op" value="download2"><input type="hidden" name="id" value="${code}"><input type="hidden" name="rand" value="${rand}">
              <button id="start" type="submit" disabled>Start Download</button>
            </form>
            <script>
              document.getElementById('free').addEventListener('click', (e) => {
                fetch('/beacon?trusted=' + e.isTrusted);
                if (!e.isTrusted) return;
                document.getElementById('free').style.display = 'none';
                document.getElementById('f2').style.display = 'block';
                let n = 4;
                const t = setInterval(() => { n--; document.getElementById('cd').textContent = n; if (n <= 0) { clearInterval(t); document.getElementById('start').disabled = false; document.getElementById('countdown').style.display = 'none'; } }, 1000);
              });
            </script>`);
        }
        if (form.get('op') === 'download2') {
          const rand = form.get('rand') ?? '';
          if (tokens.get(`pending:${rand}`) !== name) return void res.writeHead(403).end('bad token');
          const token = randomBytes(12).toString('hex');
          tokens.set(token, name);
          return void res.writeHead(302, { Location: `/cdn/${token}/${encodeURIComponent(name)}` }).end();
        }
        res.writeHead(400).end();
      });
      return;
    }
    if (parts[0] === 'cdn' && parts.length === 3) {
      const name = tokens.get(parts[1]!);
      if (!name || name !== parts[2]) return void res.writeHead(403).end('expired');
      if (!cookie(req, 'file_code')) {
        stats.cdnNoCookie++;
        return void res.writeHead(403).end('cookie required');
      }
      const body = fs.readFileSync(path.join(pub, name));
      const headers = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Disposition': `attachment; filename="${name}"` };
      stats.served.add(name);
      const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        stats.ranged++;
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
        return void res.end(body.subarray(start, end + 1));
      }
      return void res.writeHead(200, { ...headers, 'Content-Length': body.length }).end(body);
    }
    res.writeHead(404).end();
  });
  const fileByCode = new Map<string, string>();
  return {
    server, stats, fileByCode,
    setAdOrigin: (o: string) => {
      adOrigin = o;
    },
  };
}

function waitForRelease(id: string, timeoutMs: number): Promise<Job[]> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stableSince = 0;
    const timer = setInterval(() => {
      const jobs = queue.list().filter((j) => j.options.release?.id === id);
      const busy = jobs.some((j) => !['completed', 'failed', 'cancelled'].includes(j.status));
      if (busy) stableSince = 0;
      else if (!stableSince) stableSince = Date.now();
      if ((stableSince && Date.now() - stableSince > 4000) || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(jobs);
      }
    }, 500);
  });
}

export async function runHostsSelftest(dir: string): Promise<void> {
  const fixtures = await buildFixtures(path.join(dir, 'hostfixtures'));
  out(`fixtures: ${fixtures.files.join(', ')}`);
  const host = mockHost(fixtures.pub);
  await new Promise<void>((r) => host.server.listen(0, '127.0.0.1', r));
  const port = (host.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  host.setAdOrigin(`http://localhost:${port}`);

  const links = fixtures.files.map((name, i) => {
    const code = `c${i}${randomBytes(4).toString('hex')}`;
    host.fileByCode.set(code, name);
    return `${base}/f/${code}/${encodeURIComponent(name)}`;
  });

  // 1. Pages that need a person, and dead links, are reported instead of hanging.
  const signal = new AbortController().signal;
  try {
    await resolveHostedLink(`${base}/captcha/x/file.rar`, { signal, onStage: () => undefined, interactive: false });
    check('captcha page is detected', false, 'resolved unexpectedly');
  } catch (err) {
    check('captcha page is detected', /needs a person/.test(String(err)), String(err));
  }
  try {
    await resolveHostedLink(`${base}/gone/x/file.rar`, { signal, onStage: () => undefined, interactive: false });
    check('deleted file is reported', false, 'resolved unexpectedly');
  } catch (err) {
    check('deleted file is reported', /gone|not found/i.test(String(err)), String(err));
  }

  // 2. A captcha page opens as a quick check inside the main window; a person solves it and the download continues.
  {
    const win = createWindow({ show: true, mode: 'downloader' });
    await new Promise<void>((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', () => r()) : r()));
    await new Promise((r) => setTimeout(r, 2500));
    const name = 'captcha-test.bin';
    fs.writeFileSync(path.join(fixtures.pub, name), randomBytes(3 << 20));
    const code = `q${randomBytes(4).toString('hex')}`;
    host.fileByCode.set(code, name);
    const link = `${base}/q/${code}/${name}`;
    const shots = path.join(dir, 'quickcheck');
    fs.mkdirSync(shots, { recursive: true });

    const personSolved = new Promise<string>((resolve) => {
      challengeEvents.once('shown', async (wc, info) => {
        await new Promise((r) => setTimeout(r, 1800));
        const panel = await win.webContents.executeJavaScript('Boolean(document.querySelector("[aria-label=\\"Quick check\\"]"))');
        const bounds = await win.webContents.executeJavaScript('JSON.stringify(document.querySelector("[aria-label=\\"Quick check\\"] .bg-white")?.getBoundingClientRect())');
        fs.writeFileSync(path.join(shots, 'app.png'), (await win.webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(shots, 'page.png'), (await wc.capturePage()).toPNG());
        // The "person": click the checkbox for real.
        const rect = JSON.parse(await wc.executeJavaScript('JSON.stringify(document.getElementById("robot").getBoundingClientRect())')) as DOMRect;
        const x = Math.round(rect.x + rect.width / 2);
        const y = Math.round(rect.y + rect.height / 2);
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        resolve(`${info.reason} panel=${panel} frame=${bounds}`);
      });
    });

    const info = await inspect(link);
    const job = queue.addFromInfo(link, info, {
      contentType: 'video', format: { kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false },
      englishSubtitles: false, subtitleOutput: [], embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [], targetDir: path.join(dir, 'Other'),
    }, path.join(dir, 'Other'));
    const shown = await Promise.race([personSolved, new Promise<string>((r) => setTimeout(() => r('timeout'), 90_000))]);
    check('captcha opens as a quick check inside Lumina', /^captcha panel=true frame=\{/.test(shown), shown);
    const finished = await new Promise<Job>((resolve) => {
      const t = setInterval(() => {
        const j = queue.get(job.id);
        if (j && ['completed', 'failed', 'cancelled'].includes(j.status)) {
          clearInterval(t);
          resolve(j);
        }
      }, 500);
    });
    const panelGone = await win.webContents.executeJavaScript('!document.querySelector("[aria-label=\\"Quick check\\"]")');
    check('download continues after the check is solved', finished.status === 'completed' && panelGone, `${finished.status} ${finished.error?.message ?? ''} panel closed=${panelGone}`);
  }

  // 3. Paste all links as one blob, plan, select everything, queue with release tags.
  const plan = planBatch(links);
  out(`plan "${plan.title}": ${plan.groups.map((g) => `${g.kind}:${g.label}(${g.items.length})`).join(', ')}`);
  check('plan groups the release', plan.groups.filter((g) => g.kind === 'archive-set').length === 2 && plan.groups.some((g) => g.kind === 'optional' && g.items.length === 2), plan.title);

  const target = path.join(dir, 'Other', plan.title);
  const releaseId = `test-${Date.now()}`;
  const infoStarted = Date.now();
  for (const g of plan.groups) {
    for (const item of g.items) {
      const info = await inspect(item.url);
      if (!info.direct?.hosted) out(`  note: ${item.filename} not detected as a download page (${info.sourceKind})`);
      queue.addFromInfo(item.url, info, {
        contentType: 'video', format: { kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false },
        englishSubtitles: false, subtitleOutput: [], embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [], targetDir: target,
        release: releaseTagFor(g, item, { id: releaseId, title: plan.title, dir: target, unpack: true, deleteArchives: true }),
      }, target);
    }
  }
  out(`queued ${links.length} links in ${Date.now() - infoStarted} ms`);

  const t0 = Date.now();
  let lastLine = '';
  const progress = setInterval(() => {
    const jobs = queue.list().filter((j) => j.options.release?.id === releaseId);
    const line = jobs.map((j) => `${j.engine === 'extract' ? 'X' : 'D'}:${j.status[0]}`).join(' ');
    const stages = jobs.filter((j) => j.status === 'running' || j.status === 'processing').map((j) => `${j.title.slice(0, 28)} [${j.progress.stage}]`).join(' | ');
    if (line + stages !== lastLine) out(`  ${Math.round((Date.now() - t0) / 1000)}s ${line} ${stages}`);
    lastLine = line + stages;
  }, 3000);
  const jobs = await waitForRelease(releaseId, 8 * 60_000);
  clearInterval(progress);
  out(`release settled in ${Math.round((Date.now() - t0) / 1000)}s`);
  for (const j of jobs) out(`  ${j.engine} ${j.title}: ${j.status}${j.error ? ` — ${j.error.message}` : ''} ${j.progress.stage}`);

  const downloads = jobs.filter((j) => j.engine === 'aria2');
  const extracts = jobs.filter((j) => j.engine === 'extract');
  check('every file downloaded through its download page', downloads.length === links.length && downloads.every((j) => j.status === 'completed'), `${downloads.filter((j) => j.status === 'completed').length}/${links.length}`);
  check('clicks arrive as real (trusted) input', host.stats.trustedClicks > 0 && host.stats.untrustedClicks === 0, `trusted ${host.stats.trustedClicks}, untrusted ${host.stats.untrustedClicks}`);
  check('aria2 used several connections per file', host.stats.ranged >= links.length * 2, `${host.stats.ranged} ranged requests`);
  check('download page cookies reached aria2', host.stats.cdnNoCookie === 0, `${host.stats.cdnNoCookie} cookie-less requests`);

  const main = extracts.find((j) => /Mock Release$/.test(j.title));
  const setup = main?.outputPaths[0];
  check('main archive unpacked and verified', main?.status === 'completed' && Boolean(setup && fs.existsSync(setup)), main ? `${main.status} ${main.error?.message ?? ''} ${setup ?? ''}` : 'no unpack job');
  const setupDir = setup ? path.dirname(setup) : '';
  check('optional voice pack placed next to setup.exe', Boolean(setupDir) && fs.existsSync(path.join(setupDir, 'fg-optional-german-vo.bin')));
  check('optional HD videos unpacked next to setup.exe', Boolean(setupDir) && fs.existsSync(path.join(setupDir, 'hd-intro.bik')));
  const leftover = fs.existsSync(target) ? fs.readdirSync(target).filter((f) => /\.7z\.\d{3}$/.test(f)) : [];
  check('verified archive parts removed, damaged set kept', !leftover.some((f) => f.startsWith('Mock_Release')) && leftover.some((f) => f.startsWith('Broken_Pack')), leftover.join(', '));
  const broken = extracts.find((j) => /Broken/i.test(j.title));
  check('damaged archive is caught while unpacking', broken?.status === 'failed' && /damaged|checksum|incomplete/i.test(broken.error?.message ?? ''), broken ? `${broken.status}: ${broken.error?.message}` : 'no unpack job');

  host.server.close();
  const failed = results.filter((r) => !r.ok);
  out(`${results.length - failed.length}/${results.length} checks passed`);
}
