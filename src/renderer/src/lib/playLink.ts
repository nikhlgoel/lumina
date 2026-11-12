import type { MediaInfo, RequestInfo } from '@shared/types';
import { call, errorMessage } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { queueFromEntries } from '@core/searchResults';
import { usePlayer } from '@/stores/player';

/**
 * Plays a link without downloading it: main resolves it to a stream, and the player takes over the window.
 * `info` is passed when the link has already been read, so it isn't read twice. Resolves to whether playback started.
 */
export async function playLink(url: string, opts: { info?: MediaInfo; request?: RequestInfo } = {}): Promise<boolean> {
  try {
    const item = await call('media:play', { url, info: opts.info, request: opts.request });
    usePlayer.getState().playQueue([item]);
    useApp.getState().setMode('player');
    return true;
  } catch (err) {
    useApp.getState().toast(errorMessage(err), 'error');
    return false;
  }
}

/**
 * Plays an album or playlist from its first track on, without downloading it: the list is read once, then each track's stream is worked out as its turn
 * comes. A link that turns out to be one track plays as one. Resolves to whether playback started.
 */
export async function playCollection(url: string, title?: string): Promise<boolean> {
  try {
    const info = await call('media:inspect', { url });
    if (info.sourceKind !== 'playlist') return playLink(url, { info });
    const items = queueFromEntries(info.entries, title ?? info.title ?? null);
    if (!items.length) throw new Error('There is nothing in it to play.');
    usePlayer.getState().playQueue(items);
    useApp.getState().setMode('player');
    return true;
  } catch (err) {
    useApp.getState().toast(errorMessage(err), 'error');
    return false;
  }
}
