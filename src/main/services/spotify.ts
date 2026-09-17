import { BrowserWindow } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import type { MediaInfo, PlaylistEntry } from '../../shared/types';
import { settings } from '../settings';
import { deleteSecret, loadSecret, saveSecret } from '../secrets';
import { logger } from '../log';

const log = logger('spotify');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const SPOTIFY_REDIRECT = 'http://127.0.0.1:43821/callback';
const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';

interface Tokens { access: string; refresh: string; expiresAt: number; user?: string }

export type SpotifyLink = { type: 'track' | 'album' | 'playlist'; id: string } | { type: 'liked'; id: '' };

export function parseSpotifyUrl(url: string): SpotifyLink | null {
  if (/open\.spotify\.com\/collection\/tracks/.test(url)) return { type: 'liked', id: '' };
  const m = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?(track|album|playlist)\/([A-Za-z0-9]{10,40})/) ?? url.match(/^spotify:(track|album|playlist):([A-Za-z0-9]{10,40})$/);
  return m ? { type: m[1] as 'track' | 'album' | 'playlist', id: m[2]! } : null;
}

/* ---------- Account connection (OAuth with PKCE; no client secret is stored) ---------- */

export function spotifyStatus(): { connected: boolean; user: string | null; hasClientId: boolean } {
  const t = loadSecret<Tokens>('spotify');
  return { connected: Boolean(t), user: t?.user ?? null, hasClientId: Boolean(settings.get().accounts.spotifyClientId) };
}

export function disconnectSpotify() {
  deleteSecret('spotify');
}

