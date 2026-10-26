// A .torrent that claims a huge file (no data, no seeder), to test the disk-space check. usage: node scripts/dl-lab/fake-torrent.mjs <out.torrent> <sizeGB>
import fs from 'node:fs';

const [out, gb = '200'] = process.argv.slice(2);
const PIECE = 4 * 2 ** 20;
const sizes = gb.split(',').map((g) => Number(g) * 2 ** 30);
const size = sizes.reduce((a, b) => a + b, 0);
const enc = (v) => {
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (typeof v === 'string') return enc(Buffer.from(v));
  if (typeof v === 'number') return Buffer.from(`i${v}e`);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(enc), Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'), ...Object.keys(v).sort().flatMap((k) => [enc(k), enc(v[k])]), Buffer.from('e')]);
};
const multi = sizes.length > 1;
const info = { ...(multi ? { files: sizes.map((s, i) => ({ length: s, path: [`part${i + 1}.bin`] })) } : { length: size }), name: 'fake-huge', 'piece length': PIECE, pieces: Buffer.alloc(Math.ceil(size / PIECE) * 20, 7) };
fs.writeFileSync(out, enc({ announce: 'http://127.0.0.1:1/announce', info }));
console.log('wrote', out, size);
