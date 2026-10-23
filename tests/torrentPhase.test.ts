import { describe, it, expect } from 'vitest';
import { aria2Progress, isMetadataPhase, type Aria2Status } from '@core/progress';

const status = (over: Partial<Aria2Status>): Aria2Status => ({
  gid: 'a', status: 'active', totalLength: '0', completedLength: '0', downloadSpeed: '0', ...over,
});

describe('a magnet link fetching its metadata', () => {
  // Real shape: aria2 reports the metadata download with a pseudo-file named "[METADATA]<name>".
  const fetching = status({
    totalLength: '20927', completedLength: '20927',
    files: [{ index: '1', path: '[METADATA]swarm', length: '20927', completedLength: '20927', selected: 'true' }],
  });

  it('is recognised by its pseudo-file', () => {
    expect(isMetadataPhase(fetching)).toBe(true);
  });

  it('would read 100% if taken at face value, which is why the phase has to be known', () => {
    expect(aria2Progress(fetching).percent).toBe(100);
  });

  it('is not mistaken for a real download', () => {
    const real = status({ totalLength: '272629760', completedLength: '1000', files: [{ index: '1', path: 'C:/dl/swarm.bin', length: '272629760', completedLength: '1000', selected: 'true' }] });
    expect(isMetadataPhase(real)).toBe(false);
    expect(isMetadataPhase(status({}))).toBe(false);
  });
});
