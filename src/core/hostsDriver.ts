// The script Lumina runs inside a file host's download page to find the control that gets the file.
//
// Hosts reword, move and restyle that control all the time, and every time the driver could not read a page it meant a release. So it does not
// look for one button by one name: it collects every control it can reach (the page, open shadow roots, same-site iframes), scores each one
// by what it says in any of a few dozen languages, what it is called in the markup, and where it sits, and takes the best that is not a
// decoy (a Premium upsell, an ad, a menu link). Checks (captcha, Turnstile) are never touched: the driver reports them and a person solves them.
//
// `LABEL_SCORER` is plain JavaScript in a string so the same function runs in the page and in the unit tests (tests/hostsDriver.test.ts).

import { SIGNATURE_MATCHER, SIGNATURE_THRESHOLD, type ClickSignature } from './learnedClicks';

/** Words for "download" in the languages file hosts are written in. Matched as whole words, except in scripts that do not use spaces. */
export const DOWNLOAD_WORDS = [
  'download', 'downloads', 'downloaden', 'descargar', 'descarga', 'bajar', 'télécharger', 'telecharger', 'téléchargement', 'telechargement',
  'herunterladen', 'runterladen', 'baixar', 'descarregar', 'transferir', 'scarica', 'scaricare', 'скачать', 'скачивание', 'загрузить',
  'завантажити', 'indir', 'indirin', 'pobierz', 'pobieranie', 'unduh', 'tải xuống', 'tải về', 'stáhnout', 'ladda ner', 'last ned', 'hent',
  'letöltés', 'descărcare', 'descarcă', 'λήψη', 'להורדה', 'הורד', 'تحميل', 'تنزيل', 'डाउनलोड', 'ดาวน์โหลด', '下载', '下載', 'ダウンロード', '다운로드',
];
/** "free" / "slow": the host's own no-cost route, as opposed to the paid fast one. */
export const FREE_WORDS = [
  'free', 'slow', 'normal', 'gratis', 'gratuit', 'gratuito', 'grátis', 'kostenlos', 'бесплатно', 'безкоштовно', 'ücretsiz', 'darmowy', 'gratuita',
  'مجاني', 'مجانا', '免费', '免費', '無料', '무료',
];
/** Words that make a control one to leave alone: paid upgrades, ads, apps and installers, menus and ways out. */
export const AVOID_WORDS = [
  'premium', 'vip', 'pro', 'upgrade', 'fast', 'faster', 'high speed', 'high-speed', 'turbo', 'rápido', 'rápida', 'rapido', 'rapida', 'rapide', 'rapid', 'schnell', 'veloce',
  'быстрое', 'быстрый', 'быстро', 'быстрая', 'hızlı', 'szybkie', 'cepat', 'nhanh',
  '高速', '快速', 'buy', 'purchase', 'comprar', 'acheter', 'kaufen', 'acquista', 'купить', '购买', 'subscribe', 'sign up', 'signup', 'register', 'log in', 'login',
  'sign in', 'report', 'abuse', 'dmca', 'torrent', 'install', 'extension', 'add-on', 'addon', 'vpn', 'antivirus', 'advert', 'sponsored', 'ad', 'ads',
  'manager', 'software', 'client', 'app', 'launcher', 'plugin', 'toolbar', 'play', 'stream', 'watch', 'share', 'copy', 'cancel', 'close', 'cancelar', 'cerrar',
  'annuler', 'fermer', 'закрыть', '关闭', 'help', 'support', 'contact', 'terms', 'privacy', 'home', 'menu', 'search', 'upload', 'delete', 'remove',
];
/** Words that move a multi-step page along when no "download" word is on offer yet. */
export const CONTINUE_WORDS = [
  'continue', 'proceed', 'next', 'continuar', 'siguiente', 'continuer', 'suivant', 'weiter', 'fortfahren', 'continua', 'avanti', 'prosseguir',
  'продолжить', 'далее', 'продовжити', '继续', '下一步', '繼續', 'devam', 'ileri', 'متابعة', 'التالي', '続行', '次へ', '계속',
];
/** Verbs that open "...download": start, get, create, generate. */
export const START_WORDS = ['start', 'get', 'create', 'generate', 'begin', 'iniciar', 'obtener', 'commencer', 'starten', 'iniziare'];

/**
 * How likely a control's words are to be the one that gets the file: 0 for "not it", up to 100. Defines `scoreLabel(text)`.
 * Self-contained on purpose (it runs in the page).
 */
