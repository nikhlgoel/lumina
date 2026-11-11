import { capture, formatBytes, getConfig, hello, pair, setConfig, shareLogin } from './lib.js';
import { chooseMirror, groupByHost, hostOf, linkName } from './mirrors.js';

const $ = (id) => document.getElementById(id);

function setStatus(state, text) {
  $('status').dataset.state = state;
  $('status').querySelector('span').textContent = text;
}

function fileName(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
  } catch {
    return url;
  }
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const cfg = await getConfig();
  $('capture').checked = cfg.captureDownloads;
  $('prompt').checked = cfg.selectionPrompt !== false;
  $('port').value = cfg.port;

  const app = await hello();
  if (!app.running) {
    setStatus('off', 'Lumina isn’t running');
    $('connect').hidden = false;
    $('main').hidden = true;
    $('connect-text').textContent = 'Open the Lumina app on this computer, then try again.';
    $('connect-btn').textContent = 'Try again';
    $('connect-btn').onclick = render;
    return;
  }
  if (!app.paired) {
    setStatus('warn', 'Not connected');
    $('connect').hidden = false;
    $('main').hidden = true;
    $('connect-text').textContent = 'Connect once so this browser can send downloads to Lumina. You’ll confirm it in the app.';
    $('connect-btn').textContent = 'Connect to Lumina';
    $('connect-btn').onclick = async () => {
      $('connect-btn').disabled = true;
      $('connect-btn').textContent = 'Confirm in Lumina…';
      $('connect-error').hidden = true;
      try {
        await pair();
        await render();
      } catch (err) {
        $('connect-error').textContent = err.message;
        $('connect-error').hidden = false;
        $('connect-btn').disabled = false;
        $('connect-btn').textContent = 'Connect to Lumina';
      }
    };
    return;
  }

  setStatus('ok', `Connected · v${app.version}`);
  $('connect').hidden = true;
  $('main').hidden = false;

  const pageUsable = tab?.url && /^https?:/.test(tab.url);
  $('send-page').disabled = !pageUsable;
  $('page-title').textContent = pageUsable ? `Send “${tab.title || fileName(tab.url)}”` : 'This page can’t be sent';
  $('send-page').onclick = async () => {
    const { accepted: ok } = await capture({ url: tab.url, kind: 'page', pageUrl: tab.url, pageTitle: tab.title });
    $('page-title').textContent = ok ? 'Sent to Lumina ✓' : 'Lumina didn’t respond';
    if (ok) setTimeout(() => window.close(), 700);
  };

  const items = tab ? await chrome.runtime.sendMessage({ type: 'detected', tabId: tab.id }) : [];
  const list = $('media');
  list.replaceChildren();
  $('empty').hidden = items.length > 0;
  for (const item of items) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = item.label;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('b');
    title.textContent = item.kind === 'stream' ? (item.pageTitle || 'Stream') : fileName(item.url);
    const sub = document.createElement('small');
    sub.textContent = [item.kind === 'stream' ? 'Streaming video' : formatBytes(item.sizeBytes), new URL(item.url).hostname].filter(Boolean).join(' · ');
    meta.append(title, sub);
    const send = document.createElement('button');
    send.className = 'send';
    send.textContent = 'Send';
    send.onclick = async () => {
      send.disabled = true;
      const ok = await chrome.runtime.sendMessage({
        type: 'send',
        payload: { url: item.url, kind: item.kind, pageUrl: item.pageUrl, pageTitle: item.pageTitle, headers: item.headers, sizeBytes: item.sizeBytes ?? undefined },
      });
      send.textContent = ok ? 'Sent' : 'Failed';
      if (ok) send.dataset.done = '';
      else send.disabled = false;
    };
    li.append(tag, meta, send);
    list.append(li);
  }

  await renderLinks(tab);

  // Offered only when this Lumina can take a sign-in (an older one answers without `accounts`).
  $('login-box').hidden = !app.accounts;
  $('share-youtube').onclick = async () => {
    const btn = $('share-youtube');
    const note = $('share-youtube-note');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    const r = await shareLogin('youtube');
    btn.disabled = false;
    btn.textContent = 'Use my YouTube sign-in in Lumina';
    note.hidden = false;
    note.textContent = r.ok ? 'Done. Lumina can now download private and age-restricted YouTube videos as you.' : (r.reason || 'Lumina didn’t respond');
  };
}

