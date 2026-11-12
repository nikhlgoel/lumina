import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

/**
 * A GET that answers with a web `Response`, built on Node's classic `http`/`https` modules instead of `fetch`.
 *
 * Why not `fetch`: it is Node's built-in HTTP client (undici), and when a reader stops reading (a media element does once it has buffered ahead) while the
 * server finishes and closes the connection, undici throws `assert(!this.paused)` out of a socket handler as an uncaught exception. It was seen in the log of
 * the streaming proxy, which is exactly that case: a player reading a long file through it. The classic modules have no such assertion, and cancelling the
 * web stream closes the socket cleanly.
 *
 * Redirects are followed (up to five). Headers are kept on the way, except `Authorization`, which is dropped when the redirect goes to another host.
 */
export function httpGet(url: string, opts: { headers?: Record<string, string>; signal?: AbortSignal; maxRedirects?: number } = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const signal = opts.signal;
    if (signal?.aborted) return reject(new Error('aborted'));

    const go = (target: string, left: number, headers: Record<string, string>) => {
      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch (err) {
        return reject(err instanceof Error ? err : new Error(String(err)));
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return reject(new Error(`Not a web address: ${parsed.protocol}`));
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(parsed, { headers }, (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && left > 0) {
          res.resume(); // nothing is wanted of the redirect's own body
          const next = new URL(location, parsed);
          const kept = { ...headers };
          if (next.host !== parsed.host) for (const k of Object.keys(kept)) if (k.toLowerCase() === 'authorization') delete kept[k];
          return go(next.toString(), left - 1, kept);
        }
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          try {
            out.set(name, Array.isArray(value) ? value.join(', ') : String(value));
          } catch {
            // a header the Headers class refuses is not one the player needs
          }
        }
        const empty = status === 204 || status === 205 || status === 304 || status < 200;
        if (empty) res.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), { status: status < 200 ? 502 : status, headers: out }));
      });
      req.on('error', reject);
      signal?.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    };

    go(url, opts.maxRedirects ?? 5, opts.headers ?? {});
  });
}
