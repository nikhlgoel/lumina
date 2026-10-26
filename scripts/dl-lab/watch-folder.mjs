// Log what is in a folder (names + sizes) whenever it changes. usage: node scripts/dl-lab/watch-folder.mjs <dir> <logfile> <seconds>
import fs from 'node:fs';
import path from 'node:path';

const [dir, logfile, secs = '300'] = process.argv.slice(2);
const t0 = Date.now();
let prev = '';
const list = (d, base = '') => {
  let out = [];
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) out = out.concat(list(p, base + e.name + '/'));
      else { let s = -1; try { s = fs.statSync(p).size; } catch {} out.push(`${base}${e.name}=${(s / 1048576).toFixed(0)}MB`); }
    }
  } catch {}
  return out.sort();
};
const tick = () => {
  const now = list(dir).join(' | ');
  // Sizes change constantly while downloading; only log a change in WHICH files exist, plus a coarse size every 10 s.
  const names = now.replace(/=\d+MB/g, '');
  if (names !== prev || Math.floor((Date.now() - t0) / 10000) !== tick.last) {
    fs.appendFileSync(logfile, `${((Date.now() - t0) / 1000).toFixed(1)}s ${new Date().toISOString().slice(11, 23)}Z ${now || '(empty)'}\n`);
    prev = names; tick.last = Math.floor((Date.now() - t0) / 10000);
  }
};
fs.writeFileSync(logfile, '');
const h = setInterval(tick, 250);
setTimeout(() => { clearInterval(h); process.exit(0); }, Number(secs) * 1000);
