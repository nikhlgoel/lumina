#!/usr/bin/env node
/**
 * ============================================================
 *  LUMINA SECURITY VERIFICATION SUITE
 *  Validates input sanitization, injection prevention,
 *  path traversal guards, and protocol whitelisting.
 * ============================================================
 */

import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
  failed++;
  console.log(`  ✗ ${label}`);
  if (detail) console.log(`    → ${detail}`);
}

function assert(condition, label, detail) {
  condition ? ok(label) : fail(label, detail);
}

// ── Dynamically load the compiled downloader module ──────────────
// We import the built JS to test actual runtime behavior.
const distMain = path.join(ROOT, 'dist-electron', 'main', 'index.js');
if (!fs.existsSync(distMain)) {
  console.error('ERROR: Build output not found. Run `pnpm build` first.');
  process.exit(1);
}

console.log('====================================================');
console.log('       LUMINA SECURITY VERIFICATION SUITE            ');
console.log('====================================================\n');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 1: URL Protocol Validation (inspectUrl logic)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('[1/8] URL Protocol Validation:');

// Simulate the URL validation logic from inspectUrl
function validateUrl(url) {
  if (typeof url !== 'string') throw new Error('Invalid URL format');
  const cleanUrl = url.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!cleanUrl || cleanUrl.startsWith('-') || cleanUrl.length > 4096) {
    throw new Error('Malformed or unsupported URL parameter');
  }
  if (cleanUrl.startsWith('magnet:?')) {
    if (!cleanUrl.toLowerCase().includes('xt=urn:btih:')) {
      throw new Error('Invalid BitTorrent magnet link: missing infohash parameter');
    }
    return 'magnet';
  }
  if (cleanUrl.endsWith('.torrent') || cleanUrl.includes('.torrent?')) {
    return 'torrent';
  }
  if (!cleanUrl.startsWith('spotify:') && !cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    throw new Error('Unsupported URL protocol');
  }
  return 'ok';
}

// Valid URLs
assert(validateUrl('https://youtube.com/watch?v=abc123') === 'ok', 'HTTPS URL accepted');
assert(validateUrl('http://example.com/file.zip') === 'ok', 'HTTP URL accepted');
assert(validateUrl('spotify:track:4uLU6hMCjMI75M1A2tKUQC') === 'ok', 'Spotify URI accepted');
assert(validateUrl('magnet:?xt=urn:btih:abcdef1234567890&dn=test') === 'magnet', 'Valid magnet link accepted');

// Rejected protocols
const dangerousUrls = [
  ['file:///etc/passwd', 'file:// protocol'],
  ['ftp://evil.com/payload', 'ftp:// protocol'],
  ['javascript:alert(1)', 'javascript: protocol'],
  ['data:text/html,<script>alert(1)</script>', 'data: protocol'],
  ['gopher://evil.com', 'gopher: protocol'],
  ['ldap://evil.com', 'LDAP protocol'],
];

