import type { MediaInfo, RequestInfo } from '@shared/types';
import { call, errorMessage } from '@/lib/bridge';
import { useApp } from '@/stores/app';
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
