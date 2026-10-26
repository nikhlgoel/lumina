import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { portableTargetFor, safeSegment } from '@core/portable';

// The contract between the PC app and the Android TV app (tv/): a file named by one is named
// identically by the other, so a USB stick or a copied folder moves between them without renaming.
// The Kotlin port is tested against this same file (tv/app/src/test/.../FileNamesTest.kt).
//
// If this fails you changed the naming rules. If that was on purpose, update the TV port, then
// regenerate shared/contract/portable-names.json — do not just edit the expected values.
interface Fixture {
  safeSegment: { input: string; max?: number; expected: string }[];
  target: { kind: 'audio' | 'video'; path: string; title: string; artist: string | null; album: string | null; expected: string }[];
}
const fixture = JSON.parse(readFileSync('shared/contract/portable-names.json', 'utf8')) as Fixture;

describe('naming contract shared with the TV app', () => {
  it.each(fixture.safeSegment)('names the segment $input the same way on both apps', ({ input, max, expected }) => {
    expect(max ? safeSegment(input, max) : safeSegment(input)).toBe(expected);
  });

  it.each(fixture.target)('files $title at the same drive path on both apps', (t) => {
    const got = portableTargetFor({ path: t.path, kind: t.kind, title: t.title, artist: t.artist, album: t.album, trackNo: null, sizeBytes: 1 });
    expect(got).toBe(t.expected);
  });

  it('covers the cases that have caused trouble before', () => {
    const inputs = fixture.safeSegment.map((s) => s.input);
    expect(inputs).toContain('con');
    expect(inputs).toContain('Song...');
    expect(inputs.some((i) => i.includes('\u0001'))).toBe(true);
    expect(inputs.some((i) => i.length >= 100)).toBe(true);
  });
});
