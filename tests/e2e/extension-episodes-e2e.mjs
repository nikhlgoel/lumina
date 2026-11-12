#!/usr/bin/env node
// End-to-end test of sending a whole series: a real (headless) Chrome, the real extension, a replica of a streaming site, and a stub bridge.
//
//   node tests/e2e/extension-episodes-e2e.mjs
//
// The replica site is built like a series page that is still being filled in: twelve episodes are listed, six have a video, and the player
// of some of them only starts when it is clicked or sits in an iframe. Nothing is downloaded; the "videos" are tiny playlists that are never
// fetched by anything but the page's own script. Headless, with a throwaway profile in the OS temp folder.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE_PORT = 8772;
const BRIDGE_PORT = 17997;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-episodes-e2e-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/* ---------- The replica site ---------- */

// Episodes 1-3 play by themselves, 4-5 only when the play button is pressed, 6 inside an iframe. 7-12 are listed and have nothing behind them.
const WITH_VIDEO = new Set([1, 2, 3, 4, 5, 6]);
const NEEDS_CLICK = new Set([4, 5]);
const IN_FRAME = new Set([6]);
const pageHits = [];

const player = (n) => `<video id="v" width="320" height="180" muted></video><button class="play" id="play">Play</button>
<script>
  const start = () => fetch('/hls/e${n}/master.m3u8').then((r) => r.text()).then(() => { document.title += ' [playing]'; });
  ${NEEDS_CLICK.has(n) ? "document.getElementById('play').onclick = start;" : 'setTimeout(start, 400);'}
</script>`;

const sidebar = (rows) => `<nav id="side">${rows}</nav>`;
const linkRows = () => Array.from({ length: 12 }, (_, i) => `<a class="ep" href="/watch/tv/258764?s=1&e=${i + 1}&server=vidy">Ep ${i + 1} <span>▶</span> Episode ${i + 1}</a>`).join('');
const divRows = () => Array.from({ length: 5 }, (_, i) => `<div class="ep" role="button" onclick="location.href='/watch/rows/258765?s=1&e=${i + 1}'">Ep ${i + 1}</div>`).join('');
const chrome = '<header><a href="/">Home</a> <a href="/movies">Movies</a> <a href="/tv">TV Shows</a></header>';
const servers = ['vidy', 'bingr', 'core'].map((s) => `<a href="/watch/tv/258764?s=1&e=3&server=${s}">${s}</a>`).join(' ');

