import { parseValidators, type Validators } from '../core/resumeCheck';

export type ValidatorResult =
  | { ok: true; validators: Validators }
  /** `network`: could not reach the server at all. `status`: it answered, but not usefully (403, 404, 5xx). */
  | { ok: false; reason: 'network' | 'status' };

/**
 * Ask the server what it says about a file, without downloading it: a one-byte ranged GET, which is
 * what aria2 itself starts with, so it works on servers that refuse HEAD.
 *
 * `headers` are the same ones the download will send (referer, cookies, user agent): a link that only
 * works with them would otherwise answer 403 here and look unverifiable.
 */
export async function fetchValidators(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<ValidatorResult> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...headers, Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    // We only want the headers; never pull the body (a server that ignores Range would send the whole file).
    void res.body?.cancel().catch(() => undefined);
    if (!res.ok) return { ok: false, reason: 'status' };
    return { ok: true, validators: parseValidators(Object.fromEntries(res.headers.entries())) };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
