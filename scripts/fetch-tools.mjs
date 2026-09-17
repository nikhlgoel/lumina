#!/usr/bin/env node
// Downloads the external tools Lumina bundles into resources/bin/<platform>-<arch>.
// Usage: node scripts/fetch-tools.mjs [--platform win32|linux|darwin] [--arch x64|arm64] [--force]
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile, copyFile, chmod, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const platform = argValue('platform', process.platform);
const arch = argValue('arch', process.arch);
const force = args.includes('--force');

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'resources', 'bin', `${platform}-${arch}`);
const CACHE = path.join(ROOT, '.tools-cache');

const YTDLP_VERSION = '2026.08.19';
const FFMPEG_TAG = 'latest';
const ARIA2_VERSION = '1.37.0';
const WHISPER_TAG = 'b5130';
const SEVENZIP_TAG = '26.03';

const gh = (repo, tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`;

/** Each tool: files to download, optional checksum source, and how to install into OUT. */
const TOOLS = {
  'win32-x64': [
    {
      name: 'yt-dlp', version: YTDLP_VERSION,
      url: gh('yt-dlp/yt-dlp', YTDLP_VERSION, 'yt-dlp.exe'),
      sums: gh('yt-dlp/yt-dlp', YTDLP_VERSION, 'SHA2-256SUMS'),
      install: async (file) => copyFile(file, path.join(OUT, 'yt-dlp.exe')),
    },
    {
      name: 'ffmpeg', version: '9.0',
      url: gh('BtbN/FFmpeg-Builds', FFMPEG_TAG, 'ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip'),
      sums: gh('BtbN/FFmpeg-Builds', FFMPEG_TAG, 'checksums.sha256'),
      install: async (file) => extractFlat(file, 'bin', ['ffmpeg.exe', 'ffprobe.exe', /\.dll$/i]),
    },
    {
      name: 'aria2', version: ARIA2_VERSION,
      url: gh('aria2/aria2', `release-${ARIA2_VERSION}`, `aria2-${ARIA2_VERSION}-win-64bit-build1.zip`),
      install: async (file) => extractFlat(file, null, ['aria2c.exe']),
    },
    {
      name: 'whisper.cpp', version: WHISPER_TAG,
      url: gh('ggml-org/whisper.cpp', WHISPER_TAG, 'whisper-bin-x64.zip'),
      install: async (file) => extractFlat(file, null, ['whisper-cli.exe', /\.dll$/i]),
    },
    {
      // 7zr.exe only reads .7z, so it's used once here to unpack the full 7-Zip (7z.exe + 7z.dll, with RAR support).
      name: '7zr', version: SEVENZIP_TAG,
      url: gh('ip7z/7zip', SEVENZIP_TAG, '7zr.exe'),
      sha256: 'ad4c82fadcbdf93c03b4fc440f300509c7d60c5c2f4d183e35d9d70d6957037d',
      install: async () => undefined,
    },
    {
      name: '7-zip', version: SEVENZIP_TAG,
      url: gh('ip7z/7zip', SEVENZIP_TAG, `7z${SEVENZIP_TAG.replace('.', '')}-x64.exe`),
      sha256: '0859c524b8a63551848f0c246abddcb1d0b7b656b0fbfe879f8d85e61a9e6edd',
      install: async (file) => {
        const tmp = path.join(CACHE, 'x-7zip');
        await rm(tmp, { recursive: true, force: true });
        const r = spawnSync(path.join(CACHE, '7zr.exe'), ['x', file, `-o${tmp}`, '7z.exe', '7z.dll', 'License.txt', '-y'], { stdio: 'ignore' });
        if (r.status !== 0) throw new Error('Could not unpack the 7-Zip installer');
        for (const name of ['7z.exe', '7z.dll']) await copyFile(path.join(tmp, name), path.join(OUT, name));
        await copyFile(path.join(tmp, 'License.txt'), path.join(OUT, '7-Zip-License.txt'));
        await rm(tmp, { recursive: true, force: true });
      },
    },
  ],
  'linux-x64': [
    {
      name: 'yt-dlp', version: YTDLP_VERSION,
      url: gh('yt-dlp/yt-dlp', YTDLP_VERSION, 'yt-dlp_linux'),
      sums: gh('yt-dlp/yt-dlp', YTDLP_VERSION, 'SHA2-256SUMS'),
      install: async (file) => { const dest = path.join(OUT, 'yt-dlp'); await copyFile(file, dest); await chmod(dest, 0o755); },
    },
    {
      name: 'ffmpeg', version: '9.0',
      url: gh('BtbN/FFmpeg-Builds', FFMPEG_TAG, 'ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz'),
      sums: gh('BtbN/FFmpeg-Builds', FFMPEG_TAG, 'checksums.sha256'),
      install: async (file) => extractFlat(file, 'bin', ['ffmpeg', 'ffprobe']),
    },
    {
      name: 'whisper.cpp', version: WHISPER_TAG,
      url: gh('ggml-org/whisper.cpp', WHISPER_TAG, 'whisper-bin-ubuntu-x64.tar.gz'),
      install: async (file) => extractFlat(file, null, ['whisper-cli', /\.so(\.\d+)*$/]),
    },
    // aria2c on Linux: no official static build; the app falls back to the system aria2c.
    {
      name: '7-zip', version: SEVENZIP_TAG,
      url: gh('ip7z/7zip', SEVENZIP_TAG, `7z${SEVENZIP_TAG.replace('.', '')}-linux-x64.tar.xz`),
      sha256: 'dc99eff5008f1ab79bd7084c68513701547a808a89502bf4133683535ab3c695',
      install: async (file) => extractFlat(file, null, ['7zz']),
    },
  ],
};

const MODEL = {
  name: 'whisper-model-base', version: 'ggml-base',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  minBytes: 140_000_000,
};

async function download(url, dest) {
  if (existsSync(dest) && !force) return dest;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, dest);
  return dest;
}

async function sha256(file) {
  const hash = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function verify(file, sumsUrl) {
  const sumsFile = path.join(CACHE, `${new URL(sumsUrl).pathname.split('/').slice(-3).join('_')}`);
  await download(sumsUrl, sumsFile);
  const base = path.basename(file);
  const line = (await readFile(sumsFile, 'utf8')).split(/\r?\n/).find((l) => l.trim().endsWith(base));
  if (!line) throw new Error(`No checksum listed for ${base}`);
  const expected = line.trim().split(/\s+/)[0].toLowerCase();
  const actual = await sha256(file);
  if (expected !== actual) throw new Error(`Checksum mismatch for ${base}: expected ${expected}, got ${actual}`);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** Extract an archive and copy matching files (from an optional subfolder) flat into OUT. */
async function extractFlat(archive, subdir, patterns) {
  const tmp = path.join(CACHE, `x-${path.basename(archive)}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  // On Windows use the built-in bsdtar (handles zip and drive letters); GNU tar from Git Bash does not.
  const tarBin = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const r = spawnSync(tarBin, ['-xf', archive, '-C', tmp], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`Could not extract ${archive}`);
  const files = await walk(tmp);
  let copied = 0;
  for (const f of files) {
    if (subdir && path.basename(path.dirname(f)) !== subdir) continue;
    const name = path.basename(f);
    if (!patterns.some((p) => (typeof p === 'string' ? p === name : p.test(name)))) continue;
    const dest = path.join(OUT, name);
    await copyFile(f, dest);
    if (platform !== 'win32') await chmod(dest, 0o755);
    copied++;
  }
  await rm(tmp, { recursive: true, force: true });
  if (copied === 0) throw new Error(`No matching files found in ${path.basename(archive)}`);
}