export const LABEL_SCORER = String.raw`
const WORDS = ${JSON.stringify({ dl: DOWNLOAD_WORDS, free: FREE_WORDS, avoid: AVOID_WORDS, cont: CONTINUE_WORDS, start: START_WORDS })};
// Latin accents are one letter to a reader (and the Turkish capital dotted I lowercases to two characters), so they are folded away. Marks that
// make a different word in another script (Japanese voicing, Hindi vowels) stay, and Korean is put back together after decomposing.
const fold = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFKC').toLowerCase();
const SPACELESS = /[฀-໿぀-ヿ㐀-鿿가-힯ᄀ-ᇿ㄰-㆏]/;
const escapeRe = (s) => s.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
const EDGE = '[^\\p{L}\\p{N}]';
/* One pattern per list, built once: whole words in scripts that use spaces, plain containment in those that do not. 'anchored' = at the start. */
const compile = (list, anchored) => {
  const words = list.map(fold);
  const spaced = words.filter((w) => !SPACELESS.test(w)).map(escapeRe);
  const spaceless = words.filter((w) => SPACELESS.test(w)).map(escapeRe);
  const lead = anchored ? '^' : '(?:^|' + EDGE + ')';
  const parts = [];
  if (spaced.length) parts.push(lead + '(?:' + spaced.join('|') + ')(?:$|' + EDGE + ')');
  if (spaceless.length) parts.push((anchored ? '^' : '') + '(?:' + spaceless.join('|') + ')');
  return new RegExp(parts.join('|'), 'u');
};
const RE = {
  dl: compile(WORDS.dl), free: compile(WORDS.free), avoid: compile(WORDS.avoid), cont: compile(WORDS.cont),
  contAtStart: compile(WORDS.cont, true), startAtStart: compile(WORDS.start, true),
};
function normalizeLabel(raw) {
  return fold(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+/u, '');
}
function avoidLabel(raw) {
  const l = normalizeLabel(raw);
  return Boolean(l) && RE.avoid.test(l);
}
function scoreLabel(raw) {
  const l = normalizeLabel(raw);
  if (!l || l.length > 120) return 0;
  if (RE.avoid.test(l)) return 0;
  if (RE.dl.test(l)) {
    if (RE.startAtStart.test(l)) return 100;
    if (RE.free.test(l)) return 92;
    if (/^(?:continue|proceed)\s+(?:to\s+)?download/.test(l)) return 85;
    const n = l.split(' ').length;
    return n <= 4 ? 78 : n <= 8 ? 66 : 52;
  }
  if (RE.contAtStart.test(l)) return 40;
  return 0;
}
`;

/**
 * The page script. `learned` are controls the person clicked on this site before (core/learnedClicks.ts): when one is found again it wins,
 * even if the host has reworded or restyled it. The script also keeps a note of the last click made in the page by a person (not by
 * Lumina's own click, which it marks), so the caller can learn from it when the page had to be handed over.
 */
