import { describe, it, expect } from 'vitest';
import { inputSchemas } from '@shared/ipc';
import { MAX_VOLUME } from '@core/volume';

const state = (volume: number) => ({
  playing: true, title: 'A song', artist: 'Someone', volume, muted: false, shuffle: false, repeat: 'off' as const,
});

describe('the player state the tray is told about', () => {
  it('accepts every volume the player can reach, up to the boost ceiling', () => {
    // The log showed 90 rejections of "volume <= 1" once the volume boost existed: each one dropped a tray update.
    for (const v of [0, 0.5, 1, 1.5, MAX_VOLUME]) {
      expect(inputSchemas['player:state'].safeParse(state(v)).success, `volume ${v}`).toBe(true);
    }
  });

  it('still refuses a volume beyond the ceiling or below silence', () => {
    expect(inputSchemas['player:state'].safeParse(state(MAX_VOLUME + 0.01)).success).toBe(false);
    expect(inputSchemas['player:state'].safeParse(state(-0.1)).success).toBe(false);
  });
});
