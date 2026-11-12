// Development-only: the search backend against the real YouTube (it only searches; nothing is downloaded). Needs a network, so it is not part of the
// release check, which must not fail because a site was slow; run it by hand when the search code changes.
import fs from 'node:fs';
import { clearSearchMemory, searchAlbumsPart, searchPlaylistsPart, searchSongsPart, searchVideosPart } from './search';
import { inspect } from './inspect';

const out = (m: string) => {
  const line = `[selftest] ${m}\n`;
  try { process.stdout.write(line); } catch { /* closed output */ }
  if (process.env.LUMINA_SELFTEST_LOG) { try { fs.appendFileSync(process.env.LUMINA_SELFTEST_LOG, line); } catch { /* best effort */ } }
};

export async function runSearchSelftest(): Promise<void> {
  let ok = 0;
  let total = 0;
  const check = (name: string, pass: boolean, detail = '') => {
    total++;
    if (pass) ok++;
    out(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const timed = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
    const t = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - t };
  };
  const q = 'animal crossing';

  clearSearchMemory();
  const songs = await timed(() => searchSongsPart(q, 12));
  check('songs: twelve results with artist, length and a picture', songs.value.hits.length === 12 && songs.value.hits.every((h) => h.subtitle && h.durationSec && h.thumbnail), `${songs.value.hits.length} in ${songs.ms} ms`);
  check('songs: the pictures are album art, big enough to show large', songs.value.hits.some((h) => /googleusercontent\.com\/.*=w400-h400/.test(h.thumbnail ?? '')), songs.value.hits[0]?.thumbnail?.slice(0, 70) ?? '');

  const videos = await timed(() => searchVideosPart(q, 12));
  const v = videos.value.hits;
  check('videos: twelve results by the quick road, with channel, length, views and age', v.length === 12 && v.every((h) => h.subtitle && h.durationSec && h.views && h.published), `${v.length} in ${videos.ms} ms`);
  check('videos: the quick road is faster than yt-dlp usually is (under 3 s)', videos.ms < 3_000, `${videos.ms} ms`);
  check('videos: a picture big enough to show large', v.every((h) => (h.thumbnail ?? '').includes('ytimg.com')), v[0]?.thumbnail?.slice(0, 70) ?? '');

  const again = await timed(() => searchVideosPart(`  ${q.toUpperCase()} `, 12));
  check('the same search again is answered from memory', again.ms < 50 && again.value.hits.length === 12, `${again.ms} ms`);

  clearSearchMemory();
  process.env.LUMINA_SEARCH_NO_FAST = '1';
  const slow = await timed(() => searchVideosPart(q, 12));
  delete process.env.LUMINA_SEARCH_NO_FAST;
  check('videos: yt-dlp, the fallback, also works', slow.value.hits.length >= 8 && !slow.value.failed && slow.value.hits.every((h) => h.subtitle && h.thumbnail), `${slow.value.hits.length} in ${slow.ms} ms`);
  check('videos: through yt-dlp the views are there too', slow.value.hits.some((h) => h.views), slow.value.hits[0]?.views ?? 'none');

  clearSearchMemory();
  const more = await timed(() => searchVideosPart(q, 24));
  check('"load more": twenty-four videos on a second ask', more.value.hits.length >= 20 && !more.value.failed, `${more.value.hits.length} in ${more.ms} ms`);

  clearSearchMemory();
  const albums = await timed(() => searchAlbumsPart('daft punk', 12));
  const a = albums.value.hits;
  check('albums: twelve results with artist, year and a big cover', a.length === 12 && a.every((h) => h.kind === 'album' && h.subtitle && h.year && h.thumbnail), `${a.length} in ${albums.ms} ms: ${a[0]?.title ?? ''} (${a[0]?.year ?? ''})`);
  check('albums: each one’s address is a playlist the downloader and player can open', a.every((h) => /music\.youtube\.com\/playlist\?list=OLAK5uy_/.test(h.url)), a[0]?.url ?? '');
  const lists = await timed(() => searchPlaylistsPart('daft punk', 12));
  const l = lists.value.hits;
  check('playlists: curated and community ones, with the curated first and a song count', l.length >= 6 && l[0]!.trackCount !== null && !lists.value.failed, `${l.length} in ${lists.ms} ms: ${l[0]?.title ?? ''} (${l[0]?.trackCount ?? '?'} songs)`);
  const opened = a[0] ? await inspect(a[0].url).catch((e) => e as Error) : null;
  check('an album’s address opens as a list of its tracks', opened !== null && !(opened instanceof Error) && opened.sourceKind === 'playlist' && opened.entries.length >= 5, opened instanceof Error ? opened.message : `${opened?.entries.length ?? 0} tracks: ${opened?.entries[0]?.title ?? ''}`);

  const none = await searchSongsPart('qzxwvkjh zzzzqqq 12345xyz', 12);
  check('a search with no matches is an empty answer, not a failure', !none.failed);
  out(`${ok}/${total} checks passed`);
}
