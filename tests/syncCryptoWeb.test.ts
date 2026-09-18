import { describe, it, expect } from 'vitest';
import * as node from '@core/syncCrypto';
import * as web from '@core/syncCryptoWeb';

// These tests are the contract between the desktop (node:crypto) and Android/LuminaBr (Web Crypto) cores:
// if they ever drift, cross-device sync silently breaks, so we assert byte-level interop directly.

describe('syncCryptoWeb — self round-trips', () => {
  it('encrypts and decrypts its own blob', async () => {
    const seed = web.generateSeed();
    const plain = new TextEncoder().encode('phone-side secret');
    const blob = await web.encrypt(seed, plain);
    expect(new Uint8Array((await web.decrypt(seed, blob))!)).toEqual(plain);
  });

  it('round-trips its own recovery code', async () => {
    const seed = web.generateSeed();
    const decoded = await web.decodeSeed(await web.encodeSeed(seed));
    expect(decoded).not.toBeNull();
    expect(Buffer.from(decoded!)).toEqual(Buffer.from(seed));
  });

  it('round-trips JSON', async () => {
    const seed = web.generateSeed();
    const value = { likes: ['a', 'b'], v: 2 };
    expect(await web.decryptJson(seed, await web.encryptJson(seed, value))).toEqual(value);
  });

  it('rejects a wrong seed and a tampered blob', async () => {
    const seed = web.generateSeed();
    const blob = await web.encrypt(seed, new TextEncoder().encode('x'));
    expect(await web.decrypt(web.generateSeed(), blob)).toBeNull();
    const tampered = Uint8Array.from(blob);
    const last = tampered.length - 1;
    tampered[last] = tampered[last]! ^ 0xff;
    expect(await web.decrypt(seed, tampered)).toBeNull();
  });
});

describe('syncCryptoWeb ↔ syncCrypto interop (PC ⇄ Android)', () => {
  const seed = node.generateSeed();
  const message = new TextEncoder().encode('cross-device payload: cookie=secret');

  it('desktop can decrypt a blob the phone encrypted', async () => {
    const fromPhone = await web.encrypt(seed, message);
    expect(new Uint8Array(node.decrypt(seed, fromPhone)!)).toEqual(message);
  });

  it('the phone can decrypt a blob the desktop encrypted', async () => {
    const fromPc = node.encrypt(seed, message);
    expect(new Uint8Array((await web.decrypt(seed, fromPc))!)).toEqual(message);
  });

  it('AAD binding is honoured across cores', async () => {
    const aad = new TextEncoder().encode('cookie');
    const fromPhone = await web.encrypt(seed, message, aad);
    expect(node.decrypt(seed, fromPhone, aad)).not.toBeNull();
    expect(node.decrypt(seed, fromPhone, new TextEncoder().encode('bookmark'))).toBeNull();
    expect(node.decrypt(seed, fromPhone)).toBeNull();
  });

  it('both cores produce the same recovery code for a seed', async () => {
    expect(await web.encodeSeed(seed)).toBe(node.encodeSeed(seed));
  });

  it('a recovery code from one core decodes on the other', async () => {
    const code = node.encodeSeed(seed);
    const onPhone = await web.decodeSeed(code);
    expect(onPhone).not.toBeNull();
    expect(Buffer.from(onPhone!)).toEqual(Buffer.from(seed));
  });

  it('both cores derive the same chainId', async () => {
    expect(await web.chainId(seed)).toBe(node.chainId(seed));
  });

  it('a challenge answered by one core verifies on the other (LAN pairing)', async () => {
    const challenge = node.generateSeed();
    const phoneAnswer = await web.authResponse(seed, challenge);
    expect(node.authVerify(seed, challenge, phoneAnswer)).toBe(true);

    const pcAnswer = node.authResponse(seed, challenge);
    expect(await web.authVerify(seed, challenge, pcAnswer)).toBe(true);
    expect(await web.authVerify(web.generateSeed(), challenge, pcAnswer)).toBe(false);
  });

  it('a JSON document written by the desktop decrypts and parses on the phone', async () => {
    const doc = { v: 1, records: [{ id: 'a', type: 'like', payload: 1, updatedAt: 5, deviceId: 'pc', deleted: false }] };
    const blob = node.encryptJson(seed, doc);
    expect(await web.decryptJson(seed, blob)).toEqual(doc);
  });
});