/** Pages that try the page scripts: enormous, malformed, adversarial, or never still. None of them may throw or hang the extension. */
function hostile(kind) {
  const shell = (title, body) => `<!doctype html><meta charset="utf-8">${title === null ? '' : `<title>${title}</title>`}${body}`;
  switch (kind) {
    case 'many-links':
      // 100,000 links, and a real episode list in the middle of them
      return shell('Huge', `<main>${Array.from({ length: 100000 }, (_, i) => `<a href="/p/${i}">Link ${i}</a>`).join('')}${Array.from({ length: 6 }, (_, i) => `<a href="/hostile/many-links?s=1&e=${i + 1}">Ep ${i + 1}</a>`).join('')}</main>`);
    case 'bad-urls': {
      const bad = ['http://[::1', 'https://', 'http://exa mple.com/x', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'mailto:a@b.c', '//', 'http://%00/', 'https://example.com/' + 'a'.repeat(100000), 'http://‮evil.example/‭', 'ftp://x/y', 'blob:null/1', 'magnet:?xt=urn:btih:' + 'a'.repeat(40) + '&dn=' + 'b'.repeat(50000), 'https://example.com/%E0%A4%A', 'about:blank'];
      return shell('Bad addresses', `<main>${bad.map((b, i) => `<a href="${b.replace(/"/g, '&quot;')}">Link ${i}</a>`).join(' ')}<p>${'text '.repeat(2000)}</p></main>`);
    }
    case 'json-bomb': {
      const list = JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ direct_link: `https://pixeldrain.com/u/p${i}`, file_name: `F${i}.rar`, is_dangerous: false })));
      const nested = '['.repeat(2000) + ']'.repeat(2000);
      const proto = JSON.stringify([{ '__proto__': { polluted: true }, direct_link: 'https://pixeldrain.com/u/x', file_name: 'X.rar' }, { constructor: { prototype: { polluted: true } }, url: 'https://gofile.io/d/y' }]);
      return shell('JSON', `<main><div data-links='${list}'>a</div><div data-x='${nested}'>b</div><div data-y='${proto}'>c</div><div data-z='[{"direct_link": 5, "file_name": {"a": 1}}, null, 7, "x", [], {"url": "javascript:alert(1)"}]'>d</div></main>`);
    }
    case 'frames':
      return shell('Frames', '<iframe sandbox src="/hostile/many-links" width="300" height="100"></iframe><iframe src="/hostile/bad-urls"></iframe><iframe srcdoc="<iframe srcdoc=&quot;<a href=https://pixeldrain.com/u/a>F.rar</a>&quot;></iframe>"></iframe>');
    case 'shadow':
      return shell('Shadow', `<main><div id="h"></div><script>const r = document.getElementById('h').attachShadow({ mode: 'closed' }); r.innerHTML = '<a href="https://pixeldrain.com/u/s1">S1.rar</a><a href="/watch/tv/9?s=1&e=1">Ep 1</a>';</script><a href="https://pixeldrain.com/u/visible">Visible.rar</a></main>`);
    case 'no-title':
      return shell(null, '<main><a href="https://pixeldrain.com/u/a">A.rar</a></main>');
    case 'long-title':
      return shell('T'.repeat(20000) + ' | Site', Array.from({ length: 6 }, (_, i) => `<a href="/watch/tv/9?s=1&e=${i + 1}">Ep ${i + 1}</a>`).join(' '));
    case 'storm':
      // The page keeps changing under the reader: links added and removed several times a frame
      return shell('Storm', `<main id="m"></main><script>let n = 0; setInterval(() => { const m = document.getElementById('m'); for (let i = 0; i < 200; i++) { const a = document.createElement('a'); a.href = '/watch/tv/9?s=1&e=' + ((n++ % 40) + 1); a.textContent = 'Ep ' + (n % 40 + 1); m.append(a); } while (m.children.length > 800) m.firstChild.remove(); }, 5);</script>`);
    case 'deep':
      return shell('Deep', '<div>'.repeat(5000) + '<a href="https://pixeldrain.com/u/deep">Deep.rar</a>' + '</div>'.repeat(5000));
    case 'rtl-emoji':
      return shell('\u202Eevil\u202C \u{1F600}'.repeat(50), Array.from({ length: 5 }, (_, i) => `<a href="/watch/tv/9?s=1&e=${i + 1}">\u202E Ep ${i + 1} \u{1F680}\u200B\u0000</a>`).join(''));
    default:
      return shell('Unknown', '<p>nothing</p>');
  }
}

function page(url) {
  const u = new URL(url, 'http://x');
  const e = Number(u.searchParams.get('e') ?? 1);
  if (u.pathname === '/watch/tv/258764') {
    const body = IN_FRAME.has(e) ? `<iframe src="/player/${e}" width="330" height="200"></iframe>` : WITH_VIDEO.has(e) ? player(e) : '<p>This episode is not available yet.</p>';
    return `<!doctype html><meta charset="utf-8"><title>The Divorce Insurance | Replica</title>${chrome}<main>${body}<div id="servers">${servers}</div></main>${sidebar(linkRows())}`;
  }
  if (u.pathname === '/watch/rows/258765') {
    return `<!doctype html><meta charset="utf-8"><title>Mary Berry Love | Replica</title>${chrome}<main>${e <= 3 ? player(e) : '<p>Nothing here yet.</p>'}</main>${sidebar(divRows())}`;
  }
  if (u.pathname === '/heavy') {
    const divs = Array.from({ length: 30000 }, (_, i) => `<div class="c"><span>${i}</span> item</div>`).join('');
    const links = Array.from({ length: 6000 }, (_, i) => `<a href="/post/${i + 100000}">Post ${i}</a>`).join(' ');
    return `<!doctype html><meta charset="utf-8"><title>A very big page</title>${chrome}<main>${links}${divs}</main>`;
  }
  if (u.pathname.startsWith('/hostile/')) return hostile(u.pathname.slice('/hostile/'.length));
  if (u.pathname.startsWith('/player/')) return `<!doctype html><meta charset="utf-8">${player(Number(u.pathname.split('/')[2]))}`;
  return `<!doctype html><meta charset="utf-8"><title>Just a page</title>${chrome}<p>Nothing to list.</p>`;
}

const site = http.createServer((req, res) => {
  const path_ = req.url.split('?')[0];
  if (path_.startsWith('/hls/')) {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    return res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n');
  }
  pageHits.push(req.url);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page(req.url));
});

