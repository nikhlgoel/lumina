// Renders the TV launcher assets from the real brand SVG (assets/brand/icon.svg).
//
// Why a script and not hand-exported PNGs: the banner and the icon must stay in step with the PC
// app's brand, and a script makes "regenerate after a logo change" one command. Run from the repo
// root so @resvg/resvg-js (a root devDependency) resolves:
//
//     node tv/tools/make-assets.mjs
//
// Output goes to tv/app/src/main/res. The generated PNGs are committed, so building the app does
// not need Node.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const res = join(here, '..', 'app', 'src', 'main', 'res');
const brand = readFileSync(join(here, '..', '..', 'assets', 'brand', 'icon.svg'), 'utf8');

// The icon's own markup, without the outer <svg>, so it can be placed inside a larger composition.
const inner = brand.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const icon = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 1024})">${inner}</g>`;

const BG = '#0B0A10';

// 16:9 banner. The Fire TV launcher shows this in the apps row; without one it falls back to a
// small square icon stretched into a banner slot, which is exactly the "weird mobile logo" problem.
// The NAME is the banner (it is what you read from the sofa); the crystal is a small mark in the corner.
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#262430"/><stop offset="1" stop-color="#16151C"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.52" r="0.6">
      <stop offset="0" stop-color="#F59A4E" stop-opacity="0.20"/><stop offset="1" stop-color="#F59A4E" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFF1D2"/><stop offset="1" stop-color="#FFC66F"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" fill="url(#bg)"/>
  <rect width="960" height="540" fill="url(#glow)"/>
  <g fill="none" stroke="#FFFFFF" stroke-opacity="0.07" stroke-width="2">
    <circle cx="1010" cy="620" r="360"/><circle cx="1010" cy="620" r="440"/><circle cx="1010" cy="620" r="530"/>
    <circle cx="-40" cy="-90" r="300"/><circle cx="-40" cy="-90" r="390"/>
  </g>
  ${icon(46, 40, 120)}
  <text x="480" y="318" text-anchor="middle" font-family="Poppins" font-size="214" font-weight="700" fill="url(#ink)" letter-spacing="-5">Lumina</text>
  <text x="480" y="414" text-anchor="middle" font-family="Poppins" font-size="36" font-weight="500" fill="#C9C5D6" letter-spacing="1">Download. Keep. Play offline.</text>
</svg>`;

// Legacy (pre-Android-8) launcher icon: the crystal on the app's dark ground.
const legacy = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${BG}"/>${icon(56, 40, 400)}
</svg>`;

// Adaptive-icon foreground: 108dp canvas, with the artwork inside the 66% safe zone.
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 432 432">${icon(72, 56, 288)}</svg>`;

function render(svg, width, file, opaque = false) {
  const png = new Resvg(svg, {
    ...(opaque ? { background: BG } : {}),
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: [join(res, 'font', 'poppins_bold.ttf'), join(res, 'font', 'poppins_medium.ttf')], loadSystemFonts: false, defaultFontFamily: 'Poppins' },
  }).render().asPng();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`${file.replace(res, 'res')}  ${width}px  ${png.length} bytes`);
}

// The 320x180 dp banner Android TV asks for, in every bucket from mdpi (the one Downloader, which the Fire
// launcher does show properly, ships) up to xxhdpi for 4K sets. In mipmap-*, not drawable-*, to match it.
// Opaque: the Fire launcher tile is not known to composite transparency, so none is offered.
for (const [bucket, w] of [['mdpi', 320], ['hdpi', 480], ['xhdpi', 640], ['xxhdpi', 960]]) {
  render(banner, w, join(res, `mipmap-${bucket}`, 'banner.png'), true);
}
render(legacy, 96, join(res, 'mipmap-xhdpi', 'ic_launcher.png'));
render(legacy, 144, join(res, 'mipmap-xxhdpi', 'ic_launcher.png'));
render(legacy, 192, join(res, 'mipmap-xxxhdpi', 'ic_launcher.png'));
render(foreground, 432, join(res, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png'));
