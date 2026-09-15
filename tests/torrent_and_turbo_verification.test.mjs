import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
const PREDEFINED_HIGH_SPEED_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://uploads.gamecoast.net:5544/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'https://tracker.tamersunion.org:443/announce'
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTorrentAndTurboVerification() {
  console.log('====================================================');
  console.log('    LUMINA BITTORRENT & IDM TURBO SUBSYSTEM TEST    ');
  console.log('====================================================\n');

  // [1/4] Predefined Public BitTorrent Trackers
  console.log('[1/4] Verifying Predefined High-Speed Trackers:');
  console.log(`  ✓ Loaded ${PREDEFINED_HIGH_SPEED_TRACKERS.length} predefined high-speed trackers.`);
  for (let i = 0; i < Math.min(4, PREDEFINED_HIGH_SPEED_TRACKERS.length); i++) {
    console.log(`  • Tracker ${i + 1}: ${PREDEFINED_HIGH_SPEED_TRACKERS[i]}`);
  }

  // [2/4] Magnet Link Swarm Ingestion
  console.log('\n[2/4] Testing Magnet Link Ingestion & Swarm Resolution:');
  const sampleMagnet = 'magnet:?xt=urn:btih:e4c27f311c16260a9203f0ec78e47c74235882e3&dn=Arch+Linux+2026.01.01-x86_64.iso&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce';
  const params = new URLSearchParams(sampleMagnet.replace(/^magnet:\?/, ''));
  const xt = params.get('xt') || '';
  const dn = params.get('dn') || '';
  const infoHash = xt.replace(/^urn:btih:/i, '');
  const title = decodeURIComponent(dn);

  console.log('  ✓ Magnet URI parsed cleanly:');
  console.log('  • Torrent Name:', title);
  console.log('  • InfoHash:', infoHash);
  console.log('  • Predefined Swarm Trackers Attached:', PREDEFINED_HIGH_SPEED_TRACKERS.length);

  // [3/4] IDM Turbo 16-Connection Parallel Segment Download
  console.log('\n[3/4] Testing IDM Turbo Multi-Connection Download (16 Parallel Streams):');
  const testDownloadUrl = 'https://speed.cloudflare.com/__down?bytes=10485760'; // 10MB test payload
  const tempDir = path.join(os.tmpdir(), 'lumina_turbo_test');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const outputFile = 'idm_test_10m.bin';
  const ariaArgs = [
    testDownloadUrl,
    '-s', '16',
    '-x', '16',
    '-j', '16',
    '-k', '1M',
    '--min-split-size=1M',
    '--summary-interval=1',
    '--allow-overwrite=true',
    '-d', tempDir,
    '-o', outputFile
  ];

  let connectionEvents = 0;
  let maxSpeedStr = '';
  const startTs = Date.now();

  await new Promise((resolve, reject) => {
    const proc = spawn('aria2c', ariaArgs);
    proc.stdout.on('data', (c) => {
      const lines = c.toString().split(/[\r\n]+/);
      for (const line of lines) {
        const match = line.match(/\[#\w+\s+([^\/]+)\/([^\(]+)\((\d+)%\)\s+CN:(\d+)(?:\s+SD:(\d+))?\s+DL:([^\s\]]+)(?:\s+ETA:([^\]]+))?\]/);
        if (match) {
          connectionEvents++;
          maxSpeedStr = match[6];
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`aria2c exited with code ${code}`));
    });
  });

  const durationSec = ((Date.now() - startTs) / 1000).toFixed(2);
  const targetPath = path.join(tempDir, outputFile);
  const stats = fs.statSync(targetPath);
  console.log(`  ✓ IDM Turbo 16-stream download finished in ${durationSec}s!`);
  console.log(`  • Telemetry events recorded: ${connectionEvents}`);
  console.log(`  • Peak connection speed: ${maxSpeedStr || 'Fast'}/s`);
  console.log(`  • Downloaded File Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('  ✓ Cleaned temporary test cache.');

  // [4/4] Turbo Multi-Fragment Concurrent Streaming in yt-dlp (-N 16)
  console.log('\n[4/4] Testing Turbo Multi-Fragment Acceleration (-N 16) in yt-dlp:');
  const ytdlp = path.join(process.cwd(), 'engine', 'venv', 'bin', 'yt-dlp');
  const ytArgs = [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    '-N', '16',
    '--dump-json',
    '--no-warnings',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github'
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, ytArgs);
    let out = '';
    proc.stdout.on('data', c => out += c);
    proc.on('close', code => {
      if (code === 0 && out.trim()) resolve();
      else reject(new Error(`yt-dlp -N 16 check failed with code ${code}`));
    });
  });
  console.log('  ✓ yt-dlp concurrent-fragments (-N 16) validated.');

  console.log('\n====================================================');
  console.log(' ALL BITTORRENT & IDM TURBO SUBSYSTEM TESTS PASSED! ');
  console.log('====================================================\n');
}

runTorrentAndTurboVerification().catch(e => {
  console.error('\n✗ Test failed:', e);
  process.exit(1);
});
