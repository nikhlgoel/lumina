import { describe, it, expect } from 'vitest';
import { parseYtdlpLine, splitYtdlpLine } from '@core/progress';
import { applyProgressEvent, initialProgressState, type ProgressModelOptions } from '@core/ytdlpProgress';
import type { JobProgress } from '@shared/types';

/**
 * Real stdout of the bundled yt-dlp 2026.08.19 + aria2c 1.37.0 downloading a 30 MB public Big Buck
 * Bunny sample with the exact argv `buildDownloadArgs` produces (acceleration on, the default).
 *
 * With aria2 doing the transfer yt-dlp prints no `LUMINA_DL|downloading` line at all, only one
 * `finished` at the end; the live figures arrive as aria2's own readout, twice a second, wrapped in
 * a summary banner. Nothing parsed it, so a download sat at 0% until it was done (B1).
 */
const REAL_CAPTURE = [
  'LUMINA_ITEM|NA|NA|Big_Buck_Bunny_720_10s_30MB',
  '                                                                                ',
  ' *** Download Progress Summary as of Fri Oct 23 17:48:02 2026 *** ',
  '===============================================================================',
  '[#be47bb 784KiB/30MiB(2%) CN:16 DL:844KiB ETA:36s]',
  'FILE: C:/Users/x/out-accel//./Big_Buck_Bunny_720_10s_30MB.mp4.part',
  '-------------------------------------------------------------------------------',
  '[#be47bb 784KiB/30MiB(2%) CN:16 DL:844KiB ETA:36s]',
  '[#be47bb 2.6MiB/30MiB(8%) CN:16 DL:1.3MiB ETA:20s]',
  '[#be47bb 22MiB/30MiB(73%) CN:13 DL:2.5MiB ETA:3s]',
  '[#be47bb 28MiB/30MiB(93%) CN:11 DL:2.7MiB]',
  'LUMINA_DL|finished|32071424|32071424|NA|2646828.161228518|NA|NA|NA',
];

const job: ProgressModelOptions = { streamsPerItem: 1, itemCount: 1, countIsFixed: false };

function replay(lines: string[], o: ProgressModelOptions = job): Partial<JobProgress>[] {
  let state = initialProgressState(o);
  const patches: Partial<JobProgress>[] = [];
  for (const line of lines) {
    const ev = parseYtdlpLine(line);
    if (!ev) continue;
    const step = applyProgressEvent(state, ev, o);
    state = step.state;
    if (step.patch) patches.push(step.patch);
  }
  return patches;
}

/**
 * Captured from the live app, not the shell: aria2 ends its last readout without a newline, so
 * yt-dlp's own `finished` line arrives glued onto it. The video stream's `finished` was swallowed,
 * the model never moved on to the audio stream, and the bar fell from 49% back to 5% halfway through.
 */
const FUSED = '[#88f7c9 416KiB/422KiB(98%) CN:1 DL:44KiB]LUMINA_DL|finished|433081|433081|NA|45208.378479092695|NA|NA|NA';

describe('a line where aria2 and yt-dlp collide', () => {
  it('splits into the readout and the yt-dlp line that was glued to it', () => {
    expect(splitYtdlpLine(FUSED)).toEqual([
      '[#88f7c9 416KiB/422KiB(98%) CN:1 DL:44KiB]',
      'LUMINA_DL|finished|433081|433081|NA|45208.378479092695|NA|NA|NA',
    ]);
  });

  it('also rescues a file path, which is how the job learns what it produced', () => {
    expect(splitYtdlpLine('[#a 1MiB/1MiB(100%) CN:1]LUMINA_FILE|C:\\x\\a.mp4')).toEqual(['[#a 1MiB/1MiB(100%) CN:1]', 'LUMINA_FILE|C:\\x\\a.mp4']);
  });

  it('leaves an ordinary line alone', () => {
    expect(splitYtdlpLine('LUMINA_PP|started|Merger')).toEqual(['LUMINA_PP|started|Merger']);
    expect(splitYtdlpLine('ERROR: nope')).toEqual(['ERROR: nope']);
  });

  it('moves on to the audio stream after the fused finish, as the shell run does', () => {
    const video: ProgressModelOptions = { streamsPerItem: 2, itemCount: 1, countIsFixed: false };
    const patches = replay([FUSED, '[#b 1MiB/4MiB(25%) CN:1 DL:1MiB ETA:3s]'].flatMap(splitYtdlpLine), video);
    expect(patches.at(-1)!.stage).toBe('Downloading audio');
    expect(patches.at(-1)!.percent).toBeCloseTo(62.5, 5);
  });
});

