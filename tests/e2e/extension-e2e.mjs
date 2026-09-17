#!/usr/bin/env node
// End-to-end test: real browser + Lumina extension + Lumina app, downloading every common file type.
//
//   node tests/e2e/extension-e2e.mjs --browser chrome|brave|edge [--keep]
//
// Needs a built app (pnpm build) and fetched tools (pnpm tools:fetch). Uses throwaway browser and app
// profiles in the OS temp folder; never touches real profiles.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const browserName = args[args.indexOf('--browser') + 1] ?? 'chrome';
const BROWSERS = {
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  brave: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
};
const SITE_PORT = 8765;
const BRIDGE_PORT = 17899;
const CDP_PORT = 9340;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), `lumina-e2e-${browserName}-`));
const DIRS = { fixtures: path.join(WORK, 'site'), lumina: path.join(WORK, 'lumina-downloads'), browser: path.join(WORK, 'browser-downloads'), app: path.join(WORK, 'app-profile'), profile: path.join(WORK, 'browser-profile') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...m) => console.log(`[e2e:${browserName}]`, ...m);

/* ---------- Fixtures ---------- */

const ffmpeg = path.join(ROOT, 'resources', 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', gz: 'application/gzip',
  exe: 'application/vnd.microsoft.portable-executable', msi: 'application/x-msi', iso: 'application/x-iso9660-image', apk: 'application/vnd.android.package-archive',
  dmg: 'application/x-apple-diskimage', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', torrent: 'application/x-bittorrent', bin: 'application/octet-stream',
};

