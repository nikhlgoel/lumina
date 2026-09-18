export type UrlKind = 'magnet' | 'torrent-file' | 'stream' | 'direct' | 'web' | 'invalid';

const TRACKING_PARAMS = new Set([
  'si', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid',
  'igshid', 'igsh', 'mc_cid', 'mc_eid', 'yclid', 'ref_src', 'feature', 'pp', 'share_id',
]);

const DIRECT_EXT = /\.(zip|rar|7z|tar|gz|xz|iso|exe|msi|bin|dmg|pkg|deb|rpm|appimage|apk|mp4|mkv|webm|mov|avi|mp3|flac|wav|m4a|ogg|opus|pdf|\d{3})$/i;

/** Remove control characters and tracking parameters; leaves non-http schemes untouched. */
export function cleanUrl(raw: string): string {
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!/^https?:\/\//i.test(text)) return text;
  try {
    const url = new URL(text);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return text;
  }
}

export function classifyUrl(raw: string): UrlKind {
  const url = cleanUrl(raw);
  if (/^magnet:\?/i.test(url)) return /xt=urn:btih:/i.test(url) ? 'magnet' : 'invalid';
  if (!/^https?:\/\//i.test(url)) {
    return /\.torrent$/i.test(url) ? 'torrent-file' : 'invalid';
  }
  try {
    const { pathname } = new URL(url);
    if (/\.torrent$/i.test(pathname)) return 'torrent-file';
    if (/\.(m3u8|mpd)$/i.test(pathname)) return 'stream';
    if (DIRECT_EXT.test(pathname)) return 'direct';
    return 'web';
  } catch {
    return 'invalid';
  }
}

/** Sites where a link almost always means music, so audio presets are the default. */
export function isMusicSite(raw: string): boolean {
  try {
    const host = new URL(cleanUrl(raw)).hostname.replace(/^www\./, '');
    return ['music.youtube.com', 'open.spotify.com', 'soundcloud.com', 'bandcamp.com', 'music.apple.com', 'deezer.com', 'tidal.com']
      .some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function siteName(raw: string): string {
  try {
    const host = new URL(cleanUrl(raw)).hostname.replace(/^www\./, '');
    if (host === 'music.youtube.com') return 'YouTube Music';
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube';
    if (host.endsWith('spotify.com')) return 'Spotify';
    if (host.endsWith('soundcloud.com')) return 'SoundCloud';
    if (host.endsWith('bandcamp.com')) return 'Bandcamp';
    if (host.endsWith('vimeo.com')) return 'Vimeo';
    return host;
  } catch {
    return /^magnet:/i.test(raw) ? 'BitTorrent' : 'File';
  }
}

/**
 * Turn whatever the person typed into something the inspector can open:
 * a real link/magnet/torrent stays as-is (cleaned); a bare domain gains `https://`; anything else becomes a
 * YouTube search (`ytsearchN:query`). Pure, so the download bar can treat typed text as a search, not an error.
 */
export function toInspectTarget(input: string, searchCount = 12): { target: string; isSearch: boolean } {
  const text = input.trim();
  if (!text) return { target: '', isSearch: false };
  if (classifyUrl(text) !== 'invalid') return { target: cleanUrl(text), isSearch: false };
  // A bare domain like "example.com" or "example.com/path" (no spaces, has a dot) → treat as a web address.
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text)) return { target: `https://${text}`, isSearch: false };
  return { target: `ytsearch${searchCount}:${text}`, isSearch: true };
}

/** The YouTube / YouTube-Music video id from a watch URL (or youtu.be short link), or null. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) return u.searchParams.get('v');
    return null;
  } catch {
    return null;
  }
}

/** A medium (320×180) thumbnail URL for a YouTube video id — usable for both YouTube and YT-Music results. */
export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/** Pull every http(s)/magnet link out of pasted text (for multi-link and repack pastes). */
export function extractLinks(text: string): string[] {
  const found = text.match(/(https?:\/\/[^\s"'<>()]+|magnet:\?[^\s"'<>]+)/gi) ?? [];
  return [...new Set(found.map((l) => cleanUrl(l.replace(/[.,;:)\]>]+$/, ''))))];
}
