// Development-only end-to-end test of file-host downloads and release assembly against a local mock host
// that behaves like an XFileSharing-style site (cookie redirect, disabled button until "File Ready", ad
// overlay and redirect, trusted-click check, countdown, cookie-bound CDN link with range support).
// Run: LUMINA_SELFTEST=1 LUMINA_SELFTEST_HOSTS=1 electron . --user-data-dir=<scratch>
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { BrowserWindow } from 'electron';
import type { Job } from '../shared/types';
import { planBatch, releaseTagFor } from '../core/batch';
import { inspect } from './inspect';
import { queue } from './jobs/queue';
import { DRIVER_VARIANTS } from './selftestDriverPages';
import { challengeAction, challengeEvents, forgetLearnedClicks, forgetSolvedChecks, learnedFor, resolveHostedLink } from './hosters';
import { createWindow } from './window';
import { settings } from './settings';
import { runTool } from './process';
import { tools } from './tools';

const out = (m: string) => {
  const line = `[selftest] ${m}\n`;
  process.stdout.write(line);
  if (process.env.LUMINA_SELFTEST_LOG) { try { fs.appendFileSync(process.env.LUMINA_SELFTEST_LOG, line); } catch { /* best effort */ } }
};
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
  const stats = { ranged: 0, cdnNoCookie: 0, trustedClicks: 0, untrustedClicks: 0, adRedirects: 0, gateChecks: 0, gateOpen: 0, served: new Set<string>() };
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
    // A host that asks for the human check until the visitor holds its clearance cookie, like a site behind a bot check.
    if (parts[0] === 'g' && parts.length === 3) {
      return void res.writeHead(302, { 'Set-Cookie': `file_code=${parts[1]}; Path=/`, Location: '/gcheck' }).end();
    }
    if (url.pathname === '/pass') return void res.writeHead(204, { 'Set-Cookie': 'cf_clearance=passed; Path=/; HttpOnly' }).end();
    if (url.pathname === '/gcheck') {
      const code = cookie(req, 'file_code');
      const name = fileByCode.get(code ?? '');
      if (!name) return void res.writeHead(403).end('no file');
      const cleared = cookie(req, 'cf_clearance') === 'passed';
      if (cleared) stats.gateOpen++;
      else stats.gateChecks++;
      const rand = randomBytes(8).toString('hex');
      tokens.set(`pending:${rand}`, name);
      return html(res, `
        <h2>${name}</h2>
        ${cleared ? '' : `<div class="cf-turnstile" id="captcha" style="width:304px;height:78px;border:1px solid #d3d3d3;border-radius:3px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#f9f9f9">
          <input type="checkbox" id="robot" style="width:28px;height:28px"><label for="robot">I'm not a robot</label>
        </div>`}
        <form method="POST" action="/download" id="f" style="display:${cleared ? 'block' : 'none'}">
          <input type="hidden" name="op" value="download2"><input type="hidden" name="id" value="${code}"><input type="hidden" name="rand" value="${rand}">
          <button type="submit">Free Download</button>
        </form>
        <script>
          const robot = document.getElementById('robot');
          if (robot) robot.addEventListener('click', (e) => {
            if (!e.isTrusted) { e.preventDefault(); return; }
            fetch('/pass').then(() => setTimeout(() => { document.getElementById('captcha').remove(); document.getElementById('f').style.display = 'block'; }, 400));
          });
        </script>`);
    }
    // A host that sets the clearance but then refuses to honour it (expired, or tied to something else): it asks every time.
    if (parts[0] === 'n' && parts.length === 3) {
      return void res.writeHead(302, { 'Set-Cookie': `file_code=${parts[1]}; Path=/`, Location: '/ncheck' }).end();
    }
    if (url.pathname === '/ncheck') {
      const code = cookie(req, 'file_code');
      const name = fileByCode.get(code ?? '');
      if (!name) return void res.writeHead(403).end('no file');
      const rand = randomBytes(8).toString('hex');
      tokens.set(`pending:${rand}`, name);
      return html(res, `
        <h2>${name}</h2>
        <div class="cf-turnstile" id="captcha" style="width:304px;height:78px;border:1px solid #d3d3d3;border-radius:3px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#f9f9f9">
          <input type="checkbox" id="robot" style="width:28px;height:28px"><label for="robot">I'm not a robot</label>
        </div>
        <form method="POST" action="/download" id="f" style="display:none">
          <input type="hidden" name="op" value="download2"><input type="hidden" name="id" value="${code}"><input type="hidden" name="rand" value="${rand}">
          <button type="submit">Free Download</button>
        </form>
        <script>
          document.getElementById('robot').addEventListener('click', (e) => {
            if (!e.isTrusted) { e.preventDefault(); return; }
            fetch('/pass').then(() => setTimeout(() => { document.getElementById('captcha').remove(); document.getElementById('f').style.display = 'block'; }, 400));
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
    // LUMINA_SELFTEST_OFFSCREEN=1 renders this window into a bitmap instead of showing it (this machine's rule: never open the app window).
    const offscreen = process.env.LUMINA_SELFTEST_OFFSCREEN === '1';
    const win = createWindow({ show: !offscreen, mode: 'downloader', offscreen });
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

/**
 * One solved check clears the rest of that site's files, proven on the real download-page code against a stand-in host that asks for the
 * human check until it holds a clearance cookie. Runs with an OFFSCREEN main window, so nothing shows on screen: the quick-check page is a
 * hidden window that takes input anyway. `LUMINA_SELFTEST=1 LUMINA_SELFTEST_GATE=1`.
 *
 * Every scenario has a time limit: the first version of this feature hung a page forever, and a hang must show up as a failed check, not as
 * a run that never ends.
 */
export async function runGateSelftest(dir: string): Promise<void> {
  const pub = path.join(dir, 'gatepub');
  fs.rmSync(pub, { recursive: true, force: true });
  fs.mkdirSync(pub, { recursive: true });
  const host = mockHost(pub);
  await new Promise<void>((r) => host.server.listen(0, '127.0.0.1', r));
  const port = (host.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const otherSite = `http://localhost:${port}`;
  host.setAdOrigin(`http://localhost:${port}`);
  const signal = new AbortController().signal;
  createWindow({ show: false, mode: 'downloader', offscreen: true });
  await new Promise((r) => setTimeout(r, 2500));

  const names = [1, 2, 3, 4].map((n) => {
    const name = `gate-${n}.bin`;
    fs.writeFileSync(path.join(pub, name), randomBytes(64 << 10));
    return name;
  });
  const link = (origin: string, route: 'g' | 'n', name: string) => {
    const code = `${route}${randomBytes(4).toString('hex')}`;
    host.fileByCode.set(code, name);
    return `${origin}/${route}/${code}/${name}`;
  };
  const resolveOne = (url: string) => resolveHostedLink(url, { signal, onStage: () => undefined });
  const within = <T>(p: Promise<T>, ms: number, what: string) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer after ${ms / 1000}s (a page is stuck)`)), ms))]);

  // The stand-in person. `skipAll` makes them dismiss everything instead of ticking.
  let asked = 0;
  let skipAll = false;
  const person = async (wc: Electron.WebContents, info: { id: string }) => {
    asked++;
    await new Promise((r) => setTimeout(r, 1800));
    if (skipAll) return void challengeAction(info.id, 'skip-all');
    try {
      const rect = JSON.parse(await wc.executeJavaScript('JSON.stringify(document.getElementById("robot").getBoundingClientRect())')) as DOMRect;
      const x = Math.round(rect.x + rect.width / 2);
      const y = Math.round(rect.y + rect.height / 2);
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    } catch (err) {
      out(`  note: the stand-in person could not click (${String(err)})`);
    }
  };
  challengeEvents.on('shown', person);
  const fresh = () => { forgetSolvedChecks(); asked = 0; };
  const seconds = (t: number) => Math.round((Date.now() - t) / 1000);

  try {
    // 1. Baseline: the check forgotten before each file, as it behaved before this feature.
    fresh();
    for (const name of names) {
      forgetSolvedChecks();
      await within(resolveOne(link(base, 'g', name)), 60_000, 'baseline');
    }
    check('baseline: with the solved check forgotten every file asks again', asked === names.length, `asked ${asked} times for ${names.length} files`);

    // 2. Four files at once, one site: asked once, every file its own file.
    fresh();
    let t = Date.now();
    const four = await within(Promise.all(names.map((n) => resolveOne(link(base, 'g', n)))), 90_000, 'four at once');
    check('a solved check is asked for once, however many files the site has', asked === 1, `asked ${asked} time(s) for ${names.length} files in ${seconds(t)}s`);
    check('and every file still comes out as its own file', four.map((r) => r.filename).sort().join() === [...names].sort().join(), four.map((r) => r.filename).join(', '));
    check('what carried over was the proof of the check, not the file cookie', host.stats.gateOpen >= 1, `${host.stats.gateOpen} pages opened already cleared`);

    // 3. A big batch: 24 files of one site.
    fresh();
    t = Date.now();
    const many = await within(Promise.all(Array.from({ length: 24 }, (_, i) => resolveOne(link(base, 'g', names[i % names.length] ?? names[0] ?? ''))) ), 240_000, '24 files');
    check('24 files of one site ask once', asked === 1 && many.length === 24, `asked ${asked} time(s), ${many.length} resolved in ${seconds(t)}s`);

    // 4. Files opened one after another, after the check was solved.
    fresh();
    for (const name of names.slice(0, 3)) await within(resolveOne(link(base, 'g', name)), 60_000, 'one after another');
    check('files opened later, one by one, do not ask again', asked === 1, `asked ${asked} time(s) for 3 files in turn`);

    // 5. Two sites: a check solved on one is not used on the other.
    fresh();
    const mixed = await within(Promise.all([
      resolveOne(link(base, 'g', names[0] ?? '')), resolveOne(link(otherSite, 'g', names[1] ?? '')),
      resolveOne(link(base, 'g', names[2] ?? '')), resolveOne(link(otherSite, 'g', names[3] ?? '')),
    ]), 120_000, 'two sites');
    check('two different sites each ask once, and neither borrows the other’s check', asked === 2 && mixed.length === 4, `asked ${asked} time(s) for 2 files on each of 2 sites`);

    // 6. A host that refuses the reused proof: it must ask again for each file, and nothing may hang.
    fresh();
    t = Date.now();
    const refused = await within(Promise.allSettled(names.map((n) => resolveOne(link(base, 'n', n)))), 180_000, 'host that refuses the proof');
    check('a host that does not honour the reused check is asked again, and no file is lost', refused.every((r) => r.status === 'fulfilled') && asked === names.length,
      `${refused.filter((r) => r.status === 'fulfilled').length}/${names.length} resolved, asked ${asked} times in ${seconds(t)}s`);

    // 7. The person dismisses everything: all of it ends, none hangs.
    fresh();
    skipAll = true;
    t = Date.now();
    const eight = Array.from({ length: 8 }, (_, i) => names[i % names.length] ?? '');
    const skipped = await within(Promise.allSettled(eight.map((n) => resolveOne(link(base, 'g', n)))), 90_000, 'skip all');
    skipAll = false;
    check('skipping the check ends every file of the site, including those not yet opened', skipped.every((r) => r.status === 'rejected' && /Skipped/.test(String(r.reason))) && asked === 1,
      `${skipped.filter((r) => r.status === 'rejected').length}/${eight.length} skipped, asked ${asked} time(s) in ${seconds(t)}s`);

    // 8. After a skip nothing is remembered, and the next attempt works again.
    fresh();
    const again = await within(resolveOne(link(base, 'g', names[0] ?? '')), 60_000, 'after a skip');
    check('after skipping, the next try asks and works', asked === 1 && again.filename === names[0], `asked ${asked} time(s)`);
  } catch (err) {
    check('the gate scenarios ran to the end', false, String(err));
  } finally {
    challengeEvents.off('shown', person);
  }

  host.server.close();
  const failed = results.filter((r) => !r.ok);
  out(`${results.length - failed.length}/${results.length} checks passed`);
}

/**
 * The page driver against many layouts of "get the file" control, in the real app with nobody to help (`interactive: false`): a layout the
 * driver cannot read fails here instead of on the owner's machine after a host redesigns its page. Nothing is shown on screen.
 * `LUMINA_SELFTEST=1 LUMINA_SELFTEST_DRIVER=1`. `LUMINA_SELFTEST_ONLY=<id,id>` runs just those layouts.
 */
export async function runDriverSelftest(): Promise<void> {
  const only = (process.env.LUMINA_SELFTEST_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const variants = DRIVER_VARIANTS.filter((v) => !only.length || only.includes(v.id));
  const page = (inner: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Download page</title><style>body{font:16px sans-serif;padding:30px}button,.btn{padding:12px 28px;font-size:16px}</style></head><body><h2>Sample file</h2>${inner}</body></html>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (status: number, type: string, body: string) => res.writeHead(status, { 'Content-Type': type }).end(body);
    const file = (name: string) => res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': 2048 }).end(Buffer.alloc(2048, 7));
    if (parts[0] === 'v' && parts.length === 3) {
      const v = DRIVER_VARIANTS.find((x) => x.id === parts[1]);
      if (!v) return void send(404, 'text/plain', 'no such layout');
      return void send(200, 'text/html; charset=utf-8', page(v.body(`/get/${parts[2]}`, `/decoy/${parts[2]}`)));
    }
    if (parts[0] === 'frame') {
      const go = url.searchParams.get('go') ?? '/';
      return void send(200, 'text/html; charset=utf-8', page(`<button onclick="location.href='${go}'">Download</button>`));
    }
    // Layouts the driver cannot read by itself: a bare arrow. Used by the learned-click scenario below.
    if (parts[0] === 'arrow' && parts[1]) {
      return void send(200, 'text/html; charset=utf-8', page(`<div class="g-recaptcha" style="width:304px;height:78px;border:1px solid #ccc">I'm not a robot</div><button id="nx" class="r-btn" onclick="location.href='/get/${parts[1]}'">→</button>`));
    }
    if (parts[0] === 'arrow2' && parts[1]) {
      return void send(200, 'text/html; charset=utf-8', page(`<div style="margin-top:500px"><button id="nx" class="totally-new-look" onclick="location.href='/get/${parts[1]}'">→</button></div>`));
    }
    if (parts[0] === 'arrow3' && parts[1]) {
      return void send(200, 'text/html; charset=utf-8', page(`<button id="other" onclick="location.href='/get/${parts[1]}'">←</button>`));
    }
    if (parts[0] === 'get') return void file(`driver-${(parts[1] ?? 'x').replace(/\.rar$/, '')}.bin`);
    if (parts[0] === 'decoy') return void file('DECOY.bin');
    if (parts[0] === 'ad') return void send(200, 'text/html', '<h1>Win a prize!</h1>');
    send(404, 'text/plain', 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const runOne = async (v: (typeof DRIVER_VARIANTS)[number]): Promise<void> => {
    const code = randomBytes(4).toString('hex');
    const limitS = 25 + (v.waitS ?? 0);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), limitS * 1000);
    const started = Date.now();
    try {
      const got = await resolveHostedLink(`${base}/v/${v.id}/${code}`, { signal: ac.signal, onStage: () => undefined, interactive: false });
      const right = got.filename === `driver-${code}.bin`;
      check(`layout "${v.id}" (${v.note})`, right, right ? `${Math.round((Date.now() - started) / 100) / 10}s` : `took the wrong file: ${got.filename}`);
    } catch (err) {
      check(`layout "${v.id}" (${v.note})`, false, ac.signal.aborted ? `nothing found in ${limitS}s` : String(err).replace(/^Error:\s*/, '').slice(0, 140));
    } finally {
      clearTimeout(timer);
    }
  };
  const queue = [...variants];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let v = queue.shift(); v; v = queue.shift()) await runOne(v);
  }));

  // Learning from the person: a control the driver cannot read is clicked once by a person, and the site's next page needs nobody.
  if (!only.length || only.includes('learning')) {
    createWindow({ show: false, mode: 'downloader', offscreen: true });
    await new Promise((r) => setTimeout(r, 2500));
    const noPerson = (route: string) => {
      const code = randomBytes(4).toString('hex');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 15_000);
      return resolveHostedLink(`${base}/${route}/${code}`, { signal: ac.signal, onStage: () => undefined, interactive: false })
        .then((r) => ({ ok: r.filename === `driver-${code}.bin`, detail: r.filename }), (err: unknown) => ({ ok: false, detail: String(err).slice(0, 90) }))
        .finally(() => clearTimeout(timer));
    };
    forgetLearnedClicks();
    const before = await noPerson('arrow');
    check('learning: an unlabelled arrow cannot be read by the driver alone', !before.ok, before.detail);

    const clickArrow = async (wc: Electron.WebContents) => {
      await new Promise((r) => setTimeout(r, 1500));
      const rect = JSON.parse(await wc.executeJavaScript('JSON.stringify(document.getElementById("nx").getBoundingClientRect())')) as DOMRect;
      const x = Math.round(rect.x + rect.width / 2);
      const y = Math.round(rect.y + rect.height / 2);
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    };
    challengeEvents.once('shown', (wc) => void clickArrow(wc));
    const code2 = randomBytes(4).toString('hex');
    const ac2 = new AbortController();
    const t2 = setTimeout(() => ac2.abort(), 60_000);
    const helped = await resolveHostedLink(`${base}/arrow/${code2}`, { signal: ac2.signal, onStage: () => undefined }).catch((err: unknown) => err);
    clearTimeout(t2);
    check('learning: a person clicks the arrow once and the file comes', !(helped instanceof Error) && (helped as { filename: string }).filename === `driver-${code2}.bin`, helped instanceof Error ? helped.message : 'ok');
    const known = learnedFor('127.0.0.1');
    check('learning: the control is remembered for the site', known.length === 1 && known[0]?.text === '→' && known[0]?.id === 'nx', JSON.stringify(known[0] ?? null));

    const moved = await noPerson('arrow2');
    check('learning: the next page of the site, with the arrow restyled and moved, needs nobody', moved.ok, moved.detail);
    const other = await noPerson('arrow3');
    check('learning: a page with a different control is not clicked at random', !other.ok, other.detail);
    forgetLearnedClicks();
    const forgotten = await noPerson('arrow2');
    check('learning: once forgotten, the restyled page needs a person again (so it was the learning that worked)', !forgotten.ok, forgotten.detail);
  }
  server.close();
  const failed = results.filter((r) => !r.ok);
  out(`${results.length - failed.length}/${results.length} layouts read`);
}