function ff(out, ...a) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...a, out]);
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${out}: ${r.stderr}`);
}

function makeFixtures() {
  const f = (name) => path.join(DIRS.fixtures, name);
  ff(f('photo.png'), '-f', 'lavfi', '-i', 'testsrc2=s=640x360', '-frames:v', '1');
  ff(f('photo.jpg'), '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1');
  ff(f('animation.gif'), '-f', 'lavfi', '-i', 'testsrc=s=160x120:d=1:r=10');
  ff(f('picture.webp'), '-f', 'lavfi', '-i', 'testsrc2=s=320x240', '-frames:v', '1');
  ff(f('clip.mp4'), '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=3', '-f', 'lavfi', '-i', 'sine=d=3', '-shortest', '-pix_fmt', 'yuv420p');
  ff(f('clip.webm'), '-f', 'lavfi', '-i', 'testsrc2=s=320x240:d=2', '-c:v', 'libvpx-vp9', '-b:v', '200k');
  ff(f('song.mp3'), '-f', 'lavfi', '-i', 'sine=frequency=440:d=4');
  ff(f('song.flac'), '-f', 'lavfi', '-i', 'sine=frequency=660:d=4');
  fs.copyFileSync(path.join(ROOT, 'assets', 'icons', 'icon.ico'), f('favicon.ico'));
  fs.writeFileSync(f('logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="orange"/></svg>');
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  spawnSync(tar, ['-a', '-c', '-f', f('archive.zip'), '-C', DIRS.fixtures, 'photo.png', 'song.mp3']);
  const withMagic = (name, magic, size) => fs.writeFileSync(f(name), Buffer.concat([Buffer.from(magic, 'binary'), randomBytes(size)]));
  withMagic('archive.rar', 'Rar!\x1a\x07\x01\x00', 300_000);
  withMagic('archive.7z', "7z\xbc\xaf'\x1c", 400_000);
  withMagic('backup.tar.gz', '\x1f\x8b\x08', 200_000);
  withMagic('setup.exe', 'MZ\x90\x00', 2_500_000);
  withMagic('installer.msi', '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1', 1_200_000);
  withMagic('disk.iso', '', 3_000_000);
  withMagic('app.apk', 'PK\x03\x04', 900_000);
  withMagic('mac.dmg', '', 700_000);
  withMagic('game-data.bin', '', 1_500_000);
  withMagic('document.docx', 'PK\x03\x04', 60_000);
  fs.writeFileSync(f('manual.pdf'), '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  fs.writeFileSync(f('notes.txt'), 'plain text download\n');
  fs.writeFileSync(f('data.csv'), 'a,b\n1,2\n');
  fs.writeFileSync(f('config.json'), '{"ok":true}');
  withMagic('big-video.mp4', '', 60 * 1024 * 1024);
  for (let i = 1; i <= 20; i++) fs.copyFileSync(f('photo.png'), f(`burst-${String(i).padStart(2, '0')}.png`));
  // Make each burst image unique so hashes prove which file arrived.
  for (let i = 1; i <= 20; i++) fs.appendFileSync(f(`burst-${String(i).padStart(2, '0')}.png`), Buffer.from([i]));
}

/* ---------- Test website ---------- */

const requests = [];
const onceUsed = new Set();

function serveFile(res, req, file, extraHeaders = {}) {
  const data = fs.readFileSync(file);
  const ext = file.split('.').pop().toLowerCase();
  // Real servers send validators; browsers that split downloads into parallel ranges (Brave) require them.
  const headers = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes',
    ETag: `"${sha(data).slice(0, 16)}"`, 'Last-Modified': new Date(fs.statSync(file).mtimeMs).toUTCString(),
    ...extraHeaders,
  };
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
    return res.end(data.subarray(start, end + 1));
  }
  res.writeHead(200, { ...headers, 'Content-Length': data.length });
  res.end(data);
}

const TYPE_FILES = ['photo.png', 'photo.jpg', 'animation.gif', 'picture.webp', 'favicon.ico', 'logo.svg', 'clip.mp4', 'clip.webm', 'song.mp3', 'song.flac',
  'archive.zip', 'archive.rar', 'archive.7z', 'backup.tar.gz', 'setup.exe', 'installer.msi', 'disk.iso', 'app.apk', 'mac.dmg', 'game-data.bin',
  'document.docx', 'manual.pdf', 'notes.txt', 'data.csv', 'config.json'];

function page() {
  const link = (id, href, label, download = true) => `<p><a id="${id}" href="${href}" ${download ? 'download' : ''}>${label}</a></p>`;
  return `<!doctype html><html><head><title>Lumina download test site</title></head><body>
  <h1>Download test</h1>
  ${TYPE_FILES.map((name, i) => link(`t${i}`, `/files/${name}`, name)).join('\n')}
  ${link('disposition', '/dl?id=42', 'report (content-disposition, no extension)', false)}
  ${link('redirect', '/redirect', 'redirect to zip', false)}
  ${link('auth', '/auth/secret.zip', 'needs login cookie')}
  ${link('referer', '/referer/need.bin', 'needs referer')}
  ${link('once', '/once/token.bin', 'one-time link')}
  ${link('big', '/files/big-video.mp4', '60 MB video')}
  ${link('dup', '/files/archive.zip', 'archive.zip again (duplicate name)')}
  ${Array.from({ length: 20 }, (_, i) => link(`burst${i + 1}`, `/files/burst-${String(i + 1).padStart(2, '0')}.png`, `burst ${i + 1}`)).join('\n')}
  <form id="post" method="POST" action="/post"><button>POST download</button></form>
  <button id="blob">blob download</button>
  <script>
    document.getElementById('blob').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['generated in page'], { type: 'text/plain' }));
      a.download = 'generated.txt';
      document.body.append(a);
      a.click();
      a.remove();
    });
  </script>
  </body></html>`;
}

function startSite() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${SITE_PORT}`);
    const entry = { method: req.method, path: url.pathname, range: req.headers.range ?? null, ifRange: req.headers['if-range'] ?? null, ua: req.headers['user-agent'] ?? '', referer: req.headers.referer ?? '', cookie: req.headers.cookie ?? '', status: 0, sent: 0, aborted: false };
    requests.push(entry);
    const writeHead = res.writeHead.bind(res);
    res.writeHead = (status, ...rest) => { entry.status = status; return writeHead(status, ...rest); };
    res.on('close', () => { entry.aborted = !res.writableFinished; entry.sent = res.socket?.bytesWritten ?? 0; });
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'session=lumina-test; Path=/' });
      return res.end(page());
    }
    if (url.pathname.startsWith('/files/')) {
      const file = path.join(DIRS.fixtures, path.basename(decodeURIComponent(url.pathname)));
      if (!fs.existsSync(file)) return res.writeHead(404).end();
      return serveFile(res, req, file);
    }
    if (url.pathname === '/dl') return serveFile(res, req, path.join(DIRS.fixtures, 'manual.pdf'), { 'Content-Disposition': 'attachment; filename="Quarterly report 2026.pdf"' });
    if (url.pathname === '/redirect') return res.writeHead(302, { Location: '/files/archive.7z' }).end();
    if (url.pathname === '/auth/secret.zip') {
      if (!/session=lumina-test/.test(req.headers.cookie ?? '')) return res.writeHead(403).end('login required');
      return serveFile(res, req, path.join(DIRS.fixtures, 'archive.zip'), { 'Content-Disposition': 'attachment; filename="secret.zip"' });
    }
    if (url.pathname === '/referer/need.bin') {
      if (!(req.headers.referer ?? '').startsWith(`http://127.0.0.1:${SITE_PORT}/`)) return res.writeHead(403).end('hotlinking not allowed');
      return serveFile(res, req, path.join(DIRS.fixtures, 'game-data.bin'), { 'Content-Disposition': 'attachment; filename="need.bin"' });
    }
    if (url.pathname === '/once/token.bin') {
      // Like expiring download links: the second request is refused.
      if (onceUsed.has('token')) return res.writeHead(410).end('link expired');
      onceUsed.add('token');
      return serveFile(res, req, path.join(DIRS.fixtures, 'setup.exe'), { 'Content-Disposition': 'attachment; filename="token.bin"' });
    }
    if (url.pathname === '/post' && req.method === 'POST') {
      return serveFile(res, req, path.join(DIRS.fixtures, 'data.csv'), { 'Content-Disposition': 'attachment; filename="export.csv"' });
    }
    res.writeHead(404).end();
  });
  return new Promise((r) => server.listen(SITE_PORT, '127.0.0.1', () => r(server)));
}

