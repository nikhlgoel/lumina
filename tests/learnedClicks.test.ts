import { describe, expect, it } from 'vitest';
import { LearnedClicks, SIGNATURE_MATCHER, SIGNATURE_THRESHOLD, cleanSignature, stableClasses, type ClickSignature } from '@core/learnedClicks';

const sig = (over: Partial<ClickSignature> = {}): ClickSignature => ({ tag: 'button', id: '', name: '', classes: ['btn', 'go'], text: '→', role: '', type: '', ...over });
const DAY = 24 * 3600 * 1000;

describe('remembering what the person clicked', () => {
  it('keeps it for the site and gives it back', () => {
    const l = new LearnedClicks();
    expect(l.remember('host.example', sig(), 0)).toBe(true);
    expect(l.recall('host.example', 1)).toEqual([sig()]);
    expect(l.recall('other.example', 1)).toEqual([]);
  });

  it('keeps five at most, newest first, and moves a repeat to the front instead of doubling it', () => {
    const l = new LearnedClicks();
    for (let i = 1; i <= 7; i++) l.remember('h.example', sig({ id: `b${i}`, text: `go ${i}` }), i);
    expect(l.recall('h.example', 10).map((s) => s.id)).toEqual(['b7', 'b6', 'b5', 'b4', 'b3']);
    l.remember('h.example', sig({ id: 'b4', text: 'go 4' }), 11);
    expect(l.recall('h.example', 12).map((s) => s.id)).toEqual(['b4', 'b7', 'b6', 'b5', 'b3']);
  });

  it('forgets what is half a year old', () => {
    const l = new LearnedClicks();
    l.remember('h.example', sig(), 0);
    expect(l.recall('h.example', 179 * DAY)).toHaveLength(1);
    expect(l.recall('h.example', 181 * DAY)).toEqual([]);
  });

  it('does not learn a control that cannot be told from any other', () => {
    const l = new LearnedClicks();
    expect(l.remember('h.example', sig({ id: '', name: '', text: '', classes: [] }), 0)).toBe(false);
    expect(l.remember('h.example', { nonsense: true }, 0)).toBe(false);
    expect(l.remember('h.example', null, 0)).toBe(false);
  });

  it('never learns a click on the check itself', () => {
    expect(cleanSignature(sig({ classes: ['g-recaptcha'], id: '' }))).toBeNull();
    expect(cleanSignature(sig({ id: 'cf-turnstile-wrap' }))).toBeNull();
    expect(cleanSignature(sig({ id: 'challenge-stage' }))).toBeNull();
  });

  it('drops classes a page changes by itself, and generated ones', () => {
    expect(stableClasses(['btn', 'active', 'hover', 'css-1a2b3c4d', 'sc-abcdef', 'go-button', 'is-123456'])).toEqual(['btn', 'go-button']);
  });

  it('can be forgotten, for one site or all', () => {
    const l = new LearnedClicks();
    l.remember('a.example', sig(), 0);
    l.remember('b.example', sig(), 0);
    l.forget('a.example');
    expect(l.recall('a.example', 1)).toEqual([]);
    expect(l.recall('b.example', 1)).toHaveLength(1);
    l.forget();
    expect(l.recall('b.example', 1)).toEqual([]);
  });

  it('survives being saved and loaded, and drops anything damaged in the file instead of trusting it', () => {
    const l = new LearnedClicks();
    l.remember('a.example', sig({ id: 'x1' }), 5);
    const loaded = LearnedClicks.fromJSON(JSON.parse(JSON.stringify(l.toJSON())));
    expect(loaded.recall('a.example', 6)).toEqual([sig({ id: 'x1' })]);
    const damaged = LearnedClicks.fromJSON({ 'a.example': [{ sig: { tag: 5 }, at: 1 }, 'junk', { sig: sig({ id: 'ok' }), at: 2 }], 'b.example': 'nope', 'c.example': [{ sig: sig({ classes: ['g-recaptcha'] }), at: 1 }] });
    expect(damaged.recall('a.example', 3).map((s) => s.id)).toEqual(['ok']);
    expect(damaged.recall('b.example', 3)).toEqual([]);
    expect(damaged.recall('c.example', 3)).toEqual([]);
    expect(LearnedClicks.fromJSON('garbage').recall('a.example', 1)).toEqual([]);
    expect(LearnedClicks.fromJSON(null).recall('a.example', 1)).toEqual([]);
  });
});