describe('aria2 readout inside yt-dlp output', () => {
  it('turns the real capture into a rising percentage, a speed and an ETA', () => {
    const patches = replay(REAL_CAPTURE);
    expect(patches.map((p) => p.percent)).toEqual([2, 2, 8, 73, 93, 99]);
    expect(patches[2]!.speedBps).toBeCloseTo(1.3 * 1024 * 1024, 0);
    expect(patches[2]!.etaSec).toBe(20);
  });

  it('reads no ETA when aria2 prints none, rather than keeping the last one', () => {
    expect(replay(REAL_CAPTURE.filter((l) => !l.startsWith('LUMINA_DL'))).at(-1)!.etaSec).toBeNull();
  });

  it('reports the file in hand, which on a multi-item job is not the job percentage', () => {
    const patches = replay(REAL_CAPTURE.filter((l) => !l.startsWith('LUMINA_DL')), { streamsPerItem: 1, itemCount: 4, countIsFixed: true });
    const last = patches.at(-1)!;
    expect(last.filePercent).toBe(93);
    expect(last.percent).toBeCloseTo(23.25, 5);
  });

  it('does not mistake the banner, the file path or the divider for progress', () => {
    for (const line of REAL_CAPTURE.filter((l) => !l.startsWith('[#') && !l.startsWith('LUMINA_'))) {
      expect(parseYtdlpLine(line), line).toBeNull();
    }
  });

  it('keeps counting a second stream after the first finishes', () => {
    const video: ProgressModelOptions = { streamsPerItem: 2, itemCount: 1, countIsFixed: false };
    const patches = replay([
      '[#a 10MiB/20MiB(50%) CN:8 DL:2MiB ETA:5s]',
      'LUMINA_DL|finished|20971520|20971520|NA|1|NA|NA|NA',
      '[#b 1MiB/4MiB(25%) CN:4 DL:1MiB ETA:3s]',
    ], video);
    expect(patches.map((p) => p.filePercent)).toEqual([25, 50, 62.5]);
  });

  it('finishing a stream completes it, rather than leaving the last readout (93%) on screen', () => {
    const patches = replay(REAL_CAPTURE);
    expect(patches.at(-1)).toMatchObject({ percent: 99, filePercent: 100, totalBytes: 32071424, downloadedBytes: 32071424 });
  });

  it('adds up several downloads that share one readout line', () => {
    const ev = parseYtdlpLine('[#a 1MiB/4MiB(25%) CN:2 DL:1MiB ETA:3s][#b 1MiB/4MiB(25%) CN:3 DL:2MiB ETA:9s]');
    expect(ev).toMatchObject({ type: 'aria2', connections: 5, speed: 3 * 1024 * 1024, eta: 9 });
  });

  it('understands every size unit and a compound ETA', () => {
    expect(parseYtdlpLine('[#a 512B/1KiB(50%) CN:1 DL:0B ETA:1h2m3s]')).toMatchObject({
      type: 'aria2', downloaded: 512, total: 1024, speed: 0, eta: 3723,
    });
    expect(parseYtdlpLine('[#a 1.5GiB/3GiB(50%) CN:1 DL:1MiB]')).toMatchObject({ downloaded: 1.5 * 2 ** 30, total: 3 * 2 ** 30 });
  });

  it('has no fraction while the total is still unknown', () => {
    const patches = replay(['[#a 0B/0B CN:1 DL:0B]']);
    expect(patches[0]!.percent).toBe(0);
    expect(patches[0]!.totalBytes).toBeNull();
  });
});
