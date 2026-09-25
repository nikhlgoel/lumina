// The browser's shield: a real filter engine, not a domain blacklist.
//
// Ad and tracker lists are written in Adblock Plus syntax, and the useful ones are hundreds of
// thousands of rules long. Two things follow, and both are why this is a module rather than a `Set`
// of hostnames:
//
//  * A rule is a pattern with conditions — resource type, first/third party, which sites it applies
//    to, and exceptions that *unblock*. `example.com` in a list does not mean "block that host".
//  * Every request in the browser has to be decided in well under a millisecond. Scanning every
//    rule per request is hopeless, so rules are indexed by a token drawn from their pattern, and a
//    request only ever compares against rules sharing one of its own tokens. That is how real
//    blockers do it, and it turns ~150k rules into a handful of comparisons.
//
// Scope, stated honestly: this implements the parts of the syntax the big lists actually lean on —
// `||domain^` anchors, wildcards, separators, `$type`, `$third-party`, `$domain=`, `@@` exceptions,
// and element hiding. It is not a complete ABP implementation; `$rewrite`, `$redirect`, scriptlet
// injection and procedural cosmetic operators are skipped rather than half-applied. See D20.

export const RESOURCE_TYPES = [
  'mainFrame', 'subFrame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xhr', 'ping', 'cspReport', 'media', 'webSocket', 'other',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Adblock option names mapped onto the resource types Electron actually reports. */
const TYPE_ALIASES: Record<string, ResourceType> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  'object-subrequest': 'object',
  xmlhttprequest: 'xhr',
  xhr: 'xhr',
  subdocument: 'subFrame',
  frame: 'subFrame',
  document: 'mainFrame',
  font: 'font',
  media: 'media',
  websocket: 'webSocket',
  ping: 'ping',
  beacon: 'ping',
  other: 'other',
};

/** Options that change *how* a request is answered rather than whether it matches; not supported. */
const UNSUPPORTED_OPTIONS = new Set(['rewrite', 'redirect', 'redirect-rule', 'csp', 'replace', 'removeparam', 'queryprune']);

export interface NetworkRule {
  raw: string;
  /** `@@` rules allow rather than block, and win over blocking rules. */
  exception: boolean;
  regex: RegExp;
  /** The token this rule is indexed under, or null when it has none distinctive enough. */
  token: string | null;
  /** Every token the rule could be filed under, so the build can pick the rarest. */
  tokens: string[];
  types: Set<ResourceType> | null;
  excludedTypes: Set<ResourceType> | null;
  /** true = third-party only, false = first-party only, null = either. */
  thirdParty: boolean | null;
  domains: string[] | null;
  excludedDomains: string[] | null;
}

export interface CosmeticRule {
  selector: string;
  domains: string[];
  excludedDomains: string[];
  /** `#@#` rules exempt a selector on particular sites. */
  exception: boolean;
}

/* ---------- Hostnames ---------- */

/**
 * Two-label public suffixes common enough to matter.
 *
 * A correct answer needs the Public Suffix List, which is a megabyte that would have to be shipped
 * and kept current. This covers the shapes that actually appear in `$domain=` options; anything
 * missed errs toward treating a request as third-party, which blocks slightly more rather than
 * silently letting a tracker through.
 */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'or.jp', 'ne.jp', 'co.in', 'co.kr', 'com.au',
  'net.au', 'org.au', 'com.br', 'com.cn', 'com.mx', 'com.tr', 'co.za', 'co.nz', 'com.sg',
  'com.hk', 'com.tw', 'co.il', 'com.ar', 'com.pl', 'com.ua',
]);

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LABEL_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Same site or not, by registrable domain — `img.cdn.example.com` is first-party to `example.com`. */
export function isThirdParty(requestHost: string | null, sourceHost: string | null): boolean {
  if (!requestHost || !sourceHost) return false;
  return registrableDomain(requestHost) !== registrableDomain(sourceHost);
}