async function main() {
  const key = `${platform}-${arch}`;
  const tools = TOOLS[key];
  if (!tools) {
    console.error(`No bundled tool set defined for ${key}. The app will use tools found on PATH.`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  await mkdir(CACHE, { recursive: true });
  const manifest = { platform, arch, fetchedAt: new Date().toISOString(), tools: {} };

  for (const tool of tools) {
    const file = path.join(CACHE, path.basename(new URL(tool.url).pathname));
    process.stdout.write(`• ${tool.name} ${tool.version} … `);
    await download(tool.url, file);
    if (tool.sums) await verify(file, tool.sums);
    if (tool.sha256) {
      const actual = await sha256(file);
      if (actual !== tool.sha256) throw new Error(`Checksum mismatch for ${path.basename(file)}: expected ${tool.sha256}, got ${actual}`);
    }
    await tool.install(file);
    manifest.tools[tool.name] = tool.version;
    console.log(tool.sums || tool.sha256 ? 'ok (sha256 verified)' : 'ok');
  }

  const modelDir = path.join(ROOT, 'resources', 'models');
  await mkdir(modelDir, { recursive: true });
  const modelFile = path.join(modelDir, 'ggml-base.bin');
  process.stdout.write('• whisper model base … ');
  await download(MODEL.url, modelFile);
  if ((await stat(modelFile)).size < MODEL.minBytes) throw new Error('Whisper model download looks truncated');
  manifest.tools[MODEL.name] = MODEL.version;
  console.log('ok');

  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nTools ready in ${path.relative(ROOT, OUT)} (${os.EOL === '\r\n' ? 'Windows' : 'POSIX'} layout).`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
