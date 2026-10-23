import { describe, it, expect } from 'vitest';
import { formatBytes, formatEta, formatSpeed } from '@core/format';

/**
 * Edge cases found by running the formatters on awkward numbers; every "before" below is the real
 * output of the previous implementation.
 */
describe('time left', () => {
  it('never shows 60 of anything: rounding carries into the next unit', () => {
    expect(formatEta(59.6)).toBe('1m 0s'); // was "60s"
    expect(formatEta(179.6)).toBe('3m 0s'); // was "2m 60s"
    expect(formatEta(3599.7)).toBe('1h 0m'); // was "59m 60s"
  });

  it('reads naturally across the ordinary range', () => {
    expect(formatEta(0)).toBe('0s');
    expect(formatEta(45)).toBe('45s');
    expect(formatEta(125)).toBe('2m 5s');
    expect(formatEta(5400)).toBe('1h 30m');
  });

  it('switches to days instead of 72 hours', () => {
    expect(formatEta(86400 * 3)).toBe('3d 0h'); // was "72h 0m"
    expect(formatEta(90000)).toBe('1d 1h');
  });

  it('does not print an absurd figure for a download that has all but stopped', () => {
    expect(formatEta(1e9)).toBe('> 30 days'); // was "277777h 46m"
  });

  it('says nothing when there is no estimate', () => {
    for (const v of [null, undefined, NaN, -5, Infinity]) expect(formatEta(v as number | null)).toBe('—');
  });
});

describe('sizes', () => {
  it('moves up a unit instead of printing 1024 of the one below', () => {
    expect(formatBytes(1048500)).toBe('1.0 MB'); // was "1024 KB"
    expect(formatBytes(1073741000)).toBe('1.0 GB'); // was "1024 MB"
  });

  it('prints the same shape either side of 100', () => {
    expect(formatBytes(102350)).toBe('100 KB'); // 99.95 KB used to print "100.0 KB"
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
  });

  it('keeps the unit scale at the top end', () => {
    expect(formatBytes(2 ** 40)).toBe('1.0 TB');
    expect(formatBytes(5000 * 2 ** 40)).toBe('5000 TB');
  });

  it('leaves small and unknown values alone', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(null)).toBe('—');
    expect(formatSpeed(500)).toBe('500 B/s');
  });
});
