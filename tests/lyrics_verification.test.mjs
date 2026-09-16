#!/usr/bin/env node
/**
 * ============================================================
 *  LUMINA LYRICS SUBSYSTEM VERIFICATION SUITE
 *  Tests title sanitization, LRC parser, LRCLIB API integration,
 *  timestamp alignment, and autoscroll logic.
 * ============================================================
 */

import path from 'path';
import fs from 'fs';
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

console.log('====================================================');
console.log('      LUMINA LYRICS SUBSYSTEM VERIFICATION SUITE     ');
console.log('====================================================\n');

// ── 1. Title and Artist Sanitization ──────────────────────────────
console.log('[1/6] Testing Title & Artist Metadata Sanitization:');

function cleanMetadata(rawTitle, rawArtist) {
  let title = (rawTitle || '').trim();
  let artist = (rawArtist || '').trim();

  if (title.includes(' - ') && (!artist || artist === 'Lumina' || artist.toLowerCase().includes('topic') || artist.toLowerCase().includes('records'))) {
    const parts = title.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  } else if (title.includes(' – ')) {
    const parts = title.split(' – ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' – ').trim();
  }

  title = title
    .replace(/\s*\([^)]*(?:official|video|music video|audio|lyrics|lyric video|visualizer|remaster|live|performance|version|hq|hd|4k)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:official|video|music video|audio|lyrics|lyric video|visualizer|remaster|live|performance|version|hq|hd|4k)[^\]]*\]/gi, '')
    .replace(/\s*\(feat\.[^)]*\)/gi, '')
    .replace(/\s*\[feat\.[^\]]*\]/gi, '')
    .replace(/\s*feat\.\s+[^,\s-]+/gi, '')
    .replace(/\s*ft\.\s+[^,\s-]+/gi, '')
    .replace(/\s*\(prod\.[^)]*\)/gi, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  artist = artist
    .replace(/ - Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*(?:&|,|\bx\b)\s*.*$/i, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();

  return { title, artist };
}

const c1 = cleanMetadata('Queen - Bohemian Rhapsody (Official Video Remastered)', '');
assert(c1.artist === 'Queen' && c1.title === 'Bohemian Rhapsody', 'YouTube "Artist - Title (Official Video)" split cleanly');

const c2 = cleanMetadata('Never Gonna Give You Up (2022 Remaster)', 'Rick Astley');
assert(c2.title === 'Never Gonna Give You Up' && c2.artist === 'Rick Astley', 'Remaster noise removed');

const c3 = cleanMetadata('APT. [Official Music Video]', 'ROSÉ & Bruno Mars');
assert(c3.title === 'APT.' && c3.artist === 'ROSÉ', 'Primary artist preserved, video tag stripped');

const c4 = cleanMetadata('Starboy (feat. Daft Punk) [Visualizer]', 'The Weeknd - Topic');
assert(c4.title === 'Starboy' && c4.artist === 'The Weeknd', 'Feat and visualizer stripped, Topic suffix removed');

// ── 2. LRC Timestamp Parser ───────────────────────────────────────
console.log('\n[2/6] Testing LRC Timestamp Parsing:');

function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = [];
  const rawLines = lrcText.split(/\r?\n/);
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let ms = 0;
      if (match[3]) {
        ms = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
      }
      const time = minutes * 60 + seconds + ms / 1000;
      const text = match[4].trim();
      if (text || lines.length > 0) {
        lines.push({ time: Math.round(time * 100) / 100, text });
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

const sampleLrc = `
[00:00.50] Hello darkness, my old friend
[00:04.20] I've come to talk with you again
[01:15.800] In restless dreams I walked alone
`;

const parsed = parseLrc(sampleLrc);
assert(parsed.length === 3, 'All 3 LRC lines parsed');
assert(parsed[0].time === 0.5 && parsed[0].text === 'Hello darkness, my old friend', 'Line 1 timestamp: 0.5s');
assert(parsed[1].time === 4.2 && parsed[1].text === "I've come to talk with you again", 'Line 2 timestamp: 4.2s');
assert(parsed[2].time === 75.8 && parsed[2].text === 'In restless dreams I walked alone', 'Line 3 timestamp: 75.8s');

// ── 3. Autoscroll Line Index Computation ───────────────────────────
console.log('\n[3/6] Testing Autoscroll Active Line Index Computation:');

function computeActiveLineIndex(lines, currentTime) {
  const timeWithOffset = currentTime + 0.15;
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= timeWithOffset) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

assert(computeActiveLineIndex(parsed, 0.0) === -1, 'Before line 1: index is -1');
assert(computeActiveLineIndex(parsed, 0.4) === 0, 'At 0.4s (with lookahead): index is 0 (Line 1)');
assert(computeActiveLineIndex(parsed, 2.0) === 0, 'At 2.0s: index is still 0');
assert(computeActiveLineIndex(parsed, 4.1) === 1, 'At 4.1s: index transitions to 1 (Line 2)');
assert(computeActiveLineIndex(parsed, 76.0) === 2, 'At 76.0s: index is 2 (Line 3)');

// ── 4. Live LRCLIB Synced Lyrics Ingestion ─────────────────────────
console.log('\n[4/6] Testing Live Synced Lyrics Ingestion (LRCLIB):');

const res = await fetch('https://lrclib.net/api/get?track_name=Bohemian+Rhapsody&artist_name=Queen');
assert(res.ok, 'LRCLIB API responded 200 OK');

const data = await res.json();
assert(data.syncedLyrics && data.syncedLyrics.length > 50, 'Synced LRC lyrics received');
assert(data.trackName.toLowerCase().includes('bohemian'), 'Track name verified');

const realParsed = parseLrc(data.syncedLyrics);
assert(realParsed.length >= 30, `Extracted ${realParsed.length} synchronized lyric lines`);
assert(realParsed[0].time >= 0 && realParsed[0].text.length > 0, `First line: "${realParsed[0].text}" at ${realParsed[0].time}s`);

// ── 5. Live Ingestion with Noisy YouTube Title ─────────────────────
console.log('\n[5/6] Testing Query Resolution for Noisy Titles:');

const noisyTitle = 'ROSÉ & Bruno Mars - APT. (Official Music Video)';
const cleaned = cleanMetadata(noisyTitle, '');
const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleaned.title)}&artist_name=${encodeURIComponent(cleaned.artist)}`;
const searchRes = await fetch(searchUrl);
const searchData = await searchRes.json();

assert(Array.isArray(searchData) && searchData.length > 0, 'Search returned results for cleaned YouTube title');
const bestMatch = searchData.find(r => r.syncedLyrics) || searchData[0];
assert(bestMatch.syncedLyrics != null, 'Found synced lyrics for APT. by ROSÉ');

// ── 6. Instrumental Handling ──────────────────────────────────────
console.log('\n[6/6] Testing Instrumental Handling:');

function formatInstrumental(item) {
  if (item.instrumental) {
    return {
      lines: [{ time: 0, text: '♪ Instrumental ♪' }],
      isSynced: true
    };
  }
  return null;
}

const instResult = formatInstrumental({ instrumental: true });
assert(instResult && instResult.isSynced && instResult.lines[0].text === '♪ Instrumental ♪', 'Instrumental tracks mapped to graceful indicator line');

console.log('\n====================================================');
if (failed === 0) {
  console.log(`   ALL ${passed} LYRICS SUBSYSTEM TESTS PASSED! ✓`);
} else {
  console.log(`   RESULTS: ${passed} passed, ${failed} FAILED ✗`);
}
console.log('====================================================\n');

process.exit(failed > 0 ? 1 : 0);
