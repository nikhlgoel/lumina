#!/usr/bin/env node
// Packages the browser extension: release/extension/lumina-chromium.zip and lumina-firefox.zip.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'release', 'extension');
const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version.replace(/-.*$/, '');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

function build(target, transform) {
  const dir = path.join(OUT, target);
  cpSync(SRC, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  manifest.version = version;
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(transform(manifest), null, 2));
  const zip = path.join(OUT, `lumina-${target}.zip`);
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(tar, ['-a', '-c', '-f', zip, '-C', dir, '.'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`zip failed for ${target}`);
  console.log(`• ${path.relative(ROOT, zip)}`);
}

build('chromium', (m) => m);
build('firefox', (m) => ({
  ...m,
  background: { scripts: ['background.js'], type: 'module' },
  browser_specific_settings: { gecko: { id: 'downloader@lumina.app', strict_min_version: '121.0' } },
  minimum_chrome_version: undefined,
}));
