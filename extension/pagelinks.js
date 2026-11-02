// Finds the download links on a page, or in the part of it the person has highlighted.
//
// A classic script, not a module: the manifest loads it as a content script (for the "send these links" prompt), and the menu and the popup
// inject the same file with chrome.scripting. So there is exactly one copy of the rules for what counts as a download link.
(() => {
  if (globalThis.__luminaLinks) return;

  // File hosts that put a download page in front of every file. Keep in step with PAGE_HOSTS in src/core/hosts.ts (a test checks it),
  // plus a few hosts Lumina can take straight from the link.
  const HOSTS = [
    'datanodes.to', 'ddownload.com', 'ddl.to', 'rapidgator.net', 'rg.to', 'nitroflare.com', 'katfile.com', 'uploadrar.com',
    'mega4upload.net', 'hexload.com', 'usersdrive.com', 'dropapk.to', 'drop.download', 'filespayouts.com', 'clicknupload.click',
    'clicknupload.org', 'clickndownload.org', 'userupload.net', 'uptobox.com', 'send.cm', 'krakenfiles.com', 'mediafire.com',
    '1fichier.com', 'turbobit.net', 'hitfile.net', 'uploadhaven.com', 'buzzheavier.com', 'bzzhr.co', 'qiwi.gg', 'fuckingfast.co',
    'filecrypt.cc', 'filedot.to', 'megaup.net', 'upload.ee', 'dailyuploads.net', 'workupload.com', 'sendspace.com', 'uploady.io',
    'up-4ever.net', 'file-upload.org', 'dbree.me', 'anonfiles.me', 'bayfiles.com', 'uploadev.org', 'vikingfile.com', 'akirabox.com',
    'pixeldrain.com', 'gofile.io', '1drv.ms', 'dropbox.com',
  ];
  const FILE = /\.(?:rar|zip|7z|iso|bin|exe|msi|apk|dmg|torrent|mkv|mp4|avi|mov|mp3|flac|wav|pdf|epub|\d{3})(?:[?#]|$)/i;
  const MAX_LINKS = 500;

  const hostOf = (href) => {
    try { return new URL(href).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  };
  const isHosted = (href) => {
    const host = hostOf(href);
    return Boolean(host) && HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  };
  /** A link Lumina can do something with on its own: a magnet, a file host's page, or a link that ends in a file name. */
  const worthy = (href) => /^magnet:/i.test(href) || (/^https?:/i.test(href) && (isHosted(href) || FILE.test(href)));

  /** Links written out as text (a post with the address in plain sight, not clickable). */
  const textLinks = (text) => (String(text).match(/(?:https?:\/\/|magnet:\?)[^\s<>"'`]+/gi) ?? []).map((u) => u.replace(/[),.;\]]+$/, ''));

  /**
   * From the links found, the ones to offer.
   *
   * On the whole page only links Lumina can use are offered (a page is full of menus and trackers). In something the person highlighted
   * they chose these links themselves, so if the selection holds any link Lumina recognises only those are kept (a highlighted post often
   * has a stray "home" link beside the real ones), and if it holds none every web link is kept (an unfamiliar host is still their choice).
   */
  function pick(candidates, { chosen = false } = {}) {
    const seen = new Set();
    const all = [];
    for (const c of candidates) {
      const href = String(c.href ?? '').trim();
      if (!href || seen.has(href) || !/^(?:https?:|magnet:)/i.test(href)) continue;
      seen.add(href);
      all.push({ url: href, text: String(c.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), worthy: worthy(href) });
    }
    const wanted = chosen ? (all.some((l) => l.worthy) ? all.filter((l) => l.worthy) : all) : all.filter((l) => l.worthy);
    return wanted.slice(0, MAX_LINKS);
  }

  /** Read the page (or the highlighted part of it) now. */
  function read({ selectionOnly = false } = {}) {
    const sel = globalThis.getSelection?.();
    const here = location.href.split('#')[0];
    const candidates = [];
    for (const a of document.querySelectorAll('a[href]')) {
      if (selectionOnly && !(sel && !sel.isCollapsed && sel.containsNode(a, true))) continue;
      if (a.href.split('#')[0] === here && !worthy(a.href)) continue; // a link to somewhere else on the same page
      candidates.push({ href: a.href, text: a.textContent });
    }
    if (selectionOnly && sel && !sel.isCollapsed) for (const u of textLinks(sel.toString())) candidates.push({ href: u, text: '' });
    return pick(candidates, { chosen: selectionOnly });
  }

  globalThis.__luminaLinks = { pick, read, textLinks, worthy, isHosted };
})();
