import assert from 'assert';

// Realistic messy snippet copied from a FitGirl Repack page
const SAMPLE_MESSY_PAGE = `
<html>
<head>
  <link rel="stylesheet" href="https://fitgirl-repacks.site/wp-content/themes/repack/style.css?ver=6.1" />
  <script src="https://fitgirl-repacks.site/wp-content/plugins/jetpack/jetpack.js"></script>
  <script src="https://www.google-analytics.com/analytics.js"></script>
  <script src="https://c.disquscdn.com/next/embed/alfie.js"></script>
</head>
<body>
  <a href="https://fitgirl-repacks.site/donate/">Donate via PayPal or BTC</a>
  <a href="https://fitgirl-repacks.site/all-my-repacks-a-z/">All Repacks A-Z</a>
  <img src="https://i.imgur.com/screenshot1.jpg" />
  <img src="https://fitgirl-repacks.site/favicon.ico" />

  <h2>Cyberpunk 2077 (v2.12 + All DLCs) [FitGirl Repack]</h2>
  <p>Download Mirrors:</p>

  <!-- Mirror 1: Pixeldrain -->
  <a href="https://pixeldrain.com/u/abc101_Cyberpunk_2077.part01.rar">Pixeldrain Part 1</a>
  <a href="https://pixeldrain.com/u/abc102_Cyberpunk_2077.part02.rar">Pixeldrain Part 2</a>
  <a href="https://pixeldrain.com/u/abc103_Cyberpunk_2077.part03.rar">Pixeldrain Part 3</a>
  <a href="https://pixeldrain.com/u/abc104_Cyberpunk_2077.part04.rar">Pixeldrain Part 4</a>
  <a href="https://pixeldrain.com/u/abc105_Cyberpunk_2077.part05.rar">Pixeldrain Part 5</a>

  <!-- Mirror 2: 1Fichier with Missing Part 4 -->
  <a href="https://1fichier.com/?def201_Cyberpunk_2077.part01.rar">1Fichier Part 1</a>
  <a href="https://1fichier.com/?def202_Cyberpunk_2077.part02.rar">1Fichier Part 2</a>
  <a href="https://1fichier.com/?def203_Cyberpunk_2077.part03.rar">1Fichier Part 3</a>
  <a href="https://1fichier.com/?def205_Cyberpunk_2077.part05.rar">1Fichier Part 5</a>

  <!-- Selective DLC & Setup -->
  <a href="https://pixeldrain.com/u/dlc001_fg-selective-english.bin">Selective English Audio</a>
  <a href="https://pixeldrain.com/u/dlc002_fg-optional-soundtrack.bin">Optional Bonus Soundtrack</a>
  <a href="https://pixeldrain.com/u/exe001_setup.exe">Setup Installer Executable</a>
</body>
</html>
`;

// Direct mock test of crawler logic
const JUNK_DOMAIN_BLOCKLIST = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'disqus.com',
  'disquscdn.com', 'gravatar.com', 'wp.com', 's.w.org', 'cloudflare.com', 'patreon.com',
  'paypal.com', 'buymeacoffee.com', 'donationalerts.com', 'discord.gg', 'reddit.com',
  'imgur.com', 'postimg.cc', 'imagebam.com'
];
const JUNK_EXTENSION_REGEX = /\.(js|jsx|ts|tsx|mjs|css|scss|less|png|jpg|jpeg|gif|svg|webp|ico|bmp|tiff|woff|woff2|ttf|eot|otf|map|vue|json|xml|rss)(\?.*)?$/i;
const JUNK_PATH_REGEX = /\/(category|tag|author|page|comments|feed|wp-json|wp-content\/plugins|wp-includes|donate|faq|contacts|all-my-repacks|how-to-install)\/?$/i;
const VALID_PAYLOAD_EXTENSIONS = /\.(rar|7z|zip|bin|iso|tar|gz|exe|001|002|003|004|005|mp4|mkv|mp3|flac|wav|m4a)(\?.*)?$/i;
const KNOWN_FILE_HOSTERS = ['pixeldrain.com', '1fichier.com', 'mediafire.com', 'drive.google.com'];