/* ---------- Lumina app ---------- */

function startLumina() {
  fs.writeFileSync(path.join(DIRS.app, 'settings.json'), JSON.stringify({
    general: { closeToTray: true, trayNoticeShown: true, clipboardWatcher: false, notifyOnComplete: false, notifyOnFail: false, globalShortcutEnabled: false, startMode: 'tray', confirmQuitWithDownloads: false },
    downloads: { autoRetryFailed: false },
    storage: { libraryRoots: [DIRS.lumina], musicDir: path.join(WORK, 'm'), videoDir: path.join(WORK, 'v'), seriesDir: path.join(WORK, 's'), otherDir: DIRS.lumina },
    library: { watchFolders: false },
    updates: { autoUpdateYtdlp: false },
    extension: { enabled: true, port: BRIDGE_PORT, captureDownloads: true, minCaptureSizeMb: 0, saveDir: DIRS.lumina, browserDownloads: 'auto' },
  }));
  const electron = createRequire(import.meta.url)('electron');
  const env = { ...process.env, LUMINA_TEST_AUTO_APPROVE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [ROOT, '--hidden', `--user-data-dir=${DIRS.app}`], { env, stdio: 'ignore' });
  return child;
}

async function waitFor(check, timeoutMs, label) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const v = await check();
      if (v) return v;
    } catch {
      // not ready
    }
    await wait(400);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/* ---------- Browser + DevTools protocol ---------- */

