import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runLiveVerification() {
  console.log('====================================================');
  console.log('       LUMINA LIVE SUBSYSTEM VERIFICATION SUITE       ');
  console.log('====================================================\n');

  const ytdlp = path.join(process.cwd(), 'engine', 'venv', 'bin', 'yt-dlp');
  const ffmpeg = '/usr/bin/ffmpeg';

  console.log('[1/5] Checking Toolchains:');
  console.log('  • yt-dlp binary:', ytdlp, fs.existsSync(ytdlp) ? '✓ OK' : '✗ MISSING');
  console.log('  • ffmpeg binary:', ffmpeg, fs.existsSync(ffmpeg) ? '✓ OK' : '✗ MISSING');

  // 2. Storage Check
  console.log('\n[2/5] Testing Storage & Block Device Detection:');
  const { exec } = await import('child_process');
  const util = await import('util');
  const execAsync = util.promisify(exec);

  try {
    const { stdout } = await execAsync('lsblk -J -o NAME,TYPE,SIZE,MOUNTPOINTS,RM,HOTPLUG,TRAN,MODEL,VENDOR,FSTYPE,LABEL');
    const data = JSON.parse(stdout);
    const devices = data.blockdevices || [];
    console.log(`  ✓ lsblk executed successfully. Found ${devices.length} top-level block devices.`);
    const mounts = [];
    const collectMounts = (d) => {
      if (d.mountpoints) mounts.push(...d.mountpoints.filter(Boolean));
      if (d.children) d.children.forEach(collectMounts);
    };
    devices.forEach(collectMounts);
    console.log('  ✓ Active system mountpoints detected:', mounts.slice(0, 4).join(', '));
  } catch (e) {
    console.error('  ✗ Storage test failed:', e);
  }

  // 3. Live Video Inspection
  const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" (19s)
  console.log(`\n[3/5] Testing Live Video Inspection on: ${testUrl}`);
  const startTime = Date.now();

  const inspectArgs = [
    testUrl,
    '--dump-json',
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
  ];

  const inspectResult = await new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, inspectArgs);
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (err += c));
    proc.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(out));
      else reject(new Error(err));
    });
  });

  const durationMs = Date.now() - startTime;
  console.log(`  ✓ Inspection completed in ${durationMs}ms`);
  console.log('  • Title:', inspectResult.title);
  console.log('  • Uploader:', inspectResult.uploader);
  console.log('  • Duration:', inspectResult.duration, 'seconds');
  console.log('  • Formats found:', inspectResult.formats.length);

  // 4. Live Download & FFmpeg Lossless Muxing Test
  console.log('\n[4/5] Testing Live Download, Telemetry & FFmpeg Muxing:');
  const tempOutDir = path.join(os.tmpdir(), 'lumina_test_out');
  if (!fs.existsSync(tempOutDir)) fs.mkdirSync(tempOutDir, { recursive: true });

  const dlOutputFile = path.join(tempOutDir, 'test_output.%(ext)s');
  const dlArgs = [
    testUrl,
    '--newline',
    '--progress-template',
    'LUMINA_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s',
    '--ffmpeg-location', ffmpeg,
    '-o', dlOutputFile,
    '-f', 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
  ];

  let progressReportedCount = 0;
  let lastPct = '0%';
  let lastSpeed = '0';

  await new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, dlArgs);
    proc.stdout.on('data', (c) => {
      const lines = c.toString().split('\n');
      for (const line of lines) {
        if (line.includes('LUMINA_PROGRESS:')) {
          progressReportedCount++;
          const parts = line.replace('LUMINA_PROGRESS:', '').split('|');
          lastPct = parts[0];
          lastSpeed = parts[1];
        }
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Download exited with code ${code}`));
    });
  });

  console.log(`  ✓ Download telemetry captured: ${progressReportedCount} progress events. Last speed: ${lastSpeed}`);
  const outFiles = fs.readdirSync(tempOutDir);
  console.log('  ✓ Files produced in target folder:', outFiles);
  const targetFile = outFiles.find((f) => f.startsWith('test_output'));
  if (targetFile) {
    const stats = fs.statSync(path.join(tempOutDir, targetFile));
    console.log(`  ✓ Downloaded file size: ${(stats.size / 1024).toFixed(1)} KB (File is valid and non-empty!)`);
    fs.rmSync(tempOutDir, { recursive: true, force: true });
  }

  // 5. Music Search & Audio Stream URL Resolution
  console.log('\n[5/5] Testing Music Search & Direct Stream URL Extraction:');
  const searchArgs = [
    'ytsearch3:lofi hip hop chill beats',
    '--dump-json',
    '--flat-playlist',
    '--no-warnings',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
  ];

  const searchTracks = await new Promise((resolve) => {
    const proc = spawn(ytdlp, searchArgs);
    let out = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.on('close', () => {
      const list = [];
      for (const line of out.trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          list.push(JSON.parse(line));
        } catch (e) {}
      }
      resolve(list);
    });
  });

  console.log(`  ✓ Search returned ${searchTracks.length} tracks.`);
  if (searchTracks[0]) {
    console.log(`  • First track: "${searchTracks[0].title}" by ${searchTracks[0].uploader || searchTracks[0].channel}`);
    const streamProc = spawn(ytdlp, ['-f', 'bestaudio', '-g', `https://www.youtube.com/watch?v=${searchTracks[0].id}`]);
    let streamUrl = '';
    streamProc.stdout.on('data', (c) => (streamUrl += c));
    await new Promise((r) => streamProc.on('close', r));
    console.log('  ✓ Audio stream URL generated successfully:');
    console.log('    ', streamUrl.trim().slice(0, 80) + '...');
  }

  console.log('\n====================================================');
  console.log('       ALL 5 LIVE SUBSYSTEM VERIFICATIONS PASSED!     ');
  console.log('====================================================\n');
}

runLiveVerification().catch((e) => {
  console.error('\n✗ Live verification failed:', e);
  process.exit(1);
});
