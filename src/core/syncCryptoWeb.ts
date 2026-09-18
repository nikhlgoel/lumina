// Lumina Sync — the *portable* end-to-end crypto core (Web Crypto API; runs anywhere `crypto.subtle` exists:
// browsers, an Android WebView / Capacitor, React Native with a polyfill, and Node 20+).
//
// This is the byte-for-byte twin of `syncCrypto.ts` (which uses node:crypto and stays synchronous for the
// desktop main process). It exists so the Android companion "LuminaBr" can join the same chain: both sides
// produce the identical blob layout (`version || salt || iv || tag || ciphertext`), the identical HKDF-SHA256
// key derivation, the identical AES-256-GCM cipher, and the identical Crockford-base32 recovery code — so a blob
// written on the phone decrypts on the PC and vice-versa. The interop is locked down by cross-implementation
// tests (tests/syncCryptoWeb.test.ts), so the two cores can never silently drift apart.
//
// Everything here is async because Web Crypto is promise-based. The shared, non-crypto pieces (base32, the
// format constants) come from the same modules the Node core uses, so there is one source of truth for those.

import { base32Decode, base32Encode } from './base32';
import { SEED_BYTES } from './syncCrypto';

const CHECKSUM_BYTES = 1;
const FORMAT_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const randomBytes = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));
// TS 5.9 types Uint8Array as `Uint8Array<ArrayBufferLike>`, but the Web Crypto lib.dom overloads want a
// `BufferSource` backed by a plain `ArrayBuffer`. Our arrays always are, so this assertion is safe.
const bs = (u: Uint8Array): BufferSource => u as BufferSource;

/** HKDF-SHA256 → `KEY_BYTES` of key material, matching node's `hkdfSync('sha256', seed, salt, info, KEY_BYTES)`. */
async function hkdf(seed: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const ikm = await subtle().importKey('raw', bs(seed), 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bs(salt), info: bs(utf8(info)) }, ikm, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

async function aesKey(seed: Uint8Array, salt: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const raw = await hkdf(seed, salt, 'lumina-sync-blob/v1');
  return subtle().importKey('raw', bs(raw), 'AES-GCM', false, [usage]);
}

/** A fresh, cryptographically-random 256-bit sync seed — the root of a new chain. */
export function generateSeed(): Uint8Array {
  return randomBytes(SEED_BYTES);
}

/** Encode a seed as the grouped Crockford-base32 recovery code (identical output to the Node core). */
export async function encodeSeed(seed: Uint8Array): Promise<string> {
  if (seed.length !== SEED_BYTES) throw new Error(`seed must be ${SEED_BYTES} bytes`);
  const checksum = new Uint8Array(await subtle().digest('SHA-256', bs(seed)))[0]!;
  const payload = new Uint8Array(SEED_BYTES + CHECKSUM_BYTES);
  payload.set(seed);
  payload[SEED_BYTES] = checksum;
  return (base32Encode(payload).match(/.{1,4}/g) ?? []).join('-');
}

/** Decode a recovery code back to a seed, or null if it isn't well-formed and checksum-valid. */
export async function decodeSeed(input: string): Promise<Uint8Array | null> {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned) return null;
  const raw = base32Decode(cleaned);
  if (!raw || raw.length < SEED_BYTES + CHECKSUM_BYTES) return null;
  const seed = raw.slice(0, SEED_BYTES);
  const expected = new Uint8Array(await subtle().digest('SHA-256', bs(seed)))[0]!;
  return raw[SEED_BYTES] === expected ? seed : null;
}

/** True if `input` is a valid, checksum-passing recovery code. */
export async function isValidSeed(input: string): Promise<boolean> {
  return (await decodeSeed(input)) !== null;
}

/** Public, non-secret chain identifier (a one-way hash of the seed) for LAN peer grouping. */
export async function chainId(seed: Uint8Array): Promise<string> {
  const derived = await hkdf(seed, new Uint8Array(SALT_BYTES), 'lumina-sync-chain-id/v1');
  return [...derived.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Encrypt with AES-256-GCM into `version || salt || iv || tag || ciphertext` (same layout as the Node core). */
export async function encrypt(seed: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await aesKey(seed, salt, 'encrypt');
  const params: AesGcmParams = { name: 'AES-GCM', iv: bs(iv), tagLength: TAG_BYTES * 8 };
  if (aad) params.additionalData = bs(aad);
  // Web Crypto returns ciphertext with the tag appended; split it so the tag sits before the ciphertext.
  const sealed = new Uint8Array(await subtle().encrypt(params, key, bs(plaintext)));
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const out = new Uint8Array(1 + SALT_BYTES + IV_BYTES + TAG_BYTES + ciphertext.length);
  let o = 0;
  out[o++] = FORMAT_VERSION;
  out.set(salt, o); o += SALT_BYTES;
  out.set(iv, o); o += IV_BYTES;
  out.set(tag, o); o += TAG_BYTES;
  out.set(ciphertext, o);
  return out;
}

/** Decrypt a blob from either core. Returns null on wrong seed / wrong-or-missing AAD / tamper / truncation. */
export async function decrypt(seed: Uint8Array, blob: Uint8Array, aad?: Uint8Array): Promise<Uint8Array | null> {
  const header = 1 + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (blob.length < header || blob[0] !== FORMAT_VERSION) return null;
  let o = 1;
  const salt = blob.subarray(o, (o += SALT_BYTES));
  const iv = blob.subarray(o, (o += IV_BYTES));
  const tag = blob.subarray(o, (o += TAG_BYTES));
  const ciphertext = blob.subarray(o);
  // Reassemble the ciphertext||tag layout Web Crypto expects.
  const sealed = new Uint8Array(ciphertext.length + TAG_BYTES);
  sealed.set(ciphertext);
  sealed.set(tag, ciphertext.length);
  try {
    const key = await aesKey(seed, salt, 'decrypt');
    const params: AesGcmParams = { name: 'AES-GCM', iv: bs(iv), tagLength: TAG_BYTES * 8 };
    if (aad) params.additionalData = bs(aad);
    return new Uint8Array(await subtle().decrypt(params, key, bs(sealed)));
  } catch {
    return null;
  }
}

/** Encrypt a JSON-serialisable value. */
export async function encryptJson(seed: Uint8Array, value: unknown, aad?: Uint8Array): Promise<Uint8Array> {
  return encrypt(seed, utf8(JSON.stringify(value)), aad);
}

/** Decrypt and JSON-parse a blob, or null if it can't be decrypted or parsed. */
export async function decryptJson<T>(seed: Uint8Array, blob: Uint8Array, aad?: Uint8Array): Promise<T | null> {
  const plain = await decrypt(seed, blob, aad);
  if (!plain) return null;
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

/** Challenge-response prover for LAN pairing — HMAC-SHA256 over the challenge with a seed-derived auth key. */
export async function authResponse(seed: Uint8Array, challenge: Uint8Array): Promise<Uint8Array> {
  const raw = await hkdf(seed, new Uint8Array(SALT_BYTES), 'lumina-sync-auth/v1');
  const key = await subtle().importKey('raw', bs(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', key, bs(challenge)));
}

/** Constant-time verify of an auth response. False on any mismatch or length difference. */
export async function authVerify(seed: Uint8Array, challenge: Uint8Array, response: Uint8Array): Promise<boolean> {
  const expected = await authResponse(seed, challenge);
  if (response.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ response[i]!;
  return diff === 0;
}
