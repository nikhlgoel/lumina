import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CHECKSUM_FILE } from '../../core/batch';
import { checkHeader, HEADER_BYTES, manifestKey, parseChecksumManifest, type ChecksumEntry } from '../../core/verify';
import { logger } from '../log';

const log = logger('verify');
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export type VerifyResult = { ok: true; method: 'checksum' | 'header' } | { ok: false; reason: string };

/** Look for a checksum manifest next to the file (e.g. a release .md5 or SHA256SUMS) that lists it. */
function findChecksum(file: string): ChecksumEntry | null {
  const dir = path.dirname(file);
  const key = manifestKey(path.basename(file));
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!CHECKSUM_FILE.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).size > MAX_MANIFEST_BYTES) continue;
      const entry = parseChecksumManifest(name, fs.readFileSync(full, 'utf8')).get(key);
      if (entry) return entry;
    } catch (err) {
      log.debug(`Unreadable checksum file ${full}`, err);
    }
  }
  return null;
}

async function hashFile(file: string, entry: ChecksumEntry, total: number, onProgress: (percent: number) => void, signal: AbortSignal): Promise<string> {
  let done = 0;
  let last = 0;
  if (entry.algo === 'crc32') {
    let crc = 0;
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 << 20, signal })) {
      crc = zlib.crc32(chunk as Buffer, crc);
      done += (chunk as Buffer).length;
      if (Date.now() - last > 250) (last = Date.now(), onProgress((done / total) * 100));
    }
    return crc.toString(16).padStart(8, '0');
  }
  const hash = createHash(entry.algo);
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 << 20, signal })) {
    hash.update(chunk as Buffer);
    done += (chunk as Buffer).length;
    if (Date.now() - last > 250) (last = Date.now(), onProgress((done / total) * 100));
  }
  return hash.digest('hex');
}

/**
 * Check a finished download before calling it done: complete size, real file contents (not an
 * error page), and the release checksum when one sits in the same folder.
 */
export async function verifyDownload(
  file: string,
  expectedSize: number | null,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<VerifyResult> {
  const stat = await fs.promises.stat(file);
  if (expectedSize && stat.size !== expectedSize) {
    return { ok: false, reason: `The file is incomplete (${stat.size} of ${expectedSize} bytes).` };
  }
  const fd = await fs.promises.open(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(HEADER_BYTES, stat.size));
    await fd.read(head, 0, head.length, 0);
    const header = checkHeader(path.basename(file), head);
    if (!header.ok) return header;
  } finally {
    await fd.close();
  }
  const entry = findChecksum(file);
  if (!entry) return { ok: true, method: 'header' };
  const actual = await hashFile(file, entry, stat.size || 1, onProgress, signal);
  if (actual !== entry.hash) {
    log.warn(`Checksum mismatch for ${file}: expected ${entry.hash}, got ${actual} (${entry.algo})`);
    return { ok: false, reason: `The file is corrupted: its ${entry.algo.toUpperCase()} checksum doesn’t match the release’s checksum file.` };
  }
  return { ok: true, method: 'checksum' };
}
