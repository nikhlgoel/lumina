import assert from 'assert';

console.log('Testing Multi-Source Lyrics Enhancements...');

// Test 1: VTT / SRT parser
function parseVttOrSrt(captionText) {
  if (!captionText || typeof captionText !== 'string') return [];
  const lines = [];
  const blocks = captionText.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  
  for (const block of blocks) {
    const bLines = block.trim().split('\n');
    for (let i = 0; i < bLines.length; i++) {
      const timeMatch = bLines[i].match(/(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1] || '0', 10);
        const mins = parseInt(timeMatch[2], 10);
        const secs = parseInt(timeMatch[3], 10);
        const ms = parseInt(timeMatch[4], 10);
        const time = hours * 3600 + mins * 60 + secs + ms / 1000;
        
        const text = bLines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
        if (text) {
          lines.push({ time, text });
        }
        break;
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

const sampleVtt = `WEBVTT

00:00:01.500 --> 00:00:04.000
Hello, it's me

00:00:05.100 --> 00:00:08.200
I was wondering if after all these years
`;

const parsedVtt = parseVttOrSrt(sampleVtt);
assert.strictEqual(parsedVtt.length, 2);
assert.strictEqual(parsedVtt[0].time, 1.5);
assert.strictEqual(parsedVtt[0].text, "Hello, it's me");
assert.strictEqual(parsedVtt[1].time, 5.1);
console.log('✓ VTT / SRT subtitle parser verified');

// Test 2: Relaxed title cleaner
function relaxTitle(title) {
  return title
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*[-–—].*$/, '')
    .replace(/[^\w\s\u00C0-\u024F\u4e00-\u9fa5]/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

assert.strictEqual(relaxTitle('Bohemian Rhapsody - 2011 Mix'), 'Bohemian Rhapsody');
assert.strictEqual(relaxTitle('Shape of You (Acoustic)'), 'Shape of You');
assert.strictEqual(relaxTitle('Hotel California [Live At The Forum 1976]'), 'Hotel California');
console.log('✓ Relaxed title cleaner verified');

// Test 3: Live Lyrics.ovh Fallback Provider
const res = await fetch('https://api.lyrics.ovh/v1/Oasis/Wonderwall', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36'
  }
});
assert.strictEqual(res.status, 200);
const data = await res.json();
assert.ok(data.lyrics && data.lyrics.includes('Today is gonna be the day'));
console.log('✓ Live Lyrics.ovh fallback verified (Oasis - Wonderwall)');

console.log('ALL MULTI-SOURCE LYRICS TESTS PASSED! ✓');
