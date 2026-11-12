// Names and folders for the episodes of a series sent from the browser.
//
// An episode's video is found by the browser extension as a bare address (a stream's master playlist, say) that carries no title, so what the
// file is called comes from the series page: "The Divorce Insurance - S01E03.mkv". Pure, so the naming rules are tested on their own.

/** What Windows will not have in a file or folder name, and what only causes trouble (control characters, trailing dots and spaces). */
export function safeName(text: string, max = 120): string {
  const name = String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|%]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, max)
    .replace(/[.\s]+$/g, '');
  // Device names Windows refuses as a whole name.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `${name}_` : name;
}

const pad = (n: number, width = 2) => String(Math.max(0, Math.floor(n))).padStart(width, '0');

/** "Show - S01E03 - Title": the name of an episode's file, without its extension. The title is left out when the page gave none. */
export function episodeFileBase(show: string, season: number, number: number, title = ''): string {
  const head = `${safeName(show, 80) || 'Series'} - S${pad(season)}E${pad(number, number > 99 ? 3 : 2)}`;
  const tail = safeName(title, 80);
  // A title that only repeats the number says nothing.
  return tail && !new RegExp(`^(?:ep(?:isode)?\\.?\\s*0*${number})$`, 'i').test(tail) ? `${head} - ${tail}` : head;
}

/** The two folders an episode goes in below the series folder: the show, then its season ("Season 01"; "Specials" for season 0). */
export function seriesFolders(show: string, season: number): [string, string] {
  return [safeName(show, 100) || 'Series', season === 0 ? 'Specials' : `Season ${pad(season)}`];
}

export interface EpisodeLike { number: number; season: number; title: string }

/** True when a file name (any extension) is already the one this episode would get. */
export function alreadyHave(existingBases: ReadonlySet<string>, show: string, e: EpisodeLike): boolean {
  return existingBases.has(episodeFileBase(show, e.season, e.number, e.title).toLowerCase());
}

/** Names in a folder reduced to what an episode's name would be: the extension and a part suffix taken off, in lower case. */
export function baseNames(files: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    if (/\.(?:aria2|part|ytdl|tmp)$/i.test(f)) continue; // not finished
    out.add(f.replace(/\.[A-Za-z0-9]{1,5}$/, '').toLowerCase());
  }
  return out;
}

/** Episodes sorted by season, then number, with the same episode listed twice kept once (the first one). */
export function orderedEpisodes<T extends EpisodeLike>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of [...items].sort((a, b) => a.season - b.season || a.number - b.number)) {
    const key = `${e.season}:${e.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
