// The "send these links to Lumina" prompt.
//
// When the person highlights two or more download links on a page, a small button appears beside the selection. This only reads the
// selection, and only while one exists; nothing leaves the page until the button is pressed. It can be turned off in the extension's popup.
// Relies on pagelinks.js (listed before this file in the manifest) for the one definition of what counts as a download link.
(() => {
  if (globalThis.__luminaPrompt || !globalThis.__luminaLinks) return;
  globalThis.__luminaPrompt = true;

  let enabled = true;
  let host = null;
  let timer = 0;
  let lastCount = -1;

  chrome.storage.local.get({ selectionPrompt: true }).then((c) => { enabled = c.selectionPrompt !== false; }).catch(() => undefined);
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.selectionPrompt) return;
    enabled = changes.selectionPrompt.newValue !== false;
    if (!enabled) hide();
  });

  const hide = () => {
    host?.remove();
    host = null;
  };

  // The right-click menu says how many links it will send; tell the background what is highlighted now.
  const report = (count) => {
    if (count === lastCount) return;
    lastCount = count;
    chrome.runtime.sendMessage({ type: 'selection', count }).catch(() => undefined);
  };

  function show(links, sel) {
    hide();
    // Beside the end of the highlight, but always inside what is on screen: Select All on a long page ends far below the visible part, and a
    // button down there would never be seen. Fixed, so it stays put while the page is scrolled.
    const rect = sel.getRangeAt(sel.rangeCount - 1).getBoundingClientRect();
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    host.style.left = `${Math.round(Math.max(8, Math.min(rect.right - 150, innerWidth - 290)))}px`;
    host.style.top = `${Math.round(Math.max(8, Math.min(rect.bottom + 8, innerHeight - 64)))}px`;
    const root = host.attachShadow({ mode: 'closed' });
    const css = `
      .bar { display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 12px; background: #1b1a18; color: #f1ede6;
             font: 600 13px/1 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; box-shadow: 0 6px 24px rgb(0 0 0 / .35), 0 0 0 1px rgb(255 244 225 / .1); }
      button { font: inherit; border: 0; cursor: pointer; color: inherit; background: none; border-radius: 9px; }
      .go { padding: 9px 12px; background: #f08a3e; color: #1b1106; }
      .go:hover { filter: brightness(1.07); }
      .go:disabled { opacity: .7; cursor: default; }
      .x { width: 28px; height: 28px; font-size: 16px; color: #c3bdb2; }
      .x:hover { background: rgb(255 244 225 / .08); }
    `;
    // A constructable stylesheet is not subject to the page's content-security-policy; an inline <style> is, and on a strict page the
    // button appeared with no styling at all. The <style> remains as the fallback for a browser that will not adopt one.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = css;
      root.append(style);
    }
    const bar = document.createElement('div');
    bar.className = 'bar';
    const go = document.createElement('button');
    go.className = 'go';
    go.textContent = `Send ${links.length} links to Lumina`;
    const x = document.createElement('button');
    x.className = 'x';
    x.setAttribute('aria-label', 'Dismiss');
    x.textContent = '×';
    bar.append(go, x);
    root.append(bar);
    document.documentElement.append(host);

    x.onclick = hide;
    go.onclick = async () => {
      go.disabled = true;
      go.textContent = 'Sending…';
      const r = await chrome.runtime.sendMessage({ type: 'send-links', urls: links.map((l) => l.url) }).catch(() => null);
      go.textContent = r?.accepted ? 'Sent to Lumina ✓' : (r?.reason || 'Lumina didn’t respond');
      setTimeout(hide, r?.accepted ? 1400 : 3200);
    };
  }

  function check() {
    const sel = globalThis.getSelection();
    if (!sel || sel.isCollapsed) {
      report(0);
      hide();
      return;
    }
    const links = globalThis.__luminaLinks.read({ selectionOnly: true });
    report(links.length);
    // Offered when there are at least two links Lumina recognises; a single link already has its own right-click item.
    const recognised = links.filter((l) => l.worthy);
    if (!enabled || recognised.length < 2) {
      hide();
      return;
    }
    show(recognised, sel);
  }

  // Selection changes by mouse and by keyboard alike; wait for it to settle so the button does not chase a drag.
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = setTimeout(check, 250);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  }, true);
})();
