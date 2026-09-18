// Lumina Sync — the end-to-end crypto core (main-process only; uses node:crypto).
//
// Cookies and login data are secrets, so everything a chain exchanges is encrypted with a key that never
// leaves the user's devices. The root of trust is a 256-bit *sync seed* (Brave calls this the "chain"): it is
// generated once on the first device, shown to the user as a grouped recovery code (Crockford base32 + a
// checksum, QR-friendly), and typed/scanned onto every other device. From that seed we derive per-purpose keys
// with HKDF-SHA256 and encrypt blobs with AES-256-GCM (authenticated — tampering fails to decrypt). The seed
// is the only secret; it is never sent to any server or peer. At rest it belongs in the OS keychain
// (safeStorage/DPAPI) — that wiring lives in the main process, not here.
//
// This module is pure crypto with no I/O or global state, so it is fully unit-testable (round-trips + tamper
// rejection). Primitives are standard node:crypto — we are not inventing ciphers, only composing them.

import { createHash, createHmac, hkdfSync, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { base32Decode, base32Encode } from './base32';

// Format constants — MUST stay identical to syncCryptoWeb.ts so desktop and Android blobs interoperate.
export const SEED_BYTES = 32; // 256-bit seed
const CHECKSUM_BYTES = 1; // 1 byte of SHA-256(seed) guards against typos in the recovery code
const FORMAT_VERSION = 1; // first byte of every encrypted blob; lets the format evolve
const SALT_BYTES = 16; // random per-message HKDF salt
const IV_BYTES = 12; // GCM nonce
const TAG_BYTES = 16; // GCM auth tag
const KEY_BYTES = 32; // AES-256

/** A fresh, cryptographically-random 256-bit sync seed — the root of a new chain. */
export function generateSeed(): Uint8Array {
  return new Uint8Array(randomBytes(SEED_BYTES));
}

/**
 * Encode a seed as a human-transferable recovery code: base32 of `seed || checksum`, upper-cased and grouped
 * in fours (e.g. `A1B2-C3D4-…`). The checksum catches typos on entry. This is what the UI shows as words+QR.
 */
export function encodeSeed(seed: Uint8Array): string {
  if (seed.length !== SEED_BYTES) throw new Error(`seed must be ${SEED_BYTES} bytes`);
  const checksum = createHash('sha256').update(seed).digest()[0]!;
  const payload = new Uint8Array(SEED_BYTES + CHECKSUM_BYTES);
  payload.set(seed);
  payload[SEED_BYTES] = checksum;
  return (base32Encode(payload).match(/.{1,4}/g) ?? []).join('-');
}

/**
 * Decode a recovery code back to a seed, tolerating spaces, dashes, lower-case and O/I/L look-alikes.
 * Returns null if it isn't a well-formed, checksum-valid Lumina seed (so callers can show "invalid code").
 */
export function decodeSeed(input: string): Uint8Array | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned) return null;
  const raw = base32Decode(cleaned);
  if (!raw || raw.length < SEED_BYTES + CHECKSUM_BYTES) return null;
  const seed = raw.slice(0, SEED_BYTES);
  const checksum = raw[SEED_BYTES];
  const expected = createHash('sha256').update(seed).digest()[0]!;
  if (checksum !== expected) return null;
  return seed;
}

/** True if `input` is a valid, checksum-passing recovery code. */
export function isValidSeed(input: string): boolean {
  return decodeSeed(input) !== null;
}

/** Derive a 32-byte key from the seed for a given purpose (`info`) and per-message `salt`, via HKDF-SHA256. */
function deriveKey(seed: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', seed, salt, Buffer.from(info, 'utf8'), KEY_BYTES));
}

/**
 * A public, non-secret identifier for the chain: a one-way hash of the seed. Devices can advertise this on the
 * LAN to recognise peers on the same chain without revealing the seed (which has 256-bit entropy, so the id is
 * not reversible or brute-forceable). Never use it as a key.
 */
export function chainId(seed: Uint8Array): string {
  return Buffer.from(deriveKey(seed, new Uint8Array(SALT_BYTES), 'lumina-sync-chain-id/v1')).subarray(0, 8).toString('hex');
}

/**
 * Encrypt with AES-256-GCM. Output = `version(1) || salt(16) || iv(12) || tag(16) || ciphertext`.
 * `aad` (optional) is authenticated-but-not-encrypted context (e.g. record type) bound to the ciphertext.
 */
export function encrypt(seed: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(seed, salt, 'lumina-sync-blob/v1');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), salt, iv, tag, ciphertext]);
}

/**
 * Decrypt a blob produced by `encrypt`. Returns null on any failure — wrong seed, wrong/absent AAD, truncation
 * or tampering (GCM authentication fails) — so callers treat undecryptable input as "not for us / corrupt".
 */
export function decrypt(seed: Uint8Array, blob: Uint8Array, aad?: Uint8Array): Uint8Array | null {
  const header = 1 + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (blob.length < header || blob[0] !== FORMAT_VERSION) return null;
  let offset = 1;
  const salt = blob.subarray(offset, (offset += SALT_BYTES));
  const iv = blob.subarray(offset, (offset += IV_BYTES));
  const tag = blob.subarray(offset, (offset += TAG_BYTES));
  const ciphertext = blob.subarray(offset);
  try {
    const key = deriveKey(seed, salt, 'lumina-sync-blob/v1');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    if (aad) decipher.setAAD(aad);
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    return null; // authentication/decryption failed
  }
}

/** Encrypt a JSON-serialisable value. Convenience over `encrypt`. */
export function encryptJson(seed: Uint8Array, value: unknown, aad?: Uint8Array): Uint8Array {
  return encrypt(seed, Buffer.from(JSON.stringify(value), 'utf8'), aad);
}

/** Decrypt and JSON-parse a blob, or null if it can't be decrypted or parsed. */
export function decryptJson<T>(seed: Uint8Array, blob: Uint8Array, aad?: Uint8Array): T | null {
  const plain = decrypt(seed, blob, aad);
  if (!plain) return null;
  try {
    return JSON.parse(Buffer.from(plain).toString('utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Challenge-response for LAN pairing: prove a peer holds the seed without sending it. The verifier sends a
 * random `challenge`; the prover returns `authResponse(seed, challenge)`; the verifier checks it with
 * `authVerify`. Uses an HKDF-derived auth key so it's independent of the encryption key.
 */
export function authResponse(seed: Uint8Array, challenge: Uint8Array): Uint8Array {
  const key = deriveKey(seed, new Uint8Array(SALT_BYTES), 'lumina-sync-auth/v1');
  return new Uint8Array(createHmac('sha256', key).update(challenge).digest());
}

/** Constant-time check of an auth response for a challenge. False on any mismatch or malformed length. */
export function authVerify(seed: Uint8Array, challenge: Uint8Array, response: Uint8Array): boolean {
  const expected = authResponse(seed, challenge);
  if (response.length !== expected.length) return false;
  return timingSafeEqual(expected, response);
}
