#!/usr/bin/env node
// End-to-end test of sending several links at once: a real (headless) Chrome, the real extension, a fixture page and a stub bridge.
//
//   node tests/e2e/extension-links-e2e.mjs
//
// Headless, with a throwaway profile in the OS temp folder: no window opens and no real profile is touched. The bridge here is a stub that
// records what the extension sends; the real bridge is covered by tests/bridgeBatch.test.ts. The links on the fixture page point at host names
// that are never contacted (the extension only reads them).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE_PORT = 8771;
const BRIDGE_PORT = 17998;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-links-e2e-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/* ---------- The fixture page and the stub bridge ---------- */

const PAGE = `<!doctype html><meta charset="utf-8"><title>Sample release post</title>
<h1>Sample release post</h1>
<p id="mirrors">Mirror:
  <a id="a1" href="https://fuckingfast.co/aaa#Sample.part1.rar">Part 1</a>
  <a id="a2" href="https://fuckingfast.co/bbb#Sample.part2.rar">Part 2</a>
  <a id="a3" href="https://fuckingfast.co/ccc#Sample.part3.rar">Part 3</a>
  <a id="home" href="https://example.org/home">Home</a>
</p>
<p id="extra"><a id="a4" href="https://datanodes.to/zzz/Sample.Extras.rar">Optional extras</a></p>
<p id="plain"><a href="https://example.org/about">About</a></p>`;

// Pages for the edge cases: a strict content-security-policy, 600 links, links written as text, and a post inside an iframe.
const doc = (body) => `<!doctype html><meta charset="utf-8"><title>Edge case</title>${body}`;
const PAGES = {
  '/csp': { csp: "default-src 'none'; style-src 'none'; script-src 'none'; img-src 'none'", html: PAGE },
  '/many': { html: doc(`<p id="all">${Array.from({ length: 600 }, (_, i) => `<a href="https://datanodes.to/m${i}/Pack.part${String(i + 1).padStart(3, '0')}.rar">p${i}</a>`).join(' ')}</p>`) },
  '/text': { html: doc('<pre id="t">Part 1: https://rapidgator.net/file/aa/Sample.part1.rar\nPart 2: https://rapidgator.net/file/bb/Sample.part2.rar\nPart 3: https://rapidgator.net/file/cc/Sample.part3.rar</pre>') },
  '/frame': { html: doc('<iframe id="f" src="/frame-inner" width="700" height="260"></iframe>') },
  '/frame-inner': { html: PAGE },
  // Shaped like a release page with one tab per mirror: every row's button only says "DOWNLOAD", the file name is in the row, a mirror's
  // buttons are not links at all (a data attribute, a click handler), and one mirror is a host Lumina has never heard of.
  // Shaped like a hoster page: only the first host's links are drawn; every host's list also sits as JSON in a data attribute that script swaps in.
  // One host is flagged dangerous by the page itself and must never be offered.
  '/hoster': { html: doc(`<h1>Release</h1>${(() => {
    const list = (host, danger) => JSON.stringify([1, 2, 3].map((n) => ({ direct_link: `https://${host}/u/p${n}`, file_name: `Sample.part0${n}.rar`, is_dangerous: danger })));
    return `<div id="opts"><div class="option" data-links='${list('fileditchfiles.example', false)}'>FileDitch</div><div class="option" data-links='${list('pixeldrain.com', false)}'>Pixeldrain</div>`
      + `<div class="option" data-links='${list('gofile.io', false)}'>Gofile</div><div class="option" data-links='${list('risky-host.example', true)}'>Risky</div></div>`;
  })()}<div id="files">${[1, 2, 3].map((n) => `<p>Sample.part0${n}.rar <a class="downloadBtn" href="https://fileditchfiles.example/u/p${n}">Download</a></p>`).join('')}</div>`) },
  '/mirrors': { html: doc(`<h1>Release</h1>
