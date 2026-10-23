// Is the file on the server still the file we started downloading?
//
// Measured: a 250 MB download was interrupted, the server's file changed while it was down, and the
// resume appended the NEW content to the OLD partial. 80 MiB of one version and 170 MiB of the other,
// reported "Done" with no error. aria2 resumes with plain `Range` requests and never sends `If-Range`,
// and the size had not changed, so nothing downstream could notice either. Torrents are safe (every
// piece is hashed); a plain download is not.
//
// So the validators the server gives (ETag, Last-Modified, length) are remembered when a download
// starts and compared again before a partial file is resumed. A difference means start over.

export interface Validators {
  etag: string | null;
  lastModified: string | null;
  size: number | null;
}

export type Verdict = 'same' | 'changed' | 'unknown';

/** Read the validators out of a response's headers (names in any case). */
export function parseValidators(headers: Record<string, string | undefined>): Validators {
  const get = (name: string): string | null => {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    const v = key ? headers[key]?.trim() : undefined;
    return v ? v : null;
  };
  // A `bytes 0-0/12345` reply to a one-byte range carries the real size; a plain reply carries it as the length.
  const range = /\/(\d+)\s*$/.exec(get('content-range') ?? '');
  const length = Number(get('content-length'));
  const size = range ? Number(range[1]) : Number.isFinite(length) && length > 1 ? length : null;
  return { etag: get('etag'), lastModified: get('last-modified'), size };
}

/** `W/"abc"` and `"abc"` name the same content for our purpose: we only ever discard on a *difference*. */
const strip = (etag: string): string => etag.replace(/^W\//i, '');

/**
 * Compare what was seen when the download started with what the server says now.
 *
 * 'changed' only when a validator the two sides both have disagrees. Anything less certain is
 * 'unknown', and the caller then resumes as before — discarding a good partial on a hunch would cost
 * the person a long download for nothing.
 */
export function compareValidators(saved: Validators | null | undefined, now: Validators): Verdict {
  if (!saved) return 'unknown';
  if (saved.etag && now.etag) return strip(saved.etag) === strip(now.etag) ? 'same' : 'changed';
  if (saved.lastModified && now.lastModified) return saved.lastModified === now.lastModified ? 'same' : 'changed';
  if (saved.size != null && now.size != null && saved.size !== now.size) return 'changed';
  return 'unknown';
}
