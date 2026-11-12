// Finds the list of episodes on a series page: the sidebar of "Ep 1, Ep 2, Ep 3 ..." beside a player.
//
// A classic script, like pagelinks.js: the popup injects it with chrome.scripting, and tests import it (it only defines globalThis.__luminaEpisodes).
// Nothing here talks to Lumina or opens a page. It only reads the page and answers with the list; what is behind each episode is found by the
// background worker (probe.js), because a list says which episodes exist, not which of them have a video yet.
(() => {
  if (globalThis.__luminaEpisodes) return;

  const MAX_EPISODES = 300;
  const MAX_NUMBER = 9999;
  // The name of the part of an address that counts episodes (?e=3, /episode-3, /ep3), and of the one that counts seasons (?s=1).
  const EPISODE_KEY = /^(?:e|ep|eps|epi|episode|episodes)$/i;
  const SEASON_KEY = /^(?:s|se|season|seasons)$/i;
  // "Ep 3", "Episode 3", "E03", "3. Title": the number a label starts with.
  const LABEL_EPISODE = /^\s*(?:(?:ep(?:isode)?|e)\.?\s*)?0*(\d{1,4})(?![\d])/i;
  const LABEL_HAS_EPISODE = /\b(?:ep(?:isode)?\.?|e)\s*0*(\d{1,4})\b/i;
  const UNAVAILABLE_WORDS = /\b(?:coming soon|not (?:yet )?available|unavailable|unreleased|upcoming|tba|locked|premium only)\b/i;
  const UNAVAILABLE_CLASS = /(?:^|[\s_-])(?:disabled|unavailable|locked|upcoming|soon|inactive)(?:$|[\s_-])/i;

  const numberOf = (text) => {
    const n = Number(text);
    return Number.isInteger(n) && n >= 0 && n <= MAX_NUMBER ? n : null;
  };

  /**
   * Every place in an address where a whole number sits: query values and digit runs in the path. Two addresses of the same shape have the
   * same slots in the same order, which is how "the part that changes from one episode to the next" is found.
   */
  function slotsOf(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    const slots = [];
    const shape = [url.origin];
    // The path, with each digit run as a slot. The text just before the digits names it ("episode-", "/ep", "/e").
    const path = url.pathname.replace(/(^|[^0-9])(\d{1,4})(?![0-9])/g, (all, before, digits, offset) => {
      const n = numberOf(digits);
      if (n === null) return all;
      const lead = url.pathname.slice(0, offset + before.length).split(/[\/]/).pop() ?? '';
      slots.push({ kind: 'path', key: lead.replace(/[-_.]+$/, ''), value: n, digits });
      return `${before}#`;
    });
    shape.push(path);
    const keys = [...url.searchParams.keys()].sort();
    for (const key of keys) {
      const value = url.searchParams.get(key) ?? '';
      const n = /^\d{1,4}$/.test(value) ? numberOf(value) : null;
      if (n !== null) {
        slots.push({ kind: 'query', key, value: n, digits: value });
        shape.push(`${key}=#`);
      } else {
        shape.push(`${key}=${value}`);
      }
    }
    return { url, slots, shape: shape.join('|') };
  }

  const isEpisodeSlot = (s) => (s.kind === 'query' ? EPISODE_KEY.test(s.key) : /(?:^|[-_/])(?:ep|episode|episodes|e)$/i.test(s.key) || /^s?\d*e$/i.test(s.key));
  const isSeasonSlot = (s) => s.kind === 'query' && SEASON_KEY.test(s.key);

  /** What the person would read for an episode: its own title, without the "Ep 3" the list repeats before it. */
  function cleanTitle(label, number) {
    let text = String(label ?? '').replace(/\s+/g, ' ').trim();
    const lead = new RegExp(`^(?:ep(?:isode)?\\.?\\s*0*${number}|e\\s*0*${number}|0*${number})\\s*[:.\\-–—)]?\\s*`, 'i');
    // Rows often say it twice ("Ep 3 ▶ Episode 3"): take the number away until nothing but the title is left.
    for (let i = 0; i < 3; i++) {
      const next = text.replace(lead, '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
      if (next === text) break;
      text = next;
    }
    if (new RegExp(`^(?:ep(?:isode)?\\.?\\s*0*${number})$`, 'i').test(text)) return '';
    return text.slice(0, 120);
  }

  /** "The Divorce Insurance | StreameX" -> "The Divorce Insurance". The site's own name is left out. */
  function showName(documentTitle, host) {
    const brand = String(host ?? '').toLowerCase().replace(/^www\./, '').split('.').filter((p) => !['com', 'net', 'org', 'tv', 'to', 'io', 'co', 'me', 'cc', 'hn', 'app', 'one', 'cx', 'ru', 'vip', 'xyz', 'fm', 'lol', 'se', 'sh'].includes(p)).join('');
    const parts = String(documentTitle ?? '').split(/\s+[|·•–—-]\s+/).map((p) => p.trim()).filter(Boolean);
    const clean = (p) => p.replace(/^(?:watch|stream|download)\s+/i, '').replace(/\s*\(?\b(?:s(?:eason)?\s*\d+\s*)?(?:e(?:p(?:isode)?)?\s*\d+)\b\)?/i, '').replace(/\s*[-–—:]\s*$/, '').trim();
    const named = parts.filter((p) => !brand || !p.toLowerCase().replace(/[^a-z0-9]/g, '').includes(brand.replace(/[^a-z0-9]/g, '')));
    return clean(named[0] ?? parts[0] ?? '') || String(host ?? '');
  }

  /** A row the page marks as not ready: a disabled link, a "coming soon" label. Only a hint; the video check has the last word. */
  const looksUnavailable = (c) => Boolean(c.unavailable) || UNAVAILABLE_WORDS.test(String(c.text ?? ''));

  /**
   * From the links on a page, the list of episodes, or null.
   *
   * Links are grouped by the shape of their address (the same address with only numbers different). A group is an episode list when one of
   * its numbers counts up by episode: named like one (?e=3, /episode-3), or, when it has no telling name, written as "Ep N" in the labels.
   * Several groups can qualify (a season each, or recommendations beside the list): the one holding the page being read is taken, else the biggest.
   */
  function group(candidates, pageUrl, documentTitle = '') {
    const page = slotsOf(pageUrl);
    // One entry per address. The same address can be linked twice (the current episode's row, and the button of the server it plays on):
    // the label that reads like an episode is the one kept, not whichever comes first on the page.
    const byHref = new Map();
    for (const c of candidates) {
      const href = String(c.href ?? '').split('#')[0];
      if (!href) continue;
      const had = byHref.get(href);
      if (!had) byHref.set(href, { ...c, href });
      else if (!LABEL_HAS_EPISODE.test(had.text ?? '') && LABEL_HAS_EPISODE.test(c.text ?? '')) byHref.set(href, { ...c, href, unavailable: had.unavailable || c.unavailable });
    }
    const buckets = new Map();
    for (const c of byHref.values()) {
      const info = slotsOf(c.href);
      if (!info || !info.slots.length) continue;
      const list = buckets.get(info.shape) ?? [];
      list.push({ ...c, info });
      buckets.set(info.shape, list);
    }

    const found = [];
    for (const [shape, links] of buckets) {
      if (links.length < 2) continue;
      const width = links[0].info.slots.length;
      for (let i = 0; i < width; i++) {
        const named = links.every((l) => isEpisodeSlot(l.info.slots[i]));
        // The number must count something: distinct from row to row (within one season), and not an id.
        const season = links[0].info.slots.findIndex(isSeasonSlot);
        const keyOf = (l) => (season >= 0 && season !== i ? l.info.slots[season].value : 0);
        const perSeason = new Map();
        let distinct = true;
        for (const l of links) {
          const k = keyOf(l);
          const set = perSeason.get(k) ?? new Set();
          if (set.has(l.info.slots[i].value)) distinct = false;
          set.add(l.info.slots[i].value);
          perSeason.set(k, set);
        }
        if (!distinct) continue;
        const values = new Set(links.map((l) => l.info.slots[i].value));
        if (values.size < 2) continue;
        const labelled = links.filter((l) => {
          // A bare number is a page number as often as an episode number, so an unnamed slot needs the label to say "Ep" or "Episode".
          const m = named ? (LABEL_EPISODE.exec(l.text ?? '') ?? LABEL_HAS_EPISODE.exec(l.text ?? '')) : LABEL_HAS_EPISODE.exec(l.text ?? '');
          return m && Number(m[1]) === l.info.slots[i].value;
        }).length;
        // An id is no episode number: ids are far apart; episode numbers count up from near 1.
        const sorted = [...values].sort((a, b) => a - b);
        const compact = sorted[0] <= 2 && sorted[sorted.length - 1] <= Math.max(60, sorted.length * 3);
        if (!(named || (labelled >= Math.ceil(links.length * 0.6) && (compact || labelled === links.length)))) continue;
        if (links.length < 3 && !named && labelled < links.length) continue;
        found.push({ shape, links, slot: i, season, score: links.length + (named ? 2 : 0) + labelled * 0.5 });
      }
    }
    if (!found.length) return null;

    const here = (g) => (page ? g.links.some((l) => l.href === page.url.href.split('#')[0]) || g.shape.split('|').slice(0, 2).join('|') === page.shape.split('|').slice(0, 2).join('|') : false);
    found.sort((a, b) => Number(here(b)) - Number(here(a)) || b.score - a.score);
    const best = found[0];

    const pageSlots = page?.slots ?? [];
    const pageEp = pageSlots.find((s) => s.kind === best.links[0].info.slots[best.slot].kind && s.key === best.links[0].info.slots[best.slot].key)?.value ?? null;
    const pageSeason = pageSlots.find(isSeasonSlot)?.value ?? null;
    const episodes = best.links.map((l) => {
      const n = l.info.slots[best.slot].value;
      const s = best.season >= 0 && best.season !== best.slot ? l.info.slots[best.season].value : 1;
      return {
        number: n, season: s, title: cleanTitle(l.text, n), url: l.href,
        current: pageEp !== null && n === pageEp && (best.season < 0 || pageSeason === null || pageSeason === s),
        unavailable: looksUnavailable(l),
      };
    }).sort((a, b) => a.season - b.season || a.number - b.number).slice(0, MAX_EPISODES);
    if (episodes.length < 2) return null;
    const host = page?.url.hostname ?? '';
    return { show: showName(documentTitle, host), episodes, synthetic: false };
  }

  /**
   * Rows that are not links: the page draws "Ep 1, Ep 2 ..." and a click navigates by script. If the address being read counts episodes
   * (?s=1&e=3), the address of each row is the same address with its number put in.
   */
  function synthesize(rows, pageUrl, documentTitle = '') {
    const page = slotsOf(pageUrl);
    if (!page) return null;
    const slot = page.slots.find((s) => isEpisodeSlot(s));
    if (!slot) return null;
    const seenNumbers = new Set();
    const episodes = [];
    for (const row of rows) {
      const m = LABEL_EPISODE.exec(row.text ?? '') ?? LABEL_HAS_EPISODE.exec(row.text ?? '');
      const n = m ? numberOf(m[1]) : null;
      if (n === null || seenNumbers.has(n)) continue;
      seenNumbers.add(n);
      const url = new URL(page.url.href);
      if (slot.kind === 'query') url.searchParams.set(slot.key, String(n));
      else {
        let k = -1;
        url.pathname = url.pathname.replace(/(^|[^0-9])(\d{1,4})(?![0-9])/g, (all, before, digits) => {
          k++;
          return k === page.slots.filter((s) => s.kind === 'path').indexOf(slot) ? `${before}${n}` : all;
        });
      }
      const season = page.slots.find(isSeasonSlot)?.value ?? 1;
      episodes.push({ number: n, season, title: cleanTitle(row.text, n), url: url.href, current: n === slot.value, unavailable: looksUnavailable(row) });
    }
    if (episodes.length < 3) return null;
    episodes.sort((a, b) => a.number - b.number);
    return { show: showName(documentTitle, page.url.hostname), episodes: episodes.slice(0, MAX_EPISODES), synthetic: true };
  }

  // ---- reading the page ----

  const hiddenByPage = (el) => {
    for (let node = el, depth = 0; node && node !== document.body && depth < 4; node = node.parentElement, depth++) {
      if (node.getAttribute?.('aria-disabled') === 'true' || node.hasAttribute?.('disabled')) return true;
      if (UNAVAILABLE_CLASS.test(String(node.className?.baseVal ?? node.className ?? ''))) return true;
    }
    return false;
  };

  // The popup asks on every page it is opened on, including pages of tens of thousands of elements, so reading is bounded: a few thousand links, text read
  // without forcing the page to lay itself out (innerText does), and the row scan only on a page whose own address counts episodes.
  const MAX_LINKS_READ = 3000;
  const MAX_LINKS_SCANNED = 250000;
  const MAX_ROWS_READ = 4000;
  const labelOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);

  /** True when the address counts episodes (?e=3, /episode-3): the only kind of page where rows that are not links can be given addresses. */
  function hasEpisodeSlot(href) {
    const info = slotsOf(href);
    return Boolean(info?.slots.some(isEpisodeSlot));
  }

  function read() {
    const here = location.href;
    const candidates = [];
    let seen = 0;
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
      if (++seen > MAX_LINKS_READ) break;
      candidates.push({ href: a.href, text: labelOf(a), unavailable: hiddenByPage(a) });
    }
    // A very long page: the first few thousand links were read in full. On a page whose own address counts episodes, the rest are looked over with the cheapest
    // test there is (does the address share this page's path?), so an episode list far down a huge page is still found.
    if (anchors.length > MAX_LINKS_READ && hasEpisodeSlot(here)) {
      const prefix = location.pathname.split('/').slice(0, 4).join('/');
      let more = 0;
      for (let i = MAX_LINKS_READ; i < Math.min(anchors.length, MAX_LINKS_SCANNED) && more < MAX_LINKS_READ; i++) {
        const a = anchors[i];
        if (!(a.getAttribute('href') || '').includes(prefix)) continue;
        candidates.push({ href: a.href, text: labelOf(a), unavailable: hiddenByPage(a) });
        more++;
      }
    }
    seen = 0;
    for (const el of document.querySelectorAll('[data-href], [data-url], [data-link]')) {
      if (++seen > MAX_LINKS_READ) break;
      if (el.matches('a[href]')) continue;
      const raw = el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('data-link');
      try { candidates.push({ href: new URL(raw, here).href, text: labelOf(el), unavailable: hiddenByPage(el) }); } catch { /* not an address */ }
    }
    const fromLinks = group(candidates, here, document.title);
    if (fromLinks) return fromLinks;
    // No links: rows that look like "Ep 3" and repeat. Taken only when the address itself counts episodes, so on every other page this costs nothing.
    if (!hasEpisodeSlot(here)) return null;
    const startsWithNumber = /^\s*(?:ep(?:isode)?\.?\s*)?\d{1,4}\b/i;
    const rows = [];
    seen = 0;
    for (const el of document.querySelectorAll('li, [role="listitem"], [role="button"], button, div')) {
      if (++seen > MAX_ROWS_READ) break;
      if (el.children.length > 8) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 80 || !startsWithNumber.test(text)) continue;
      // The innermost row only, not each box around it.
      if ([...el.children].some((c) => startsWithNumber.test((c.textContent || '').trim()) && c.tagName !== 'SPAN' && c.tagName !== 'B')) continue;
      rows.push({ text, unavailable: hiddenByPage(el) });
    }
    return synthesize(rows, here, document.title);
  }

  globalThis.__luminaEpisodes = { read, group, synthesize, cleanTitle, showName, slotsOf, hasEpisodeSlot };
})();