<div id="tabs">FileDitch | Pixeldrain | Gofile | Other</div>
<table id="fd">${[1, 2, 3].map((n) => `<tr><td>Release.part0${n}.rar</td><td><a class="btn" href="https://fileditchfiles.example/s${n}/f${n}">DOWNLOAD</a></td></tr>`).join('')}</table>
<table id="pd">${[1, 2, 3].map((n) => `<tr><td>Release.part0${n}.rar</td><td><a class="btn" href="https://pixeldrain.com/u/pd${n}">DOWNLOAD</a></td></tr>`).join('')}</table>
<table id="gf">${[1, 2, 3].map((n) => `<tr><td>Release.part0${n}.rar</td><td><button data-href="https://gofile.io/d/gf${n}">Download</button></td></tr>`).join('')}</table>
<table id="ot"><tr><td>Release.part01.rar</td><td><button onclick="window.open('https://unknown-mirror.example/get/x1')">Download</button></td></tr></table>
<p><a href="https://example.org/about">About us</a></p>`) },
};

const site = http.createServer((req, res) => {
  const page = PAGES[req.url.split('?')[0]];
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    ...(page?.csp ? { 'Content-Security-Policy': page.csp } : {}),
    // A bot-check cookie and an ordinary one: only the ordinary one may ever reach Lumina.
    'Set-Cookie': ['cf_clearance=SECRET-CLEARANCE; Path=/', 'file_code=abc; Path=/'],
  });
  res.end(page?.html ?? PAGE);
});

const received = [];
let batchSupported = true;
const bridge = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Lumina-Client', 'Access-Control-Allow-Methods': 'GET, POST', Vary: 'Origin' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (status, value) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/v1/hello') return json(200, { app: 'Lumina', version: 'stub', paired: true, batch: true, captureDownloads: false, minCaptureSizeMb: 0, skipExtensions: [], skipSites: [] });
    if (req.url === '/v1/pair') return json(200, { token: 'a'.repeat(64) });
    // What an older Lumina does with a request it does not know.
    if (req.url === '/v1/capture-batch' && !batchSupported) return json(404, { error: 'Not found' });
    const parsed = body ? JSON.parse(body) : {};
    received.push({ path: req.url, body: parsed, bytes: Buffer.byteLength(body) });
    return json(202, { accepted: true, count: parsed.urls?.length ?? 1 });
  });
});

/* ---------- DevTools protocol over a pipe (same approach as extension-e2e.mjs) ---------- */

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

async function waitFor(check, timeoutMs, label) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { const v = await check(); if (v) return v; } catch { /* not ready */ }
    await wait(300);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Find a text node (also inside a closed shadow root) whose text is `text`. */
function findText(node, text) {
  if (node.nodeType === 3 && node.nodeValue?.trim() === text) return node;
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])]) {
    const hit = findText(child, text);
    if (hit) return hit;
  }
  return null;
}
/** Like findText, but returns the element around the text too (the button), so its size on screen can be measured. */
function findWithParent(node, text, parent = null) {
  if (node.nodeType === 3 && node.nodeValue?.trim() === text) return { node, parent };
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])]) {
    const hit = findWithParent(child, text, node);
    if (hit) return hit;
  }
  return null;
}
const containsPrefix = (node, prefix) => {
  if (node.nodeType === 3 && node.nodeValue?.trim().startsWith(prefix)) return node.nodeValue.trim();
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const hit = containsPrefix(child, prefix);
    if (hit) return hit;
  }
  return null;
};

async function main() {
  await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));
  await new Promise((r) => bridge.listen(BRIDGE_PORT, '127.0.0.1', r));

  const profile = path.join(WORK, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const browser = spawn(CHROME, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = pipeCdp(browser);

  try {
    await waitFor(() => cdp.send('Browser.getVersion'), 30_000, 'browser');
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const sw = await waitFor(async () => (await cdp.targets()).find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extId}/background.js`), 40_000, 'extension service worker');
    const worker = await cdp.attach(sw.targetId);
    // The worker's target exists before its script has finished loading; the first command used to race it ("lumina is not defined").
    await waitFor(() => worker.eval("typeof lumina !== 'undefined'"), 15_000, 'the extension script to finish loading');
    await worker.eval(`lumina.setConfig({ port: ${BRIDGE_PORT} })`);
    await worker.eval('lumina.pair()');
    check('the extension pairs with the (stub) bridge', (await worker.eval('lumina.hello()')).paired === true);

    const { targetId } = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${SITE_PORT}/` });
    const tab = await cdp.attach(targetId);
    await waitFor(() => tab.eval("document.readyState === 'complete' && !!document.getElementById('a1')"), 20_000, 'fixture page');
    await tab.send('DOM.enable');
    await wait(500); // let the content script settle
    const tabId = await worker.eval("chrome.tabs.query({ url: 'http://127.0.0.1:8771/*' }).then((t) => t[0].id)");

    const select = (from, to) => tab.eval(`(() => { const r = document.createRange(); r.setStartBefore(document.getElementById('${from}')); r.setEndAfter(document.getElementById('${to}')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString().length; })()`);
    const clear = () => tab.eval('getSelection().removeAllRanges()');
    const prompt = async () => {
      const { root } = await tab.send('DOM.getDocument', { depth: -1, pierce: true });
      return containsPrefix(root, 'Send ') ?? null;
    };

    /* the page-wide list (what the popup shows) */
    const all = await worker.eval(`lumina.linksIn(${tabId}, false)`);
    check('the whole page offers the four download links and not the plain ones', all.length === 4 && all.every((l) => l.worthy), all.map((l) => l.url.split('/').pop()).join(', '));

    /* highlighting the three parts */
    await select('a1', 'a3');
    const chosen = await worker.eval(`lumina.linksIn(${tabId}, true)`);
    check('a highlight of three links reads exactly those three (the Home link and the extras are not in it)', chosen.length === 3 && chosen.map((l) => l.url).join() === 'https://fuckingfast.co/aaa#Sample.part1.rar,https://fuckingfast.co/bbb#Sample.part2.rar,https://fuckingfast.co/ccc#Sample.part3.rar', chosen.length);

    await wait(900);
    const label = await prompt();
    check('a prompt appears beside the highlight: "Send 3 links to Lumina"', label === 'Send 3 links to Lumina', String(label));

    /* pressing it */
    const { root } = await tab.send('DOM.getDocument', { depth: -1, pierce: true });
    const textNode = findText(root, 'Send 3 links to Lumina');
    const { model } = await tab.send('DOM.getBoxModel', { backendNodeId: textNode.backendNodeId });
    const [x1, y1, x2, , , y3] = model.content;
    const [cx, cy] = [(x1 + x2) / 2, (y1 + y3) / 2];
    await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
    const batch = await waitFor(() => received.find((r) => r.path === '/v1/capture-batch'), 8000, 'the batch reaching the bridge');
    check('pressing it sends the three links to the bridge as ONE batch', batch.body.urls.length === 3, `${batch.body.urls.length} urls`);
    check('the batch names the page the links came from', batch.body.request.pageUrl === `http://127.0.0.1:${SITE_PORT}/` && batch.body.request.headers.Referer === `http://127.0.0.1:${SITE_PORT}/`);
    const cookieNames = batch.body.request.cookies.map((c) => c.name);
    check('an ordinary cookie goes along', cookieNames.includes('file_code'), cookieNames.join());
    // Without this the next check would pass for the wrong reason: the cookie has to really be in the browser's jar to be able to leak.
    const jar = await worker.eval(`chrome.cookies.getAll({ url: 'http://127.0.0.1:${SITE_PORT}/' }).then((c) => c.map((x) => x.name))`);
    check('(the browser really holds the clearance cookie, so it could have leaked)', jar.includes('cf_clearance') && jar.includes('file_code'), jar.join());
    check('the bot-check cookie (cf_clearance) does NOT leave the browser', !cookieNames.includes('cf_clearance') && !JSON.stringify(batch.body).includes('SECRET-CLEARANCE'));

    /* collapsing the highlight removes the prompt */
    await clear();
    await wait(900);
    check('the prompt goes away when the highlight does', (await prompt()) === null);

    /* a single link has no prompt */
    await select('a4', 'a4');
    await wait(900);
    check('highlighting a single link shows no prompt (it has its own right-click item)', (await prompt()) === null);

    /* switching the prompt off */
    await worker.eval('lumina.setConfig({ selectionPrompt: false })');
    await wait(300);
    await select('a1', 'a3');
    await wait(900);
    check('with the prompt switched off, highlighting three links shows nothing', (await prompt()) === null);
    await worker.eval('lumina.setConfig({ selectionPrompt: true })');

    /* ---------- edge cases ---------- */
    const openPage = async (route, hostName = '127.0.0.1') => {
      const { targetId } = await cdp.send('Target.createTarget', { url: `http://${hostName}:${SITE_PORT}${route}` });
      const t = await cdp.attach(targetId);
      await waitFor(() => t.eval("document.readyState === 'complete'"), 20_000, `page ${route}`);
      await t.send('DOM.enable');
      await wait(600); // let the content script settle
      const id = await worker.eval(`chrome.tabs.query({ url: 'http://${hostName}:${SITE_PORT}${route}' }).then((x) => x[0]?.id ?? null)`);
      return { t, id, close: () => cdp.send('Target.closeTarget', { targetId }) };
    };
    const selectIn = (t, from, to) => t.eval(`(() => { const r = document.createRange(); r.setStartBefore(document.getElementById('${from}')); r.setEndAfter(document.getElementById('${to}')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    const buttonBox = async (t, text) => {
      const { root } = await t.send('DOM.getDocument', { depth: -1, pierce: true });
      const hit = findWithParent(root, text);
      if (!hit?.parent) return null;
      const { model } = await t.send('DOM.getBoxModel', { backendNodeId: hit.parent.backendNodeId });
      // The border box: the content box leaves out the padding, which is exactly what the page's styling would add.
      const [x1, y1, x2, , , y3] = model.border;
      return { x: (x1 + x2) / 2, y: (y1 + y3) / 2, width: x2 - x1, height: y3 - y1 };
    };
    const press = async (t, box) => {
      await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    };
    const nextBatch = () => waitFor(() => received.find((r) => r.path === '/v1/capture-batch'), 12_000, 'a batch reaching the bridge');

    // A strict content-security-policy: the prompt's own styling must not be blocked by the page's rules.
    {
      const csp = await openPage('/csp');
      await selectIn(csp.t, 'a1', 'a3');
      await wait(900);
      const box = await buttonBox(csp.t, 'Send 3 links to Lumina');
      check('on a page with a strict content-security-policy the prompt still appears, styled', Boolean(box) && box.height >= 28 && box.width >= 150, JSON.stringify(box));
      await csp.close();
    }

    // Select All on a page of 600 links.
    {
      const many = await openPage('/many');
      await many.t.eval("getSelection().selectAllChildren(document.getElementById('all'))");
      await wait(1300);
      const box = await buttonBox(many.t, 'Send 500 links to Lumina');
      check('Select All on a page of 600 links offers the 500-link limit, not 600', Boolean(box));
      received.length = 0;
      const started = Date.now();
      if (box) await press(many.t, box);
      const big = await nextBatch();
      check('all 500 arrive as one batch, under the bridge size limit, within seconds', big.body.urls.length === 500 && big.bytes < 512 * 1024 && Date.now() - started < 8000, `${big.body.urls.length} links, ${big.bytes} bytes, ${Date.now() - started} ms`);
      check('in the order they are on the page', big.body.urls[0].endsWith('part001.rar') && big.body.urls[499].endsWith('part500.rar'));
      await many.close();
    }

    // Links written out as plain text, not clickable.
    {
      const text = await openPage('/text');
      await text.t.eval("getSelection().selectAllChildren(document.getElementById('t'))");
      await wait(900);
      const box = await buttonBox(text.t, 'Send 3 links to Lumina');
      check('three links written as plain text are found in a highlight', Boolean(box));
      received.length = 0;
      if (box) await press(text.t, box);
      const b = await nextBatch();
      check('and sent without the punctuation or the words around them', b.body.urls.join() === 'https://rapidgator.net/file/aa/Sample.part1.rar,https://rapidgator.net/file/bb/Sample.part2.rar,https://rapidgator.net/file/cc/Sample.part3.rar', b.body.urls.join(' '));
      await text.close();
    }

    // A highlight inside an iframe (the right-click path reads every frame).
    {
      const frame = await openPage('/frame');
      await frame.t.eval(`(() => { const d = document.getElementById('f').contentDocument; const r = d.createRange(); r.setStartBefore(d.getElementById('a1')); r.setEndAfter(d.getElementById('a3')); const s = d.defaultView.getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
      const inFrame = await worker.eval(`lumina.linksIn(${frame.id}, true)`);
      check('a highlight inside an iframe is read by the right-click path', inFrame.length === 3, String(inFrame.length));
      await frame.close();
    }

    // A big cookie jar must not make a good batch fail. (From `localhost`, so these cookies stay apart from the bridge's own host: cookies are
    // not isolated by port, and Node refuses request headers over 16 KB. Chrome caps what one site may keep, so this cannot reach the size
    // where the extension starts trimming; that is covered by the fitToBridge unit tests.)
    {
      const jarTab = await openPage('/', 'localhost');
      await jarTab.t.eval("for (let i = 0; i < 150; i++) document.cookie = `big${i}=` + 'x'.repeat(3800) + '; path=/'; 0");
      await wait(1200); // Chrome commits cookie writes a moment after document.cookie returns
      const held = await worker.eval(`chrome.cookies.getAll({ url: 'http://localhost:${SITE_PORT}/' }).then((c) => c.length)`);
      await selectIn(jarTab.t, 'a1', 'a3');
      await wait(900);
      const box = await buttonBox(jarTab.t, 'Send 3 links to Lumina');
      received.length = 0;
      if (box) await press(jarTab.t, box);
      const b = await nextBatch();
      check('the browser holds a cookie jar far over the bridge limit (so the next check means something)', held >= 100, `${held} cookies, about ${Math.round(held * 3.9)} KB`);
      check('with that jar the batch still goes: the cookies are trimmed away, the links and the page are not', Boolean(box) && b.body.urls.length === 3 && b.bytes < 450_000 && b.body.request.cookies.length === 0, `${b.body.request.cookies.length} cookies sent, ${b.bytes} bytes`);
      check('the links and the page are what they should be', b.body.request.pageUrl === `http://localhost:${SITE_PORT}/` && b.body.urls[0].includes('part1.rar'));
      await jarTab.t.eval("for (let i = 0; i < 150; i++) document.cookie = `big${i}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`; 0");
      await jarTab.close();
    }

    // Lumina is not running: the prompt says so plainly.
    {
      bridge.closeAllConnections?.();
      await new Promise((r) => bridge.close(r));
      const down = await openPage('/');
      await selectIn(down.t, 'a1', 'a3');
      await wait(900);
      const box = await buttonBox(down.t, 'Send 3 links to Lumina');
      if (box) await press(down.t, box);
      const said = await waitFor(async () => {
        const { root } = await down.t.send('DOM.getDocument', { depth: -1, pierce: true });
        return containsPrefix(root, 'Lumina isn');
      }, 12_000, 'the unreachable message');
      check('with Lumina not running the prompt says so, rather than failing silently', /isn’t reachable/.test(said), said);
      await down.close();
      await new Promise((r) => bridge.listen(BRIDGE_PORT, '127.0.0.1', r)); // back up for the rest
    }

    // This extension with the previous Lumina, which has no batch request: the links go one at a time instead of being lost.
    {
      batchSupported = false;
      received.length = 0;
      const urls = ['https://datanodes.to/o/Old.part1.rar', 'https://datanodes.to/o/Old.part2.rar', 'https://datanodes.to/o/Old.part3.rar'];
      const r = await worker.eval(`lumina.sendLinks(${JSON.stringify(urls)}, { url: 'http://127.0.0.1:${SITE_PORT}/', title: 'Old' }).then((x) => JSON.stringify(x))`);
      const singles = received.filter((x) => x.path === '/v1/capture');
      check('an older Lumina without the batch request still gets every link, one at a time', singles.length === 3 && singles.every((s) => s.body.kind === 'link') && JSON.parse(r).accepted === true && JSON.parse(r).count === 3, `${singles.length} singles, ${r}`);
      batchSupported = true;
    }

    /* the popup's list and its send */
    const popup = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` }).then((t) => cdp.attach(t.targetId));
    await wait(1500);
    // Draw the popup the way it looks with the fixture page in front (a popup normally reads the active tab; here that is the popup itself).
    await popup.eval(`chrome.tabs.query = async () => [{ id: ${tabId}, url: 'http://127.0.0.1:${SITE_PORT}/', title: 'Sample release post' }]; __renderPopup().then(() => 0)`);
    await popup.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: false });
    await wait(800);
    const shot = await popup.send('Page.captureScreenshot', { format: 'png' });
    if (process.env.SHOT_DIR) fs.writeFileSync(path.join(process.env.SHOT_DIR, 'popup-links.png'), Buffer.from(shot.data, 'base64'));
    const rows = await popup.eval("[...document.querySelectorAll('#links li')].map((li) => li.querySelector('b').textContent)");
    check('the popup lists the links by readable names (file names kept after the #, link text otherwise)', rows.join('|') === 'Part 1|Part 2|Part 3|Optional extras', rows.join('|'));
    check('the popup offers to send all four', (await popup.eval("document.getElementById('send-links').textContent")) === 'Send 4 to Lumina');
    const popupLinks = await popup.eval(`chrome.runtime.sendMessage({ type: 'page-links', tabId: ${tabId} })`);
    check('the popup is given the page\'s four links', popupLinks.length === 4);
    received.length = 0;
    const sent = await popup.eval(`chrome.runtime.sendMessage({ type: 'send-links', tabId: ${tabId}, urls: ${JSON.stringify(popupLinks.slice(0, 2).map((l) => l.url))} })`);
    check('sending two picked links from the popup arrives as a batch of two', sent.accepted && received.at(-1)?.path === '/v1/capture-batch' && received.at(-1).body.urls.length === 2);
    received.length = 0;
    await popup.eval(`chrome.runtime.sendMessage({ type: 'send-links', tabId: ${tabId}, urls: [${JSON.stringify(popupLinks[0].url)}] })`);
    check('a single link takes the ordinary single-link path', received.at(-1)?.path === '/v1/capture' && received.at(-1).body.kind === 'link');

    /* a release page with one tab per mirror: names, buttons that are not links, and choosing a mirror */
    {
      const { targetId: mirrorTarget } = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${SITE_PORT}/mirrors` });
      const mirrorTab = await cdp.attach(mirrorTarget);
      await waitFor(() => mirrorTab.eval("document.readyState === 'complete' && !!document.getElementById('gf')"), 20_000, 'mirrors page');
      await wait(500);
      const mTabId = await worker.eval(`chrome.tabs.query({ url: 'http://127.0.0.1:${SITE_PORT}/mirrors' }).then((t) => t[0].id)`);
      const found = await worker.eval(`lumina.linksIn(${mTabId}, false)`);
      check('every mirror’s ten download buttons are found: links, a data attribute, a click handler, and a host never heard of', found.length === 10, `${found.length}: ${found.map((l) => new URL(l.url).hostname).join(', ')}`);
      check('each is named by the file name in its row, not "DOWNLOAD"', found.every((l) => /^Release\.part0[123]\.rar$/.test(l.text)), found.map((l) => l.text).join('|'));
      check('the plain link on the page is left out', !found.some((l) => l.url.includes('example.org/about')));

      await popup.eval(`chrome.tabs.query = async () => [{ id: ${mTabId}, url: 'http://127.0.0.1:${SITE_PORT}/mirrors', title: 'Release' }]; __renderPopup().then(() => 0)`);
      await wait(900);
      const options = await popup.eval("[...document.getElementById('mirror').options].map((o) => o.textContent)");
      check('the popup notices the same files are offered on several hosts', !(await popup.eval("document.getElementById('mirror').hidden")) && options[0] === 'All hosts (10)', options.join(' | '));
      check('it starts with the host Lumina handles best (Pixeldrain), not the first one on the page', (await popup.eval("document.getElementById('mirror').value")) === 'pixeldrain.com');
      check('so only that host’s three files are listed and ticked', (await popup.eval("[...document.querySelectorAll('#links li')].filter((li) => !li.hidden).length")) === 3 && (await popup.eval("document.getElementById('send-links').textContent")) === 'Send 3 to Lumina');
      // Choosing "All hosts" and going back (before sending: a successful send closes the popup after 0.9 s).
      await popup.eval("(() => { const s = document.getElementById('mirror'); s.value = ''; s.dispatchEvent(new Event('change')); })()");
      await wait(300);
      check('choosing "All hosts" lists and ticks all ten', (await popup.eval("document.getElementById('send-links').textContent")) === 'Send 10 to Lumina');
      await popup.eval("(() => { const s = document.getElementById('mirror'); s.value = 'pixeldrain.com'; s.dispatchEvent(new Event('change')); })()");
      await wait(300);
      check('choosing Pixeldrain again goes back to three', (await popup.eval("document.getElementById('send-links').textContent")) === 'Send 3 to Lumina');

      received.length = 0;
      await popup.eval("document.getElementById('send-links').click()");
      await wait(1200);
      const mirrorBatch = received.find((r) => r.path === '/v1/capture-batch');
      check('pressing Send delivers just those three, once each', mirrorBatch?.body.urls.length === 3 && mirrorBatch.body.urls.every((u) => u.startsWith('https://pixeldrain.com/')), mirrorBatch?.body.urls.join(' '));
    }

    /* a hoster page that keeps the other hosts' lists as JSON in data attributes */
    {
      const { targetId: hosterTarget } = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${SITE_PORT}/hoster` });
      const hosterTab = await cdp.attach(hosterTarget);
      await waitFor(() => hosterTab.eval("document.readyState === 'complete' && !!document.getElementById('files')"), 20_000, 'hoster page');
      await wait(500);
      const hTabId = await worker.eval(`chrome.tabs.query({ url: 'http://127.0.0.1:${SITE_PORT}/hoster' }).then((t) => t[0].id)`);
      const links = await worker.eval(`lumina.linksIn(${hTabId}, false)`);
      const hosts = [...new Set(links.map((l) => new URL(l.url).hostname))].sort();
      check('hidden host lists are read in a real browser: the drawn links plus Pixeldrain and Gofile, each file once per host', links.length === 9, `${links.length}: ${hosts.join(', ')}`);
      check('the host the page itself flags as dangerous is never offered', !links.some((l) => l.url.includes('risky-host.example')), hosts.join(', '));
      check('the three hosts are all there for the mirror chooser', hosts.join() === ['fileditchfiles.example', 'gofile.io', 'pixeldrain.com'].join(), hosts.join(', '));
      check('each is named by its file name', links.every((l) => /^Sample\.part0[123]\.rar$/.test(l.text)), links.map((l) => l.text).join('|'));
    }
  } finally {
    browser.kill();
    site.close();
    bridge.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error('E2E failed to run:', err.message);
  process.exitCode = 2;
}).finally(() => {
  try { fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the browser may still be closing */ }
  setTimeout(() => process.exit(), 500);
});
