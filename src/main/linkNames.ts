import { directApiUrl } from '../core/hosts';
import { nameFromText } from '../core/batch';
import { logger } from './log';

const log = logger('linknames');

/** Names read at once. Pixeldrain drops a client that asks for many things together (see core/hostBudget), and a batch is ten or twelve links. */
const CONCURRENCY = 3;
const EACH_TIMEOUT_MS = 5_000;
/** The whole lookup is capped: the list is shown without names rather than made to wait for a slow host. */
const TOTAL_TIMEOUT_MS = 8_000;

/** The file name a share link has on its host's own information page, or '' when the host cannot say. */
async function nameOf(url: string): Promise<string> {
  const api = directApiUrl(url);
  if (!api) return '';
  const info = api.replace(/\?download$/, '/info');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(info, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(EACH_TIMEOUT_MS) });
      if (!res.ok) return '';
      const json = (await res.json()) as { name?: unknown };
      return typeof json.name === 'string' ? nameFromText(json.name) : '';
    } catch (err) {
      log.debug('Name lookup failed', { info, attempt, err: String(err) });
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return '';
}

/**
 * Names for links whose address says nothing about the file (share links). Today that is Pixeldrain, which publishes a file's name. Anything the
 * host does not answer for in time is left out, and the list shows the link, as it did before.
 */
export async function resolveLinkNames(urls: string[]): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const queue = urls.filter((u) => directApiUrl(u)).slice(0, 200);
  let next = 0;
  const work = async () => {
    while (next < queue.length) {
      const url = queue[next++] as string;
      const name = await nameOf(url);
      if (name) found[url] = name;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, work)),
    new Promise((resolve) => { timer = setTimeout(resolve, TOTAL_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);
  // A lookup still in flight when the time ran out must not go on asking: leave the queue empty so its worker stops after the current request.
  next = queue.length;
  return { ...found };
}
