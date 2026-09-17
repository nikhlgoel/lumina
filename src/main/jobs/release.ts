// Assembles a pasted release once its downloads finish: unpack split archives with 7-Zip (their own
// checksums catch damaged data), verify the unpacked files against any checksum lists inside, move
// optional components next to the installer, and point the Queue at "Run setup".
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { ChildProcess } from 'node:child_process';
import type { Job, ReleaseTag } from '../../shared/types';
import { installerIn, parseListing, parseProgress, unpackError } from '../../core/archive';
import { CHECKSUM_FILE, prettyTitle, splitVolume } from '../../core/batch';
import { parseChecksumEntries, type ChecksumEntry } from '../../core/verify';
import { formatBytes } from '../../core/format';
import { killTree, runTool, spawnTool } from '../process';
import { tools } from '../tools';
import { logger } from '../log';
import { queue, type Runner } from './queue';

const log = logger('release');

const tagOf = (job: Job): ReleaseTag | undefined => job.options.release;
const isArchiveSet = (t: ReleaseTag | undefined) => Boolean(t?.set);
const isMainSet = (t: ReleaseTag | undefined) => Boolean(t?.set && t.role === 'archive');

/* ---------- file helpers ---------- */

function walk(dir: string, depth = 6, out: string[] = []): string[] {
  if (depth < 0) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth - 1, out);
    else out.push(full);
  }
  return out;
}

async function hashFile(file: string, entry: ChecksumEntry, signal: AbortSignal, onBytes: (n: number) => void): Promise<string> {
  const stream = fs.createReadStream(file, { highWaterMark: 4 << 20, signal });
  if (entry.algo === 'crc32') {
    let crc = 0;
    for await (const chunk of stream) {
      crc = zlib.crc32(chunk as Buffer, crc);
      onBytes((chunk as Buffer).length);
    }
    return crc.toString(16).padStart(8, '0');
  }
  const hash = createHash(entry.algo);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
    onBytes((chunk as Buffer).length);
  }
  return hash.digest('hex');
}

/**
 * Verify unpacked files against checksum lists shipped inside the archive (e.g. a repack's MD5 folder).
 * Paths in a list are relative to the list, but some point one folder up; try both, then the name alone.
 */
async function verifyUnpacked(root: string, files: string[], signal: AbortSignal, onStage: (s: string, pct: number) => void): Promise<{ checked: number; bad: string[] }> {
  const manifests = files.filter((f) => CHECKSUM_FILE.test(path.basename(f)) && fs.statSync(f).size < 8 << 20);
  const byName = new Map(files.map((f) => [path.basename(f).toLowerCase(), f]));
  const work: { file: string; entry: ChecksumEntry; size: number }[] = [];
  for (const m of manifests) {
    for (const e of parseChecksumEntries(path.basename(m), fs.readFileSync(m, 'utf8'))) {
      const rel = e.name.replace(/[\\/]+/g, path.sep);
      const candidates = [path.resolve(path.dirname(m), rel), path.resolve(path.dirname(path.dirname(m)), path.basename(rel))];
      const file = candidates.find((c) => c.startsWith(root) && fs.existsSync(c)) ?? byName.get(path.basename(rel).toLowerCase());
      if (!file) continue;
      work.push({ file, entry: e, size: fs.statSync(file).size });
    }
  }
  const total = work.reduce((n, w) => n + w.size, 0) || 1;
  let done = 0;
  let last = 0;
  const bad: string[] = [];
  for (const w of work) {
    const actual = await hashFile(w.file, w.entry, signal, (n) => {
      done += n;
      if (Date.now() - last > 300) {
        last = Date.now();
        onStage(`Verifying unpacked files · ${path.basename(w.file)}`, (done / total) * 100);
      }
    });
    if (actual !== w.entry.hash) bad.push(path.relative(root, w.file));
  }
  return { checked: work.length, bad };
}

/* ---------- coordinator ---------- */

function releaseJobs(id: string): Job[] {
  return queue.list().filter((j) => tagOf(j)?.id === id);
}

/** Folder holding the installer; null when the release has no main archive, undefined until it's unpacked. */
function mainInstallerDir(jobs: Job[]): string | null | undefined {
  if (!jobs.some((j) => j.engine === 'aria2' && isMainSet(tagOf(j)))) return null;
  const unpacked = jobs.filter((j) => j.engine === 'extract' && isMainSet(tagOf(j)) && j.status === 'completed');
  // Prefer the unpacked set that actually contains an installer.
  const done = unpacked.find((j) => j.outputPaths.some((p) => /\.exe$/i.test(p))) ?? unpacked[0];
  return done ? (done.outputDir ?? null) : undefined;
}

