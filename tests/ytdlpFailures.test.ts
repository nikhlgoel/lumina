import { describe, expect, it } from 'vitest';
import { MAX_RETRY_PASSES, attribute, classifyItemFailure, failureSummary, isRetryable, nextRetry, settle, videoIdIn, type ItemFailure } from '@core/ytdlpFailures';

const f = (index: number | null, message: string): ItemFailure => ({ index, message, cls: classifyItemFailure(message) });

describe('sorting one failed item by what can be done about it', () => {
  it('reads an item that is really gone as unavailable, which no retry fixes', () => {
    for (const m of ['[youtube] EYa7Q9kE1OA: This video is not available', 'Video unavailable. This video has been removed by the uploader', 'Private video. Sign in if you\'ve been granted access',
      'This video is only available to Music Premium members', 'The uploader has not made this video available in your country', 'Join this channel to get access to members-only content',
      'Sign in to confirm your age. This video may be inappropriate for some users.', 'This video is DRM protected']) {
      expect(classifyItemFailure(m), m).toBe('unavailable');
    }
  });

  it('reads the bot check and rate limits as throttled, which a rest helps', () => {
    for (const m of ['[youtube] 4hzMRVY71hk: Sign in to confirm you’re not a bot. Use --cookies-from-browser', 'HTTP Error 429: Too Many Requests', 'HTTP Error 403: Forbidden', 'rate limit exceeded']) {
      expect(classifyItemFailure(m), m).toBe('throttled');
    }
  });

  it('does not mistake "confirm your age" for the bot check', () => {
    expect(classifyItemFailure('Sign in to confirm your age')).toBe('unavailable');
    expect(classifyItemFailure('Sign in to confirm you’re not a bot')).toBe('throttled');
  });

  it('reads the accelerator failing as its own thing, since the plain downloader often manages the same file', () => {
    expect(classifyItemFailure('aria2c exited with code 1')).toBe('accelerator');
    expect(classifyItemFailure('ERROR: external downloader failed')).toBe('accelerator');
  });

  it('reads a dropped connection as transient', () => {
    for (const m of ['Read timed out', 'Connection reset by peer', 'HTTP Error 503: Service Unavailable', 'Unable to download video data: remote end closed connection', 'SSL: UNEXPECTED_EOF']) {
      expect(classifyItemFailure(m), m).toBe('transient');
    }
  });

  it('leaves anything else as other, and retries only what can recover', () => {
    expect(classifyItemFailure('something nobody has seen before')).toBe('other');
    expect([isRetryable('throttled'), isRetryable('accelerator'), isRetryable('transient')]).toEqual([true, true, true]);
    expect([isRetryable('unavailable'), isRetryable('other')]).toEqual([false, false]);
  });
});

describe('telling which item an error belongs to', () => {
  const entries = [{ id: 'AAAAAAAAAAA', index: 1 }, { id: 'BBBBBBBBBBB', index: 2 }, { id: 'CCCCCCCCCCC', index: 3 }];

  it('is the item the error names, when it names one', () => {
    expect(videoIdIn('[youtube] BBBBBBBBBBB: Sign in to confirm you’re not a bot')).toBe('BBBBBBBBBBB');
    expect(attribute('[youtube] CCCCCCCCCCC: This video is not available', 1, entries).index).toBe(3);
  });

  it('is the item being fetched when the error does not name one (the accelerator’s exit code names none)', () => {
    expect(attribute('aria2c exited with code 1', 2, entries)).toMatchObject({ index: 2, cls: 'accelerator' });
  });

  it('is nothing when neither is known', () => {
    expect(attribute('aria2c exited with code 1', null, entries).index).toBeNull();
    expect(attribute('[youtube] ZZZZZZZZZZZ: gone', null, entries).index).toBeNull();
  });

  it('keeps the last word on an item, in playlist order, and the errors tied to no item', () => {
    const settled = settle([f(5, 'Read timed out'), f(2, 'aria2c exited with code 1'), f(5, '[youtube] x: This video is not available'), f(null, 'odd')]);
    expect(settled.map((s) => [s.index, s.cls])).toEqual([[2, 'accelerator'], [5, 'unavailable'], [null, 'other']]);
  });
});

describe('when to try the failed items again', () => {
  const failures = [f(10, 'This video is not available'), f(53, 'Sign in to confirm you’re not a bot'), f(54, 'aria2c exited with code 1'), f(60, 'Sign in to confirm you’re not a bot'), f(null, 'aria2c exited with code 1')];

  it('picks only the items a retry can recover, in order, after a rest', () => {
    expect(nextRetry(failures, 0, 0)).toEqual({ indices: [53, 54, 60], cooldownMs: 90_000 });
  });

  it('rests longer the second time, and only if the first time recovered something', () => {
    expect(nextRetry(failures, 1, 12)).toEqual({ indices: [53, 54, 60], cooldownMs: 300_000 });
    expect(nextRetry(failures, 1, 0)).toBeNull();
  });

  it('stops after the allowed passes', () => {
    expect(nextRetry(failures, MAX_RETRY_PASSES, 50)).toBeNull();
  });

  it('has nothing to do when everything left is gone for good', () => {
    expect(nextRetry([f(10, 'This video is not available'), f(11, 'Private video')], 0, 0)).toBeNull();
    expect(nextRetry([], 0, 0)).toBeNull();
  });
});

describe('what the finished playlist says', () => {
  it('names how many are missing and why, in plain words, and what to do', () => {
    const list = [...Array.from({ length: 50 }, (_, i) => f(i + 1, 'This video is not available')), ...Array.from({ length: 55 }, (_, i) => f(i + 100, 'Sign in to confirm you’re not a bot'))];
    const text = failureSummary(438, list);
    expect(text).toContain('105 of 438 could not be downloaded');
    expect(text).toContain('50 unavailable (removed, private or blocked)');
    expect(text).toContain('55 refused while the site was limiting downloads');
    expect(text).toMatch(/press Retry in an hour/i);
    expect(text).not.toMatch(/stopped unexpectedly|code 1/i);
  });

  it('says nothing about retrying when nothing can be recovered', () => {
    expect(failureSummary(10, [f(1, 'This video is not available')])).not.toMatch(/retry/i);
  });

  it('says how many a second try saved', () => {
    expect(failureSummary(100, [f(5, 'This video is not available')], 12)).toContain('12 items were recovered on a second try');
    expect(failureSummary(100, [], 3)).toContain('All 100 downloaded');
    expect(failureSummary(100, [])).toBe('');
  });
});
