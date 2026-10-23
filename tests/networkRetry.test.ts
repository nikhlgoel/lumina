import { describe, it, expect } from 'vitest';
import { NETWORK_WAIT_LIMIT_MS, classifyFailure, nextProbeDelayMs, retryLabel, waitedTooLong } from '@core/networkRetry';

describe('what kind of failure is this', () => {
  it('calls the real aria2 outage message a network failure, as captured from a refused connection', () => {
    const raw = 'Network problem has occurred. cause:No connection could be made because the target machine actively refused it.';
    expect(classifyFailure(raw)).toBe('network');
  });

  it('recognises the other ways a connection goes', () => {
    for (const m of ['getaddrinfo ENOTFOUND example.com', 'Connection reset by peer', 'No internet connection, or the server name is wrong.', 'The operation timed out', 'SSL handshake failure']) {
      expect(classifyFailure(m), m).toBe('network');
    }
  });

  it('keeps rate limits and busy servers on the short ladder', () => {
    for (const m of ['HTTP error 429', 'Service Unavailable 503 temporarily', 'The site is rate-limiting requests']) {
      expect(classifyFailure(m), m).toBe('transient');
    }
  });

  it('never retries what retrying cannot fix', () => {
    for (const m of ['The disk is full. Free up space', 'This video is private', 'HTTP error 404', 'The server refused the download (403)', 'This media is protected by DRM']) {
      expect(classifyFailure(m), m).toBe('permanent');
    }
  });

  it('does not wait for a network that is fine when the message is something unknown', () => {
    expect(classifyFailure('Something nobody has seen before')).toBe('permanent');
    expect(classifyFailure(null)).toBe('permanent');
  });

  it('reads the detail as well as the headline', () => {
    expect(classifyFailure('Download failed', 'connection refused')).toBe('network');
  });
});

describe('asking whether the network is back', () => {
  it('asks quickly at first, then once a minute for ever', () => {
    expect([0, 1, 2, 3, 4].map(nextProbeDelayMs)).toEqual([5000, 10000, 20000, 30000, 60000]);
    expect(nextProbeDelayMs(50)).toBe(60000);
    expect(nextProbeDelayMs(-3)).toBe(5000);
  });

  it('gives up only after hours, not after twelve minutes', () => {
    expect(waitedTooLong(0, 15 * 60_000)).toBe(false);
    expect(waitedTooLong(0, NETWORK_WAIT_LIMIT_MS + 1)).toBe(true);
  });

  it('labels a short wait honestly', () => {
    expect(retryLabel(30_000)).toBe('30 s'); // the old label said "1 min"
    expect(retryLabel(120_000)).toBe('2 min');
    expect(retryLabel(600_000)).toBe('10 min');
  });
});