function firstVolume(members: Job[]): string | null {
  const sorted = [...members].sort((a, b) => (tagOf(a)?.part ?? 0) - (tagOf(b)?.part ?? 0));
  return sorted[0]?.outputPaths[0] ?? null;
}

/** Look at a release after any of its jobs finishes and queue whatever can happen next. */
export function advanceRelease(id: string) {
  const jobs = releaseJobs(id);
  const downloads = jobs.filter((j) => j.engine === 'aria2');
  const extracts = jobs.filter((j) => j.engine === 'extract');
  const tag = downloads[0] ? tagOf(downloads[0])! : undefined;
  if (!tag?.unpack) return;
  const installerDir = mainInstallerDir(jobs);

  const sets = new Map<string, Job[]>();
  for (const j of downloads) {
    const t = tagOf(j);
    if (!isArchiveSet(t)) continue;
    sets.set(t!.set!, [...(sets.get(t!.set!) ?? []), j]);
  }

  for (const [set, members] of sets) {
    const t = tagOf(members[0]!)!;
    if (extracts.some((e) => tagOf(e)?.set === set)) continue;
    if (members.length < (t.parts ?? members.length) || !members.every((m) => m.status === 'completed')) continue;
    // Optional archives unpack next to the installer, so wait for the main archive first.
    if (t.role !== 'archive' && installerDir === undefined) continue;
    const first = firstVolume(members);
    if (!first || !fs.existsSync(first)) continue;
    const dest = t.role === 'archive' ? t.dir : installerDir ?? t.dir;
    log.info(`Unpacking ${set} (${members.length} parts) into ${dest}`);
    queue.add({
      url: first, title: `Unpack ${prettyTitle(splitVolume(path.basename(first))?.base ?? path.basename(first)).replace(/^fg[- ](optional|selective)[- ]/i, `${t.title} · `)}`,
      thumbnail: null, uploader: t.title, engine: 'extract', outputDir: dest,
      options: {
        contentType: 'video', format: { kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false },
        englishSubtitles: false, subtitleOutput: [], embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [],
        release: { ...t, part: undefined },
      },
      source: { sourceKind: 'direct', site: 'Local files', entries: [] },
    });
  }

  // Loose optional components (voice packs etc.) belong in the installer's folder.
  if (installerDir) {
    for (const j of downloads) {
      const t = tagOf(j);
      if (t?.role !== 'optional' || t.set || j.status !== 'completed') continue;
      const src = j.outputPaths[0];
      if (!src || !fs.existsSync(src) || path.dirname(src) === installerDir) continue;
      const dest = path.join(installerDir, path.basename(src));
      try {
        fs.renameSync(src, dest);
        queue.update(j.id, { outputPaths: [dest], outputDir: installerDir });
        log.info(`Placed ${path.basename(src)} next to the installer`);
      } catch (err) {
        log.warn(`Could not move ${src} next to the installer`, err);
      }
    }
  }
}

export function watchReleases() {
  queue.on('completed', (job) => {
    const t = tagOf(job);
    if (t?.unpack) advanceRelease(t.id);
  });
  // Releases whose last download finished while Lumina was closed.
  const ids = new Set(queue.list().map((j) => tagOf(j)?.id).filter((x): x is string => Boolean(x)));
  for (const id of ids) advanceRelease(id);
}

/* ---------- unpack runner ---------- */