function startBrowser() {
  const prefsDir = path.join(DIRS.profile, 'Default');
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(path.join(prefsDir, 'Preferences'), JSON.stringify({
    download: { default_directory: DIRS.browser, prompt_for_download: false, directory_upgrade: true },
    safebrowsing: { enabled: false },
    // Let the test page start many downloads without Chrome's "download multiple files?" prompt.
    profile: {
      exit_type: 'Normal',
      default_content_setting_values: { automatic_downloads: 1 },
      content_settings: { exceptions: { automatic_downloads: { [`http://127.0.0.1:${SITE_PORT},*`]: { setting: 1 } } } },
    },
  }));
  const exe = BROWSERS[browserName];
  // Branded Chrome ignores --load-extension; DevTools' Extensions.loadUnpacked over a pipe is the supported way.
  const child = spawn(exe, [
    `--user-data-dir=${DIRS.profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  return { child, cdp: pipeCdp(child) };
}

/** Chrome DevTools Protocol over --remote-debugging-pipe (NUL-delimited JSON), with flattened sessions. */
function pipeCdp(child) {
  const out = child.stdio[3];
  const inp = child.stdio[4];
  let id = 0;
  let buffer = '';
  const pending = new Map();
  inp.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  const send = (method, params = {}, sessionId) => {
    const myId = ++id;
    out.write(`${JSON.stringify({ id: myId, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    return new Promise((resolve, reject) => pending.set(myId, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result))));
  };
  const session = (sessionId) => ({
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result?.value;
    },
  });
  return {
    send,
    async attach(targetId) {
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      return session(sessionId);
    },
    async targets() {
      return (await send('Target.getTargets')).targetInfos;
    },
  };
}

/* ---------- Checks ---------- */

function snapshot(dir) {
  const out = new Map();
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      if (fs.statSync(p).isFile() && !/\.(aria2|crdownload|tmp|part)$/i.test(name)) out.set(name, sha(fs.readFileSync(p)));
    } catch {
      // renamed or removed while listing (a download finishing); picked up next pass
    }
  }
  return out;
}

async function settle(dirs, quietMs, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let last = '';
  let stableSince = Date.now();
  while (Date.now() < until) {
    const pendingParts = dirs.some((d) => fs.readdirSync(d).some((n) => /\.(aria2|crdownload|tmp)$/i.test(n)));
    const state = dirs.map((d) => [...snapshot(d).entries()].map((e) => e.join(':')).join('|')).join('#');
    if (state !== last || pendingParts) {
      last = state;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > quietMs) {
      return;
    }
    await wait(700);
  }
}