/**
 * Photographs the quick-check pop-up the way the person sees it, offscreen: the app screen and the live page window laid over it are
 * separate windows, so both are captured and composited. `LUMINA_SELFTEST=1 LUMINA_SELFTEST_SHOTS=1 LUMINA_SHOT_DIR=<dir>
 * LUMINA_SHOT_MODE=light|dark LUMINA_STALL_MS=4000`. Cases: a tick-the-box check, and a stuck page that needs a button pressed.
 */
export async function runShotsSelftest(): Promise<void> {
  const outDir = process.env.LUMINA_SHOT_DIR ?? path.join(process.cwd(), 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  const mode = process.env.LUMINA_SHOT_MODE === 'dark' ? 'dark' : 'light';
  settings.update({ appearance: { ...settings.get().appearance, colorMode: mode } });
  const body = (inner: string) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:16px system-ui,sans-serif;background:#fafafa;color:#222;display:grid;place-items:center;min-height:100vh}</style></head><body>${inner}</body></html>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (inner: string) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body(inner));
    if (parts[0] === 'check') {
      return void send(`<div style="padding:60px 0;text-align:center"><h1 style="font-size:24px;margin:0 0 6px">Checking your browser</h1><p style="color:#666;margin:0 0 28px">Verify you are human to continue</p>
        <div id="box" class="cf-turnstile" style="display:inline-flex;align-items:center;gap:14px;width:300px;height:65px;border:1px solid #d0d0d0;border-radius:4px;background:#fff;padding:0 16px;box-sizing:border-box">
          <input type="checkbox" id="robot" style="width:24px;height:24px"><label for="robot">Verify you are human</label></div></div>`);
    }
    if (parts[0] === 'stuck') return void send(`<div style="text-align:center"><p style="color:#666">Your file is ready</p><button id="go" style="padding:14px 34px;font-size:18px;border-radius:10px;border:1px solid #bbb;background:#fff">→</button></div>`);
    res.writeHead(404).end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const win = createWindow({ show: false, mode: 'downloader', offscreen: true });
  await new Promise((r) => setTimeout(r, 3000));

  const compose = async (appPng: Electron.NativeImage, pagePng: Electron.NativeImage, rect: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }, file: string) => {
    const w = new BrowserWindow({ show: false, width: size.width, height: size.height, webPreferences: { offscreen: true } });
    const html = `<body style="margin:0;position:relative;width:${size.width}px;height:${size.height}px;overflow:hidden"><img src="${appPng.toDataURL()}" style="position:absolute;left:0;top:0;width:${size.width}px;height:${size.height}px"><img src="${pagePng.toDataURL()}" style="position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px"></body>`;
    await w.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await new Promise((r) => setTimeout(r, 800));
    fs.writeFileSync(file, (await w.webContents.capturePage()).toPNG());
    w.destroy();
  };

  const cases: { name: string; route: string; sizes: { width: number; height: number }[]; act: (wc: Electron.WebContents) => Promise<void> }[] = [
    { name: 'check', route: 'check', sizes: [{ width: 1360, height: 860 }, { width: 960, height: 640 }], act: async () => undefined },
    { name: 'button', route: 'stuck', sizes: [{ width: 1360, height: 860 }, { width: 960, height: 640 }], act: async () => undefined },
  ];
  for (const c of cases) {
    const code = randomBytes(4).toString('hex');
    const ac = new AbortController();
    const shown = new Promise<{ wc: Electron.WebContents; reason: string }>((resolve) => challengeEvents.once('shown', (wc, info) => resolve({ wc, reason: info.reason })));
    const resolving = resolveHostedLink(`${base}/${c.route}/${code}`, { signal: ac.signal, onStage: () => undefined }).catch(() => undefined);
    const { wc, reason } = await Promise.race([shown, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${c.name}: the pop-up never appeared`)), 60_000))]);
    out(`${c.name}: pop-up shown for reason "${reason}"`);
    for (const size of c.sizes) {
      win.setSize(size.width, size.height);
      await new Promise((r) => setTimeout(r, 2500));
      const rect = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(document.querySelector("[aria-label=\\"Quick check\\"] .bg-white").getBoundingClientRect())')) as { x: number; y: number; width: number; height: number };
      const appPng = await win.webContents.capturePage();
      const pagePng = await wc.capturePage();
      const file = path.join(outDir, `${mode}-${c.name}-${size.width}x${size.height}.png`);
      await compose(appPng, pagePng, rect, size, file);
      out(`  saved ${path.basename(file)} (frame ${Math.round(rect.width)}x${Math.round(rect.height)} at ${Math.round(rect.x)},${Math.round(rect.y)})`);
    }
    ac.abort();
    await resolving;
    await new Promise((r) => setTimeout(r, 1000));
  }
  server.close();
}