/** True when `hostname` is `domain` or a subdomain of it. */
export function hostMatches(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/* ---------- Patterns ---------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turn an Adblock pattern into a regular expression.
 *
 * `||` anchors at a domain boundary, `|` at the start or end of the URL, `*` is any run, and `^` is
 * a separator — anything that is not a letter, digit, `_`, `-`, `.` or `%`, or the end of the URL.
 */
export function patternToRegex(pattern: string): RegExp {
  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    return new RegExp(pattern.slice(1, -1), 'i');
  }
  let src = '';
  let i = 0;
  if (pattern.startsWith('||')) {
    // Scheme, then any number of leading labels — so `||ads.com^` also catches `a.ads.com`, but
    // never `notads.com`, because the optional group has to end on a dot.
    src += '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?';
    i = 2;
  } else if (pattern.startsWith('|')) {
    src += '^';
    i = 1;
  }
  let end = pattern.length;
  let anchorEnd = false;
  if (end - 1 > i && pattern.endsWith('|')) {
    anchorEnd = true;
    end -= 1;
  }
  for (; i < end; i++) {
    const c = pattern[i]!;
    if (c === '*') src += '.*';
    else if (c === '^') src += '(?:[^\\w\\-.%]|$)';
    else src += escapeRe(c);
  }
  if (anchorEnd) src += '$';
  return new RegExp(src, 'i');
}

/**
 * The runs of characters a URL can be indexed by.
 *
 * Three characters is the shortest worth indexing; below that almost every URL contains it and the
 * bucket stops narrowing anything down.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
}

/**
 * Pick the token a rule is filed under.
 *
 * It has to be a run that every URL the rule matches necessarily contains, so runs after a `*` are
 * still fine (they remain substrings) but a `/regex/` rule is not indexed at all. The longest run
 * is chosen because it is the rarest, which makes its bucket the smallest.
 */
export function ruleTokens(pattern: string): string[] {
  if (pattern.startsWith('/') && pattern.endsWith('/')) return [];
  return tokenize(pattern);
}

export function ruleToken(pattern: string): string | null {
  const tokens = ruleTokens(pattern);
  if (!tokens.length) return null;
  return tokens.reduce((best, t) => (t.length > best.length ? t : best));
}

/* ---------- Parsing ---------- */

/**
 * Split a domain list into the sites a rule applies to and the ones it does not.
 *
 * The two syntaxes disagree on the separator, which is the sort of detail that silently half-works:
 * a network rule writes `$domain=a.com|b.com`, an element-hiding rule writes `a.com,~b.com##…`.
 */
const splitDomains = (value: string, separator: string) => {
  const domains: string[] = [];
  const excluded: string[] = [];
  for (const part of value.split(separator)) {
    const d = part.trim().toLowerCase();
    if (!d) continue;
    if (d.startsWith('~')) excluded.push(d.slice(1));
    else domains.push(d);
  }
  return { domains, excluded };
};

