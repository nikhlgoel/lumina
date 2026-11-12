// Development-only: the equalizer's sound, measured. Run: LUMINA_CAPTURE=<dir> LUMINA_PROBE_AUDIO=<scratch dir> LUMINA_CAPTURE_ONLY='probe-audio|9100|9101|9102|9103' electron . --user-data-dir=<scratch>
//
// Three kinds of check, each against the same maths the panel draws (core/equalizer):
//   1. Offline: the real Web Audio chain (the player's own buildChain) is run on sine waves at eleven frequencies for every preset, and its measured gain must
//      match the curve; flat must pass the signal through; a hot signal under a bass boost must stay under full scale (and does clip without the new protection).
//   2. Live: real pink noise is played through the real player (media element, graph, limiter), and the spectrum that comes out is read back for several presets;
//      the difference from flat must follow the curve.
//   3. The panel: opened over the playing player, a dot dragged with real mouse events, the settings read back.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import { EQ_PROFILES, headroomDb, responseDb } from '../core/equalizer';
import { tools } from './tools';
import { panelSteps } from './captureAudioPanel';
import { axeNow } from './captureAxe';

const PORT = 8796;
const FREQS = [40, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000];
const CENTRES = [62, 125, 250, 500, 1000, 2000, 4000, 8000];
let started: Promise<void> | null = null;

/** What the output of pink noise should differ from flat by, in an octave band: the response averaged over the band's frequency bins, weighted by pink noise (power ~ 1/f). */
function expectedBand(gains: number[], centre: number): number {
  const lo = centre / Math.SQRT2;
  const hi = centre * Math.SQRT2;
  let num = 0;
  let den = 0;
  const n = 240;
  for (let i = 0; i < n; i++) {
    const f = lo + ((hi - lo) * (i + 0.5)) / n;
    const w = 1 / f;
    num += w * 10 ** (responseDb(gains, f) / 10);
    den += w;
  }
  return 10 * Math.log10(num / den);
}