export async function connectSpotify(parent: BrowserWindow | null): Promise<string> {
  const clientId = settings.get().accounts.spotifyClientId;
  if (!clientId) throw new Error('Add your Spotify Client ID first.');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: SPOTIFY_REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state,
  })}`;

  const code = await new Promise<string>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520, height: 760, parent: parent ?? undefined, modal: Boolean(parent), title: 'Connect Spotify', autoHideMenuBar: true,
      webPreferences: { partition: 'persist:lumina-accounts', sandbox: true, contextIsolation: true },
    });
    let settled = false;
    const finish = (url: string) => {
      if (!url.startsWith(SPOTIFY_REDIRECT) || settled) return false;
      settled = true;
      const params = new URL(url).searchParams;
      if (params.get('state') !== state) reject(new Error('Spotify sign-in was interrupted. Please try again.'));
      else if (params.get('error')) reject(new Error(params.get('error') === 'access_denied' ? 'Spotify access was not allowed.' : `Spotify said: ${params.get('error')}`));
      else resolve(params.get('code') ?? '');
      win.close();
      return true;
    };
    win.webContents.on('will-redirect', (e, url) => { if (finish(url)) e.preventDefault(); });
    win.webContents.on('will-navigate', (e, url) => { if (finish(url)) e.preventDefault(); });
    win.on('closed', () => { if (!settled) reject(new Error('Spotify sign-in was closed.')); });
    void win.loadURL(authUrl, { userAgent: UA });
  });

  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT, client_id: clientId, code_verifier: verifier });
  const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${tokens.access}` } }).then((r) => (r.ok ? r.json() as Promise<{ display_name?: string; id?: string }> : null)).catch(() => null);
  tokens.user = me?.display_name ?? me?.id;
  saveSecret('spotify', tokens);
  return tokens.user ?? 'Spotify';
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Spotify sign-in failed: ${data.error_description ?? res.status}`);
  return { access: data.access_token, refresh: data.refresh_token ?? body.refresh_token ?? '', expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
}

async function accessToken(): Promise<string | null> {
  const t = loadSecret<Tokens>('spotify');
  const clientId = settings.get().accounts.spotifyClientId;
  if (!t || !clientId) return null;
  if (Date.now() < t.expiresAt) return t.access;
  try {
    const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId });
    saveSecret('spotify', { ...fresh, user: t.user });
    return fresh.access;
  } catch (err) {
    log.warn('Spotify token refresh failed; disconnecting', err);
    deleteSecret('spotify');
    return null;
  }
}

/* ---------- Reading tracks ---------- */

interface ApiTrack { name?: string; duration_ms?: number; artists?: { name: string }[]; album?: { name?: string; images?: { url: string }[] }; external_urls?: { spotify?: string }; id?: string }

async function api<T>(token: string, path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2) * 1000));
      continue;
    }
    if (res.status === 404) throw new Error('Spotify couldn’t find that. It may be private to another account.');
    if (!res.ok) throw new Error(`Spotify returned ${res.status}.`);
    return res.json() as Promise<T>;
  }
}

const toEntry = (t: ApiTrack, i: number, fallbackArt: string | null): PlaylistEntry => {
  const artist = (t.artists ?? []).map((a) => a.name).join(', ');
  const durationSec = t.duration_ms ? Math.round(t.duration_ms / 1000) : null;
  return {
    index: i + 1, id: t.id ?? `sp-${i + 1}`, title: t.name ?? 'Unknown', uploader: artist, durationSec,
    url: t.external_urls?.spotify ?? '', thumbnail: t.album?.images?.at(-1)?.url ?? fallbackArt,
    match: { title: t.name ?? '', artist: t.artists?.[0]?.name ?? artist, album: t.album?.name, durationSec },
  };
};

async function viaApi(link: SpotifyLink, token: string): Promise<Pick<MediaInfo, 'title' | 'uploader' | 'thumbnail' | 'entries'>> {
  const pageAll = async <T>(first: string, pick: (item: T) => ApiTrack | null | undefined) => {
    const tracks: ApiTrack[] = [];
    let next: string | null = first;
    while (next && tracks.length < 10_000) {
      const page: { items: T[]; next: string | null } = await api(token, next);
      for (const item of page.items) {
        const t = pick(item);
        if (t?.name) tracks.push(t);
      }
      next = page.next;
    }
    return tracks;
  };

  if (link.type === 'liked') {
    const tracks = await pageAll<{ track: ApiTrack }>('/me/tracks?limit=50', (x) => x.track);
    return { title: 'Liked Songs', uploader: spotifyStatus().user ?? 'Spotify', thumbnail: null, entries: tracks.map((t, i) => toEntry(t, i, null)) };
  }
  if (link.type === 'track') {
    const t = await api<ApiTrack>(token, `/tracks/${link.id}`);
    return { title: t.name ?? 'Track', uploader: (t.artists ?? []).map((a) => a.name).join(', '), thumbnail: t.album?.images?.[0]?.url ?? null, entries: [toEntry(t, 0, null)] };
  }
  if (link.type === 'album') {
    const album = await api<{ name: string; artists: { name: string }[]; images: { url: string }[] }>(token, `/albums/${link.id}`);
    const art = album.images?.[0]?.url ?? null;
    const tracks = await pageAll<ApiTrack>(`/albums/${link.id}/tracks?limit=50`, (x) => ({ ...x, album: { name: album.name, images: album.images } }));
    return { title: album.name, uploader: album.artists.map((a) => a.name).join(', '), thumbnail: art, entries: tracks.map((t, i) => toEntry(t, i, art)) };
  }
  const pl = await api<{ name: string; owner?: { display_name?: string }; images?: { url: string }[] }>(token, `/playlists/${link.id}?fields=name,owner(display_name),images`);
  const tracks = await pageAll<{ track: ApiTrack | null }>(
    `/playlists/${link.id}/tracks?limit=100&fields=items(track(id,name,duration_ms,artists(name),album(name,images),external_urls)),next`, (x) => x.track,
  );
  const art = pl.images?.[0]?.url ?? null;
  return { title: pl.name, uploader: pl.owner?.display_name ?? 'Spotify', thumbnail: art, entries: tracks.map((t, i) => toEntry(t, i, art)) };
}

/** Public data from Spotify's embed page. Limited to the first 100 tracks and has no album names. */
async function viaEmbed(link: SpotifyLink): Promise<Pick<MediaInfo, 'title' | 'uploader' | 'thumbnail' | 'entries'> & { truncated: boolean }> {
  if (link.type === 'liked') throw new Error('Liked Songs are private. Connect Spotify under Settings › Accounts to download them.');
  const res = await fetch(`https://open.spotify.com/embed/${link.type}/${link.id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(res.status === 404 ? 'This Spotify link is private or doesn’t exist. Connect Spotify under Settings › Accounts to download private playlists.' : `Spotify returned ${res.status}.`);
  const json = (await res.text()).match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/)?.[1];
  const entity = json ? JSON.parse(json)?.props?.pageProps?.state?.data?.entity : null;
  if (!entity) throw new Error('Couldn’t read this Spotify link. If it’s a private playlist, connect Spotify under Settings › Accounts.');

  const cover = entity.visualIdentity?.image?.at?.(-1)?.url ?? entity.coverArt?.sources?.[0]?.url ?? null;
  const raw: { title: string; subtitle: string; duration?: number }[] = link.type === 'track'
    ? [{ title: entity.name ?? entity.title, subtitle: (entity.artists ?? []).map((a: { name: string }) => a.name).join(', ') || entity.subtitle, duration: entity.duration }]
    : entity.trackList ?? [];
  const entries: PlaylistEntry[] = raw.map((t, i) => {
    const durationSec = t.duration ? Math.round(t.duration / 1000) : null;
    return {
      index: i + 1, id: `sp-${i + 1}`, title: t.title, uploader: t.subtitle, durationSec, url: '', thumbnail: cover,
      match: { title: t.title, artist: t.subtitle.split(/,\s*/)[0] ?? t.subtitle, durationSec },
    };
  });
  return { title: entity.name ?? entity.title ?? 'Spotify', uploader: entity.subtitle ?? 'Spotify', thumbnail: cover, entries, truncated: link.type !== 'track' && raw.length >= 100 };
}

export async function inspectSpotify(url: string): Promise<MediaInfo> {
  const link = parseSpotifyUrl(url);
  if (!link) throw new Error('Unrecognised Spotify link.');
  const token = await accessToken();
  const notes = ['Spotify doesn’t allow downloading its audio, so Lumina finds each song on YouTube Music and downloads that.'];
  let data;
  if (token) {
    data = await viaApi(link, token);
  } else {
    const embed = await viaEmbed(link);
    if (embed.truncated) notes.push('Only the first 100 songs are visible without signing in. Connect Spotify under Settings › Accounts to get the whole playlist.');
    data = embed;
  }
  return {
    url, sourceKind: 'playlist', site: 'Spotify', isLive: false, isMusic: true, videoStreams: [], audioStreams: [], subtitles: [],
    durationSec: data.entries.reduce((s, e) => s + (e.durationSec ?? 0), 0) || null,
    title: data.title, uploader: data.uploader, thumbnail: data.thumbnail, entries: data.entries, notes,
  };
}