async function main() {
  log(`work folder ${WORK}`);
  makeFixtures();
  const site = await startSite();
  const app = startLumina();
  await waitFor(async () => (await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/hello`, { headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } })).ok, 60_000, 'Lumina bridge');
  log('Lumina is up');

  const { child: browser, cdp } = startBrowser();
  const version = await waitFor(() => cdp.send('Browser.getVersion'), 30_000, 'browser');
  log(`browser: ${version.product}`);
  const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
  const sw = await waitFor(async () => (await cdp.targets()).find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extId}/background.js`), 40_000, 'extension service worker');
  log(`extension loaded: ${sw.url}`);
  const worker = await cdp.attach(sw.targetId);
  await worker.eval(`lumina.setConfig({ port: ${BRIDGE_PORT} })`);
  await worker.eval('lumina.pair()');
  const status = await worker.eval('lumina.hello()');
  log(`paired: ${status.paired}, capture: ${status.captureDownloads}`);
  if (!status.paired) {
    const raw = await worker.eval(`lumina.getConfig().then(async (c) => { try { const r = await fetch('http://127.0.0.1:${BRIDGE_PORT}/v1/hello', { headers: c.token ? { Authorization: 'Bearer ' + c.token } : {} }); return { port: c.port, hasToken: !!c.token, status: r.status, body: await r.text() }; } catch (e) { return { port: c.port, hasToken: !!c.token, error: String(e) }; } })`);
    log('debug:', JSON.stringify(raw));
    throw new Error('Pairing failed');
  }

  const { targetId } = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${SITE_PORT}/` });
  const tab = await cdp.attach(targetId);
  await waitFor(() => tab.eval("document.readyState === 'complete' && !!document.getElementById('t0')"), 20_000, 'test page');

  if (args.includes('--no-capture')) await worker.eval('lumina.setConfig({ captureDownloads: false })');
  log('cookies visible to the extension:', JSON.stringify(await worker.eval(`lumina.cookiesFor('http://127.0.0.1:${SITE_PORT}/auth/secret.zip')`)));
  const click = (id) => tab.eval(`document.getElementById(${JSON.stringify(id)}).click(), true`);
  if (args.includes('--only')) {
    // Debug helper: click just these ids, then print the trail and both folders.
    for (const id of args[args.indexOf('--only') + 1].split(',')) {
      await click(id);
      await wait(3000);
    }
    log('trail', JSON.stringify(await worker.eval('lumina.events'), null, 1));
    log('downloads', JSON.stringify(await worker.eval('chrome.downloads.search({})')));
    log('lumina folder', fs.readdirSync(DIRS.lumina), 'browser folder', fs.readdirSync(DIRS.browser));
    await cdp.send('Browser.close').catch(() => undefined);
    spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(WORK)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
    process.exit(0);
  }
  const ids = [...TYPE_FILES.map((_, i) => `t${i}`), 'disposition', 'redirect', 'auth', 'referer', 'once', 'big', 'dup'];
  for (const id of ids) {
    await click(id);
    await wait(900);
  }
  if (args.includes('--burst-control')) {
    // Control experiment: same burst with capture off, to see what the browser does on its own.
    await worker.eval('lumina.setConfig({ captureDownloads: false })');
    await Promise.all(Array.from({ length: 20 }, (_, i) => click(`burst${i + 1}`)));
    await wait(8000);
    const got = fs.readdirSync(DIRS.browser).filter((n) => /^burst-/.test(n)).length;
    log(`CONTROL: browser alone saved ${got}/20 burst files`);
    await worker.eval('lumina.setConfig({ captureDownloads: true })');
    for (const n of fs.readdirSync(DIRS.browser)) fs.rmSync(path.join(DIRS.browser, n), { force: true });
    await tab.eval('location.reload(), true');
    await wait(3000);
  }
  await click('blob');
  await wait(1500);
  log('clicked single downloads; firing a burst of 20 at once');
  // Twenty clicks as fast as possible. Chrome itself lets only part of such a burst through (see --burst-control).
  await Promise.all(Array.from({ length: 20 }, (_, i) => click(`burst${i + 1}`)));
  await wait(1500);
  await tab.eval("document.getElementById('post').submit(), true");

  await settle([DIRS.lumina, DIRS.browser], 8000, 180_000);
  const trail = await worker.eval('lumina.events');
  const browserState = await tab.eval('true').then(() => worker.eval("chrome.downloads.search({}).then((list) => list.map((d) => ({ id: d.id, url: d.url.slice(-40), state: d.state, paused: d.paused, error: d.error })))"));

  // Lumina stopped: downloads must go straight to the browser.
  log('stopping Lumina to check the browser keeps working on its own');
  app.kill();
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F']);
  await wait(3000);
  await tab.eval("(() => { const a = document.createElement('a'); a.href = '/files/notes.txt'; a.download = 'offline-notes.txt'; document.body.append(a); a.click(); return true; })()");
  await wait(6000);

  const lumina = snapshot(DIRS.lumina);
  const browserFiles = snapshot(DIRS.browser);
  const fixture = (name) => sha(fs.readFileSync(path.join(DIRS.fixtures, name)));
  const rows = [];
  const expect = (label, ok, detail = '') => rows.push({ label, ok, detail });
  const inLumina = (name, src = name) => lumina.get(name) === fixture(src);
  const inBrowser = (name, src = name) => browserFiles.get(name) === fixture(src);

  for (const name of TYPE_FILES) expect(`${name} → Lumina, identical`, inLumina(name), browserFiles.has(name) ? 'also in browser folder' : '');
  expect('Content-Disposition name kept', inLumina('Quarterly report 2026.pdf', 'manual.pdf'));
  expect('Redirect followed', [...lumina.values()].includes(fixture('archive.7z')));
  expect('Login cookie forwarded', inLumina('secret.zip', 'archive.zip'));
  expect('Referer forwarded', inLumina('need.bin', 'game-data.bin'));
  expect('One-time link finished by the browser', inBrowser('token.bin', 'setup.exe') || inLumina('token.bin', 'setup.exe'), inBrowser('token.bin', 'setup.exe') ? 'browser' : 'Lumina');
  expect('60 MB file → Lumina, identical', inLumina('big-video.mp4'));
  const bigRanges = requests.filter((r) => r.path === '/files/big-video.mp4' && r.range).length;
  expect('60 MB file used multiple connections', bigRanges > 1, `${bigRanges} ranged requests`);
  expect('Duplicate name → "archive (1).zip"', inLumina('archive (1).zip', 'archive.zip'));
  let burst = 0;
  for (let i = 1; i <= 20; i++) if (inLumina(`burst-${String(i).padStart(2, '0')}.png`)) burst++;
  const burstStarted = new Set(trail.filter((e) => e.step === 'seen' && /burst-\d+\.png/.test(e.url ?? '')).map((e) => e.url)).size;
  expect('Burst: every download the browser started reached Lumina', burst === burstStarted && burst >= 10, `${burst} in Lumina, browser started ${burstStarted}/20`);
  expect('Page-generated (blob) file left to browser', browserFiles.has('generated.txt'));
  expect('Form POST download left to browser', inBrowser('export.csv', 'data.csv'));
  expect('Browser works normally when Lumina is closed', browserFiles.has('offline-notes.txt'));
  const duplicates = [...browserFiles.keys()].filter((n) => lumina.has(n) && !['token.bin'].includes(n));
  expect('No file downloaded twice', duplicates.length === 0, duplicates.join(', '));
  const leftovers = [DIRS.lumina, DIRS.browser].flatMap((d) => fs.readdirSync(d).filter((n) => /\.(aria2|crdownload)$/i.test(n)));
  expect('No stuck partial files', leftovers.length === 0, leftovers.join(', '));

  const pass = rows.filter((r) => r.ok).length;
  if (pass !== rows.length || args.includes('--trace')) {
    console.log('\nExtension trail:');
    for (const e of trail) console.log(`  #${e.id} ${e.step.padEnd(10)} ${e.url?.replace(`http://127.0.0.1:${SITE_PORT}`, '')} ${e.detail}`);
    console.log('\nBrowser download list:');
    for (const d of browserState) console.log(`  #${d.id} ${d.state}${d.paused ? ' (paused)' : ''} ${d.error ?? ''} ${d.url}`);
    console.log('\nRequests to the test site:', requests.length);
    for (const r of requests.filter((x) => /song\.mp3|archive\.zip/.test(x.path))) console.log(`  ${r.method} ${r.path} range=${r.range} ifRange=${r.ifRange} -> ${r.status}${r.aborted ? ' (aborted)' : ''}`);
  }
  for (const r of rows) console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
  console.log(`\n${browserName}: ${pass}/${rows.length} checks passed`);
  const extraBrowser = [...browserFiles.keys()].filter((n) => !['generated.txt', 'export.csv', 'offline-notes.txt', 'token.bin'].includes(n));
  if (extraBrowser.length) console.log(`Unexpected files in the browser folder: ${extraBrowser.join(', ')}`);

  await cdp.send('Browser.close').catch(() => undefined);
  browser.kill();
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F']);
  site.close();
  if (!args.includes('--keep')) setTimeout(() => fs.rmSync(WORK, { recursive: true, force: true }), 3000);
  setTimeout(() => process.exit(pass === rows.length ? 0 : 1), 3500);
}

main().catch((err) => {
  console.error(`[e2e:${browserName}] ERROR`, err);
  // Clean up only processes that belong to this test's own work folder.
  if (process.platform === 'win32') {
    spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(WORK)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  }
  process.exit(2);
});
