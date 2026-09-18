import { describe, it, expect } from 'vitest';
import {
  authResponse,
  authVerify,
  chainId,
  decodeSeed,
  decrypt,
  decryptJson,
  encodeSeed,
  encrypt,
  encryptJson,
  generateSeed,
  isValidSeed,
  SEED_BYTES,
} from '@core/syncCrypto';

describe('syncCrypto — seed generation & recovery code', () => {
  it('generates a 256-bit seed', () => {
    expect(generateSeed()).toHaveLength(SEED_BYTES);
  });

  it('two seeds are (overwhelmingly) different', () => {
    expect(Buffer.from(generateSeed())).not.toEqual(Buffer.from(generateSeed()));
  });

  it('encode/decode round-trips exactly', () => {
    const seed = generateSeed();
    const decoded = decodeSeed(encodeSeed(seed));
    expect(decoded).not.toBeNull();
    expect(Buffer.from(decoded!)).toEqual(Buffer.from(seed));
  });

  it('decoding tolerates spaces, lower-case and O/I/L look-alikes', () => {
    const seed = generateSeed();
    const code = encodeSeed(seed);
    const messy = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'O').replace(/1/g, 'l');
    const decoded = decodeSeed(messy);
    expect(decoded).not.toBeNull();
    expect(Buffer.from(decoded!)).toEqual(Buffer.from(seed));
  });

  it('rejects a code whose checksum fails (single-char typo)', () => {
    const code = encodeSeed(generateSeed());
    // Flip one character to a different valid base32 symbol.
    const idx = code.search(/[A-Z2-9]/);
    const ch = code[idx];
    const swapped = ch === 'A' ? 'B' : 'A';
    const broken = code.slice(0, idx) + swapped + code.slice(idx + 1);
    expect(decodeSeed(broken)).toBeNull();
  });

  it('rejects garbage and empty input', () => {
    expect(decodeSeed('')).toBeNull();
    expect(decodeSeed('not a real seed at all')).toBeNull();
    expect(isValidSeed('nope')).toBe(false);
    expect(isValidSeed(encodeSeed(generateSeed()))).toBe(true);
  });
});

describe('syncCrypto — chainId', () => {
  it('is stable for a seed and different across seeds', () => {
    const a = generateSeed();
    const b = generateSeed();
    expect(chainId(a)).toBe(chainId(a));
    expect(chainId(a)).not.toBe(chainId(b));
  });

  it('is a short hex id and never equals the raw seed', () => {
    const seed = generateSeed();
    const id = chainId(seed);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toContain(Buffer.from(seed).toString('hex'));
  });
});

describe('syncCrypto — encrypt/decrypt (AES-256-GCM)', () => {
  it('round-trips a payload with the right seed', () => {
    const seed = generateSeed();
    const plain = Buffer.from('cookie: session=secret; login=token');
    const blob = encrypt(seed, plain);
    expect(Buffer.from(decrypt(seed, blob)!)).toEqual(plain);
  });

  it('produces different ciphertext each time (random salt + IV)', () => {
    const seed = generateSeed();
    const plain = Buffer.from('same input');
    expect(Buffer.from(encrypt(seed, plain))).not.toEqual(Buffer.from(encrypt(seed, plain)));
  });

  it('the wrong seed cannot decrypt (returns null, no throw)', () => {
    const blob = encrypt(generateSeed(), Buffer.from('secret'));
    expect(decrypt(generateSeed(), blob)).toBeNull();
  });

  it('a tampered blob fails authentication', () => {
    const seed = generateSeed();
    const blob = encrypt(seed, Buffer.from('secret'));
    const tampered = Buffer.from(blob);
    const last = tampered.length - 1;
    tampered[last] = tampered[last]! ^ 0xff; // flip a ciphertext bit
    expect(decrypt(seed, tampered)).toBeNull();
  });

  it('rejects truncated / wrong-version blobs', () => {
    const seed = generateSeed();
    expect(decrypt(seed, new Uint8Array(4))).toBeNull();
    const blob = Buffer.from(encrypt(seed, Buffer.from('x')));
    blob[0] = 99; // bogus format version
    expect(decrypt(seed, blob)).toBeNull();
  });

  it('binds AAD — decrypt fails if the AAD differs', () => {
    const seed = generateSeed();
    const blob = encrypt(seed, Buffer.from('secret'), Buffer.from('cookie'));
    expect(decrypt(seed, blob, Buffer.from('cookie'))).not.toBeNull();
    expect(decrypt(seed, blob, Buffer.from('bookmark'))).toBeNull();
    expect(decrypt(seed, blob)).toBeNull(); // missing AAD
  });
});

describe('syncCrypto — JSON helpers', () => {
  it('round-trips a structured value', () => {
    const seed = generateSeed();
    const value = { history: [{ url: 'https://x', at: 1 }], likes: ['a', 'b'] };
    const blob = encryptJson(seed, value);
    expect(decryptJson<typeof value>(seed, blob)).toEqual(value);
  });

  it('returns null for a blob the seed cannot open', () => {
    const blob = encryptJson(generateSeed(), { a: 1 });
    expect(decryptJson(generateSeed(), blob)).toBeNull();
  });
});

describe('syncCrypto — pairing challenge-response', () => {
  it('a peer holding the seed passes; a peer without it fails', () => {
    const seed = generateSeed();
    const challenge = Buffer.from(generateSeed()); // any random bytes
    const response = authResponse(seed, challenge);
    expect(authVerify(seed, challenge, response)).toBe(true);
    expect(authVerify(generateSeed(), challenge, response)).toBe(false);
  });

  it('a wrong-length response is rejected without throwing', () => {
    const seed = generateSeed();
    expect(authVerify(seed, Buffer.from('c'), new Uint8Array(3))).toBe(false);
  });
});
