import { capture, formatBytes, getConfig, hello, pair, setConfig } from './lib.js';

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
}

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

void render();