function prepare(dir: string): Promise<void> {
  started ??= (async () => {
    for (let i = 0; i < 80 && !tools.has('ffmpeg'); i++) await new Promise((r) => setTimeout(r, 500));
    const media = path.join(dir, 'site');
    fs.mkdirSync(media, { recursive: true });
    spawnSync(tools.require('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:duration=90:seed=7', '-c:a', 'libmp3lame', '-q:a', '2', path.join(media, 'pink.mp3')]);
    // A picture to play in the video player, with the same noise for sound.
    spawnSync(tools.require('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=90', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:duration=90:seed=7', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(media, 'test.mp4')]);
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '');
      const file = path.join(media, name === 'test.mp4' ? 'test.mp4' : 'pink.mp3');
      const size = fs.statSync(file).size;
      const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.writeHead(m ? 206 : 200, { 'Content-Type': file.endsWith('.mp4') ? 'video/mp4' : 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
      fs.createReadStream(file, { start, end }).pipe(res);
    });
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  })();
  return started;
}

const offlineScript = (expected: Record<string, { gains: number[]; headroom: number; want: number[] }>) => `(async () => {
  const A = window.__luminaAudio;
  if (!A) return JSON.stringify({ error: 'no chain hook' });
  const sr = 48000, FREQS = ${JSON.stringify(FREQS)}, EXPECT = ${JSON.stringify(expected)};
  const render = async (make, o, secs = 1, tap = 'output') => {
    const c = new OfflineAudioContext(1, sr * secs, sr);
    const buf = c.createBuffer(1, sr * secs, sr);
    make(buf.getChannelData(0));
    const src = c.createBufferSource(); src.buffer = buf;
    const chain = A.buildChain(c, src, o);
    chain[tap].connect(c.destination); src.start();
    return (await c.startRendering()).getChannelData(0);
  };
  const sine = (f, a) => (d) => { for (let i = 0; i < d.length; i++) d[i] = a * Math.sin(2 * Math.PI * f * i / sr); };
  const rms = (x, from = 0.5) => { let s = 0, n = 0; for (let i = Math.floor(x.length * from); i < x.length; i++) { s += x[i] * x[i]; n++; } return Math.sqrt(s / n); };
  const peak = (x, from = 0.25) => { let p = 0; for (let i = Math.floor(x.length * from); i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; };
  const db = (v) => 20 * Math.log10(v);
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  // 1. The measured gain of the real chain against the curve, for every preset, at eleven frequencies. The same chain with a flat curve is the baseline, so whatever the
  // limiter node itself adds (its make-up gain) is not counted against the curve.
  const base = {};
  for (const f of FREQS) base[f] = db(rms(await render(sine(f, 0.02), { gains: Array(10).fill(0), trackGain: 1, boostGain: 1, protect: false })) / (0.02 / Math.SQRT2));
  let worst = 0, worstWhere = '';
  for (const [id, e] of Object.entries(EXPECT)) {
    for (const [i, f] of FREQS.entries()) {
      const out = await render(sine(f, 0.02), { gains: e.gains, trackGain: 1, boostGain: 1, protect: false, headroomDb: e.headroom });
      const got = db(rms(out) / (0.02 / Math.SQRT2)) - base[f];
      const err = Math.abs(got - e.want[i]);
      if (err > worst) { worst = err; worstWhere = id + ' @ ' + f + ' Hz: measured ' + got.toFixed(2) + ', curve ' + e.want[i].toFixed(2); }
    }
  }
  add('the real audio chain follows the curve for all presets at 11 frequencies', worst <= 0.35, 'worst error ' + worst.toFixed(3) + ' dB (' + worstWhere + ')');

  // The limiter node (a compressor) adds make-up gain whenever it is engaged. Measured here so the live check can tell it from the curve.
  const quietRef = rms(await render(sine(1000, 0.02), { gains: Array(10).fill(0), trackGain: 1, boostGain: 1, protect: false }));
  const quietLim = rms(await render(sine(1000, 0.02), { gains: Array(10).fill(0), trackGain: 1, boostGain: 1, protect: true }));
  window.__makeupDb = db(quietLim / quietRef);
  add('the limiter, when engaged, adds only a small make-up gain (measured, reported)', Math.abs(window.__makeupDb) < 2, window.__makeupDb.toFixed(2) + ' dB');

  // 2. A flat curve changes nothing.
  const flatRms = db(rms(await render(sine(1000, 0.3), { gains: Array(10).fill(0), trackGain: 1, boostGain: 1, protect: false })) / (0.3 / Math.SQRT2));
  add('a flat curve passes a signal through at the same level', Math.abs(flatRms) < 0.1, flatRms.toFixed(3) + ' dB');

  // 3. A hot signal under a bass boost. The person's chain as the app builds it: headroom, then the limiter on because the curve lifts.
  const bass = EXPECT.bass;
  const hot = sine(62, 0.98);
  // Before the limiter and the ceiling (the boost stage's output): what the equalizer alone does to a loud track.
  const unprotected = peak(await render(hot, { gains: bass.gains, trackGain: 1, boostGain: 1, protect: false }, 1, 'boost'));
  const protectedOut = peak(await render(hot, { gains: bass.gains, trackGain: 1, boostGain: 1, protect: true, headroomDb: bass.headroom }));
  add('the equalizer alone would push a loud track far over full scale (what used to be clipped)', unprotected > 1.5, 'peak ' + unprotected.toFixed(2));
  add('with headroom and the limiter the same track stays under full scale', protectedOut <= 0.999, 'peak ' + protectedOut.toFixed(3) + ', headroom ' + bass.headroom + ' dB');

  // 4. A loud, bass-heavy, broadband signal (noise through a slow low-pass), every boosting preset.
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 * 2 - 1; };
  const heavy = (d) => { let y = 0, m = 0; for (let i = 0; i < d.length; i++) { y += 0.02 * (rnd() - y); d[i] = y + 0.15 * rnd(); m = Math.max(m, Math.abs(d[i])); } for (let i = 0; i < d.length; i++) d[i] = d[i] / m * 0.98; };
  const over = [];
  for (const [id, e] of Object.entries(EXPECT)) {
    if (e.headroom === 0 && Math.max(...e.want) <= 0.05) continue;
    const y = await render(heavy, { gains: e.gains, trackGain: 1, boostGain: 1, protect: true, headroomDb: e.headroom }, 2);
    if (peak(y) > 0.999) over.push(id + ' ' + peak(y).toFixed(3));
  }
  add('loud bass-heavy music stays under full scale for every preset', over.length === 0, over.length ? over.join('; ') : 'all under 1.0');

  // 5. Shelves are shelves: lifting the top lifts everything above it, lifting the bottom everything below.
  // The curve itself, without the headroom taken off before it (the headroom lowers every band alike).
  const t = EXPECT.treble.want.map((v) => v - EXPECT.treble.headroom), b = EXPECT.bass.want.map((v) => v - EXPECT.bass.headroom);
  add('treble boost lifts 8 kHz, 12 kHz and 16 kHz alike (a shelf, not a bump)', t[8] > 4 && t[9] > 3.5 && t[10] > 3.5, [t[8], t[9], t[10]].map((v) => v.toFixed(1)).join(' / ') + ' dB');
  add('bass boost lifts 40 Hz, 62 Hz and 125 Hz alike', b[0] > 4 && b[1] > 5 && b[2] > 4, [b[0], b[1], b[2]].map((v) => v.toFixed(1)).join(' / ') + ' dB');

  // 6. Best sound's own curve at the loudness it was measured at: a quiet track lifted 6 dB with the clarity curve does not clip.
  const cl = EXPECT.clarity;
  const lifted = peak(await render(sine(1000, 0.5), { gains: cl.gains, trackGain: 2, boostGain: 1, protect: true, headroomDb: cl.headroom }));
  add('best sound with a track lifted 6 dB stays under full scale', lifted <= 0.999, 'peak ' + lifted.toFixed(3));
  return JSON.stringify({ checks });
})()`;

const liveScript = (expected: Record<string, number[]>, pinkPath: string) => `(async () => {
  const A = window.__luminaAudio, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const EXPECT = ${JSON.stringify(expected)}, CENTRES = ${JSON.stringify(CENTRES)};
  const P = (patch) => window.lumina.invoke('settings:update', { player: patch });
  for (let i = 0; i < 120; i++) { try { await fetch('http://127.0.0.1:${PORT}/pink.mp3', { mode: 'no-cors', headers: { Range: 'bytes=0-1' } }); break; } catch { await sleep(500); } }
  await P({ bestSound: false, normalizeLoudness: false, eqEnabled: true, eqProfile: 'bass' });
  __luminaPlayer.getState().playQueue([{ id: 'pink', kind: 'audio', title: 'Pink noise', artist: 'Test', album: 'Test', durationSec: 90, src: '', artworkUrl: null, path: null, lazyUrl: 'http://127.0.0.1:${PORT}/pink.mp3' }]);
  await sleep(9000);
  const state = __luminaPlayer.getState();
  const checks = [], add = (name, pass, detail) => checks.push({ name, pass, detail });
  add('the noise is really playing through the player', state.playing === true, 'playing=' + state.playing);
  add('the audio graph was built by the equalizer', A.graphReady() === true, '');
  const average = async () => {
    const acc = CENTRES.map(() => 0); let n = 0;
    for (let k = 0; k < 50; k++) { const f = A.probeBands(CENTRES); if (f) { f.forEach((v, i) => { acc[i] += 10 ** (v / 10); }); n++; } await sleep(150); }
    return acc.map((a) => 10 * Math.log10(a / Math.max(1, n)));
  };
  await P({ eqProfile: 'flat' }); await sleep(1500);
  const flat = await average();
  add('the output has a signal to measure', flat.every((v) => v > -90), flat.map((v) => v.toFixed(0)).join(' / ') + ' dB');
  // The flat baseline has the limiter out of the way and a boosting preset has it engaged, so every band of a boosting preset carries the limiter's make-up gain on
  // top of the curve (measured offline above). It is the same in every band, so what is checked is the SHAPE (each band's error after taking out the mean offset),
  // and that the offset is the make-up gain.
  const makeup = window.__makeupDb ?? 0;
  let worst = 0, where = '', offsets = [];
  const rows = {};
  for (const id of Object.keys(EXPECT)) {
    await P({ eqProfile: id }); await sleep(1500);
    const got = await average();
    rows[id] = got.map((v, i) => +(v - flat[i]).toFixed(1));
    const diffs = got.map((v, i) => (v - flat[i]) - EXPECT[id][i]);
    const offset = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    offsets.push(offset);
    diffs.forEach((d, i) => { const err = Math.abs(d - offset); if (err > worst) { worst = err; where = id + ' @ ' + CENTRES[i] + ' Hz: measured ' + rows[id][i] + ', curve ' + EXPECT[id][i].toFixed(1) + ', offset ' + offset.toFixed(2); } });
  }
  add('the live output has the shape of each preset (8 octave bands, after the common offset)', worst <= 0.8, 'worst shape error ' + worst.toFixed(2) + ' dB (' + where + ')');
  const meanOffset = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  add('the common offset is the limiter make-up gain measured offline', Math.abs(meanOffset - makeup) <= 0.5, 'offset ' + meanOffset.toFixed(2) + ' dB, make-up ' + makeup.toFixed(2) + ' dB');
  const bassRow = rows.bass || [], trebleRow = rows.treble || [];
  add('bass boost lifts the lows 4 dB or more above the highs in the live output', bassRow[0] - bassRow[6] > 4, '62 Hz minus 4 kHz = ' + (bassRow[0] - bassRow[6]).toFixed(1) + ' dB');
  add('treble boost lifts the highs 3.5 dB or more above the lows in the live output (the 8 kHz octave band averages 5.6 to 11 kHz)', trebleRow[7] - trebleRow[1] > 3.5, '8 kHz minus 125 Hz = ' + (trebleRow[7] - trebleRow[1]).toFixed(1) + ' dB');
  // Loudness matching, with everything else in the chain as it is by default: the track gets a gain from its measured loudness (it needs a file on disk to be
  // measured, so the track is given its path as well), and the gain goes through the headroom, the limiter and the ceiling without any of them misbehaving.
  const overall = (v) => 10 * Math.log10(v.reduce((a, b) => a + 10 ** (b / 10), 0) / v.length);
  await P({ eqEnabled: false, eqProfile: 'flat', bestSound: false, normalizeLoudness: false });
  // A track from the library, as a person plays one: the folder is a library root (in this scratch profile only), and the file is resolved to a playable item that has its path.
  await window.lumina.invoke('settings:update', { storage: { libraryRoots: [${JSON.stringify(path.dirname(pinkPath))}] } });
  await sleep(2500);
  const item = await window.lumina.invoke('player:resolve-path', { path: ${JSON.stringify(pinkPath)} });
  __luminaPlayer.getState().playQueue([item]);
  await sleep(9000);
  const off = overall(await average());
  await P({ normalizeLoudness: true }); await sleep(7000);
  const on = overall(await average());
  await P({ normalizeLoudness: false }); await sleep(3000);
  const back = overall(await average());
  add('loudness matching raises the quiet noise track in the live output', on - off > 3, 'off ' + off.toFixed(1) + ' dB, on ' + on.toFixed(1) + ' dB (+' + (on - off).toFixed(1) + ')');
  add('and switching it off again brings the level back', Math.abs(back - off) < 1, 'back ' + back.toFixed(1) + ' dB vs ' + off.toFixed(1) + ' dB');
  await P({ eqEnabled: false, eqProfile: 'flat', bestSound: true, normalizeLoudness: true });
  return JSON.stringify({ checks, rows, flat });
})()`;

export function audioSteps(scratch: string): { name: string; script: string; delay?: number; before?: (win: BrowserWindow) => void }[] {
  const expectedOffline: Record<string, { gains: number[]; headroom: number; want: number[] }> = {};
  for (const p of EQ_PROFILES) expectedOffline[p.id] = { gains: p.gains, headroom: headroomDb(p.gains), want: FREQS.map((f) => responseDb(p.gains, f) + headroomDb(p.gains)) };
  const live: Record<string, number[]> = {};
  for (const id of ['bass', 'treble', 'vocal', 'small-speakers', 'loudness', 'clarity']) {
    const p = EQ_PROFILES.find((x) => x.id === id)!;
    live[id] = CENTRES.map((c) => expectedBand(p.gains, c) + headroomDb(p.gains));
  }
  return [
    { name: 'probe-audio-offline', script: offlineScript(expectedOffline), delay: 500, before: () => { void prepare(scratch); } },
    { name: 'probe-audio-live', script: liveScript(live, path.join(scratch, 'site', 'pink.mp3')), delay: 500 },
    ...panelSteps(axeNow(process.env.LUMINA_AXE)),
  ];
}
