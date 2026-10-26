/* Lumina website: theme, the side menu, scroll polish, and live release facts from GitHub. No libraries, no tracking. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REPO = 'nikhlgoel/lumina';
  const RELEASES = `https://github.com/${REPO}/releases/latest`;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Theme: a two-way switch, light or dark ---------- */
  const themeButtons = $$('[data-set-theme]');
  const syncTheme = () => {
    const now = document.documentElement.getAttribute('data-theme');
    themeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setTheme === now)));
  };
  themeButtons.forEach((b) => b.addEventListener('click', () => {
    document.documentElement.setAttribute('data-theme', b.dataset.setTheme);
    try { localStorage.setItem('lumina-theme', b.dataset.setTheme); } catch { /* private mode: the choice just isn't remembered */ }
    syncTheme();
  }));
  syncTheme();

  /* ---------- The side menu ---------- */
  const rail = $('#rail');
  const toggle = $('#rail-toggle');
  const setOpen = (open) => {
    rail.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
  };
  toggle.addEventListener('click', () => setOpen(!rail.classList.contains('open')));
  $$('.rail-links a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  document.addEventListener('click', (e) => { if (!rail.contains(e.target)) setOpen(false); });

  if ('IntersectionObserver' in window) {
    const links = new Map($$('.rail-links a').map((a) => [a.getAttribute('href').slice(1), a]));
    const so = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const link = links.get(e.target.id);
        if (link && e.isIntersecting) { links.forEach((l) => l.removeAttribute('aria-current')); link.setAttribute('aria-current', 'true'); }
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((_, id) => { const s = document.getElementById(id); if (s) so.observe(s); });
  }

  /* ---------- Scroll reveal ---------- */
  const reveals = $$('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach((el) => io.observe(el));
  }

  /* ---------- Toast + copy ---------- */
  const toast = $('#toast');
  let toastTimer = 0;
  const say = (msg) => { toast.textContent = msg; toast.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('on'), 2200); };

  /* ---------- Live facts from GitHub ---------- */
  const DAY = 86_400_000;
  const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / DAY);
  const relative = (iso) => {
    const days = daysSince(iso);
    if (!Number.isFinite(days) || days < 0) return '';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 45) return `${days} days ago`;
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    return `${Math.round(days / 365)} years ago`;
  };
  const since = (iso) => {
    const days = daysSince(iso);
    if (!Number.isFinite(days) || days < 0) return '—';
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 60) return `${days} days ago`;
    return `${Math.round(days / 30)} months ago`;
  };
  const getJSON = async (url, key, ttl = 600_000) => {
    try { const c = JSON.parse(sessionStorage.getItem(key)); if (c && Date.now() - c.t < ttl) return c.d; } catch { /* no cache */ }
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const d = await r.json();
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { /* cache is optional */ }
    return d;
  };
  // Rounded down to one decimal under 10 MB, the way GitHub shows an asset's size, so the two pages agree.
  const mb = (bytes) => { const m = bytes / 1048576; return `${m < 10 ? (Math.floor(m * 10) / 10).toFixed(1) : Math.round(m)} MB`; };

  const PICKS = {
    std: {
      title: 'Lumina Standard', find: /Standard-Setup\.exe$/i, button: 'Download for Windows', where: 'Windows 10 and 11, 64-bit',
      steps: ['Download the installer and run it.', 'If Windows shows a blue SmartScreen box, choose <b>More info</b>, then <b>Run anyway</b>. The installer is not code-signed yet.', 'Pick a folder if you like, and finish. Lumina opens.'],
      note: 'Standard does not include the code editor. Choose Full if you want it.',
    },
    full: {
      title: 'Lumina Full', find: /Full-Setup\.exe$/i, button: 'Download for Windows', where: 'Windows 10 and 11, 64-bit',
      steps: ['Download the installer and run it.', 'If Windows shows a blue SmartScreen box, choose <b>More info</b>, then <b>Run anyway</b>. The installer is not code-signed yet.', 'Pick a folder if you like, and finish. Lumina opens.'],
      note: 'Full adds the code editor, terminal, source control and MCP client to everything in Standard.',
    },
    android: {
      title: 'Lumina for Android', find: /^lumina-tv-.*\.apk$/i, button: 'Download the APK', where: 'Android',
      steps: ['Download the APK onto the device, or copy it there from a computer.', 'Open it. If Android asks, allow installs from that source in the device’s settings.', 'Prefer a computer? Connect the device and run <code>adb install -r {file}</code>.'],
      note: 'It is made for a big screen and a remote. It is signed with the same key as earlier versions, so it can update them.',
    },
  };

  let release = null;
  let failed = false;
  let current = 'std';
  const assetFor = (id) => release && release.assets.find((a) => PICKS[id].find.test(a.name));

  const renderPick = () => {
    const p = PICKS[current];
    const asset = assetFor(current);
    const version = current === 'android'
      ? (asset && (asset.name.match(/(\d+(?:\.\d+)+)/) || [])[1])
      : release && release.tag_name.replace(/^v/i, '');
    $('#get-title').textContent = version ? `${p.title} ${version}` : p.title;

    const meta = $('#get-meta');
    meta.innerHTML = '';
    const add = (html) => { const s = document.createElement('span'); s.innerHTML = html; meta.appendChild(s); };
    if (asset) {
      add(esc(p.where));
      add(`<b>${mb(asset.size)}</b>`);
      add(`published ${esc(relative(release.published_at))}`);
    } else if (failed) {
      add('Couldn’t check the latest version just now. The button opens the releases page.');
    } else if (release) {
      add('This file isn’t in the latest release. The button opens the releases page.');
    } else {
      add('Checking the latest release…');
    }

    $('#get-btn').href = asset ? asset.browser_download_url : (release ? release.html_url : RELEASES);
    $('#get-btn-text').textContent = asset ? p.button : 'Open the releases page';

    const file = asset ? asset.name : 'lumina-tv-VERSION.apk';
    $('#get-steps').innerHTML = p.steps.map((s) => `<li>${s.replace('{file}', esc(file))}</li>`).join('');
    $('#get-note span').textContent = p.note;

    const digest = asset && typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/, '') : '';
    $('#get-hash').hidden = !digest;
    $('#hash-code').textContent = digest;
    $('#hash-code').title = digest;
  };

  $('#hash-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#hash-code').textContent); say('Checksum copied'); } catch { say('Select the checksum and copy it'); }
  });

  const radios = $$('.choice');
  const pick = (id, focus) => {
    current = id;
    radios.forEach((r) => { const on = r.dataset.pick === id; r.setAttribute('aria-checked', String(on)); r.tabIndex = on ? 0 : -1; if (on && focus) r.focus(); });
    renderPick();
  };
  radios.forEach((r, i) => {
    r.tabIndex = i === 0 ? 0 : -1;
    r.addEventListener('click', () => pick(r.dataset.pick));
    r.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      pick(radios[(i + d + radios.length) % radios.length].dataset.pick, true);
    });
  });
  renderPick();

  const fillGlance = (r) => {
    const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
    set('g-version', r.tag_name.replace(/^v/i, ''));
    set('g-when', relative(r.published_at));
    const std = assetFor('std'); const full = assetFor('full'); const apk = assetFor('android');
    if (std) set('g-std', mb(std.size));
    if (full) set('g-full', mb(full.size));
    if (apk) set('g-apk', `${(apk.name.match(/(\d+(?:\.\d+)+)/) || [])[1] || ''} · ${mb(apk.size)}`.replace(/^ · /, ''));
  };

  getJSON(`https://api.github.com/repos/${REPO}/releases/latest`, 'lumina-release')
    .then((r) => {
      release = r;
      const pill = $('#release-pill');
      pill.classList.remove('off');
      pill.href = r.html_url;
      $('#release-pill-text').textContent = `Latest release ${r.tag_name.replace(/^v/i, '')} · ${relative(r.published_at)}`;
      fillGlance(r);
      renderPick();
    })
    .catch(() => { failed = true; renderPick(); });

  getJSON(`https://api.github.com/repos/${REPO}`, 'lumina-repo')
    .then((r) => { const n = $('#g-updated'); if (n) n.textContent = since(r.pushed_at); })
    .catch(() => { /* the figure stays a dash */ });
})();
