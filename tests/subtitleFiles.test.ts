import { describe, it, expect } from 'vitest';
import { pickSubtitleSidecar } from '@core/subtitleFiles';

describe('pickSubtitleSidecar', () => {
  const stem = 'My Movie (2021)';

  it('finds the plain English .srt yt-dlp/Whisper writes', () => {
    expect(pickSubtitleSidecar(stem, [`${stem}.en.srt`, `${stem}.mp4`])).toBe(`${stem}.en.srt`);
  });

  it('accepts .vtt and other English lang-code variants', () => {
    expect(pickSubtitleSidecar(stem, [`${stem}.en-US.vtt`, `${stem}.mkv`])).toBe(`${stem}.en-US.vtt`);
    expect(pickSubtitleSidecar(stem, [`${stem}.english.srt`])).toBe(`${stem}.english.srt`);
  });

  it('prefers official English over regional and auto/original', () => {
    expect(pickSubtitleSidecar(stem, [`${stem}.en-orig.srt`, `${stem}.en-GB.srt`, `${stem}.en.srt`])).toBe(`${stem}.en.srt`);
    expect(pickSubtitleSidecar(stem, [`${stem}.en-orig.srt`, `${stem}.en-GB.srt`])).toBe(`${stem}.en-GB.srt`);
  });

  it('prefers .srt over .vtt on a tie', () => {
    expect(pickSubtitleSidecar(stem, [`${stem}.en.vtt`, `${stem}.en.srt`])).toBe(`${stem}.en.srt`);
  });

  it('falls back to a non-English subtitle sidecar when there is no English one', () => {
    expect(pickSubtitleSidecar(stem, [`${stem}.fr.srt`, `${stem}.mp4`])).toBe(`${stem}.fr.srt`);
  });

  it('ignores unrelated files and other media in the folder', () => {
    expect(pickSubtitleSidecar(stem, ['Another.en.srt', `${stem}.mp4`, `${stem}.jpg`])).toBeNull();
    expect(pickSubtitleSidecar(stem, [])).toBeNull();
  });
});
