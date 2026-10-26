import { describe, expect, it } from 'vitest';
import { PLAYBACK_SPEEDS, clampSpeed, speedLabel, stepSpeed } from '@core/playbackSpeed';
import { CONTROLS_IDLE_MS, controlsHidden, type ControlsState } from '@core/idleControls';
import { bufferedAhead, droppedPercent, formatKbps, formatResolution, gainDb } from '@core/videoStats';

describe('playback speed', () => {
  it('steps up and down the ladder one rung at a time', () => {
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
    expect(stepSpeed(0.25, 1)).toBe(0.5);
  });

  it('stops at the ends instead of running off the ladder', () => {
    expect(stepSpeed(2, 1)).toBe(2);
    expect(stepSpeed(0.25, -1)).toBe(0.25);
  });

  it('moves a rate that is between rungs to the nearest rung in the direction asked', () => {
    expect(stepSpeed(1.1, 1)).toBe(1.25);
    expect(stepSpeed(1.1, -1)).toBe(1);
  });

  it('treats junk as normal speed and holds real numbers inside the ladder', () => {
    expect(clampSpeed(Number.NaN)).toBe(1);
    expect(clampSpeed('fast')).toBe(1);
    expect(clampSpeed(undefined)).toBe(1);
    expect(clampSpeed(16)).toBe(2);
    expect(clampSpeed(0)).toBe(0.25);
    expect(clampSpeed(-3)).toBe(0.25);
  });

  it('calls 1x "Normal" and the rest by their multiplier', () => {
    expect(speedLabel(1)).toBe('Normal');
    expect(speedLabel(1.5)).toBe('1.5×');
  });

  it('offers normal speed, so there is always a way back', () => {
    expect(PLAYBACK_SPEEDS).toContain(1);
  });
});

describe('when the video controls hide', () => {
  const base: ControlsState = { idle: true, playing: true, pointerOverChrome: false, menuOpen: false, queueOpen: false };

  it('hides after stillness while a video plays', () => {
    expect(controlsHidden(base)).toBe(true);
  });

  it('never hides while paused, so a stopped picture is never left without controls', () => {
    expect(controlsHidden({ ...base, playing: false })).toBe(false);
  });

  it('stays up until there has been stillness', () => {
    expect(controlsHidden({ ...base, idle: false })).toBe(false);
  });

  it('does not pull the bar out from under the pointer', () => {
    expect(controlsHidden({ ...base, pointerOverChrome: true })).toBe(false);
  });

  it('stays up while a menu or the queue is open', () => {
    expect(controlsHidden({ ...base, menuOpen: true })).toBe(false);
    expect(controlsHidden({ ...base, queueOpen: true })).toBe(false);
  });

  it('waits a few seconds, like the sites people compare it with', () => {
    expect(CONTROLS_IDLE_MS).toBeGreaterThanOrEqual(2000);
    expect(CONTROLS_IDLE_MS).toBeLessThanOrEqual(5000);
  });
});

describe('video stats', () => {
  const ranges = [{ start: 0, end: 30 }, { start: 60, end: 90 }];

  it('measures the buffer ahead of the playhead inside a buffered range', () => {
    expect(bufferedAhead(ranges, 10)).toBe(20);
    expect(bufferedAhead(ranges, 60)).toBe(30);
  });

  it('reports no buffer when the playhead sits in a gap, which is when playback stalls', () => {
    expect(bufferedAhead(ranges, 45)).toBe(0);
    expect(bufferedAhead([], 5)).toBe(0);
  });

  it('computes the share of dropped frames without dividing by zero', () => {
    expect(droppedPercent(5, 100)).toBe(5);
    expect(droppedPercent(0, 0)).toBe(0);
    expect(droppedPercent(10, 0)).toBe(0);
    expect(droppedPercent(500, 100)).toBe(100);
  });

  it('formats bitrates and resolutions, and says "unknown" rather than printing nonsense', () => {
    expect(formatKbps(256)).toBe('256 kbps');
    expect(formatKbps(4500)).toBe('4.5 Mbps');
    expect(formatKbps(null)).toBe('unknown');
    expect(formatKbps(0)).toBe('unknown');
    expect(formatResolution(1920, 1080)).toBe('1920×1080');
    expect(formatResolution(null, 1080)).toBe('unknown');
    expect(formatResolution(0, 0)).toBe('unknown');
  });

  it('shows a gain as signed decibels', () => {
    expect(gainDb(1)).toBe('+0.0 dB');
    expect(gainDb(2)).toBe('+6.0 dB');
    expect(gainDb(0.5)).toBe('-6.0 dB');
    expect(gainDb(0)).toBe('—');
  });
});