function extractValidCandidateUrls(text) {
  const urlRegex = /(https?:\/\/[^\s"'<>()]+|magnet:\?[^\s"'<>]+)/gi;
  const matches = text.match(urlRegex) || [];
  const cleanCandidates = [];

  for (const raw of matches) {
    const clean = raw.replace(/[.,;:)\]>]+$/, '').trim();
    if (!clean) continue;
    if (clean.startsWith('magnet:?')) {
      if (!cleanCandidates.includes(clean)) cleanCandidates.push(clean);
      continue;
    }
    if (JUNK_EXTENSION_REGEX.test(clean)) continue;
    if (JUNK_DOMAIN_BLOCKLIST.some(d => clean.toLowerCase().includes(d))) continue;
    try {
      const parsed = new URL(clean);
      if (JUNK_PATH_REGEX.test(parsed.pathname)) continue;
    } catch {
      continue;
    }
    const isHoster = KNOWN_FILE_HOSTERS.some(h => clean.toLowerCase().includes(h));
    const isPayload = VALID_PAYLOAD_EXTENSIONS.test(clean);
    if (isHoster || isPayload) {
      if (!cleanCandidates.includes(clean)) cleanCandidates.push(clean);
    }
  }
  return cleanCandidates;
}

console.log('--- Testing Junk Filtering ---');
const candidates = extractValidCandidateUrls(SAMPLE_MESSY_PAGE);
console.log(`Extracted candidates count: ${candidates.length}`);

// Verify 0 junk URLs were accepted
const hasCss = candidates.some(u => u.includes('.css'));
const hasJs = candidates.some(u => u.includes('.js'));
const hasJpg = candidates.some(u => u.includes('.jpg'));
const hasIco = candidates.some(u => u.includes('.ico'));
const hasAnalytics = candidates.some(u => u.includes('google-analytics'));
const hasDisqus = candidates.some(u => u.includes('disqus'));
const hasDonate = candidates.some(u => u.includes('donate'));

assert.strictEqual(hasCss, false, 'CSS stylesheets must be filtered out');
assert.strictEqual(hasJs, false, 'JS scripts must be filtered out');
assert.strictEqual(hasJpg, false, 'Image screenshots must be filtered out');
assert.strictEqual(hasIco, false, 'Favicon must be filtered out');
assert.strictEqual(hasAnalytics, false, 'Analytics tracking must be filtered out');
assert.strictEqual(hasDisqus, false, 'Disqus comments must be filtered out');
assert.strictEqual(hasDonate, false, 'Donation links must be filtered out');

console.log('✓ ALL junk web assets, ads, tracking, and donation URLs successfully filtered out (0 junk accepted).');

// Verify genuine downloads were extracted
const pixeldrainParts = candidates.filter(u => u.includes('pixeldrain.com/u/abc10'));
assert.strictEqual(pixeldrainParts.length, 5, 'Must extract all 5 Pixeldrain parts');

const fichierParts = candidates.filter(u => u.includes('1fichier.com/?def20'));
assert.strictEqual(fichierParts.length, 4, 'Must extract all 4 1Fichier parts');

const selectiveDlc = candidates.filter(u => u.includes('fg-selective') || u.includes('fg-optional'));
assert.strictEqual(selectiveDlc.length, 2, 'Must extract both selective DLC files');

const setupExe = candidates.filter(u => u.includes('setup.exe'));
assert.strictEqual(setupExe.length, 1, 'Must extract setup.exe');

console.log('✓ ALL authentic repack files correctly identified: 5 Pixeldrain parts, 4 1Fichier parts, 2 Selective DLCs, 1 Setup executable.');
console.log('--- TEST PASSED WITH 100% ACCURACY ---');
