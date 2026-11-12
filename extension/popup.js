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

  await renderEpisodes(tab);
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

/** The episodes of a series on this page: all of them listed, the ones with a video found by opening each, and those sent together. */
let episodeTimer = 0;
async function renderEpisodes(tab) {
  clearInterval(episodeTimer);
  const usable = tab?.id && /^https?:/.test(tab.url ?? '');
  const found = usable ? await chrome.runtime.sendMessage({ type: 'episodes-read', tabId: tab.id }).catch(() => null) : null;
  $('episodes-box').hidden = !found;
  if (!found) return;

  const episodes = found.episodes;
  const list = $('episodes');
  list.replaceChildren();
  const chosen = new Set();
  const rows = [];
  const label = (e) => `Episode ${e.number}${e.title ? ` · ${e.title}` : ''}`;
  const seasons = new Set(episodes.map((e) => e.season));
  $('episodes-title').textContent = `${found.show || 'Episodes'} · ${episodes.length} episode${episodes.length === 1 ? '' : 's'}`;
  $('episodes-hint').textContent = 'A list shows every episode, including ones that are not out yet. Lumina opens each one in the background to see which has a video.';

  for (const [i, e] of episodes.entries()) {
    const li = document.createElement('li');
    li.className = 'ep-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.disabled = true;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('b');
    title.textContent = `${seasons.size > 1 ? `S${e.season} ` : ''}${label(e)}`;
    title.title = e.url;
    const sub = document.createElement('small');
    meta.append(title, sub);
    const tag = document.createElement('span');
    tag.className = 'ep-tag';
    li.append(check, meta, tag);
    li.onclick = (ev) => { if (ev.target !== check && !check.disabled) check.click(); };
    check.onchange = () => { if (check.checked) chosen.add(String(i)); else chosen.delete(String(i)); refresh(); };
    rows.push({ li, check, sub, tag, e });
    list.append(li);
  }

  const TEXT = {
    waiting: ['Not checked yet', ''], checking: ['Checking…', 'checking'], found: ['Video found', 'found'],
    none: ['No video yet', 'none'], error: ['Couldn’t check', 'error'],
  };
  let last = null;
  let ticked = false; // the first time the check finishes, everything with a video is ticked for the person
  const apply = (snap) => {
    last = snap;
    for (const [i, r] of rows.entries()) {
      const item = snap?.items?.[i];
      const status = item?.status ?? 'waiting';
      const [text, tone] = TEXT[status] ?? TEXT.waiting;
      r.li.dataset.status = status;
      r.tag.textContent = text;
      r.tag.dataset.status = tone;
      r.sub.textContent = status === 'found' ? (item.kind === 'stream' ? 'Streaming video' : 'Video file') : status === 'none' ? (r.e.unavailable ? 'Not out yet, according to the page' : 'The page opened, but no video played') : status === 'error' ? (item.reason || '') : (r.e.unavailable && status === 'waiting' ? 'The page marks this one as not out yet' : '');
      r.check.disabled = status !== 'found';
      if (status !== 'found') { r.check.checked = false; chosen.delete(String(i)); }
      else if (!snap.running && !ticked) { r.check.checked = true; chosen.add(String(i)); }
    }
    if (snap && !snap.running && snap.items.some((x) => x.status !== 'waiting')) ticked = true;
    refresh();
  };
  const refresh = () => {
    const found = last?.items?.filter((x) => x.status === 'found').length ?? 0;
    const checked = last?.items?.filter((x) => ['found', 'none', 'error'].includes(x.status)).length ?? 0;
    const running = Boolean(last?.running);
    $('eps-all').disabled = found === 0;
    $('eps-all').checked = found > 0 && chosen.size === found;
    $('eps-all').indeterminate = chosen.size > 0 && chosen.size < found;
    $('eps-count').textContent = running ? `Checking · ${checked} of ${episodes.length}` : checked ? `${found} of ${episodes.length} have a video` : `${episodes.length} listed`;
    $('eps-check').textContent = running ? 'Stop' : checked ? 'Check again' : 'Find the ones with a video';
    const send = $('eps-send');
    send.disabled = chosen.size === 0;
    send.textContent = chosen.size ? `Send ${chosen.size} episode${chosen.size === 1 ? '' : 's'} to Lumina` : (checked && !running ? 'No episode with a video is picked' : 'Check the episodes first');
  };
  const poll = async () => {
    const snap = await chrome.runtime.sendMessage({ type: 'episodes-status', tabId: tab.id }).catch(() => null);
    if (snap && snap.items?.length === episodes.length) apply(snap);
    if (!snap?.running) clearInterval(episodeTimer);
  };

  $('eps-check').onclick = async () => {
    if (last?.running) {
      await chrome.runtime.sendMessage({ type: 'episodes-stop', tabId: tab.id }).catch(() => undefined);
      return poll();
    }
    ticked = false;
    chosen.clear();
    const snap = await chrome.runtime.sendMessage({ type: 'episodes-probe', tabId: tab.id, show: found.show, episodes }).catch(() => null);
    if (snap) apply(snap);
    clearInterval(episodeTimer);
    episodeTimer = setInterval(poll, 1000);
  };
  $('eps-all').onchange = (ev) => {
    for (const [i, r] of rows.entries()) {
      if (r.check.disabled) continue;
      r.check.checked = ev.target.checked;
      if (ev.target.checked) chosen.add(String(i)); else chosen.delete(String(i));
    }
    refresh();
  };
  $('eps-send').onclick = async () => {
    const send = $('eps-send');
    send.disabled = true;
    send.textContent = 'Sending…';
    const r = await chrome.runtime.sendMessage({ type: 'episodes-send', tabId: tab.id, show: found.show, keys: [...chosen] }).catch(() => null);
    if (r?.accepted) {
      send.textContent = 'Sent to Lumina ✓';
      setTimeout(() => window.close(), 900);
    } else {
      send.textContent = r?.reason || 'Lumina didn’t respond';
      setTimeout(refresh, 3000);
    }
  };

  // A check that was already started (the popup was closed meanwhile) is picked up where it is.
  apply(null);
  await poll();
  if (last?.running) episodeTimer = setInterval(poll, 1000);
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
