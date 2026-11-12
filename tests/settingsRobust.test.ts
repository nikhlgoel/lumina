import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { settingsSchema } from '@shared/settings';

const RUNS = { numRuns: Number(process.env.FUZZ_RUNS) || 300 };
const defaults = settingsSchema.parse({});

describe('the settings file', () => {
  it('an empty file gives every setting its default', () => {
    expect(settingsSchema.parse({})).toEqual(defaults);
  });

  it('parsing settings that were already parsed changes nothing', () => {
    expect(settingsSchema.parse(defaults)).toEqual(defaults);
  });

  it('survives any junk in it: every section is still there and a second parse changes nothing', () => {
    fc.assert(fc.property(fc.jsonValue(), (junk) => {
      const once = settingsSchema.parse(typeof junk === 'object' && junk !== null && !Array.isArray(junk) ? junk : {});
      expect(Object.keys(once).sort()).toEqual(Object.keys(defaults).sort());
      expect(settingsSchema.parse(once)).toEqual(once);
    }), RUNS);
  });

  it('a section that is not an object (null, a number, a list, text) falls back to its own defaults without touching the other sections', () => {
    for (const bad of [null, 0, 'x', [], true]) {
      const parsed = settingsSchema.parse({ downloads: { concurrency: 3 }, subtitles: bad, network: bad });
      expect(parsed.subtitles).toEqual(defaults.subtitles);
      expect(parsed.network).toEqual(defaults.network);
      expect(parsed.downloads.concurrency).toBe(3); // what was fine is kept
    }
  });

  it('a wrong value for one setting falls back to its default and leaves the others alone', () => {
    const sections = Object.keys(defaults).filter((k) => typeof (defaults as Record<string, unknown>)[k] === 'object' && !Array.isArray((defaults as Record<string, unknown>)[k]));
    fc.assert(fc.property(fc.constantFrom(...sections), fc.jsonValue(), (section, junk) => {
      const own = Object.keys((defaults as unknown as Record<string, Record<string, unknown>>)[section]!);
      for (const key of own) {
        const parsed = settingsSchema.parse({ [section]: { [key]: junk } }) as unknown as Record<string, Record<string, unknown>>;
        // every other setting in the section is still its default
        for (const other of own.filter((k) => k !== key)) expect(parsed[section]![other]).toEqual((defaults as unknown as Record<string, Record<string, unknown>>)[section]![other]);
      }
    }), { numRuns: 60 });
  });

  it('keeps numbers inside their limits however far out they are given', () => {
    const wild = settingsSchema.parse({ downloads: { concurrency: 9999, retries: -5, speedLimitKbps: 1e12 }, player: { volume: 50 }, network: { connectionsPerServer: 0 } });
    expect(wild.downloads.concurrency).toBeLessThanOrEqual(32);
    expect(wild.downloads.retries).toBeGreaterThanOrEqual(0);
    expect(wild.player.volume).toBeLessThanOrEqual(2);
    expect(wild.network.connectionsPerServer).toBeGreaterThanOrEqual(1);
  });

  it('the browser shield settings are there, on by default, with the four lists', () => {
    expect(defaults.browser).toMatchObject({ shieldsEnabled: true, hideAdSpace: true, httpsUpgrade: true });
    expect(defaults.browser.shieldLists).toEqual(['easylist', 'easyprivacy', 'malware', 'annoyances']);
  });
});
