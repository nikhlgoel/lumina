import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

vi.mock('../src/main/log', () => ({ logger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) }));
const { verifyDownload } = await import('../src/main/jobs/verify');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-verify-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const signal = new AbortController().signal;
const rar = (n: number) => Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), Buffer.alloc(n, 7)]);

describe('verifyDownload on real files', () => {
  it('passes a volume whose MD5 matches the release checksum file', async () => {
    const good = rar(3 << 20);
    fs.writeFileSync(path.join(dir, 'set.part01.rar'), good);
    fs.writeFileSync(path.join(dir, 'set.part02.rar'), rar(1000));
    fs.writeFileSync(path.join(dir, 'release.md5'), [
      `${createHash('md5').update(good).digest('hex')} *MD5\\set.part01.rar`,
      `${'0'.repeat(32)} *MD5\\set.part02.rar`,
    ].join('\r\n'));
    const progress: number[] = [];
    await expect(verifyDownload(path.join(dir, 'set.part01.rar'), good.length, (p) => progress.push(p), signal)).resolves.toEqual({ ok: true, method: 'checksum' });
    const bad = await verifyDownload(path.join(dir, 'set.part02.rar'), null, () => {}, signal);
    expect(bad.ok).toBe(false);
  });

  it('checks SFV CRC32 and catches HTML saved as an archive or a short file', async () => {
    const data = Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(5000, 3)]);
    fs.writeFileSync(path.join(dir, 'other.7z.001'), data);
    fs.writeFileSync(path.join(dir, 'other.sfv'), `other.7z.001 ${zlib.crc32(data).toString(16).padStart(8, '0')}\n`);
    await expect(verifyDownload(path.join(dir, 'other.7z.001'), null, () => {}, signal)).resolves.toEqual({ ok: true, method: 'checksum' });

    fs.writeFileSync(path.join(dir, 'page.part03.rar'), '<!DOCTYPE html><html><body>Please wait 30 seconds</body></html>');
    const html = await verifyDownload(path.join(dir, 'page.part03.rar'), null, () => {}, signal);
    expect(html).toMatchObject({ ok: false });
    expect((html as { reason: string }).reason).toMatch(/web page/);

    fs.writeFileSync(path.join(dir, 'short.iso'), Buffer.alloc(10));
    expect((await verifyDownload(path.join(dir, 'short.iso'), 20, () => {}, signal)).ok).toBe(false);
    await expect(verifyDownload(path.join(dir, 'short.iso'), 10, () => {}, signal)).resolves.toEqual({ ok: true, method: 'header' });
  });
});
