// File hosts: links that open a download page (buttons, countdowns, sometimes a captcha) rather than the file.
// Lumina opens those pages in a hidden browser, clicks through, and catches the real download.

/** Hosts known to put a download page in front of every file (XFileSharing-style and similar). */
const PAGE_HOSTS = [
  'datanodes.to', 'ddownload.com', 'ddl.to', 'rapidgator.net', 'rg.to', 'nitroflare.com', 'katfile.com', 'uploadrar.com',
  'mega4upload.net', 'hexload.com', 'usersdrive.com', 'dropapk.to', 'drop.download', 'filespayouts.com', 'clicknupload.click',
  'clicknupload.org', 'clickndownload.org', 'userupload.net', 'uptobox.com', 'send.cm', 'krakenfiles.com', 'mediafire.com',
  '1fichier.com', 'turbobit.net', 'hitfile.net', 'uploadhaven.com', 'buzzheavier.com', 'bzzhr.co', 'qiwi.gg', 'fuckingfast.co',
  'filecrypt.cc', 'filedot.to', 'megaup.net', 'upload.ee', 'dailyuploads.net', 'workupload.com', 'sendspace.com', 'uploady.io',
  'up-4ever.net', 'file-upload.org', 'dbree.me', 'anonfiles.me', 'bayfiles.com', 'uploadev.org', 'vikingfile.com', 'akirabox.com',
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when the link belongs to a file host that serves a download page first. */
export function isPageHost(url: string): boolean {
  const host = hostOf(url);
  return Boolean(host && PAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)));
}

/** Hosts with a public direct-file API: rewrite the share link to the file itself, no page needed. */
export function directApiUrl(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const path = new URL(url).pathname;
  if (host === 'pixeldrain.com' || host === 'pixeldra.in') {
    const id = path.match(/^\/(?:u|api\/file)\/([A-Za-z0-9]+)/)?.[1];
    return id ? `https://pixeldrain.com/api/file/${id}?download` : null;
  }
  return null;
}

