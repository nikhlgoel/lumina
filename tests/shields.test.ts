import { describe, it, expect } from 'vitest';
import {
  buildShieldEngine, hostMatches, hostnameOf, isThirdParty, parseCosmeticRule, parseNetworkRule,
  patternToRegex, registrableDomain, ruleToken, shouldUpgradeToHttps, tokenize,
} from '@core/shields';

import type { ResourceType } from '@core/shields';

const req = (url: string, sourceHostname: string | null = 'example.com', type: ResourceType = 'script') =>
  ({ url, sourceHostname, type });

describe('working out what counts as the same site', () => {
  it('treats subdomains as the same site', () => {
    expect(registrableDomain('img.cdn.example.com')).toBe('example.com');
    expect(isThirdParty('img.cdn.example.com', 'www.example.com')).toBe(false);
  });

  it('spots a genuinely different site', () => {
    expect(isThirdParty('tracker.net', 'example.com')).toBe(true);
  });

  it('handles the two-label suffixes that actually turn up in lists', () => {
    expect(registrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(isThirdParty('news.bbc.co.uk', 'www.bbc.co.uk')).toBe(false);
    // Without this, every co.uk site would look third-party to itself and get over-blocked.
    expect(isThirdParty('ads.example.co.uk', 'www.bbc.co.uk')).toBe(true);
  });

  it('says first-party when there is nothing to compare against', () => {
    // A top-level navigation has no source; treating it as third-party would apply the wrong rules.
    expect(isThirdParty('example.com', null)).toBe(false);
  });

  it('matches a domain and its subdomains, and nothing that merely ends the same', () => {
    expect(hostMatches('a.ads.com', 'ads.com')).toBe(true);
    expect(hostMatches('ads.com', 'ads.com')).toBe(true);
    expect(hostMatches('notads.com', 'ads.com')).toBe(false);
  });

  it('returns nothing for a URL it cannot read', () => {
    expect(hostnameOf('not a url')).toBeNull();
  });
});

describe('turning a filter pattern into a matcher', () => {
  it('anchors || at a domain boundary, including subdomains', () => {
    const re = patternToRegex('||ads.com^');
    expect(re.test('https://ads.com/x')).toBe(true);
    expect(re.test('https://a.ads.com/x')).toBe(true);
    // The whole point of the boundary: these must not match.
    expect(re.test('https://notads.com/x')).toBe(false);
    expect(re.test('https://example.com/?u=ads.com')).toBe(false);
  });

  it('treats ^ as a separator that the end of a URL also satisfies', () => {
    const re = patternToRegex('||ads.com^');
    expect(re.test('https://ads.com')).toBe(true);
    expect(re.test('https://ads.com?a=1')).toBe(true);
  });

  it('expands * and anchors | at either end', () => {
    expect(patternToRegex('/banner*.gif').test('https://x.com/banner-large.gif')).toBe(true);
    expect(patternToRegex('|https://only.start').test('https://only.start/a')).toBe(true);
    expect(patternToRegex('|https://only.start').test('https://x.com/?u=https://only.start')).toBe(false);
    expect(patternToRegex('/track.js|').test('https://x.com/track.js')).toBe(true);
    expect(patternToRegex('/track.js|').test('https://x.com/track.js?a=1')).toBe(false);
  });

  it('takes a /regex/ rule literally', () => {
    expect(patternToRegex('/ad[0-9]+\\.js/').test('https://x.com/ad42.js')).toBe(true);
  });

  it('escapes characters that would otherwise be regex syntax', () => {
    expect(patternToRegex('/a.b/c').test('https://x.com/a.b/c')).toBe(true);
    expect(patternToRegex('/a.b/c').test('https://x.com/axb/c')).toBe(false);
  });
});

describe('indexing rules by token', () => {
  it('picks the longest run, because it is the rarest', () => {
    expect(ruleToken('||doubleclick.net^')).toBe('doubleclick');
  });

  it('refuses to index a regex rule, which has no guaranteed substring', () => {
    expect(ruleToken('/ad[0-9]+/')).toBeNull();
  });

  it('finds nothing to index in a pattern of punctuation', () => {
    expect(ruleToken('/*/')).toBeNull();
    expect(tokenize('https://a.io/x')).toEqual(['https']);
  });
});

describe('reading the options on a rule', () => {
  it('reads a type restriction', () => {
    const r = parseNetworkRule('||ads.com^$script,image')!;
    expect(r.types).toEqual(new Set(['script', 'image']));
  });

  it('reads first- and third-party restrictions both ways round', () => {
    expect(parseNetworkRule('||ads.com^$third-party')!.thirdParty).toBe(true);
    expect(parseNetworkRule('||ads.com^$~third-party')!.thirdParty).toBe(false);
    expect(parseNetworkRule('||ads.com^')!.thirdParty).toBeNull();
  });

  it('reads the sites a rule applies to, and the ones it does not', () => {
    const r = parseNetworkRule('||ads.com^$domain=a.com|~b.a.com')!;
    expect(r.domains).toEqual(['a.com']);
    expect(r.excludedDomains).toEqual(['b.a.com']);
  });

  it('recognises an exception rule', () => {
    expect(parseNetworkRule('@@||ads.com^$script')!.exception).toBe(true);
  });

  it('skips comments, section headers and cosmetic lines', () => {
    expect(parseNetworkRule('! a comment')).toBeNull();
    expect(parseNetworkRule('[Adblock Plus 2.0]')).toBeNull();
    expect(parseNetworkRule('example.com##.ad')).toBeNull();
  });

  it('drops rules whose option changes the response rather than the verdict', () => {
    // Half-applying $redirect would let the request through believing it had been handled.
    expect(parseNetworkRule('||ads.com^$redirect=noop.js')).toBeNull();
    expect(parseNetworkRule('||ads.com^$removeparam=fbclid')).toBeNull();
  });

  it('keeps a rule whose only unknown option just narrows it further', () => {
    expect(parseNetworkRule('||ads.com^$important')).not.toBeNull();
  });

  it('survives a malformed regex rule instead of throwing', () => {
    expect(parseNetworkRule('/ad[0-9/')).toBeNull();
  });
});

describe('blocking decisions', () => {
  const engine = buildShieldEngine([`
! test list
||doubleclick.net^
||tracker.net^$third-party
||cdn.example.com/ads.js$script
@@||tracker.net^$domain=partner.com
/analytics.js
`]);

  it('blocks an ad host', () => {
    expect(engine.match(req('https://ads.doubleclick.net/pixel.gif')).blocked).toBe(true);
  });

  it('leaves an ordinary request alone', () => {
    const m = engine.match(req('https://example.com/app.js'));
    expect(m.blocked).toBe(false);
    expect(m.rule).toBeNull();
  });

  it('applies a third-party rule only to third parties', () => {
    expect(engine.match(req('https://tracker.net/t.js', 'example.com')).blocked).toBe(true);
    expect(engine.match(req('https://tracker.net/t.js', 'tracker.net')).blocked).toBe(false);
  });

  it('lets an exception unblock a site that needs the script', () => {
    // The whole reason @@ exists: a page that breaks without it keeps working.
    expect(engine.match(req('https://tracker.net/t.js', 'partner.com')).blocked).toBe(false);
    expect(engine.match(req('https://tracker.net/t.js', 'other.com')).blocked).toBe(true);
  });

  it('honours a type restriction', () => {
    expect(engine.match({ url: 'https://cdn.example.com/ads.js', sourceHostname: 'x.com', type: 'script' }).blocked).toBe(true);
    expect(engine.match({ url: 'https://cdn.example.com/ads.js', sourceHostname: 'x.com', type: 'image' }).blocked).toBe(false);
  });

  it('matches a plain substring rule anywhere in the URL', () => {
    expect(engine.match(req('https://any.site/js/analytics.js')).blocked).toBe(true);
  });

  it('names the rule that decided it, so the panel can say why', () => {
    expect(engine.match(req('https://ads.doubleclick.net/x')).rule).toBe('||doubleclick.net^');
  });

  it('counts what it loaded', () => {
    expect(engine.networkRuleCount).toBe(5);
  });
});

describe('a request the token index must not miss', () => {
  // The index is an optimisation, and an optimisation that changes the answer is a bug.
  const engine = buildShieldEngine(['||metrics.somewhere.example^']);

  it('finds a rule whose token is buried in the URL', () => {
    expect(engine.match(req('https://metrics.somewhere.example/a/b/c?q=1')).blocked).toBe(true);
  });

  it('agrees with a rule-at-a-time scan across a mixed list', () => {
    const lines = ['||a-ads.com^', '/pixel.gif', '||stats.io^$image', '||x.co^$third-party'];
    const indexed = buildShieldEngine([lines.join('\n')]);
    const urls = [
      'https://a-ads.com/x', 'https://cdn.net/pixel.gif', 'https://stats.io/p.png',
      'https://x.co/y', 'https://safe.org/app.js',
    ];
    for (const url of urls) {
      const one = indexed.match(req(url, 'example.com', 'image'));
      // Each rule on its own, in an engine of one: the verdict must be identical.
      const separately = lines.some((line) => buildShieldEngine([line]).match(req(url, 'example.com', 'image')).blocked);
      expect(one.blocked, url).toBe(separately);
    }
  });
});

describe('hiding elements', () => {
  const engine = buildShieldEngine([`
##.generic-ad
example.com##.sponsored
example.com#@#.generic-ad
~news.example.com,example.com##.only-here
`]);

  it('hides the generic selectors everywhere', () => {
    expect(engine.cosmeticCss('anything.org')).toContain('.generic-ad');
  });

  it('adds the selectors for this site', () => {
    expect(engine.cosmeticCss('example.com')).toContain('.sponsored');
    expect(engine.cosmeticCss('other.org')).not.toContain('.sponsored');
  });

  it('lets a site exempt a generic selector that breaks it', () => {
    expect(engine.cosmeticCss('example.com')).not.toContain('.generic-ad');
  });

  it('honours an excluded subdomain', () => {
    expect(engine.cosmeticCss('news.example.com')).not.toContain('.only-here');
    expect(engine.cosmeticCss('shop.example.com')).toContain('.only-here');
  });

  it('produces valid, unconditional CSS', () => {
    expect(engine.cosmeticCss('example.com')).toMatch(/\{ display: none !important; \}$/);
  });

  it('says nothing when there is nothing to hide', () => {
    expect(buildShieldEngine(['||ads.com^']).cosmeticCss('example.com')).toBe('');
  });

  it('skips procedural selectors rather than emitting CSS that cannot work', () => {
    expect(parseCosmeticRule('example.com##.a:has-text(Ad)')).toBeNull();
    expect(parseCosmeticRule('example.com##.plain')).not.toBeNull();
  });
});

describe('upgrading to https', () => {
  const none = new Set<string>();

  it('upgrades a plain http page', () => {
    expect(shouldUpgradeToHttps('http://example.com/a?b=1', none)).toBe('https://example.com/a?b=1');
  });

  it('leaves https alone', () => {
    expect(shouldUpgradeToHttps('https://example.com/', none)).toBeNull();
  });

  it('leaves local addresses alone, so development servers and devices still work', () => {
    expect(shouldUpgradeToHttps('http://localhost:3000/', none)).toBeNull();
    expect(shouldUpgradeToHttps('http://192.168.1.10/', none)).toBeNull();
    expect(shouldUpgradeToHttps('http://printer.local/', none)).toBeNull();
  });

  it('stops trying for a host that already failed', () => {
    expect(shouldUpgradeToHttps('http://oldsite.org/', new Set(['oldsite.org']))).toBeNull();
  });

  it('ignores something that is not a URL', () => {
    expect(shouldUpgradeToHttps('mailto:a@b.com', none)).toBeNull();
    expect(shouldUpgradeToHttps('nonsense', none)).toBeNull();
  });
});
