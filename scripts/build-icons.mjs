#!/usr/bin/env node
// Renders every Lumina icon from the SVG masters in assets/brand.
// Output: assets/icons (app, .ico, tray, notifications), extension/icons, build/ (installer art).
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const brand = (f) => readFileSync(path.join(ROOT, 'assets', 'brand', f), 'utf8');
const out = (...p) => {
  const file = path.join(ROOT, ...p);
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
};

const FULL = brand('icon.svg');        // detailed crystal for 64 px and up
const SMALL = brand('icon-small.svg'); // simplified, bolder crystal for 16–48 px
const TRAY = brand('tray.svg');        // Windows/Linux tray
const TRAY_ACTIVE = brand('tray-active.svg');
const TEMPLATE = brand('tray-template.svg'); // macOS menu bar (monochrome)

function png(svg, width, height = width) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' });
  const img = r.render();
  if (img.height !== height) throw new Error(`Unexpected height ${img.height} for ${width}`);
  return { png: img.asPng(), rgba: img.pixels, width: img.width, height: img.height };
}

const pick = (size) => (size <= 48 ? SMALL : FULL);

/** ICO containing PNG frames (supported since Windows Vista). */
function ico(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((f, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(f.width >= 256 ? 0 : f.width, e);
    header.writeUInt8(f.height >= 256 ? 0 : f.height, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(f.png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += f.png.length;
  });
  return Buffer.concat([header, ...frames.map((f) => f.png)]);
}

/** 24-bit bottom-up BMP (what NSIS expects for installer artwork). */
function bmp({ rgba, width, height }, background = [18, 14, 11]) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const data = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const a = rgba[s + 3] / 255;
      const d = (height - 1 - y) * rowSize + x * 3;
      data[d] = Math.round(rgba[s + 2] * a + background[2] * (1 - a));
      data[d + 1] = Math.round(rgba[s + 1] * a + background[1] * (1 - a));
      data[d + 2] = Math.round(rgba[s] * a + background[0] * (1 - a));
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + data.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(data.length, 34);
  return Buffer.concat([header, data]);
}

// App icons
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  writeFileSync(out('assets', 'icons', `icon_${size}.png`), png(pick(size), size).png);
}
writeFileSync(out('assets', 'icons', 'icon.png'), png(FULL, 512).png);
writeFileSync(out('assets', 'icon.png'), png(FULL, 512).png);
writeFileSync(out('assets', 'icons', 'icon.ico'), ico([16, 20, 24, 32, 40, 48, 64, 256].map((s) => png(pick(s), s))));

// Linux expects sized PNGs named by size in the icon directory
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  writeFileSync(out('build', 'icons', `${size}x${size}.png`), png(pick(size), size).png);
}

// Tray: base + @2x for high-DPI; an "active" variant with a progress dot
writeFileSync(out('assets', 'icons', 'tray.png'), png(TRAY, 16).png);
writeFileSync(out('assets', 'icons', 'tray@2x.png'), png(TRAY, 32).png);
writeFileSync(out('assets', 'icons', 'tray-active.png'), png(TRAY_ACTIVE, 16).png);
writeFileSync(out('assets', 'icons', 'tray-active@2x.png'), png(TRAY_ACTIVE, 32).png);
writeFileSync(out('assets', 'icons', 'trayTemplate.png'), png(TEMPLATE, 16).png);
writeFileSync(out('assets', 'icons', 'trayTemplate@2x.png'), png(TEMPLATE, 32).png);

// Browser extension
for (const size of [16, 32, 48, 128]) {
  writeFileSync(out('extension', 'icons', `icon-${size}.png`), png(pick(size), size).png);
}

// Installer artwork
const sidebar = brand('installer-sidebar.svg').replace('<!--ICON-->', `<image x="27" y="58" width="110" height="110" href="data:image/svg+xml;base64,${Buffer.from(FULL).toString('base64')}"/>`);
writeFileSync(out('build', 'installerSidebar.bmp'), bmp(png(sidebar, 164, 314)));
writeFileSync(out('build', 'installerHeader.bmp'), bmp(png(brand('installer-header.svg'), 150, 57), [250, 248, 244]));

console.log('Icons rendered.');