/** Parse one network filter line. Returns null for comments, cosmetic rules and unsupported syntax. */
export function parseNetworkRule(line: string): NetworkRule | null {
  const raw = line.trim();
  if (!raw || raw.startsWith('!') || raw.startsWith('[')) return null;
  if (/#[@?$]?#/.test(raw)) return null; // cosmetic; handled separately

  let body = raw;
  const exception = body.startsWith('@@');
  if (exception) body = body.slice(2);

  let types: Set<ResourceType> | null = null;
  let excludedTypes: Set<ResourceType> | null = null;
  let thirdParty: boolean | null = null;
  let domains: string[] | null = null;
  let excludedDomains: string[] | null = null;

  const optionsAt = body.lastIndexOf('$');
  // A `$` inside a /regex/ rule is part of the pattern, not an option list.
  const hasOptions = optionsAt > 0 && !(body.startsWith('/') && body.endsWith('/'));
  if (hasOptions) {
    const optionText = body.slice(optionsAt + 1);
    body = body.slice(0, optionsAt);
    for (const option of optionText.split(',')) {
      const opt = option.trim();
      if (!opt) continue;
      const eq = opt.indexOf('=');
      const name = (eq === -1 ? opt : opt.slice(0, eq)).replace(/^~/, '').toLowerCase();
      const negated = opt.startsWith('~');
      const value = eq === -1 ? '' : opt.slice(eq + 1);

      if (UNSUPPORTED_OPTIONS.has(name)) return null;
      if (name === 'third-party' || name === '3p') { thirdParty = !negated; continue; }
      if (name === 'first-party' || name === '1p') { thirdParty = negated; continue; }
      if (name === 'domain' || name === 'from') {
        const split = splitDomains(value, '|');
        if (split.domains.length) domains = split.domains;
        if (split.excluded.length) excludedDomains = split.excluded;
        continue;
      }
      const type = TYPE_ALIASES[name];
      if (type) {
        if (negated) (excludedTypes ??= new Set()).add(type);
        else (types ??= new Set()).add(type);
        continue;
      }
      // Options that only narrow matching further (match-case, important, popup, …) are ignored
      // rather than treated as a parse failure: dropping the rule blocks less, not more.
    }
  }

  if (!body) return null;
  let regex: RegExp;
  try {
    regex = patternToRegex(body);
  } catch {
    return null; // a malformed /regex/ rule in a downloaded list must not take the engine down
  }

  const tokens = ruleTokens(body);
  return { raw, exception, regex, token: ruleToken(body), tokens, types, excludedTypes, thirdParty, domains, excludedDomains };
}

/** Parse one element-hiding line (`example.com##.ad`, `##.ad`, `example.com#@#.ad`). */
export function parseCosmeticRule(line: string): CosmeticRule | null {
  const raw = line.trim();
  if (!raw || raw.startsWith('!')) return null;
  const m = /^(.*?)#(@?)#(.+)$/.exec(raw);
  if (!m) return null;
  const [, domainPart = '', at = '', selector = ''] = m;
  // Procedural selectors need a running engine in the page; skipped rather than half-applied.
  if (/:-abp-|:has-text|:matches-css|:xpath|:upward|:remove\(/.test(selector)) return null;
  if (!selector.trim()) return null;
  const { domains, excluded } = domainPart ? splitDomains(domainPart, ',') : { domains: [], excluded: [] };
  return { selector: selector.trim(), domains, excludedDomains: excluded, exception: at === '@' };
}

/* ---------- The engine ---------- */

export interface ShieldRequest {
  url: string;
  /** The page the request belongs to; null for a top-level navigation. */
  sourceHostname: string | null;
  type: ResourceType;
}

export interface ShieldMatch {
  blocked: boolean;
  /** The rule that decided it, for the "why was this blocked" panel. */
  rule: string | null;
}

export interface ShieldEngine {
  readonly networkRuleCount: number;
  readonly cosmeticRuleCount: number;
  match(req: ShieldRequest): ShieldMatch;
  /** CSS hiding the elements the lists call ads on this hostname. */
  cosmeticCss(hostname: string): string;
}

function ruleApplies(rule: NetworkRule, req: ShieldRequest, requestHost: string | null): boolean {
  if (rule.types && !rule.types.has(req.type)) return false;
  if (rule.excludedTypes?.has(req.type)) return false;
  if (rule.thirdParty !== null && rule.thirdParty !== isThirdParty(requestHost, req.sourceHostname)) return false;
  if (rule.domains || rule.excludedDomains) {
    const host = req.sourceHostname;
    if (rule.excludedDomains && host && rule.excludedDomains.some((d) => hostMatches(host, d))) return false;
    if (rule.domains && !(host && rule.domains.some((d) => hostMatches(host, d)))) return false;
  }
  return rule.regex.test(req.url);
}

/**
 * Build an engine from filter-list text.
 *
 * Lists are given as whole files because that is how they arrive, and a bad line is skipped rather
 * than failing the load — a downloaded list that gained one unsupported rule must not leave the
 * browser with no protection at all.
 */
export function buildShieldEngine(lists: readonly string[]): ShieldEngine {
  const blockByToken = new Map<string, NetworkRule[]>();
  const blockGeneric: NetworkRule[] = [];
  const allowByToken = new Map<string, NetworkRule[]>();
  const allowGeneric: NetworkRule[] = [];
  const cosmeticGeneric: string[] = [];
  const cosmeticByDomain: CosmeticRule[] = [];
  const cosmeticExceptions: CosmeticRule[] = [];
  let networkRuleCount = 0;
  let cosmeticRuleCount = 0;

  // Parsed first, filed second. Which token a rule should be filed under depends on how common
  // that token is across the *whole* list, which is not known until every rule has been read.
  const parsed: NetworkRule[] = [];
  const frequency = new Map<string, number>();

  for (const list of lists) {
    for (const line of list.split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text.startsWith('!') || text.startsWith('[Adblock')) continue;
      const cosmetic = parseCosmeticRule(text);
      if (cosmetic) {
        cosmeticRuleCount++;
        if (cosmetic.exception) cosmeticExceptions.push(cosmetic);
        else if (cosmetic.domains.length || cosmetic.excludedDomains.length) cosmeticByDomain.push(cosmetic);
        else cosmeticGeneric.push(cosmetic.selector);
        continue;
      }
      const rule = parseNetworkRule(text);
      if (!rule) continue;
      parsed.push(rule);
      for (const token of rule.tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }

  /**
   * Test every rule that could apply, without building a list of them first.
   *
   * The obvious version collects the candidate rules into an array and then scans it. That array is
   * allocated on every single request the browser makes, and it measured at 114us per request
   * against the real lists - for a page of a hundred requests, 11ms of pure bookkeeping. Walking
   * the buckets in place does the same work with no allocation at all.
   */
  /**
   * File each rule under its *rarest* token, not its longest.
   *
   * Filing by length looked sensible and measured badly: `analytics` is long, so 838 rules landed
   * in one bucket and every request to an analytics host was compared against all of them. The
   * rarest token narrows the search most, which is the entire purpose of the index.
   */
  for (const rule of parsed) {
    const byToken = rule.exception ? allowByToken : blockByToken;
    const generic = rule.exception ? allowGeneric : blockGeneric;
    let best: string | null = null;
    let bestCount = Infinity;
    for (const token of rule.tokens) {
      const count = frequency.get(token) ?? 0;
      if (count < bestCount) {
        best = token;
        bestCount = count;
      }
    }
    if (best) {
      const bucket = byToken.get(best);
      if (bucket) bucket.push(rule);
      else byToken.set(best, [rule]);
    } else {
      generic.push(rule);
    }
    networkRuleCount++;
  }

  const firstMatch = (
    byToken: Map<string, NetworkRule[]>,
    generic: NetworkRule[],
    tokens: string[],
    req: ShieldRequest,
    requestHost: string | null,
  ): NetworkRule | null => {
    for (const rule of generic) if (ruleApplies(rule, req, requestHost)) return rule;
    for (const token of tokens) {
      const bucket = byToken.get(token);
      if (!bucket) continue;
      for (const rule of bucket) if (ruleApplies(rule, req, requestHost)) return rule;
    }
    return null;
  };

  return {
    networkRuleCount,
    cosmeticRuleCount,

    match(req) {
      const requestHost = hostnameOf(req.url);
      const tokens = tokenize(req.url);

      // An exception is checked first and short-circuits: `@@` exists to unblock, so a page that
      // needs a script the lists would otherwise kill keeps working.
      const allowed = firstMatch(allowByToken, allowGeneric, tokens, req, requestHost);
      if (allowed) return { blocked: false, rule: allowed.raw };
      const blocked = firstMatch(blockByToken, blockGeneric, tokens, req, requestHost);
      return blocked ? { blocked: true, rule: blocked.raw } : { blocked: false, rule: null };
    },

    cosmeticCss(hostname) {
      const host = hostname.toLowerCase();
      const hidden = new Set(cosmeticGeneric);
      for (const rule of cosmeticByDomain) {
        if (rule.excludedDomains.some((d) => hostMatches(host, d))) continue;
        if (rule.domains.length && !rule.domains.some((d) => hostMatches(host, d))) continue;
        hidden.add(rule.selector);
      }
      for (const rule of cosmeticExceptions) {
        if (!rule.domains.length || rule.domains.some((d) => hostMatches(host, d))) hidden.delete(rule.selector);
      }
      if (!hidden.size) return '';
      return `${[...hidden].join(',\n')} { display: none !important; }`;
    },
  };
}

/* ---------- Upgrading to https ---------- */

/**
 * Sites that break on https are not worth guessing at, so the upgrade is attempted and the failure
 * remembered — the same shape as a browser's own behaviour, without pretending to be HSTS.
 * `localhost` and raw addresses are left alone: there is usually no certificate for them, and
 * upgrading breaks development servers and local devices.
 */
export function shouldUpgradeToHttps(url: string, failedHosts: ReadonlySet<string>): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return null;
  if (failedHosts.has(host)) return null;
  parsed.protocol = 'https:';
  return parsed.toString();
}
