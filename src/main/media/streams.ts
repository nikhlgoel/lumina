import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { MediaInfo, PlayableItem, RequestInfo } from '../../shared/types';
import { hasVideo, planFromDirect, planFromYtdlp, playFormatSelector, type PlayJson, type StreamPlan } from '../../core/streamPlan';
import { friendlyYtdlpError } from '../../core/progress';
import { requestArgs } from '../../core/ytdlpArgs';
import { parseExtraArgs } from '../../shared/settings';
import { inspect } from '../inspect';
import { requestContext } from '../request';
import { runTool } from '../process';
import { settings } from '../settings';
import { tempDir } from '../paths';
import { tools } from '../tools';
import { logger } from '../log';

const log = logger('streams');
export const STREAM_PREFIX = 'stream-';

/** Plans for the links being played, newest last. Held only in memory: a plan carries the site's headers and cookies. */
const plans = new Map<string, StreamPlan>();
const MAX_PLANS = 24;

function keep(plan: StreamPlan): string {
  const token = crypto.randomBytes(9).toString('hex');
  plans.set(token, plan);
  // A Map iterates in insertion order, so the first key is the oldest.
  while (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value as string);
  return token;
}

/** The plan behind a `lumina-media://stream/<token>` address or a `stream-<token>` item id. */
export const streamPlan = (idOrToken: string): StreamPlan | undefined =>
  plans.get(idOrToken.startsWith(STREAM_PREFIX) ? idOrToken.slice(STREAM_PREFIX.length) : idOrToken);

export const isStreamId = (id: string) => id.startsWith(STREAM_PREFIX);

/** `name=value; …` for the cookies that apply to a host, for the file-link case where yt-dlp isn't involved. */
function cookieHeader(request: RequestInfo | undefined, url: string): string | undefined {
  if (!request?.cookies.length) return undefined;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return undefined; }
  const pairs = request.cookies
    .filter((c) => {
      const d = c.domain.replace(/^\./, '').toLowerCase();
      return host === d || host.endsWith(`.${d}`);
    })
    .map((c) => `${c.name}=${c.value}`);
  return pairs.length ? pairs.join('; ') : undefined;
}

/** Resolves a page link through yt-dlp to the address(es) that actually carry the media. */
async function resolveWithYtdlp(url: string, request: RequestInfo | undefined, audioOnly: boolean): Promise<{ plan: StreamPlan; video: boolean }> {
  const workDir = fs.mkdtempSync(path.join(tempDir(), 'play-'));
  try {
    const ctx = requestContext(request, workDir);
    const selector = playFormatSelector({ audioOnly, maxHeight: 1080 });
    const args = [
      '--ignore-config', '--no-warnings', '--no-playlist', '--js-runtimes', tools.jsRuntime(), ...requestArgs(ctx),
      ...parseExtraArgs(settings.get().advanced.extraYtdlpArgs).args, '-f', selector, '-J', '--', url,
    ];
    const r = await runTool(tools.require('yt-dlp'), args, { timeoutMs: 90_000, env: tools.env() });
    if (r.code !== 0 || !r.stdout.trim()) {
      const msg = r.stderr.split(/\r?\n/).find((l) => l.startsWith('ERROR:'))?.slice(6).trim() ?? r.stderr.trim().split(/\r?\n/).pop() ?? 'yt-dlp could not open this link.';
      log.warn('Could not resolve a link for playing', { url, stderr: r.stderr.slice(-1500) });
      throw new Error(friendlyYtdlpError(msg));
    }
    const json = JSON.parse(r.stdout) as PlayJson;
    return { plan: planFromYtdlp(json), video: hasVideo(json) };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Turns a link (already read, or not yet) into something the player can start now, without writing a file.
 * Torrents and file-host pages can't be played from the link; the message says what to do instead.
 */
export async function playableFromLink(url: string, request?: RequestInfo, known?: MediaInfo): Promise<PlayableItem> {
  log.info(`Opening ${url} for playback${known ? ' (already read)' : ''}`);
  const info = known ?? (await inspect(url, request));
  log.info(`Read as ${info.sourceKind}${info.stream ? ` (${info.stream.protocol})` : ''}: ${info.title}`);
  if (info.sourceKind === 'torrent') throw new Error('A torrent has to be downloaded before it can play. Press Download, and play it from the Library.');
  if (info.sourceKind === 'direct' && info.direct?.hosted) throw new Error('This file host gives out its file only after a download page. Press Download, then play it from the Library.');

  let title = info.title;
  let artist: string | null = info.uploader || null;
  let durationSec = info.durationSec;
  let thumbnail = info.thumbnail;
  let plan: StreamPlan;
  let audio: boolean;

  if (info.sourceKind === 'direct') {
    const ctx = requestContext(request, null);
    const cookie = cookieHeader(request, info.url);
    plan = planFromDirect(info.url, {
      mime: info.direct?.mime, filename: info.direct?.filename,
      headers: { ...ctx.headers, ...(ctx.userAgent ? { 'User-Agent': ctx.userAgent } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    artist = null;
    audio = plan.mode === 'proxy' && plan.mime.startsWith('audio/');
  } else if (info.sourceKind === 'playlist') {
    const first = info.entries.find((e) => e.url);
    if (!first) throw new Error('That playlist has nothing in it to play.');
    const resolved = await resolveWithYtdlp(first.url, request, info.isMusic);
    plan = resolved.plan;
    audio = !resolved.video;
    title = first.title;
    artist = first.uploader || artist;
    durationSec = first.durationSec;
    thumbnail = first.thumbnail ?? thumbnail;
  } else {
    // Audio is asked for only when the site says it is music, or lists sound and no picture. A site that lists nothing at all
    // (an HLS manifest) is asked for video, and the answer decides what the player shows.
    const resolved = await resolveWithYtdlp(info.url, request, info.isMusic || (info.audioStreams.length > 0 && info.videoStreams.length === 0));
    plan = resolved.plan;
    audio = !resolved.video;
  }

  const token = keep(plan);
  log.info(`Playing as ${plan.mode === 'proxy' ? `a passed-through ${plan.mime}` : `an ffmpeg pipe of ${plan.sources.length} source${plan.sources.length === 1 ? '' : 's'}`}`);
  return {
    id: `${STREAM_PREFIX}${token}`,
    kind: audio ? 'audio' : 'video',
    title, artist, album: null, durationSec,
    src: plan.mode === 'proxy' ? `lumina-media://stream/${token}` : `lumina-media://remux/${STREAM_PREFIX}${token}?t=0`,
    artworkUrl: thumbnail, path: null,
    pipe: plan.mode === 'pipe',
  };
}
