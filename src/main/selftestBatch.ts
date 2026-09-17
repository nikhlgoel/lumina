// Development-only: batch paste -> plan -> queue -> aria2 -> verification, against a local server.
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Job } from '../shared/types';
import { planBatch } from '../core/batch';
import { inspect } from './inspect';
import { queue } from './jobs/queue';

const out = (m: string) => process.stdout.write(`[selftest] ${m}\n`);

export async function runBatchSelftest(dir: string): Promise<void> {
  const rar = () => Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), randomBytes(24 << 20)]);
  const files = new Map<string, { body: Buffer; type: string }>();
  const p1 = rar();
  const p2 = rar();
  const p3 = rar();
  files.set('Sample_Release_--_example-site.net_--_.part01.rar', { body: p1, type: 'application/x-rar-compressed' });
  files.set('Sample_Release_--_example-site.net_--_.part02.rar', { body: p2, type: 'application/x-rar-compressed' });
  // Served with a file content type but the bytes differ from the checksum: simulates a damaged transfer.
  files.set('Sample_Release_--_example-site.net_--_.part03.rar', { body: rar(), type: 'application/x-rar-compressed' });
  // A host that answers a file link with a download page.
  files.set('Sample_Release_--_example-site.net_--_.part04.rar', { body: Buffer.from('<!DOCTYPE html><html><body>Wait 30s</body></html>'), type: 'application/octet-stream' });
  files.set('fg-optional-german-vo.bin', { body: randomBytes(1 << 20), type: 'application/octet-stream' });
  const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
  files.set('Sample_Release.md5', {
    body: Buffer.from([p1, p2, p3].map((b, i) => `${md5(b)} *MD5/Sample_Release_--_example-site.net_--_.part0${i + 1}.rar`).join('\r\n')),
    type: 'application/octet-stream',
  });

  let rangeRequests = 0;
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(path.basename(new URL(req.url ?? '/', 'http://x').pathname));
    const f = files.get(name);
    if (!f) return void res.writeHead(404).end();
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const headers = { 'Content-Type': f.type, 'Accept-Ranges': 'bytes' };
    if (m) {
      rangeRequests++;
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), f.body.length - 1) : f.body.length - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${f.body.length}`, 'Content-Length': end - start + 1 });
      return void res.end(f.body.subarray(start, end + 1));
    }
    res.writeHead(200, { ...headers, 'Content-Length': f.body.length }).end(f.body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const order = ['part01', 'part02', 'part03', 'part04'].map((p) => `Sample_Release_--_example-site.net_--_.${p}.rar`);
  const blob = [...order.map((n, i) => `  ${base}/slug${i}/${n}`), `${base}/x/fg-optional-german-vo.bin`, `${base}/y/Sample_Release.md5`].join('\n');

  const plan = planBatch(blob.match(/https?:\/\/\S+/g)!);
  out(`batch plan: "${plan.title}" -> ${plan.groups.map((g) => `${g.kind}:${g.label}(${g.items.length})${g.defaultSelected ? '' : ' [off]'}`).join(', ')}`);
  const chosen = plan.groups.filter((g) => g.defaultSelected).flatMap((g) => g.items);
  const target = path.join(dir, 'Other', plan.title);
  const jobs: Job[] = [];
  for (const item of chosen) {
    const info = await inspect(item.url);
    out(`  inspect ${item.filename}: ${info.sourceKind} ${info.direct?.sizeBytes ?? ''}`);
    jobs.push(queue.addFromInfo(item.url, info, {
      contentType: 'video', format: { kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false },
      englishSubtitles: false, subtitleOutput: [], embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [], targetDir: target,
    }, target));
  }
  const started = Date.now();
  const done = await Promise.all(jobs.map((j) => new Promise<Job>((resolve) => {
    const check = (job: Job) => {
      if (job.id !== j.id || !['completed', 'failed', 'cancelled'].includes(job.status)) return;
      queue.off('updated', check);
      resolve(job);
    };
    queue.on('updated', check);
  })));
  for (const j of done) out(`  ${j.title}: ${j.status}${j.error ? ` - ${j.error.message}` : ''}`);
  out(`  ${rangeRequests} ranged requests (multi-connection), ${Math.round((Date.now() - started) / 100) / 10}s`);
  server.close();
}
