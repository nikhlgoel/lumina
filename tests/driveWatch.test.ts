import { describe, it, expect } from 'vitest';
import {
  RESCAN_MS, afterScan, backoffMs, describeSpawnFailure, initialDriveScan, parseFsutilDrives, shouldScan,
} from '@core/driveWatch';

describe('reading the drive letters', () => {
  it('reads them out of fsutil output, in any language', () => {
    expect(parseFsutilDrives('Drives: C:\\ D:\\ Z:\\')).toEqual(['C', 'D', 'Z']);
    expect(parseFsutilDrives('Laufwerke: C:\\ E:\\\r\n')).toEqual(['C', 'E']);
  });

  it('sorts, upper-cases and de-duplicates, and reads nothing from noise', () => {
    expect(parseFsutilDrives('Drives: e:\\ C:\\ e:\\')).toEqual(['C', 'E']);
    expect(parseFsutilDrives('')).toEqual([]);
    expect(parseFsutilDrives('Access is denied.')).toEqual([]);
  });
});

describe('when the drives are looked at again', () => {
  const T = 1_000_000;

  it('scans the first time', () => {
    expect(shouldScan(initialDriveScan(), 'C,D', T)).toBe(true);
  });

  it('does not run the expensive query while nothing has changed', () => {
    const s = afterScan(initialDriveScan(), 'C,D', true, T);
    expect(shouldScan(s, 'C,D', T + 5_000)).toBe(false);
    expect(shouldScan(s, 'C,D', T + RESCAN_MS - 1)).toBe(false);
  });

  it('scans at once when a drive letter appears or goes', () => {
    const s = afterScan(initialDriveScan(), 'C,D', true, T);
    expect(shouldScan(s, 'C,D,E', T + 5_000)).toBe(true);
    expect(shouldScan(s, 'C', T + 5_000)).toBe(true);
  });

  it('refreshes free space now and then even when nothing changed', () => {
    const s = afterScan(initialDriveScan(), 'C,D', true, T);
    expect(shouldScan(s, 'C,D', T + RESCAN_MS)).toBe(true);
  });

  it('backs off after a failure instead of trying again in 5 seconds', () => {
    let s = afterScan(initialDriveScan(), 'C,D', true, T);
    s = afterScan(s, 'C,D', false, T + 1_000);
    expect(shouldScan(s, 'C,D', T + 6_000)).toBe(false);
    expect(shouldScan(s, 'C,D', T + 1_000 + 15_000)).toBe(true);
  });

  it('still reacts to a new drive during a back-off', () => {
    let s = afterScan(initialDriveScan(), 'C,D', true, T);
    s = afterScan(s, 'C,D', false, T + 1_000);
    expect(shouldScan(s, 'C,D,E', T + 2_000)).toBe(true);
  });

  it('keeps backing off when the very first scan fails, and recovers on success', () => {
    let s = afterScan(initialDriveScan(), 'C', false, T);
    expect(s.key).toBeNull();
    expect(shouldScan(s, 'C', T + 5_000)).toBe(false);
    expect(shouldScan(s, 'C', T + 15_000)).toBe(true);
    s = afterScan(s, 'C', true, T + 15_000);
    expect(s.failures).toBe(0);
    expect(shouldScan(s, 'C', T + 20_000)).toBe(false);
  });

  it('doubles the wait for each failure up to five minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(backoffMs)).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });
});

describe('describing a failed command', () => {
  it('says it timed out rather than printing a stack', () => {
    const err = Object.assign(new Error('Command failed: powershell.exe ...'), { killed: true, signal: 'SIGTERM' });
    expect(describeSpawnFailure(err)).toContain('did not finish in time');
  });

  it('prefers the command’s own first line of complaint', () => {
    const err = Object.assign(new Error('Command failed'), { stderr: '\r\n  Access is denied.\r\nmore' });
    expect(describeSpawnFailure(err)).toBe('Access is denied.');
  });

  it('knows a missing program, and handles non-errors', () => {
    expect(describeSpawnFailure(Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }))).toBe('the command was not found');
    expect(describeSpawnFailure('plain')).toBe('plain');
  });
});