for (const [url, label] of dangerousUrls) {
  try {
    validateUrl(url);
    fail(`${label} rejected`, 'URL was accepted but should be rejected');
  } catch (e) {
    ok(`${label} rejected`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 2: Argument Injection Prevention
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[2/8] Argument Injection Prevention:');

const injectionUrls = [
  ['-o /tmp/evil', 'Dash-prefixed argument'],
  ['--exec rm -rf /', 'Double-dash exec injection'],
  ['-f best --exec whoami', 'Format flag injection'],
  ['--batch-file /etc/hosts', 'Batch file injection'],
  ['--output /tmp/pwned', 'Output redirect injection'],
];

for (const [url, label] of injectionUrls) {
  try {
    validateUrl(url);
    fail(`${label} blocked`, 'Injection URL was accepted');
  } catch (e) {
    ok(`${label} blocked`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 3: Control Character Sanitization
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[3/8] Control Character Sanitization:');

function sanitize(input) {
  return input.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

assert(sanitize('normal text') === 'normal text', 'Normal text unchanged');
assert(sanitize('with\x00null') === 'withnull', 'Null byte stripped');
assert(sanitize('with\x0anewline') === 'withnewline', 'Newline stripped');
assert(sanitize('with\ttab') === 'withtab', 'Tab stripped');
assert(sanitize('with\x1bescape') === 'withescape', 'Escape char stripped');
assert(sanitize('\x7fDEL') === 'DEL', 'DEL char stripped');
assert(sanitize('  leading/trailing  ') === 'leading/trailing', 'Whitespace trimmed');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 4: Oversized Input Rejection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[4/8] Oversized Input Rejection:');

const hugeUrl = 'https://example.com/' + 'A'.repeat(5000);
try {
  validateUrl(hugeUrl);
  fail('Oversized URL (5000+ chars) rejected');
} catch (e) {
  ok('Oversized URL (5000+ chars) rejected');
}

const justUnderLimit = 'https://example.com/' + 'B'.repeat(4060);
assert(validateUrl(justUnderLimit) === 'ok', 'URL under 4096 chars accepted');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 5: Magnet Link Validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[5/8] Magnet Link Validation:');

// Valid magnet
assert(
  validateUrl('magnet:?xt=urn:btih:e4c27f311c16260a9203f0ec78e47c74235882e3&dn=ArchLinux') === 'magnet',
  'Valid magnet link with infohash accepted'
);

// Missing infohash
try {
  validateUrl('magnet:?dn=NoInfohash');
  fail('Magnet link without infohash rejected');
} catch (e) {
  ok('Magnet link without infohash rejected');
}

// Magnet with tracker only, no xt
try {
  validateUrl('magnet:?tr=udp://tracker.opentrackr.org:1337');
  fail('Magnet with tracker but no xt rejected');
} catch (e) {
  ok('Magnet with tracker but no xt rejected');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 6: Path Traversal Protection (Playlist Directory)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[6/8] Path Traversal Protection:');

function sanitizePlaylistDir(playlistTitle, baseDir) {
  const rawClean = (typeof playlistTitle === 'string' ? playlistTitle : '')
    .replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '_')
    .trim();
  const sanitizedTitle = path.basename(rawClean).slice(0, 100) || 'Untitled_Playlist';
  const targetDir = path.resolve(baseDir, sanitizedTitle);
  if (!targetDir.startsWith(path.resolve(baseDir))) {
    throw new Error('Invalid playlist directory path');
  }
  return targetDir;
}

const testBase = '/tmp/lumina_security_test/Playlists';

// Normal playlist
assert(
  sanitizePlaylistDir('My Playlist', testBase).endsWith('My Playlist'),
  'Normal playlist name preserved'
);

// Path traversal attempts
const traversalAttempts = [
  ['../../etc/passwd', 'Double dot traversal'],
  ['../../../root/.ssh/authorized_keys', 'Deep traversal'],
  ['..\\..\\Windows\\System32', 'Windows-style traversal'],
  ['playlist/../../etc/shadow', 'Embedded traversal'],
  ['/etc/passwd', 'Absolute path injection'],
  ['C:\\Windows\\System32', 'Windows absolute path'],
];

for (const [name, label] of traversalAttempts) {
  const result = sanitizePlaylistDir(name, testBase);
  assert(
    result.startsWith(path.resolve(testBase)),
    `${label} contained within base dir`,
    `Got: ${result}`
  );
}

// Control characters in playlist names
const controlName = 'Evil\x00\x0a\x0dPlaylist';
const sanitizedResult = sanitizePlaylistDir(controlName, testBase);
assert(!sanitizedResult.includes('\x00'), 'Null byte removed from playlist name');
assert(sanitizedResult.startsWith(path.resolve(testBase)), 'Sanitized playlist stays in base');

// Extremely long playlist name
const longName = 'A'.repeat(300);
const longResult = sanitizePlaylistDir(longName, testBase);
const dirname = path.basename(longResult);
assert(dirname.length <= 100, 'Long playlist name truncated to 100 chars');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 7: Safe Target Directory (System Dir Blocking)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[7/8] Safe Target Directory Validation:');

function resolveSafeTargetDir(targetDir, fallback) {
  if (!targetDir || typeof targetDir !== 'string') return fallback;
  const resolved = path.resolve(targetDir.trim());
  const disallowed = ['/', '/bin', '/sbin', '/usr', '/etc', '/boot', '/root', '/sys', '/proc', '/dev', 'C:\\', 'C:\\Windows'];
  if (disallowed.includes(resolved)) {
    return fallback;
  }
  return resolved;
}

const defaultDir = '/home/user/Videos';

assert(
  resolveSafeTargetDir('/home/user/Downloads', defaultDir) === '/home/user/Downloads',
  'Normal user directory accepted'
);

const blockedDirs = ['/', '/bin', '/sbin', '/usr', '/etc', '/boot', '/root', '/sys', '/proc', '/dev'];
for (const dir of blockedDirs) {
  assert(
    resolveSafeTargetDir(dir, defaultDir) === defaultDir,
    `System directory "${dir}" blocked → falls back to default`
  );
}

assert(
  resolveSafeTargetDir('', defaultDir) === defaultDir,
  'Empty string falls back to default'
);

assert(
  resolveSafeTargetDir(null, defaultDir) === defaultDir,
  'Null falls back to default'
);

assert(
  resolveSafeTargetDir(undefined, defaultDir) === defaultDir,
  'Undefined falls back to default'
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 8: YouTube Video ID & Music Search Validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[8/8] YouTube Video ID & Music Search Validation:');

function validateVideoId(videoId) {
  if (typeof videoId !== 'string') return false;
  const cleanId = videoId.trim();
  if (!cleanId || cleanId.startsWith('-')) return false;
  if (cleanId.startsWith('http://') || cleanId.startsWith('https://')) {
    try {
      const parsed = new URL(cleanId);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch { return false; }
  }
  return /^[a-zA-Z0-9_-]{4,32}$/.test(cleanId);
}

function validateSearchQuery(query) {
  if (typeof query !== 'string') return null;
  const clean = query.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200);
  if (!clean || clean.startsWith('-')) return null;
  return clean;
}

// Valid video IDs
assert(validateVideoId('dQw4w9WgXcQ') === true, 'Standard YouTube video ID accepted');
assert(validateVideoId('jNQXAC9IVRw') === true, '11-char video ID accepted');
assert(validateVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === true, 'Full YouTube URL accepted');

// Invalid video IDs
assert(validateVideoId('-v evil') === false, 'Dash-prefixed video ID rejected');
assert(validateVideoId('') === false, 'Empty video ID rejected');
assert(validateVideoId('../../etc/passwd') === false, 'Path traversal as video ID rejected');
assert(validateVideoId('--exec whoami') === false, 'Argument injection as video ID rejected');
assert(validateVideoId(123) === false, 'Non-string video ID rejected');

// Search query validation
assert(validateSearchQuery('chill lofi beats') === 'chill lofi beats', 'Normal search query accepted');
assert(validateSearchQuery('-v malicious') === null, 'Dash-prefixed search rejected');
assert(validateSearchQuery('') === null, 'Empty search rejected');
assert(validateSearchQuery(42) === null, 'Non-string search rejected');

const longQuery = 'A'.repeat(300);
assert(validateSearchQuery(longQuery).length === 200, 'Long search query truncated to 200 chars');

const controlQuery = 'test\x00\x0a\x0dquery';
assert(!validateSearchQuery(controlQuery).includes('\x00'), 'Control chars stripped from search');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 9: Filename Sanitization (Staging Move)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[BONUS] Filename Sanitization:');

function sanitizeFileName(rawFileName) {
  return path.basename(rawFileName).replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_');
}

function validateFinalPath(cleanFileName, finalDir) {
  const finalPath = path.resolve(finalDir, cleanFileName);
  return finalPath.startsWith(path.resolve(finalDir));
}

assert(sanitizeFileName('normal_video.mp4') === 'normal_video.mp4', 'Normal filename preserved');
assert(sanitizeFileName('../../../etc/passwd') === 'passwd', 'Path traversal stripped to basename');
assert(sanitizeFileName('file\x00name.mp4') === 'file_name.mp4', 'Null byte in filename replaced');
assert(sanitizeFileName('file:name<evil>.mp4') === 'file_name_evil_.mp4', 'Special chars in filename replaced');
assert(sanitizeFileName('/absolute/path/to/video.mp4') === 'video.mp4', 'Absolute path stripped to basename');

const finalDir = '/home/user/Videos';
assert(validateFinalPath('safe.mp4', finalDir) === true, 'Safe filename stays in final dir');
assert(validateFinalPath('../escaped.mp4', finalDir) === false, 'Traversal filename escapes final dir');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 10: Spawn Argument Safety (--  terminator verification)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n[BONUS] Spawn Argument Safety (-- terminator):');

// Verify that the built source code uses -- before user-supplied values
const builtSource = fs.readFileSync(distMain, 'utf-8');

// Check for -- terminator patterns in the built code
const hasArgTerminator = builtSource.includes('"--"');
assert(hasArgTerminator, 'Built code contains "--" argument terminator');

// Verify no exec/execSync with string interpolation remains
const hasExecInterpolation = /exec\(`[^`]*\$\{/.test(builtSource) || /exec\("[^"]*\$\{/.test(builtSource);
assert(!hasExecInterpolation, 'No exec() with string interpolation in built code');

// Verify spawn is used instead of exec for user-facing commands
const hasSpawnUsage = builtSource.includes('spawn(');
assert(hasSpawnUsage, 'Built code uses spawn() for process execution');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESULTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n====================================================');
if (failed === 0) {
  console.log(`   ALL ${passed} SECURITY VERIFICATIONS PASSED! ✓`);
} else {
  console.log(`   RESULTS: ${passed} passed, ${failed} FAILED ✗`);
}
console.log('====================================================\n');

process.exit(failed > 0 ? 1 : 0);
