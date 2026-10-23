import { describe, it, expect } from 'vitest';
import { compareValidators, parseValidators, type Validators } from '@core/resumeCheck';

const v = (o: Partial<Validators>): Validators => ({ etag: null, lastModified: null, size: null, ...o });

describe('reading what the server says about a file', () => {
  it('takes the size from Content-Range when asked for one byte, as the real server replied', () => {
    expect(parseValidators({ 'Content-Range': 'bytes 0-0/262144000', 'Content-Length': '1', ETag: '"v1"', 'Last-Modified': 'Thu, 01 Jan 2026 00:00:00 GMT' }))
      .toEqual({ etag: '"v1"', lastModified: 'Thu, 01 Jan 2026 00:00:00 GMT', size: 262144000 });
  });

  it('takes the size from Content-Length on a plain reply, and ignores header case', () => {
    expect(parseValidators({ 'content-length': '5000', etag: 'W/"x"' })).toEqual({ etag: 'W/"x"', lastModified: null, size: 5000 });
  });

  it('does not mistake a one-byte reply for a one-byte file', () => {
    expect(parseValidators({ 'Content-Length': '1' }).size).toBeNull();
  });

  it('reports nothing for a server that says nothing', () => {
    expect(parseValidators({})).toEqual(v({}));
  });
});

describe('is it still the same file', () => {
  it('spots a changed ETag even though the size is identical — the corruption that was measured', () => {
    expect(compareValidators(v({ etag: '"v1"', size: 262144000 }), v({ etag: '"v2"', size: 262144000 }))).toBe('changed');
  });

  it('spots a changed Last-Modified when there is no ETag', () => {
    expect(compareValidators(v({ lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' }), v({ lastModified: 'Tue, 02 Jan 2026 00:00:00 GMT' }))).toBe('changed');
  });

  it('spots a changed size when nothing else is offered', () => {
    expect(compareValidators(v({ size: 100 }), v({ size: 200 }))).toBe('changed');
  });

  it('treats a weak and a strong form of the same ETag as the same', () => {
    expect(compareValidators(v({ etag: 'W/"abc"' }), v({ etag: '"abc"' }))).toBe('same');
  });

  it('says same when the ETag matches, even if the server rewrote Last-Modified', () => {
    expect(compareValidators(v({ etag: '"a"', lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' }), v({ etag: '"a"', lastModified: 'Tue, 02 Jan 2026 00:00:00 GMT' }))).toBe('same');
  });

  it('will not call a file changed on a hunch: no shared validator means unknown', () => {
    expect(compareValidators(v({ etag: '"a"' }), v({ size: 5 }))).toBe('unknown');
    expect(compareValidators(v({ size: 5 }), v({ size: 5 }))).toBe('unknown');
    expect(compareValidators(null, v({ etag: '"a"' }))).toBe('unknown');
  });
});
