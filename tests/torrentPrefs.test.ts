import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_PEERS, MAX_TRACKERS, PEER_PRESETS, SEED_PRESETS, cleanTracker, describeSeeding, effectiveSeeding, isLocalHost, peerPresetOf, sanitizeTrackers, seedPresetOf,
} from '@core/torrentPrefs';

describe('peer presets', () => {
  it('has the default among them, in increasing order, and none below what aria2 uses on its own (55)', () => {
    expect(peerPresetOf(DEFAULT_PEERS)?.id).toBe('fast');
    const peers = PEER_PRESETS.map((p) => p.peers);
    expect([...peers].sort((a, b) => a - b)).toEqual(peers);
    expect(Math.min(...peers)).toBeGreaterThanOrEqual(55);
  });

  it('knows a stored number that is no preset', () => {
    expect(peerPresetOf(77)).toBeNull();
    expect(peerPresetOf(60)?.id).toBe('balanced');
    expect(peerPresetOf(250)?.id).toBe('maximum');
  });
});

describe('sharing after a download', () => {
  it('treats a time of 0 as "stop", whatever the ratio is, because that is what aria2 does with it', () => {
    expect(effectiveSeeding(1.5, 0)).toEqual({ ratio: 0, minutes: 0 });
    expect(effectiveSeeding(10, 0)).toEqual({ ratio: 0, minutes: 0 });
    expect(effectiveSeeding(1.5, 30)).toEqual({ ratio: 1.5, minutes: 30 });
  });

  it('shows a ratio with no time as the "stop" choice it really is', () => {
    expect(seedPresetOf(2, 0)?.id).toBe('stop');
    expect(seedPresetOf(0, 0)?.id).toBe('stop');
  });

  it('finds each preset by its own two numbers, and nothing else', () => {
    for (const p of SEED_PRESETS) expect(seedPresetOf(p.ratio, p.minutes)?.id).toBe(p.id);
    expect(seedPresetOf(1.5, 45)).toBeNull();
  });

  it('never offers a choice that stops at once other than the first, and always sets a time for the rest', () => {
    expect(SEED_PRESETS.filter((p) => p.minutes === 0).map((p) => p.id)).toEqual(['stop']);
    expect(SEED_PRESETS.every((p) => p.minutes <= 10_080)).toBe(true);
  });

  it('describes a custom pair in plain words', () => {
    expect(describeSeeding(2, 0)).toMatch(/as soon as the download finishes/);
    expect(describeSeeding(0, 90)).toBe('Shares for up to 90 minutes.');
    expect(describeSeeding(1.5, 120)).toBe('Shares until you have given back 1.5× what you took, or 2 hours, whichever comes first.');
    expect(describeSeeding(0, 60)).toBe('Shares for up to 1 hour.');
  });
});

describe('tracker addresses', () => {
  it('keeps public trackers of the kinds a torrent client speaks', () => {
    for (const ok of ['udp://tracker.opentrackers.org:8080/announce', 'https://tracker.example.com/announce', 'http://1.2.3.4:6969/announce', 'wss://tracker.webtorrent.dev', 'udp://[2001:db8::1]:6969/announce']) {
      expect(cleanTracker(ok)).toBe(ok);
    }
  });

  it('drops anything that points at this machine, the home network, or no real host', () => {
    for (const bad of [
      'udp://localhost:6969', 'http://127.0.0.1:6800/jsonrpc', 'http://127.1.2.3/announce', 'http://10.0.0.5/announce', 'http://192.168.1.1/announce', 'http://172.16.0.1/a', 'http://172.31.255.255/a',
      'http://169.254.169.254/latest/meta-data', 'http://0.0.0.0/a', 'http://[::1]:8080/a', 'http://[fe80::1]/a', 'http://[fd00::1]/a', 'http://router.local/a', 'http://nas/announce', 'http://tracker.internal/a',
      'http://100.64.0.1/a', 'http://224.0.0.1/a',
    ]) {
      expect(cleanTracker(bad), bad).toBeNull();
    }
    expect(isLocalHost('172.32.0.1')).toBe(false);
    expect(isLocalHost('11.0.0.1')).toBe(false);
  });

  it('drops other schemes, credentials, overlong or broken lines', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://tracker.example.com/a', 'javascript:alert(1)', 'http://user:pw@tracker.example.com/a', 'not a url', '', `http://example.com/${'a'.repeat(300)}`, 'udp://a.example.com,udp://b.example.com']) {
      expect(cleanTracker(bad), bad).toBeNull();
    }
  });

  it('turns a downloaded list into distinct clean entries, capped', () => {
    const text = 'udp://a.example.com:80/announce\n\nudp://a.example.com:80/announce\nhttp://127.0.0.1/x\r\nhttps://b.example.com/announce <script>\n';
    expect(sanitizeTrackers(text)).toEqual(['udp://a.example.com:80/announce', 'https://b.example.com/announce']);
    const many = Array.from({ length: 500 }, (_, i) => `udp://t${i}.example.com:80/announce`).join('\n');
    expect(sanitizeTrackers(many)).toHaveLength(MAX_TRACKERS);
    expect(sanitizeTrackers(many, 5)).toHaveLength(5);
  });

  it('never throws and never lets a local or oversized entry through, whatever the text is', () => {
    fc.assert(fc.property(fc.string({ maxLength: 4000 }), (text) => {
      const out = sanitizeTrackers(text);
      expect(out.length).toBeLessThanOrEqual(MAX_TRACKERS);
      for (const t of out) {
        expect(t.length).toBeLessThanOrEqual(200);
        expect(isLocalHost(new URL(t).hostname)).toBe(false);
      }
    }), { numRuns: 300 });
  });
});

describe('presets and the settings they write', () => {
  it('survive the settings schema unchanged, so a click is never turned into another value', async () => {
    const { settingsSchema } = await import('@shared/settings');
    for (const p of PEER_PRESETS) expect(settingsSchema.parse({ torrents: { maxPeers: p.peers } }).torrents.maxPeers).toBe(p.peers);
    for (const p of SEED_PRESETS) {
      const t = settingsSchema.parse({ torrents: { seedRatio: p.ratio, seedMinutes: p.minutes } }).torrents;
      expect([t.seedRatio, t.seedMinutes]).toEqual([p.ratio, p.minutes]);
    }
  });

  it('match the defaults a new install starts with', async () => {
    const { defaultSettings } = await import('@shared/settings');
    const t = defaultSettings().torrents;
    expect(t.maxPeers).toBe(DEFAULT_PEERS);
    expect(seedPresetOf(t.seedRatio, t.seedMinutes)?.id).toBe('stop');
  });
});
