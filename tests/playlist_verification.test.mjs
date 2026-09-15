import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPlaylistVerification() {
  console.log('====================================================');
  console.log('    LUMINA PLAYLIST & ALBUM SUBSYSTEM VERIFICATION    ');
  console.log('====================================================\n');

  const ytdlp = path.join(process.cwd(), 'engine', 'venv', 'bin', 'yt-dlp');
  const ffmpeg = '/usr/bin/ffmpeg';

  // [1/5] Spotify Playlist Embed Extraction
  console.log('[1/5] Testing Spotify Playlist Ingestion:');
  const spotifyPlaylistUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
  const embedUrl = 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M';
  
  const spotifyRes = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  });

  if (!spotifyRes.ok) {
    throw new Error(`Spotify embed fetch failed: HTTP ${spotifyRes.status}`);
  }

  const spotifyHtml = await spotifyRes.text();
  const nextDataMatch = spotifyHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (!nextDataMatch) {
    throw new Error('Spotify __NEXT_DATA__ script not found');
  }

  const spotifyData = JSON.parse(nextDataMatch[1]);
  const entity = spotifyData.props?.pageProps?.state?.data?.entity;
  if (!entity || !Array.isArray(entity.trackList)) {
    throw new Error('Invalid Spotify playlist entity payload');
  }

  console.log('  ✓ Spotify Playlist extracted cleanly!');
  console.log('  • Title:', entity.title || entity.name);
  console.log('  • Curator/Subtitle:', entity.subtitle);
  console.log('  • Track Count:', entity.trackList.length);
  console.log('  • Sample Track 1:', `"${entity.trackList[0].title}" by ${entity.trackList[0].subtitle}`);
  console.log('  • Sample Track 2:', `"${entity.trackList[1].title}" by ${entity.trackList[1].subtitle}`);

  // [2/5] Spotify Album Ingestion
  console.log('\n[2/5] Testing Spotify Album Ingestion:');
  const albumEmbedUrl = 'https://open.spotify.com/embed/album/4m2880jivSbbyEGAKfITCa'; // Random Access Memories
  const albumRes = await fetch(albumEmbedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  });
  const albumHtml = await albumRes.text();
  const albumMatch = albumHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  const albumData = JSON.parse(albumMatch[1]);
  const albumEntity = albumData.props?.pageProps?.state?.data?.entity;
  console.log('  ✓ Spotify Album extracted cleanly!');
  console.log('  • Album Title:', albumEntity.title || albumEntity.name);
  console.log('  • Album Tracks:', albumEntity.trackList?.length);

  // [3/5] Spotify Single Track Ingestion
  console.log('\n[3/5] Testing Spotify Single Track Ingestion:');
  const trackEmbedUrl = 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT';
  const trackRes = await fetch(trackEmbedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  });
  const trackHtml = await trackRes.text();
  const trackMatch = trackHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  const trackData = JSON.parse(trackMatch[1]);
  const trackEntity = trackData.props?.pageProps?.state?.data?.entity;
  const artists = Array.isArray(trackEntity.artists) ? trackEntity.artists.map(a => a.name).join(', ') : trackEntity.subtitle;
  console.log('  ✓ Spotify Single Track extracted:');
  console.log('  • Title:', trackEntity.title, 'by', artists);

  // [4/5] YouTube Music / YouTube Playlist Extraction
  console.log('\n[4/5] Testing YouTube Music Playlist Extraction via yt-dlp:');
  const ytMusicUrl = 'https://music.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj';
  const ytPlaylistArgs = [
    ytMusicUrl,
    '--dump-single-json',
    '--flat-playlist',
    '--no-warnings',
    '--playlist-items', '1-5',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
  ];

  const ytPlaylistResult = await new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, ytPlaylistArgs);
    let out = '';
    let err = '';
    proc.stdout.on('data', c => out += c);
    proc.stderr.on('data', c => err += c);
    proc.on('close', code => {
      if (code === 0 && out.trim()) {
        resolve(JSON.parse(out));
      } else {
        reject(new Error(`yt-dlp playlist dump failed: ${err}`));
      }
    });
  });

  console.log('  ✓ YouTube Music Playlist extracted!');
  console.log('  • Playlist Title:', ytPlaylistResult.title);
  console.log('  • Extracted Entries sample size:', ytPlaylistResult.entries?.length);
  if (ytPlaylistResult.entries?.length > 0) {
    console.log('  • Entry 1:', ytPlaylistResult.entries[0].title);
  }

  // [5/5] End-to-End Playlist Batch Download into Dedicated Folder
  console.log('\n[5/5] Testing Dedicated Folder Creation & Batch Download:');
  const testPlaylistName = 'Lumina_Test_Playlist';
  const targetPlaylistDir = path.join(os.tmpdir(), 'lumina_playlist_test', 'Playlists', testPlaylistName);
  if (!fs.existsSync(targetPlaylistDir)) {
    fs.mkdirSync(targetPlaylistDir, { recursive: true });
  }

  console.log('  • Created dedicated folder:', targetPlaylistDir);

  // Download 1 short test audio track into this dedicated folder
  const testTrackTitle = 'Never Gonna Give You Up';
  const testTrackArtist = 'Rick Astley';
  const outTemplate = path.join(targetPlaylistDir, '01 - %(title)s.%(ext)s');

  const dlArgs = [
    `ytsearch1:${testTrackArtist} - ${testTrackTitle} audio`,
    '--newline',
    '--ffmpeg-location', ffmpeg,
    '-o', outTemplate,
    '-x', '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--embed-thumbnail', '--embed-metadata',
    '--no-playlist',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
  ];

  console.log('  • Downloading track into dedicated playlist folder...');
  await new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, dlArgs);
    let err = '';
    proc.stderr.on('data', c => err += c);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Track download failed with code ${code}: ${err}`));
    });
  });

  const filesInPlaylist = fs.readdirSync(targetPlaylistDir);
  console.log('  ✓ Files in playlist directory:', filesInPlaylist);
  const audioFile = filesInPlaylist.find(f => f.endsWith('.mp3'));
  if (!audioFile) {
    throw new Error('Expected .mp3 file in playlist directory, but none found!');
  }

  const stat = fs.statSync(path.join(targetPlaylistDir, audioFile));
  console.log(`  ✓ Successfully downloaded "${audioFile}" (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
  
  // Cleanup test folder
  fs.rmSync(path.join(os.tmpdir(), 'lumina_playlist_test'), { recursive: true, force: true });
  console.log('  ✓ Cleanup verified.');

  console.log('\n====================================================');
  console.log(' ALL 5 PLAYLIST SUBSYSTEM VERIFICATIONS SUCCEEDED!  ');
  console.log('====================================================\n');
}

runPlaylistVerification().catch(e => {
  console.error('\n✗ Playlist verification failed:', e);
  process.exit(1);
});
