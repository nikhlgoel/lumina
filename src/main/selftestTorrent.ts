// Development-only: the torrent settings, in the real download engine. A made-up torrent whose data is already on disk, so it needs no peers.
// What is checked is what the settings screen promises: the connection choices reach aria2, "Stop" really stops sharing, and
// the sharing choices really share (a ratio with no time must not be left looking like a choice).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { aria2 } from './jobs/aria2';
import { settings } from './settings';
import { isLocalHost } from '../core/torrentPrefs';

const out = (m: string) => {
  const line = `[selftest] ${m}\n`;
  process.stdout.write(line);
  if (process.env.LUMINA_SELFTEST_LOG) { try { fs.appendFileSync(process.env.LUMINA_SELFTEST_LOG, line); } catch { /* best effort */ } }
};

const bencode = (v: unknown): Buffer => {
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (typeof v === 'number') return Buffer.from(`i${v}e`);
  if (typeof v === 'string') return bencode(Buffer.from(v));
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(bencode), Buffer.from('e')]);
  const o = v as Record<string, unknown>;
  return Buffer.concat([Buffer.from('d'), ...Object.keys(o).sort().flatMap((k) => [bencode(k), bencode(o[k])]), Buffer.from('e')]);
};

/** A torrent of one random file, written with its data under `dir`, with a tracker that is never there. */
function makeTorrent(dir: string, name: string): { torrent: Buffer; infoHash: string } {
  const data = crypto.randomBytes(300 * 1024);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), data);
  const plen = 64 * 1024;
  const pieces: Buffer[] = [];
  for (let i = 0; i < data.length; i += plen) pieces.push(crypto.createHash('sha1').update(data.subarray(i, i + plen)).digest());
  const info = { length: data.length, name, 'piece length': plen, pieces: Buffer.concat(pieces) };
  return { torrent: bencode({ announce: 'http://127.0.0.1:9/announce', info }), infoHash: crypto.createHash('sha1').update(bencode(info)).digest('hex') };
}

export async function runTorrentSelftest(dir: string): Promise<void> {
  let ok = 0;
  let total = 0;
  const check = (name: string, pass: boolean, detail = '') => {
    total++;
    if (pass) ok++;
    out(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const globalOptions = () => aria2.call<Record<string, string>>('aria2.getGlobalOption');

  settings.update({ torrents: { seedRatio: 0, seedMinutes: 0, maxPeers: 60, dht: false, autoTrackers: true } });
  await aria2.ensure();
  await aria2.applySettings();

  // --- what the settings screen writes reaches the engine
  let g = await globalOptions();
  check('Balanced reaches the engine as 60 peers', g['bt-max-peers'] === '60', g['bt-max-peers']);
  check('"Stop" reaches the engine as seed-time 0', g['seed-time'] === '0', g['seed-time']);
  settings.update({ torrents: { maxPeers: 250 } });
  await aria2.applySettings();
  g = await globalOptions();
  check('Maximum reaches the running engine as 250 peers, with no restart', g['bt-max-peers'] === '250', g['bt-max-peers']);

  const trackers = (g['bt-tracker'] ?? '').split(',').filter(Boolean);
  check('the engine was given a tracker list', trackers.length >= 5, String(trackers.length));
  check('and none of its trackers is on this machine or its own network', trackers.every((t) => { try { return !isLocalHost(new URL(t).hostname); } catch { return false; } }), trackers.filter((t) => { try { return isLocalHost(new URL(t).hostname); } catch { return true; } }).join(' '));
  check('and none is longer than a tracker address should be', trackers.every((t) => t.length <= 200));

  // --- "Stop": a torrent whose data is already here finishes and is not shared
  const add = async (name: string): Promise<string> => {
    const sub = path.join(dir, name.replace(/\W/g, '_'));
    const { torrent } = makeTorrent(sub, name);
    return aria2.call<string>('aria2.addTorrent', torrent.toString('base64'), [], { dir: sub, 'check-integrity': 'true', 'bt-seed-unverified': 'true' });
  };
  const state = async (gid: string) => aria2.call<{ status: string; seeder?: string }>('aria2.tellStatus', gid, ['status', 'seeder']).catch(() => ({ status: 'gone' }));
  const waitFor = async (gid: string, want: (s: { status: string; seeder?: string }) => boolean, ms: number) => {
    const until = Date.now() + ms;
    let last = { status: '?' } as { status: string; seeder?: string };
    while (Date.now() < until) {
      last = await state(gid);
      if (want(last)) return { hit: true, last };
      await sleep(300);
    }
    return { hit: false, last };
  };

  const stopGid = await add('stop-test.bin');
  const stopped = await waitFor(stopGid, (s) => s.status === 'complete' || s.status === 'gone', 20_000);
  check('Stop: a finished torrent is not seeded (the engine reports it complete)', stopped.hit, JSON.stringify(stopped.last));

  // --- the sharing choices: ratio 1 and 2 hours, and "a week with no ratio", both keep sharing
  for (const [label, ratio, minutes] of [['A little', 1, 120], ['Keep sharing', 0, 10_080], ['a ratio with no time (shown as Stop)', 2, 0]] as const) {
    settings.update({ torrents: { seedRatio: ratio, seedMinutes: minutes } });
    await aria2.applySettings();
    const gid = await add(`${label.replace(/\W/g, '')}.bin`);
    const seeding = await waitFor(gid, (s) => s.status === 'active' && s.seeder === 'true', 20_000);
    const done = await waitFor(gid, (s) => s.status === 'complete' || s.status === 'gone', minutes === 0 ? 20_000 : 1500);
    if (minutes === 0) check(`${label}: does not share, as its label says`, done.hit, JSON.stringify(done.last));
    else check(`${label}: keeps sharing after the download`, seeding.hit && !done.hit, JSON.stringify({ seeding: seeding.last, done: done.last }));
  }

  await aria2.gracefulStop().catch(() => undefined);
  out(`${ok}/${total} checks passed`);
}
