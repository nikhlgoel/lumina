#!/usr/bin/env node
// Writes the winget manifest for one release of Lumina: three small files in packaging/winget/<version>/, ready for `winget validate`,
// for a local test install, and for a pull request to microsoft/winget-pkgs.
//
//   node scripts/winget-manifest.mjs                 the version in package.json
//   node scripts/winget-manifest.mjs 1.2.1           a given version
//   node scripts/winget-manifest.mjs 1.2.1 --sha <64 hex>   skip the download of SHA256SUMS.txt (for a release that is not public yet)
//
// It points at the *Standard* installer of the GitHub release with that tag (tags have no "v"), and takes the checksum from the release's own
// SHA256SUMS.txt, so the manifest can only describe a file that is really published.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shaFlag = args.indexOf('--sha');
const given = shaFlag >= 0 ? args[shaFlag + 1] : null;
const version = args.find((a, i) => !a.startsWith('--') && i !== shaFlag + 1) ?? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const REPO = 'nikhlgoel/lumina';
const ID = 'nikhlgoel.Lumina';
/** How Lumina's installer registers itself in Windows' "Installed apps" (read from an installed copy): the same key for every version. */
const PRODUCT_CODE = '81d10068-56fa-5099-8ac4-8565ebdb0da4';
const SCHEMA = '1.6.0';
const installerName = `Lumina-${version}-Standard-Setup.exe`;
const base = `https://github.com/${REPO}/releases/download/${version}`;

function fail(message) {
  console.error(`winget-manifest: ${message}`);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" is not a plain version such as 1.2.1 (a release candidate is not sent to winget).`);

async function checksum() {
  if (given) {
    if (!/^[0-9a-fA-F]{64}$/.test(given)) fail('--sha must be 64 hex characters');
    return given.toUpperCase();
  }
  const res = await fetch(`${base}/SHA256SUMS.txt`, { redirect: 'follow' });
  if (!res.ok) fail(`could not read ${base}/SHA256SUMS.txt (${res.status}). Is release ${version} published, with that file?`);
  const line = (await res.text()).split(/\r?\n/).find((l) => l.trim().endsWith(installerName));
  const hash = line?.trim().split(/\s+/)[0];
  if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) fail(`${installerName} is not listed in SHA256SUMS.txt`);
  return hash.toUpperCase();
}

async function releaseDate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${version}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const at = (await res.json()).published_at;
    return typeof at === 'string' ? at.slice(0, 10) : null;
  } catch {
    return null;
  }
}

const sha = await checksum();
const date = await releaseDate();
const out = path.join(root, 'packaging', 'winget', version);
fs.mkdirSync(out, { recursive: true });
const head = `PackageIdentifier: ${ID}\nPackageVersion: ${version}\n`;
const write = (name, text) => fs.writeFileSync(path.join(out, `${ID}${name}.yaml`), text.replace(/\r?\n/g, '\n'));

write('', `${head}DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${SCHEMA}
`);

write('.installer', `${head}InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
- silentWithProgress
UpgradeBehavior: install
Installers:
- Architecture: x64
  InstallerUrl: ${base}/${installerName}
  InstallerSha256: ${sha}
  ProductCode: '${PRODUCT_CODE}'
  AppsAndFeaturesEntries:
  - DisplayName: Lumina ${version}
    Publisher: nikhlgoel
    DisplayVersion: ${version}
    ProductCode: '${PRODUCT_CODE}'
${date ? `ReleaseDate: ${date}\n` : ''}ManifestType: installer
ManifestVersion: ${SCHEMA}
`);

write('.locale.en-US', `${head}PackageLocale: en-US
Publisher: nikhlgoel
PublisherUrl: https://github.com/nikhlgoel
PublisherSupportUrl: https://github.com/${REPO}/issues
Author: nikhlgoel
PackageName: Lumina
PackageUrl: https://github.com/${REPO}
License: MIT
LicenseUrl: https://github.com/${REPO}/blob/main/LICENSE
Copyright: Copyright (c) 2026 Lumina
ShortDescription: Download music, video and files from links, torrents and many sites, and play them, in one app.
Description: Lumina is a free, open-source downloader and media player. It downloads from direct links, torrents, file hosts and many video and music sites, checks each file as it finishes, unpacks release archives, and plays what you have, with a browser extension that sends links from the page you are on.
Tags:
- downloader
- media-player
- music
- video
- torrent
- yt-dlp
- aria2
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/${version}
ManifestType: defaultLocale
ManifestVersion: ${SCHEMA}
`);

console.log(`Wrote ${out}`);
console.log(`  installer: ${base}/${installerName}`);
console.log(`  sha256:    ${sha}`);
console.log(`Next: winget validate --manifest "${out}"`);