export const extractRunner: Runner = (ctx) => {
  const job = ctx.job();
  const tag = tagOf(job);
  let child: ChildProcess | null = null;
  let stopped = false;
  const abort = new AbortController();

  (async () => {
    const first = job.url;
    const dest = job.outputDir ?? tag?.dir ?? path.dirname(first);
    if (!fs.existsSync(first)) throw new Error('The first archive part is no longer there.');
    // Queued at startup, possibly before tools were probed.
    if (!tools.has('7z')) await tools.probe('7z');
    const sevenZip = tools.require('7z');
    fs.mkdirSync(dest, { recursive: true });

    ctx.progress({ stage: 'Reading archive', percent: 0, speedBps: null, etaSec: null }, 'processing');
    const listed = await runTool(sevenZip, ['l', '-slt', '-p', first], { timeoutMs: 15 * 60_000 });
    if (stopped) return;
    if (listed.code !== 0) throw new Error(unpackError(listed.code, `${listed.stdout}\n${listed.stderr}`));
    const listing = parseListing(listed.stdout);
    if (listing.encrypted) throw new Error(unpackError(2, 'Wrong password'));
    const free = (() => {
      try {
        const s = fs.statfsSync(dest);
        return s.bavail * s.bsize;
      } catch {
        return Infinity;
      }
    })();
    if (listing.totalBytes > free) {
      throw new Error(`Not enough disk space to unpack: needs ${formatBytes(listing.totalBytes)}, ${formatBytes(free)} free on that drive.`);
    }

    const before = new Set(walk(dest));
    ctx.progress({ stage: `Unpacking ${formatBytes(listing.totalBytes)}`, percent: 0 });
    const started = Date.now();
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      // -p with no value: never prompt for a password (stdin is closed anyway); -aoa: a retry overwrites half-written files.
      child = spawnTool(sevenZip, ['x', first, `-o${dest}`, '-y', '-aoa', '-p', '-bsp1', '-bso0', '-bse2'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stdout?.on('data', (c: Buffer) => {
        const pct = parseProgress(c.toString('utf8'));
        if (pct === null) return;
        const elapsed = (Date.now() - started) / 1000;
        const doneBytes = (listing.totalBytes * pct) / 100;
        ctx.progress({
          percent: pct, downloadedBytes: doneBytes, totalBytes: listing.totalBytes,
          speedBps: elapsed > 1 ? doneBytes / elapsed : null, etaSec: pct > 0 ? (elapsed * (100 - pct)) / pct : null,
          stage: `Unpacking · ${pct}%`,
        });
      });
      child.stderr?.on('data', (c: Buffer) => {
        stderr = (stderr + c.toString('utf8')).slice(-16_000);
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
    });
    child = null;
    if (stopped) return;
    // 0 = ok, 1 = warnings (e.g. a locked file skipped); anything else is a real failure.
    if (result.code !== 0 && result.code !== 1) throw Object.assign(new Error(unpackError(result.code, result.stderr)), { detail: result.stderr });

    const after = walk(dest);
    const created = after.filter((f) => !before.has(f));
    const installer = installerIn(created.length ? created : after);
    const installerDir = installer ? path.dirname(installer) : dest;

    // The repack's own checksum list (if any) proves the unpacked data is intact.
    ctx.progress({ stage: 'Verifying unpacked files', percent: 0, speedBps: null, etaSec: null });
    const check = await verifyUnpacked(dest, created.length ? created : after, abort.signal, (stage, pct) => ctx.progress({ stage, percent: pct }));
    if (stopped) return;
    if (check.bad.length) {
      throw Object.assign(new Error(`${check.bad.length} unpacked file${check.bad.length === 1 ? ' is' : 's are'} damaged (checksum mismatch). Retry the download parts, then unpack again.`), { detail: check.bad.join('\n') });
    }
    if (check.checked) log.info(`Verified ${check.checked} unpacked files against the release checksums`);

    if (tag?.deleteArchives) {
      const volumes = queue.list().filter((j) => j.engine === 'aria2' && tagOf(j)?.id === tag.id && tagOf(j)?.set === tag.set);
      for (const v of volumes) {
        for (const p of v.outputPaths) {
          fs.rmSync(p, { force: true });
          fs.rmSync(`${p}.aria2`, { force: true });
        }
      }
      log.info(`Removed ${volumes.length} archive parts after a verified unpack`);
    }

    ctx.patch({ outputDir: installerDir, outputPaths: installer ? [installer] : [], title: `${job.title.replace(/^Unpack /, 'Unpacked ')}` });
    ctx.progress({
      percent: 100, speedBps: null, etaSec: 0,
      stage: installer ? `Ready to install${check.checked ? ` · ${check.checked} files verified` : ''}` : `Unpacked${check.checked ? ` · ${check.checked} files verified` : ''}`,
    });
    ctx.complete();
  })().catch((err: Error & { detail?: string }) => {
    if (stopped) return;
    ctx.fail(err.message, err.detail);
  });

  return {
    stop: () => {
      stopped = true;
      abort.abort();
      killTree(child);
    },
  };
};
