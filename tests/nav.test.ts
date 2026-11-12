import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { keyFor, navKeys, navViews, type NavOptions } from '@core/nav';
import { settingsSchema } from '@shared/settings';

const opts = (o: Partial<NavOptions> = {}): NavOptions => ({ hasBrowser: true, showBrowser: false, hasIde: true, ...o });

describe('the sidebar', () => {
  it('offers the downloader, queue and library, the code editor, and settings by default: no browser until asked for', () => {
    expect(navViews(opts())).toEqual(['download', 'queue', 'library', 'ide', 'settings']);
  });

  it('adds the browser, in its old place, when it is asked for', () => {
    expect(navViews(opts({ showBrowser: true }))).toEqual(['download', 'queue', 'library', 'browser', 'ide', 'settings']);
  });

  it('never offers what the build does not contain, whatever the setting says', () => {
    expect(navViews(opts({ hasBrowser: false, showBrowser: true }))).not.toContain('browser');
    expect(navViews(opts({ hasIde: false }))).not.toContain('ide');
    expect(navViews(opts({ hasBrowser: false, hasIde: false }))).toEqual(['download', 'queue', 'library', 'settings']);
  });
});

describe('the keys', () => {
  it('number what is shown, with no gap, and give settings its comma', () => {
    expect(navKeys(opts())).toEqual({ 1: 'download', 2: 'queue', 3: 'library', 4: 'ide', ',': 'settings' });
    expect(navKeys(opts({ showBrowser: true }))).toEqual({ 1: 'download', 2: 'queue', 3: 'library', 4: 'browser', 5: 'ide', ',': 'settings' });
  });

  it('send no key to a screen that is not offered (the shortcut used to land on an empty pane in a build without it)', () => {
    expect(Object.values(navKeys(opts()))).not.toContain('browser');
    expect(Object.values(navKeys(opts({ hasBrowser: false, showBrowser: true })))).not.toContain('browser');
    expect(Object.values(navKeys(opts({ hasIde: false })))).not.toContain('ide');
  });

  it('shows beside each item the key that goes to it', () => {
    expect(keyFor('ide', opts())).toBe('4');
    expect(keyFor('ide', opts({ showBrowser: true }))).toBe('5');
    expect(keyFor('settings', opts())).toBe(',');
    expect(keyFor('browser', opts())).toBe('');
  });

  it('for every combination: each offered screen has exactly one key, the keys are 1..n then a comma, and every key goes to an offered screen', () => {
    fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (hasBrowser, showBrowser, hasIde) => {
      const o = { hasBrowser, showBrowser, hasIde };
      const views = navViews(o);
      const keys = navKeys(o);
      expect(new Set(Object.values(keys))).toEqual(new Set(views));
      expect(Object.keys(keys).filter((k) => k !== ',').sort()).toEqual(Array.from({ length: views.length - 1 }, (_, i) => String(i + 1)));
      for (const v of views) expect(keyFor(v, o)).not.toBe('');
    }));
  });
});

describe('the setting', () => {
  it('is off for a new install and for a settings file from before it existed', () => {
    expect(settingsSchema.parse({}).browser.showInSidebar).toBe(false);
    expect(settingsSchema.parse({ browser: { shieldsEnabled: true } }).browser.showInSidebar).toBe(false);
    expect(settingsSchema.parse({ browser: { showInSidebar: 'yes' } }).browser.showInSidebar).toBe(false);
    expect(settingsSchema.parse({ browser: { showInSidebar: true } }).browser.showInSidebar).toBe(true);
  });
});