export const pageDriver = (learned: readonly ClickSignature[] = []): string => String.raw`(() => {
  ${LABEL_SCORER}
  ${SIGNATURE_MATCHER}
  const LEARNED = ${JSON.stringify(learned)};
  const THRESHOLD = ${SIGNATURE_THRESHOLD};
  const LEARNED_IDS = new Set(LEARNED.map((s) => s.id).filter(Boolean));
  const hitCache = new Map();
  /* How strongly this element is a control the person clicked here before: 108 when its id is the same, 88 when only its words are (a decoy
     with the same words must not beat an id hint), 0 when it is not. Cheap tests first: describing an element reads its text, which makes the
     browser lay the page out, and this runs for every element on every look at the page. */
  const learnedBoost = (el) => {
    if (!LEARNED.length) return 0;
    if (hitCache.has(el)) return hitCache.get(el);
    const small = LEARNED_IDS.has(el.id) || (el.children.length <= 3 && (el.textContent || '').length <= 120);
    let boost = 0;
    if (small && LEARNED.some((s) => matchSignature(s, el) >= THRESHOLD)) boost = LEARNED.some((s) => matchById(s, el)) ? 108 : 88;
    hitCache.set(el, boost);
    return boost;
  };
  const now = Date.now();

  /* Every document that can be reached: the page and its same-site frames. */
  const docs = [];
  (function collect(doc, depth) {
    docs.push(doc);
    if (depth > 3) return;
    for (const f of doc.querySelectorAll('iframe, frame')) {
      try {
        const d = f.contentDocument;
        if (d && d.documentElement) collect(d, depth + 1);
      } catch (e) { /* another site's frame: not ours to read */ }
    }
  })(document, 0);
  /* Where a frame's own (0,0) is in the page, now: its position moves when the page scrolls. */
  const offsetOf = (doc) => {
    let x = 0;
    let y = 0;
    for (let w = doc.defaultView; w && w.frameElement; w = w.parent) {
      const r = w.frameElement.getBoundingClientRect();
      x += r.left;
      y += r.top;
    }
    return { x, y };
  };
  /* Note the last click a person makes in the page, to learn from it. Lumina's own click is marked first (see below), so it is not taken for theirs. */
  for (const d of docs) {
    const w = d.defaultView;
    if (w.__luminaRec) continue;
    w.__luminaRec = true;
    d.addEventListener('click', (e) => {
      if (!e.isTrusted || Date.now() - (w.__luminaOwnAt || 0) < 1500) return;
      const t = (e.composedPath ? e.composedPath()[0] : e.target);
      if (!t || t.nodeType !== 1) return;
      const c = t.closest ? t.closest('button, a, input, [role=button], [onclick], [class*=btn i]') : null;
      // "control" says it was a button, link or the like; a click on bare page background is not something to learn.
      w.__luminaLast = { sig: describeControl(c || t), at: Date.now(), control: Boolean(c) };
    }, true);
  }

  /* Elements matching a selector in a root and in every open shadow root below it. */
  const deepAll = (root, sel, out, budget) => {
    for (const el of root.querySelectorAll(sel)) {
      if (out.length > 6000) break;
      out.push(el);
    }
    if (budget.n <= 0) return out;
    for (const el of root.querySelectorAll('*')) {
      if (--budget.n <= 0) break;
      if (el.shadowRoot) deepAll(el.shadowRoot, sel, out, budget);
    }
    return out;
  };

  const parentOf = (n) => n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    for (let n = el; n && n.nodeType === 1 && n !== n.ownerDocument.documentElement; n = parentOf(n)) {
      const s = n.ownerDocument.defaultView.getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    }
    return true;
  };
  const text = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('alt') || el.title || '').replace(/\s+/g, ' ').trim();
  const body = (document.body && document.body.innerText || '').slice(0, 20000);

  const captchaEl = [...document.querySelectorAll('.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"], img[src*="captcha" i]')].find(visible);
  // A solved check stays on the page (a green tick where the box was); what changes is that the widget fills in a response token. That token
  // is what the person's solving produces, so seeing it means the check has been passed by them and the page can carry on. Without this a
  // solved check was read as still waiting for a person, and the host's own Download button was never pressed.
  const solved = [...document.querySelectorAll('input[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="h-captcha-response"]')].some((e) => (e.value || '').length > 20);
  const captcha = !solved && (Boolean(captchaEl) || /verify you are human|checking (?:if the site connection is secure|your browser)|i'm not a robot/i.test(body));
  // Bring the check to the middle of what the person sees, once; a page that opens with it below the fold hides the very thing to click.
  if (captchaEl && !captchaEl.dataset.luminaCentred) {
    captchaEl.dataset.luminaCentred = '1';
    captchaEl.scrollIntoView({ block: 'center', inline: 'center' });
  }
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
  for (const doc of docs) {
    for (const el of doc.querySelectorAll('[id*="count" i], [class*="count" i], [id*="timer" i], [class*="timer" i], [id*="wait" i], [class*="wait" i]')) {
      if (!visible(el) || el.children.length > 3) continue;
      const m = text(el).match(/(?:^|\D)(\d{1,4})\s*(?:s|sec|secs|seconds?)?$/i);
      if (m && Number(m[1]) > 0 && Number(m[1]) < 3600) { countdown = Number(m[1]); break; }
    }
    if (countdown !== null) break;
  }

  const ID_HINT = /method_free|downloadbtn|download_btn|btn_download|free_download|dl_btn/;
  const CLASS_HINT = /(?:^|[\s_-])(?:btn-?download|download-?btn|dl-?btn|download-?button|free-?download|get-?file|download-?link|download-?now)(?:[\s_-]|$)/i;
  const ICON_HINT = /fa-download|bi-download|icon-download|download-icon|ico-download|file-download|arrow-down-to|class="[^"]*download/i;
  const FILE_HREF = /\.(?:rar|zip|7z|iso|bin|exe|msi|apk|dmg|torrent|mkv|mp4|avi|mov|mp3|flac|wav|pdf|epub|tar|gz|xz|\d{3})(?:[?#]|$)/i;
  const SEL = 'button, input[type=submit], input[type=button], input[type=image], a[href], [role=button], [onclick], [class*=btn i], [class*=button i], [class*=download i], [id*=download i]';

  let best = null;
  const budget = { n: 4000 };
  for (const doc of docs) {
    const list = deepAll(doc, SEL, [], budget);
    if (LEARNED.length) {
      // A control the person clicked before may be any element (a div with a listener); look through all of them for it.
      const seen = new Set(list);
      for (const el of deepAll(doc, '*', [], { n: 4000 })) if (!seen.has(el) && learnedBoost(el)) list.push(el);
    }
    for (const el of list) {
      if (!visible(el)) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/.test(el.className)) continue;
      if (now - Number(el.dataset && el.dataset.luminaClicked || 0) < 5000) continue;
      const label = text(el).slice(0, 120);
      const idn = ((el.id || '') + ' ' + (el.getAttribute('name') || '')).toLowerCase();
      const cls = typeof el.className === 'string' ? el.className : '';
      let score = scoreLabel(label);
      const avoided = avoidLabel(label);
      if (ID_HINT.test(idn)) score = Math.max(score, 95);
      else if (!avoided) {
        if (CLASS_HINT.test(cls + ' ' + idn)) score = Math.max(score, 78);
        if (label.length < 3 && ICON_HINT.test(el.outerHTML.slice(0, 400))) score = Math.max(score, 74);
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') || '';
          if (el.hasAttribute('download')) score = Math.max(score, 85);
          else {
            let path = '';
            try { path = new URL(href, doc.location.href).pathname + new URL(href, doc.location.href).search; } catch (e) { /* not an address */ }
            if (FILE_HREF.test(path)) score = Math.max(score, 80);
          }
        }
      }
      // The person clicked this very control on this site before: that outranks any guess from its words.
      const lb = learnedBoost(el);
      if (lb) score = Math.max(score, lb);
      if (!score) continue;
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        if (/^javascript:|^#$/.test(href) && score < 70) continue;
        try { if (new URL(href, doc.location.href).host !== doc.location.host && !FILE_HREF.test(href)) score -= 30; } catch (e) { /* not an address */ }
      }
      // A menu or footer link says "Download" too, and leads to another page.
      if (!ID_HINT.test(idn) && el.closest && el.closest('nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]')) score -= 35;
      const r = el.getBoundingClientRect();
      score += Math.min(10, (r.width * r.height) / 4000);
      if (!best || score > best.score) best = { el, score, label: label || el.id || cls.split(' ')[0] || 'button', doc };
    }
  }

  let target = null;
  let clicked = null;
  if (best && !captcha && best.score >= 40) {
    const el = best.el;
    el.dataset.luminaClicked = String(now);
    best.doc.defaultView.__luminaOwnAt = now;
    const tries = Number(el.dataset.luminaTries || 0) + 1;
    el.dataset.luminaTries = String(tries);
    if (tries >= 3) {
      // Real clicks didn't take (element covered or listening for something else): click it directly.
      el.click();
      clicked = best.label;
    } else {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const lx = Math.round(r.left + r.width / 2);
      const ly = Math.round(r.top + r.height / 2);
      const off = offsetOf(best.doc);
      target = { x: Math.round(off.x + lx), y: Math.round(off.y + ly), label: best.label };
      // Ask the button's own root: on the page, a button in a shadow root answers as its host, which is not a layer over it.
      const root = el.getRootNode();
      const top = (root && root.elementFromPoint ? root : best.doc).elementFromPoint(lx, ly);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        // Something (an ad overlay) covers the button: remove it rather than clicking the ad.
        if (!top.closest('form') && top !== best.doc.body && top !== best.doc.documentElement) top.remove();
      }
    }
  }
  let lastClick = null;
  for (const d of docs) {
    const l = d.defaultView.__luminaLast;
    if (l && (!lastClick || l.at > lastClick.at)) lastClick = l;
  }
  return { captcha, captchaKind, target, clicked, countdown, blocked, lastClick };
})()`;

/** The script with nothing learned: what the tests and the first visit to a site run. */
export const PAGE_DRIVER = pageDriver();