/** "example.co.uk" style registrable domain, close enough to tell a host's own pages from ad redirects. */
export function siteOf(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
  const twoLevel = parts.length > 2 && /^(co|com|net|org|gov|ac|edu)$/.test(parts[parts.length - 2]!) && parts[parts.length - 1]!.length === 2;
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

export interface PageScan {
  /** A captcha or interactive challenge is showing: a person has to finish the page. */
  captcha: boolean;
  /** Which kind of check, so Lumina can name it for the person (e.g. "reCAPTCHA"). */
  captchaKind: string | null;
  /** Where to click next (CSS pixels in the viewport), so the click arrives as real input. */
  target: { x: number; y: number; label: string } | null;
  /** Label of a control the page script clicked itself (after real clicks did nothing). */
  clicked: string | null;
  /** Seconds left on a visible countdown. */
  countdown: number | null;
  /** The host refuses: file gone, wait or limit messages. */
  blocked: string | null;
}

/**
 * Runs inside the download page. Finds the best "free download" style control, skipping premium
 * upsells, ads and disabled or counting-down buttons, and reports where to click it.
 */
export const PAGE_DRIVER = String.raw`(() => {
  const now = Date.now();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    }
    return true;
  };
  const text = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim();
  const body = (document.body && document.body.innerText || '').slice(0, 20000);

  const captchaEl = [...document.querySelectorAll('.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"], img[src*="captcha" i]')].find(visible);
  const captcha = Boolean(captchaEl) || /verify you are human|checking (?:if the site connection is secure|your browser)|i'm not a robot/i.test(body);
  let captchaKind = null;
  if (captcha) {
    const html = document.documentElement.innerHTML;
    if (/challenges\.cloudflare\.com|cf-turnstile|checking if the site connection is secure/i.test(html)) captchaKind = 'Cloudflare check';
    else if (/hcaptcha\.com|h-captcha/i.test(html)) captchaKind = 'hCaptcha';
    else if (/recaptcha|g-recaptcha/i.test(html)) captchaKind = 'reCAPTCHA';
    else if (captchaEl && captchaEl.tagName === 'IMG') captchaKind = 'image code';
    else captchaKind = 'human check';
  }

  let blocked = null;
  const bm = body.match(/(file (?:was |has been )?(?:not found|deleted|removed)|no such file|file (?:is )?unavailable|you (?:have|need) to wait [^.\n]{1,40}|download limit[^.\n]{0,60}|too many (?:downloads|connections)[^.\n]{0,40}|only (?:premium|registered) users[^.\n]{0,60})/i);
  if (bm) blocked = bm[1];

  let countdown = null;
  for (const el of document.querySelectorAll('[id*="count" i], [class*="count" i], [id*="timer" i], [class*="timer" i], [id*="wait" i], [class*="wait" i]')) {
    if (!visible(el) || el.children.length > 3) continue;
    const m = text(el).match(/(?:^|\D)(\d{1,4})\s*(?:s|sec|secs|seconds?)?$/i);
    if (m && Number(m[1]) > 0 && Number(m[1]) < 3600) { countdown = Number(m[1]); break; }
  }

  const GOOD = [
    [/^(?:start|get|create|generate)\s+(?:the\s+)?download(?:\s+link)?\b/i, 100],
    [/\bfree\s+download\b|\bslow\s+download\b|\bdownload\s+free\b/i, 90],
    [/\b(?:continue|proceed)\s+(?:to\s+)?download\b/i, 85],
    [/^download(?:\s+(?:now|file|here))?\s*(?:\(|\[|$)/i, 70],
    [/^(?:continue|proceed|next)\b/i, 40],
  ];
  const BAD = /premium|fast(?:er)?\s+download|high[\s-]?speed|upgrade|buy|purchase|subscribe|sign\s*up|register|log\s*in|login|report|abuse|dmca|torrent|install|extension|vpn|advert|sponsored|play|stream|watch|share|copy|cancel|close/i;

  let best = null;
  for (const el of document.querySelectorAll('button, input[type=submit], input[type=button], a[href], [role=button]')) {
    if (!visible(el)) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/.test(el.className)) continue;
    if (now - Number(el.dataset.luminaClicked || 0) < 5000) continue;
    const label = text(el).slice(0, 80);
    const id = (el.id + ' ' + (el.getAttribute('name') || '')).toLowerCase();
    let score = 0;
    if (/method_free|downloadbtn|download_btn|btn_download|free_download|dl_btn/.test(id)) score = 95;
    for (const [re, s] of GOOD) if (re.test(label)) score = Math.max(score, s);
    if (!score || BAD.test(label)) continue;
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') || '';
      if (/^javascript:|^#$/.test(href) && score < 70) continue;
      try { if (new URL(href, location.href).host !== location.host && !/\.(rar|zip|7z|bin|iso|exe|\d{3})(\?|$)/i.test(href)) score -= 30; } catch {}
    }
    const r = el.getBoundingClientRect();
    score += Math.min(10, (r.width * r.height) / 4000);
    if (!best || score > best.score) best = { el, score, label };
  }

  let target = null;
  let clicked = null;
  if (best && !captcha && best.score >= 40) {
    const el = best.el;
    el.dataset.luminaClicked = String(now);
    const tries = Number(el.dataset.luminaTries || 0) + 1;
    el.dataset.luminaTries = String(tries);
    if (tries >= 3) {
      // Real clicks didn't take (element covered or listening for something else): click it directly.
      el.click();
      clicked = best.label || el.id || 'button';
    } else {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      target = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: best.label || el.id || 'button' };
      const top = document.elementFromPoint(target.x, target.y);
      if (top && top !== el && !el.contains(top)) {
        // Something (an ad overlay) covers the button: remove it rather than clicking the ad.
        if (!top.closest('form') && top !== document.body && top !== document.documentElement) top.remove();
      }
    }
  }
  return { captcha, captchaKind, target, clicked, countdown, blocked };
})()`;
