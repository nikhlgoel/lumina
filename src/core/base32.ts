// Crockford base32 — a compact, human-readable byte encoding used for the Lumina Sync recovery code.
// No I, L, O, U in the alphabet so a person can read the code aloud without ambiguity; decoding also maps the
// look-alikes O→0 and I/L→1 so a mistyped character still round-trips. Pure (no crypto, no I/O) and shared by
// both the Node (`syncCrypto`) and Web-Crypto (`syncCryptoWeb`) cores so the encoding is identical on every
// platform in the chain (desktop and Android).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const DECODE_MAP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET[i]!] = i;
  m['O'] = 0;
  m['I'] = 1;
  m['L'] = 1;
  return m;
})();

/** Encode bytes as Crockford base32 (no padding). */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode Crockford base32 back to bytes, or null if it contains a character outside the alphabet/aliases. */
export function base32Decode(text: string): Uint8Array | null {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text) {
    const v = DECODE_MAP[ch];
    if (v === undefined) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
