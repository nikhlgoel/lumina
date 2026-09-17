import fs from 'node:fs';
import path from 'node:path';
import type { Lyrics } from '../../shared/types';
import { runFfmpeg } from './ffmpeg';

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

export function lyricsToLrc(lyrics: Lyrics): string {
  if (!lyrics.synced) return lyrics.plain ?? lyrics.lines.map((l) => l.text).join('\n');
  const header = [`[ti:${lyrics.title}]`, lyrics.artist && `[ar:${lyrics.artist}]`, '[re:Lumina]'].filter(Boolean);
  const body = lyrics.lines.map((l) => `[${pad(l.timeSec / 60)}:${pad(l.timeSec % 60)}.${pad((l.timeSec % 1) * 100)}]${l.text}`);
  return `${[...header, ...body].join('\n')}\n`;
}

/** Write lyrics into the audio file's tags without re-encoding (keeps cover art and other tags). */
export async function embedLyrics(file: string, lyrics: Lyrics, register: (cancel: () => void) => void): Promise<void> {
  const ext = path.extname(file).toLowerCase();
  const tmp = path.join(path.dirname(file), `.${path.basename(file, ext)}.lyrics${ext}`);
  const text = lyricsToLrc(lyrics).trim();
  // MP4 uses "lyrics" (©lyr); Vorbis comments and ID3 use LYRICS / USLT through ffmpeg's generic key.
  const key = ext === '.m4a' || ext === '.mp4' ? 'lyrics' : 'LYRICS';
  const run = runFfmpeg(['-i', file, '-map', '0', '-c', 'copy', '-map_metadata', '0', '-metadata', `${key}=${text}`, ...(ext === '.mp3' ? ['-id3v2_version', '3'] : []), tmp], null, () => undefined);
  register(run.cancel);
  try {
    await run.promise;
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
