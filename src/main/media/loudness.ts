// Measuring how loud a track really is, once.
//
// Seven of eight tracks in the development library peak *above* full scale — one at +5.6 dBFS — so
// playing them untouched clips, which is heard as harsh and flat rather than loud. What to do about
// that is decided in `src/core/loudness.ts`; this runs the measurement and remembers it.
//
// Measuring costs a full decode. It is fast — ffmpeg manages a few hundred times real time — but not
// free, so the answer is stored on the library row and thrown away only when the file itself
// changes, which the scanner handles by clearing the columns whenever it re-reads a file.
import fs from 'node:fs';
import {
  type GainDecision, type LoudnessMeasurement,
  measureArgs, normalizationGain, parseEbur128,
} from '../../core/loudness';
import { rememberLoudness, storedLoudness } from '../library';
import { runTool } from '../process';
import { tools } from '../tools';
import { logger } from '../log';

const log = logger('loudness');

/** Measurements in flight, so two plays of the same track do not decode it twice. */
const pending = new Map<string, Promise<LoudnessMeasurement | null>>();

async function measure(path: string): Promise<LoudnessMeasurement | null> {
  const started = Date.now();
  // ebur128 writes its summary to stderr *and* exits 0 on success, so the summary has to be read
  // from stderr either way — not only when something failed.
  const r = await runTool(tools.require('ffmpeg'), measureArgs(path), { timeoutMs: 10 * 60_000 });
  const parsed = parseEbur128(`${r.stderr}\n${r.stdout}`);
  if (!parsed) {
    log.debug(`No loudness summary for ${path} (exit ${r.code})`);
    return null;
  }
  log.debug(`${path}: ${parsed.integratedLufs} LUFS, peak ${parsed.truePeakDbfs} dBFS, in ${Date.now() - started}ms`);
  return parsed;
}

export interface LoudnessAnswer extends GainDecision {
  /** Null when the track could not be measured; playback then runs at unity. */
  measurement: LoudnessMeasurement | null;
  /** True when this call had to decode the file rather than read a stored answer. */
  measured: boolean;
}

/**
 * What gain to play this track at.
 *
 * Never throws. A track that cannot be measured plays at its own level, which is exactly what
 * happened before any of this existed — silence would be the wrong failure mode.
 */
export async function loudnessFor(path: string, targetLufs?: number): Promise<LoudnessAnswer> {
  const unity: LoudnessAnswer = { gainDb: 0, gainLinear: 1, peakLimited: false, measurement: null, measured: false };
  try {
    if (!fs.existsSync(path)) return unity;

    const stored = storedLoudness(path);
    if (stored) {
      const m: LoudnessMeasurement = { integratedLufs: stored.integratedLufs, lra: null, truePeakDbfs: stored.truePeakDbfs };
      return { ...normalizationGain(m, targetLufs), measurement: m, measured: false };
    }

    let job = pending.get(path);
    if (!job) {
      job = measure(path).finally(() => pending.delete(path));
      pending.set(path, job);
    }
    const m = await job;
    if (!m) return unity;

    try {
      rememberLoudness(path, m.integratedLufs, m.truePeakDbfs);
    } catch (err) {
      // Worth playing even if the answer could not be kept; it will simply be measured again.
      log.debug(`Could not store loudness for ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { ...normalizationGain(m, targetLufs), measurement: m, measured: true };
  } catch (err) {
    log.debug(`Loudness unavailable for ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return unity;
  }
}
