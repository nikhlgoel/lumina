import { describe, it, expect } from 'vitest';
import { parseYtdlpLine, postprocessLabel } from '@core/progress';
import {
  applyProgressEvent, initialProgressState, type ProgressModelOptions, type ProgressModelState,
} from '@core/ytdlpProgress';
import type { JobProgress } from '@shared/types';

/**
 * Real lines, captured from the bundled yt-dlp downloading three public Big Buck Bunny samples with
 * the exact argv `buildDownloadArgs` produces. Two earlier attempts to explain the progress bug
 * blamed this format and were both wrong; the capture is kept here so the next theory has to argue
 * with something real.
 *
 * Note `playlist_index` and `n_entries` are `NA` in batch mode — that is what yt-dlp genuinely
 * prints, and the model has to keep counting without them.
 */
const REAL_CAPTURE = `
LUMINA_ITEM|NA|NA|Big_Buck_Bunny_360_10s_1MB
LUMINA_DL|downloading|1024|991017|NA|NA|NA|NA|NA
LUMINA_DL|downloading|15360|991017|NA|4562319.201189717|0|NA|NA
LUMINA_DL|downloading|261120|991017|NA|2586816.3664191375|0|NA|NA
LUMINA_DL|downloading|991017|991017|NA|4141076.8236950254|0|NA|NA
LUMINA_DL|finished|991017|991017|NA|2071353.5357040344|NA|NA|NA
LUMINA_ITEM|NA|NA|Big_Buck_Bunny_360_10s_2MB
LUMINA_DL|downloading|261120|2070701|NA|4385445.046548597|0|NA|NA
LUMINA_DL|downloading|2070701|2070701|NA|4385445.046548597|0|NA|NA
LUMINA_DL|finished|2070701|2070701|NA|4385445.046548597|NA|NA|NA
LUMINA_ITEM|NA|NA|Big_Buck_Bunny_360_10s_5MB
LUMINA_DL|downloading|592201|5229245|NA|12854.272882831432|360|NA|NA
LUMINA_DL|downloading|2628692|5229245|NA|9438.936415986607|275|NA|NA
LUMINA_PP|started|ExtractAudio
`.trim().split('\n');

const audioJob = (itemCount: number, countIsFixed = false): ProgressModelOptions =>
  ({ streamsPerItem: 1, itemCount, countIsFixed });

function replay(lines: string[], o: ProgressModelOptions): { state: ProgressModelState; patches: Partial<JobProgress>[] } {
  let state = initialProgressState(o);
  const patches: Partial<JobProgress>[] = [];
  for (const line of lines) {
    const ev = parseYtdlpLine(line);
    if (!ev) continue;
    const step = applyProgressEvent(state, ev, o);
    state = step.state;
    if (step.patch) patches.push(step.patch);
  }
  return { state, patches };
}

describe('replaying a real yt-dlp run', () => {
  const { state, patches } = replay(REAL_CAPTURE, audioJob(3));

  it('counts every item even though batch mode reports no index', () => {
    expect(state.itemsSeen).toBe(3);
    expect(state.itemCount).toBe(3);
    expect(patches.filter((p) => p.item).map((p) => p.item!.index)).toEqual([1, 2, 3]);
  });

  it('rises, and never goes backwards', () => {
    const percents = patches.map((p) => p.percent).filter((v): v is number => v != null);
    expect(percents.length).toBeGreaterThan(5);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i], `sample ${i}`).toBeGreaterThanOrEqual(percents[i - 1]!);
    }
    expect(percents.at(-1)).toBeGreaterThan(60);
  });

  it('carries the speed yt-dlp reported, and no speed when it reported none', () => {
    const speeds = patches.map((p) => p.speedBps).filter((v) => v !== undefined);
    expect(speeds).toContain(4562319.201189717);
    expect(speeds).toContain(12854.272882831432);
    // The first tick of a download genuinely has no speed yet — that must arrive as null, not 0.
    expect(speeds[0]).toBeNull();
  });

  it('labels the postprocessing step and drops the stale speed with it', () => {
    const pp = patches.at(-1)!;
    expect(pp.stage).toBe('Extracting audio');
    expect(pp.speedBps).toBeNull();
    expect(pp.etaSec).toBeNull();
  });

  it('never claims the job is finished while it is still running', () => {
    for (const p of patches) if (p.percent != null) expect(p.percent).toBeLessThanOrEqual(99);
  });
});