const received = [];
const bridge = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Lumina-Client', 'Access-Control-Allow-Methods': 'GET, POST' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (status, value) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/v1/hello') return json(200, { app: 'Lumina', version: 'stub', paired: true, batch: true, episodes: true, captureDownloads: false, minCaptureSizeMb: 0, skipExtensions: [], skipSites: [] });
    if (req.url === '/v1/pair') return json(200, { token: 'a'.repeat(64) });
    const parsed = body ? JSON.parse(body) : {};
    received.push({ path: req.url, body: parsed });
    return json(202, { accepted: true, count: parsed.items?.length ?? 1 });
  });
});

/* ---------- DevTools protocol over a pipe ---------- */

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
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const send = (method, params = {}, sessionId) => {
    const myId = ++id;
    out.write(`${JSON.stringify({ id: myId, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    return new Promise((resolve, reject) => pending.set(myId, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result))));
  };
  return {
    send,
    async attach(targetId) {
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      return {
        send: (method, params) => send(method, params, sessionId),
        async eval(expression) {
          const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          return r.result?.value;
        },
      };
    },
    targets: async () => (await send('Target.getTargets')).targetInfos,
  };
}

async function waitFor(check_, timeoutMs, label) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { const v = await check_(); if (v) return v; } catch { /* not ready */ }
    await wait(300);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));
  await new Promise((r) => bridge.listen(BRIDGE_PORT, '127.0.0.1', r));

  const profile = path.join(WORK, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const browser = spawn(CHROME, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = pipeCdp(browser);

  try {
    await waitFor(() => cdp.send('Browser.getVersion'), 30_000, 'browser');
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const sw = await waitFor(async () => (await cdp.targets()).find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extId}/background.js`), 40_000, 'extension service worker');
    const worker = await cdp.attach(sw.targetId);
    await waitFor(() => worker.eval("typeof lumina !== 'undefined'"), 15_000, 'the extension script to finish loading');
    await worker.eval(`lumina.setConfig({ port: ${BRIDGE_PORT} })`);
    await worker.eval('lumina.pair()');
    check('the extension pairs with the (stub) bridge', (await worker.eval('lumina.hello()')).paired === true);

    const base = `http://127.0.0.1:${SITE_PORT}`;
    const open = async (route) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: `${base}${route}` });
      const t = await cdp.attach(targetId);
      await waitFor(() => t.eval("document.readyState === 'complete'"), 20_000, `page ${route}`);
      const id = await waitFor(() => worker.eval(`chrome.tabs.query({ url: '${base}${route.split('?')[0]}*' }).then((x) => x[0]?.id ?? null)`), 10_000, 'tab id');
      return { t, id, targetId };
    };
    const tabCount = () => worker.eval('chrome.tabs.query({}).then((t) => t.length)');

    /* ---------- the series page: twelve listed, six with a video ---------- */
    const series = await open('/watch/tv/258764?s=1&e=3&server=vidy');
    await wait(1500); // episode 3 plays by itself; the tab has seen its stream
    const list = await worker.eval(`lumina.episodesIn(${series.id})`);
    check('the sidebar list is read: twelve episodes in order', list?.episodes?.length === 12 && list.episodes.map((e) => e.number).join() === '1,2,3,4,5,6,7,8,9,10,11,12', list ? `${list.episodes.length}` : 'null');
    check('the show is named without the site', list?.show === 'The Divorce Insurance', list?.show);
    check('the episode being watched is marked', list?.episodes.filter((e) => e.current).map((e) => e.number).join() === '3');
    check('the server buttons and the menu are not taken for episodes', !list?.episodes.some((e) => /server=|\/movies|\/tv$/.test(e.url) && !/e=\d+/.test(e.url)));

    const tabsBefore = await tabCount();
    pageHits.length = 0;
    await worker.eval(`lumina.startEpisodeProbe({ tabId: ${series.id}, show: ${JSON.stringify(list.show)}, episodes: ${JSON.stringify(list.episodes)} })`);
    const done = await waitFor(async () => { const s = await worker.eval(`lumina.episodeSnapshot(${series.id})`); return s && !s.running && s.items.every((i) => i.status !== 'waiting' && i.status !== 'checking') ? s : null; }, 240_000, 'the check to finish');
    const status = done.items.map((i) => i.status);
    check('the six episodes with a video are found, including the one that needs a click and the one in an iframe', status.slice(0, 6).every((s) => s === 'found'), status.join());
    check('the six that are listed but empty are reported as having no video', status.slice(6).every((s) => s === 'none'), status.join());
    check('the episode already being watched was not opened a second time', pageHits.filter((u) => u.includes('e=3')).length === 0, pageHits.filter((u) => u.includes('e=3')).join(' '));
    check('every other episode page was opened exactly once', [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12].every((n) => pageHits.filter((u) => u.startsWith('/watch/tv/258764') && u.includes(`e=${n}&`)).length === 1), pageHits.join(' '));
    await wait(500);
    check('no probe tab is left open afterwards', (await tabCount()) === tabsBefore, `${tabsBefore} before, ${await tabCount()} after`);

    received.length = 0;
    const sent = await worker.eval(`lumina.sendEpisodes({ tabId: ${series.id}, show: 'The Divorce Insurance' })`);
    const msg = received.find((r) => r.path === '/v1/capture-episodes');
    check('sending goes to the bridge as one series', sent?.accepted === true && Boolean(msg), JSON.stringify(sent));
    check('only the six with a video are sent', msg?.body.items.length === 6 && msg.body.items.map((i) => i.number).join() === '1,2,3,4,5,6', msg?.body.items.map((i) => i.number).join());
    check('each carries the address of its own video', msg?.body.items.every((i) => i.url === `${base}/hls/e${i.number}/master.m3u8` && i.kind === 'stream'), msg?.body.items.map((i) => i.url.split('/').slice(-2).join('/')).join());
    check('and the page it was found on, and a Referer for it', msg?.body.items.every((i) => i.pageUrl.includes(`e=${i.number}`) && /127\.0\.0\.1/.test(i.headers.Referer ?? '')), JSON.stringify(msg?.body.items[0]?.headers));
    check('the show name is sent', msg?.body.show === 'The Divorce Insurance');

    /* ticking only some */
    received.length = 0;
    await worker.eval(`lumina.sendEpisodes({ tabId: ${series.id}, show: 'X', keys: ['0', '1', '9'] })`);
    check('only the ticked episodes are sent, and an empty one cannot be sent even if ticked', received.find((r) => r.path === '/v1/capture-episodes')?.body.items.map((i) => i.number).join() === '1,2');

    /* the popup */
    const popup = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` }).then((t) => cdp.attach(t.targetId));
    await wait(1500);
    await popup.eval(`chrome.tabs.query = async () => [{ id: ${series.id}, url: '${base}/watch/tv/258764?s=1&e=3&server=vidy', title: 'The Divorce Insurance | Replica' }]; __renderPopup().then(() => 0)`);
    await popup.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 2, mobile: false });
    await waitFor(() => popup.eval("document.querySelectorAll('#episodes li').length === 12"), 10_000, 'the popup episode list');
    check('the popup lists all twelve episodes', true);
    check('and shows the check already done, with six found and six not', (await popup.eval("[...document.querySelectorAll('#episodes li')].map((li) => li.dataset.status).join()")) === 'found,found,found,found,found,found,none,none,none,none,none,none');
    check('the empty ones cannot be ticked', (await popup.eval("[...document.querySelectorAll('#episodes input')].slice(6).every((i) => i.disabled)")) === true);
    check('the count says six of twelve have a video', (await popup.eval("document.getElementById('eps-count').textContent")) === '6 of 12 have a video', await popup.eval("document.getElementById('eps-count').textContent"));
    const shot = await popup.send('Page.captureScreenshot', { format: 'png' });
    if (process.env.SHOT_DIR) fs.writeFileSync(path.join(process.env.SHOT_DIR, 'popup-episodes.png'), Buffer.from(shot.data, 'base64'));

    /* a fresh popup, a fresh check, started from the button */
    await worker.eval(`chrome.storage.session.remove('episodes:${series.id}')`);
    check('(the memory of the check is cleared for the next part)', true);

    await series.t.send('Page.close').catch(() => undefined);

    /* ---------- rows that are not links ---------- */
    const rows = await open('/watch/rows/258765?s=1&e=2');
    await wait(1200);
    const synthetic = await worker.eval(`lumina.episodesIn(${rows.id})`);
    check('rows without links are listed too, from the address of the page', synthetic?.synthetic === true && synthetic.episodes.length === 5, synthetic ? `${synthetic.episodes.length}` : 'null');
    check('each row gets its own address', synthetic?.episodes.every((e) => e.url === `${base}/watch/rows/258765?s=1&e=${e.number}`));
    await worker.eval(`lumina.startEpisodeProbe({ tabId: ${rows.id}, show: 'Mary Berry Love', episodes: ${JSON.stringify(synthetic.episodes)} })`);
    const done2 = await waitFor(async () => { const s = await worker.eval(`lumina.episodeSnapshot(${rows.id})`); return s && !s.running && s.items.every((i) => i.status !== 'waiting' && i.status !== 'checking') ? s : null; }, 120_000, 'the second check');
    check('three of five have a video, the other two are shown as empty', done2.items.map((i) => i.status).join() === 'found,found,found,none,none', done2.items.map((i) => i.status).join());

    /* ---------- a page that changes episode without reloading ---------- */
    // A single-page site: episode 3 played (the tab saw its stream), then the page moved on to episode 5 with no reload. What the tab saw belongs to episode 3,
    // so episode 5 must be opened and checked like any other, not given episode 3's stream.
    const spa = await open('/watch/tv/258764?s=1&e=3&server=vidy');
    await wait(1500);
    await spa.t.eval("history.pushState({}, '', '/watch/tv/258764?s=1&e=5&server=vidy'); document.title = document.title; 0");
    await wait(300);
    const spaList = await worker.eval(`lumina.episodesIn(${spa.id})`);
    check('after the page moves to another episode the new one is marked as current', spaList?.episodes.filter((e) => e.current).map((e) => e.number).join() === '5', spaList?.episodes.filter((e) => e.current).map((e) => e.number).join());
    pageHits.length = 0;
    await worker.eval(`lumina.startEpisodeProbe({ tabId: ${spa.id}, show: 'The Divorce Insurance', episodes: ${JSON.stringify(spaList.episodes.filter((e) => [4, 5].includes(e.number)))} })`);
    const spaDone = await waitFor(async () => { const s = await worker.eval(`lumina.episodeSnapshot(${spa.id})`); return s && !s.running && s.items.every((i) => i.status !== 'waiting' && i.status !== 'checking') ? s : null; }, 120_000, 'the single-page check');
    check('the episode it moved to is opened and checked itself, not given the earlier stream', pageHits.some((u) => u.includes('e=5&')) && spaDone.items.every((i) => i.status === 'found'), pageHits.join(' '));

    /* ---------- a very heavy page ---------- */
    const heavy = await open('/heavy');
    const t0 = Date.now();
    const heavyList = await worker.eval(`lumina.episodesIn(${heavy.id})`);
    const took = Date.now() - t0;
    check('a page of 36,000 elements is answered quickly, with no list', heavyList === null && took < 3000, `${took} ms`);

    /* ---------- hostile pages: every one is answered, in time, with a sensible shape ---------- */
    const hostileKinds = ['many-links', 'bad-urls', 'json-bomb', 'frames', 'shadow', 'no-title', 'long-title', 'storm', 'deep', 'rtl-emoji'];
    for (const kind of hostileKinds) {
      const pg = await open(`/hostile/${kind}`);
      const started = Date.now();
      let links;
      let episodes;
      let failure = '';
      try {
        links = await worker.eval(`lumina.linksIn(${pg.id}, false)`);
        episodes = await worker.eval(`lumina.episodesIn(${pg.id})`);
      } catch (err) {
        failure = String(err.message).slice(0, 120);
      }
      const took = Date.now() - started;
      const shapeOk = Array.isArray(links) && links.length <= 500 && links.every((l) => typeof l.url === 'string' && /^(https?:|magnet:)/i.test(l.url)) && (episodes === null || (Array.isArray(episodes?.episodes) && episodes.episodes.length >= 2 && episodes.episodes.length <= 300));
      check(`hostile page "${kind}": answered without an error, in time, with a sane shape`, !failure && shapeOk && took < 15000, failure || `${took} ms, ${links?.length} links, ${episodes ? episodes.episodes.length + ' episodes' : 'no list'}`);
      await cdp.send('Target.closeTarget', { targetId: pg.targetId }).catch(() => undefined);
    }
    {
      const pg = await open('/hostile/many-links?s=1&e=2');
      const t0 = Date.now();
      const e = await worker.eval(`lumina.episodesIn(${pg.id})`);
      const took = Date.now() - t0;
      check('a real episode list far down a page of 100,000 other links is still found, quickly', e?.episodes?.length === 6 && took < 4000, `${e?.episodes?.length} episodes, ${took} ms`);
      await cdp.send('Target.closeTarget', { targetId: pg.targetId }).catch(() => undefined);
    }

    /* ---------- a page with no list ---------- */
    const plain = await open('/plain');
    check('a page with no episode list offers none', (await worker.eval(`lumina.episodesIn(${plain.id})`)) === null);

    const passed = results.filter(Boolean).length;
    console.log(`${passed} of ${results.length} checks passed`);
    if (passed !== results.length) process.exitCode = 1;
  } finally {
    browser.kill();
    site.close();
    bridge.close();
    await wait(800);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* Chrome may still hold a file; it is in the OS temp folder */ }
  }
}

main().catch((err) => {
  console.error('FAIL  e2e crashed:', err.message);
  process.exit(1);
});
