import https from 'node:https';
import { logger } from './log';

const log = logger('lines');

// A few seconds of real traffic over each network connection, to share a download between them in proportion to how fast each is.
// Equal shares are wrong for unequal lines (see core/networkBind weightedBindList). Two public files in case one has moved.
const PROBE_URLS = [
  'https://releases.ubuntu.com/24.04/ubuntu-24.04.3-live-server-amd64.iso',
  'https://proof.ovh.net/files/1Gb.dat',
];
const CONNECTIONS = 4;
const WARM_UP_MS = 1500;
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; speeds: number[] }>();

/** Bytes per second one line delivers: several connections bound to its address, counted for `ms`. 0 when it cannot be measured. */
function oneLine(address: string, url: string, ms: number): Promise<number> {
  let bytes = 0;
  const started = Date.now();
  // The first moments are TCP and TLS ramping up, not the line's speed: a tether that does 34 MB/s read 2.6 over three seconds.
  // Bytes count only after a warm-up, and the speed is those bytes over the time since.
  const warmEnd = started + WARM_UP_MS;
  const streams = Array.from({ length: CONNECTIONS }, (_, i) => new Promise<void>((resolve) => {
    const start = i * 100_000_000;
    // family 4: the bind address is IPv4, and without this Node tries IPv6 first (a tether's DNS64 hands out such addresses),
    // which fails with "bind EINVAL" and made every measurement read 0 MB/s.
    const req = https.get(url, { localAddress: address, family: 4, headers: { Range: `bytes=${start}-${start + 99_999_999}` }, timeout: ms + 3000 }, (res) => {
      if (res.statusCode !== 206 && res.statusCode !== 200) { res.destroy(); resolve(); return; }
      res.on('data', (chunk: Buffer) => { if (Date.now() >= warmEnd) bytes += chunk.length; });
      res.on('error', () => resolve());
      res.on('close', () => resolve());
      setTimeout(() => res.destroy(), ms);
    });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
  }));
  return Promise.all(streams).then(() => bytes / Math.max(0.5, (Date.now() - warmEnd) / 1000));
}

/** Speed of each address in bytes/s, in the order given; 0 for one that failed. Cached for ten minutes. */
export async function measureLines(addresses: string[], ms = 5000): Promise<number[]> {
  const key = addresses.join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.speeds;
  let speeds: number[] = addresses.map(() => 0);
  for (const url of PROBE_URLS) {
    speeds = await Promise.all(addresses.map((a) => oneLine(a, url, ms)));
    if (speeds.some((s) => s > 0)) break;
  }
  log.info('Measured network connections', Object.fromEntries(addresses.map((a, i) => [a, `${(speeds[i]! / 1048576).toFixed(1)} MB/s`])));
  if (speeds.some((s) => s > 0)) cache.set(key, { at: Date.now(), speeds });
  return speeds;
}