// The matcher runs in the page; here it runs in Node against stand-in elements, so the real function is what is tested.
const api = new Function(`${SIGNATURE_MATCHER}; return { matchSignature, describeControl, matchById };`)() as {
  matchSignature: (s: ClickSignature, el: unknown) => number;
  matchById: (s: ClickSignature, el: unknown) => boolean;
  describeControl: (el: unknown) => ClickSignature;
};
const el = (o: { tag?: string; id?: string; className?: string; text?: string; attrs?: Record<string, string> }) => ({
  tagName: (o.tag ?? 'BUTTON').toUpperCase(), id: o.id ?? '', className: o.className ?? '', innerText: o.text ?? '', value: '',
  getAttribute: (k: string) => o.attrs?.[k] ?? null,
});

describe('finding a learned control again', () => {
  const learned = sig({ id: 'go', classes: ['btn', 'go-btn'], text: '→' });

  it('finds it unchanged', () => {
    expect(api.matchSignature(learned, el({ id: 'go', className: 'btn go-btn', text: '→' }))).toBeGreaterThanOrEqual(SIGNATURE_THRESHOLD);
  });

  it('finds it after the host changed its classes and moved it, when the id is the same', () => {
    expect(api.matchSignature(learned, el({ id: 'go', className: 'x-new-look', text: '→' }))).toBeGreaterThanOrEqual(SIGNATURE_THRESHOLD);
  });

  it('finds it after the host dropped the id, when the words are the same', () => {
    expect(api.matchSignature(learned, el({ id: '', className: 'btn go-btn', text: '→' }))).toBeGreaterThanOrEqual(SIGNATURE_THRESHOLD);
  });

  it('finds it when the tag changed from a button to a link but the id and words held', () => {
    expect(api.matchSignature(learned, el({ tag: 'a', id: 'go', text: '→' }))).toBeGreaterThanOrEqual(SIGNATURE_THRESHOLD);
  });

  it('does not take another control just because it is also a button with the same class', () => {
    expect(api.matchSignature(learned, el({ id: 'other', className: 'btn go-btn', text: 'Cancel' }))).toBe(0);
  });

  it('does not take a control with only the tag in common', () => {
    expect(api.matchSignature(learned, el({ id: '', className: '', text: 'Something else' }))).toBe(0);
  });

  it('describes a control the way it is stored, without a generated class', () => {
    const d = api.describeControl(el({ id: 'b', className: 'btn active css-1a2b3c4d', text: '  Go   on ', attrs: { role: 'button', name: 'n' } }));
    expect(d).toEqual({ tag: 'button', id: 'b', name: 'n', classes: ['btn'], text: 'Go on', role: 'button', type: '' });
  });
});

describe('telling a match on the id from a match on the words alone', () => {
  const learned = sig({ id: 'go', text: 'Download' });

  it('knows when the id is the same', () => {
    expect(api.matchById(learned, el({ id: 'go', text: 'Download' }))).toBe(true);
    expect(api.matchById(learned, el({ id: 'other', text: 'Download' }))).toBe(false);
  });

  it('never calls two controls with no id the same one', () => {
    expect(api.matchById(sig({ id: '' }), el({ id: '', text: 'Download' }))).toBe(false);
  });

  it('still matches on the words alone when the id is gone, so a decoy can be told apart by the caller', () => {
    expect(api.matchSignature(learned, el({ id: '', text: 'Download' }))).toBeGreaterThanOrEqual(SIGNATURE_THRESHOLD);
    expect(api.matchById(learned, el({ id: '', text: 'Download' }))).toBe(false);
  });
});