describe('a long playlist — the bug this model exists for', () => {
  // 433 items is the real report. One song is 0.23% of the job, so the job percentage is frozen for
  // five songs at a time and reads 0% for the first five. Without a second figure there is nothing
  // on screen that moves, which is exactly what "it just keeps progressing until it's complete"
  // describes.
  const o = audioJob(433);

  it('shows a file percentage that moves while the job percentage cannot', () => {
    const { patches } = replay([
      'LUMINA_ITEM|1|433|Song one',
      'LUMINA_DL|downloading|500000|1000000|NA|250000|2|NA|NA',
    ], o);
    const tick = patches.at(-1)!;
    expect(Math.floor(tick.percent!)).toBe(0);
    expect(Math.round(tick.filePercent!)).toBe(50);
  });

  it('would leave the job percentage on the same whole number for five songs', () => {
    const afterItems = (n: number) => {
      const lines: string[] = [];
      for (let i = 1; i <= n; i++) lines.push(`LUMINA_ITEM|${i}|433|Song ${i}`);
      return replay(lines, o).patches.at(-1)!.percent!;
    };
    expect(Math.floor(afterItems(1))).toBe(0);
    expect(Math.floor(afterItems(5))).toBe(0);
    expect(Math.floor(afterItems(6))).toBe(1);
  });

  it('starts each file from zero rather than leaving the last one at full', () => {
    const { patches } = replay([
      'LUMINA_ITEM|1|433|Song one',
      'LUMINA_DL|downloading|900000|1000000|NA|250000|1|NA|NA',
      'LUMINA_ITEM|2|433|Song two',
    ], o);
    expect(patches.at(-1)!.filePercent).toBe(0);
  });

  it('clears the byte counts at an item boundary, so they cannot read as a resetting total', () => {
    const { patches } = replay(['LUMINA_ITEM|1|433|Song one'], o);
    expect(patches.at(-1)!.downloadedBytes).toBeNull();
    expect(patches.at(-1)!.totalBytes).toBeNull();
  });
});

describe('who owns the item count', () => {
  it('takes yt-dlp’s count when the caller does not already know it', () => {
    expect(replay(['LUMINA_ITEM|1|40|Track'], audioJob(1)).state.itemCount).toBe(40);
  });

  it('keeps a hand-picked selection’s count, which yt-dlp cannot know', () => {
    // Downloading items 2 and 5 of a 40-item playlist is a job of two, not of forty.
    expect(replay(['LUMINA_ITEM|2|40|Track'], audioJob(2, true)).state.itemCount).toBe(2);
  });

  it('says nothing about position on a single download', () => {
    const { patches } = replay(['LUMINA_ITEM|NA|NA|One video'], audioJob(1));
    expect(patches).toEqual([]);
  });
});

describe('a video item with separate video and audio streams', () => {
  const video: ProgressModelOptions = { streamsPerItem: 2, itemCount: 1, countIsFixed: false };

  it('counts both streams as one file, so the file is half done when the video stream finishes', () => {
    const { patches } = replay([
      'LUMINA_DL|downloading|1000000|1000000|NA|500000|0|NA|NA',
      'LUMINA_DL|finished|1000000|1000000|NA|500000|NA|NA|NA',
      'LUMINA_DL|downloading|1|1000000|NA|500000|8|NA|NA',
    ], video);
    expect(Math.round(patches.at(-1)!.filePercent!)).toBe(50);
  });

  it('names the stream being fetched when there is only one item to talk about', () => {
    const { patches } = replay(['LUMINA_DL|downloading|1|100|NA|50|1|NA|NA'], video);
    expect(patches.at(-1)!.stage).toBe('Downloading video');
  });

  it('names the item instead once there is more than one', () => {
    const { patches } = replay([
      'LUMINA_ITEM|1|12|Second episode',
      'LUMINA_DL|downloading|1|100|NA|50|1|NA|NA',
    ], { streamsPerItem: 2, itemCount: 12, countIsFixed: false });
    expect(patches.at(-1)!.stage).toBe('Second episode');
  });
});

describe('postprocessor names, as yt-dlp really prints them', () => {
  // Captured from the bundled binary: `ExtractAudio` for a music download, and `Metadata`,
  // `MoveFiles`, `ThumbnailsConvertor`, `VideoRemuxer` from a remux run. yt-dlp's `pp_key()` drops
  // the class's `FFmpeg` prefix, so the prefixed spellings match nothing at all.
  it('names the step a music download spends most of its time in', () => {
    expect(postprocessLabel('ExtractAudio')).toBe('Extracting audio');
  });

  it('names every step observed from the real binary', () => {
    expect(postprocessLabel('Metadata')).toBe('Writing metadata');
    expect(postprocessLabel('MoveFiles')).toBe('Moving files');
    expect(postprocessLabel('ThumbnailsConvertor')).toBe('Preparing artwork');
    expect(postprocessLabel('VideoRemuxer')).toBe('Remuxing');
    expect(postprocessLabel('Merger')).toBe('Merging video and audio');
  });

  it('never goes back to the FFmpeg-prefixed spellings, which match nothing', () => {
    for (const wrong of ['FFmpegExtractAudio', 'FFmpegMetadata', 'FFmpegVideoRemuxer', 'FFmpegMerger', 'FFmpegEmbedSubtitle']) {
      expect(postprocessLabel(wrong), wrong).toBe('Processing');
    }
  });

  it('falls back to something sayable for a postprocessor nobody has labelled', () => {
    expect(postprocessLabel('SomethingNew')).toBe('Processing');
  });
});

describe('ticks that report no size', () => {
  it('holds the last known fraction rather than dropping to zero', () => {
    const { patches } = replay([
      'LUMINA_DL|downloading|500|1000|NA|100|1|NA|NA',
      'LUMINA_DL|downloading|NA|NA|NA|100|1|NA|NA',
    ], audioJob(1));
    expect(patches.at(-1)!.percent).toBeCloseTo(50, 5);
  });

  it('uses fragment counts when a stream reports no byte total', () => {
    const { patches } = replay(['LUMINA_DL|downloading|NA|NA|NA|100|1|3|4'], audioJob(1));
    expect(patches.at(-1)!.percent).toBeCloseTo(75, 5);
  });
});