/** Every download link on the page, to pick from and send together. */
async function renderLinks(tab) {
  const usable = tab?.id && /^https?:/.test(tab.url ?? '');
  const links = usable ? await chrome.runtime.sendMessage({ type: 'page-links', tabId: tab.id }).catch(() => []) : [];
  $('links-box').hidden = links.length === 0;
  $('links-empty').hidden = links.length > 0;
  const list = $('links');
  list.replaceChildren();
  if (!links.length) return;

  const chosen = new Set(links.map((l) => l.url));
  const rows = [];
  for (const l of links) {
    const li = document.createElement('li');
    li.className = 'link-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = true;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('b');
    title.textContent = linkName(l);
    title.title = l.url;
    const sub = document.createElement('small');
    sub.textContent = /^magnet:/i.test(l.url) ? 'Magnet link' : new URL(l.url).hostname;
    meta.append(title, sub);
    li.append(check, meta);
    li.onclick = (e) => { if (e.target !== check) check.click(); };
    check.onchange = () => {
      if (check.checked) chosen.add(l.url);
      else chosen.delete(l.url);
      refresh();
    };
    rows.push({ li, check, l, haystack: `${linkName(l)} ${l.url}`.toLowerCase(), filterOff: false, mirrorOff: false });
    list.append(li);
  }

  // A page that offers the same files on several hosts: start with one of them, so the files are not all sent several times over.
  const mirror = chooseMirror(groupByHost(links));
  const mirrorSel = $('mirror');
  mirrorSel.hidden = !mirror;
  const showRow = (r) => { r.li.hidden = r.filterOff || r.mirrorOff; };
  const applyMirror = (host) => {
    for (const r of rows) {
      const on = !host || (/^magnet:/i.test(r.l.url) ? 'magnet' : hostOf(r.l.url)) === host;
      r.mirrorOff = !on;
      r.check.checked = on;
      if (on) chosen.add(r.l.url);
      else chosen.delete(r.l.url);
      showRow(r);
    }
    refresh();
  };
  if (mirror) {
    mirrorSel.replaceChildren(new Option(`All hosts (${links.length})`, ''), ...groupByHost(links).map((g) => new Option(`${g.host} (${g.links.length})`, g.host)));
    mirrorSel.value = mirror;
    mirrorSel.onchange = () => applyMirror(mirrorSel.value);
  }

  const send = $('send-links');
  const refresh = () => {
    $('links-count').textContent = `${chosen.size} of ${links.length}`;
    $('links-all').checked = chosen.size === links.length;
    $('links-all').indeterminate = chosen.size > 0 && chosen.size < links.length;
    send.textContent = chosen.size ? `Send ${chosen.size} to Lumina` : 'Pick at least one link';
    send.disabled = chosen.size === 0;
  };
  if (mirror) applyMirror(mirror);
  $('links-all').onchange = (e) => {
    for (const r of rows) {
      if (r.li.hidden) continue; // select all applies to what the filter shows
      r.check.checked = e.target.checked;
      if (e.target.checked) chosen.add(r.l.url);
      else chosen.delete(r.l.url);
    }
    refresh();
  };
  $('links-filter').value = '';
  $('links-filter').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const r of rows) {
      r.filterOff = Boolean(q) && !r.haystack.includes(q);
      showRow(r);
    }
  };
  send.onclick = async () => {
    send.disabled = true;
    send.textContent = 'Sending…';
    // The name each link has on the page ("Game.part01.rar"), so Lumina can show and group files that are named by their address alone.
    const names = Object.fromEntries(links.filter((l) => chosen.has(l.url) && l.text).map((l) => [l.url, l.text]));
    const r = await chrome.runtime.sendMessage({ type: 'send-links', urls: [...chosen], names, tabId: tab.id }).catch(() => null);
    if (r?.accepted) {
      send.textContent = 'Sent to Lumina ✓';
      setTimeout(() => window.close(), 900);
    } else {
      send.textContent = r?.reason || 'Lumina didn’t respond';
      setTimeout(refresh, 2500);
    }
  };
  refresh();
}

$('prompt').onchange = (e) => setConfig({ selectionPrompt: e.target.checked });
$('capture').onchange = (e) => setConfig({ captureDownloads: e.target.checked });
$('port').onchange = async (e) => {
  const port = Number(e.target.value);
  if (port >= 1024 && port <= 65535) {
    await setConfig({ port });
    await render();
  }
};
$('disconnect').onclick = async () => {
  await setConfig({ token: null });
  await render();
};

// Handle for automated tests, like `globalThis.lumina` in the background worker: lets a test draw the popup for a given tab.
globalThis.__renderPopup = render;

void render();
