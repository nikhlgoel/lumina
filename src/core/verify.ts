// Pure helpers for checking a finished download: did we get the real file, and does it match its checksum?

export type HashAlgo = 'md5' | 'sha1' | 'sha256' | 'sha512' | 'crc32';

export interface ChecksumEntry {
  algo: HashAlgo;
  hash: string;
}

const SIGNATURES: { ext: RegExp; magic: number[][]; offset?: number }[] = [
  { ext: /\.(rar|part\d+\.rar)$/i, magic: [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]] },
  { ext: /\.(7z|7z\.001)$/i, magic: [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]] },
  { ext: /\.(zip|apk|jar|docx|xlsx|pptx)$/i, magic: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]] },
  { ext: /\.(gz|tgz)$/i, magic: [[0x1f, 0x8b]] },
  { ext: /\.xz$/i, magic: [[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]] },
  { ext: /\.zst$/i, magic: [[0x28, 0xb5, 0x2f, 0xfd]] },
  { ext: /\.(exe|dll|msi)$/i, magic: [[0x4d, 0x5a], [0xd0, 0xcf, 0x11, 0xe0]] },
  { ext: /\.pdf$/i, magic: [[0x25, 0x50, 0x44, 0x46]] },
  { ext: /\.png$/i, magic: [[0x89, 0x50, 0x4e, 0x47]] },
];

const BINARY_EXT = /\.(rar|7z|zip|gz|tgz|xz|zst|bz2|tar|iso|img|bin|exe|msi|dll|apk|dmg|pkg|deb|rpm|appimage|mp4|mkv|webm|mov|avi|mp3|flac|m4a|ogg|opus|wav|pdf|png|jpe?g|webp|\d{3})$/i;

/** Bytes needed from the start of a file for `checkHeader`. */
export const HEADER_BYTES = 512;

/**
 * Check the first bytes of a finished file. Catches the most common "corrupt" download:
 * a server or file host sending an HTML page (login, captcha, expired link) instead of the file.
 */
export function checkHeader(filename: string, head: Uint8Array): { ok: true } | { ok: false; reason: string } {
  if (!BINARY_EXT.test(filename) || head.length === 0) return { ok: true };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, 256)).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (/^(<!doctype html|<html|<head|<body|<script|<\?xml|\{\s*"(error|status|message)")/.test(text)) {
    return { ok: false, reason: 'The server sent a web page instead of the file (the link may need a browser, a login or has expired).' };
  }
  const sig = SIGNATURES.find((s) => s.ext.test(filename));
  if (!sig) return { ok: true };
  const matches = sig.magic.some((m) => m.every((b, i) => head[(sig.offset ?? 0) + i] === b));
  return matches ? { ok: true } : { ok: false, reason: 'The file is damaged: its contents don’t match its type.' };
}

function algoFromFile(file: string, hashLength: number): HashAlgo | null {
  const f = file.toLowerCase();
  if (f.endsWith('.sfv')) return 'crc32';
  if (f.includes('sha512')) return 'sha512';
  if (f.includes('sha256')) return 'sha256';
  if (f.includes('sha1')) return 'sha1';
  if (f.includes('md5')) return 'md5';
  return ({ 8: 'crc32', 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' } as Record<number, HashAlgo>)[hashLength] ?? null;
}

/** Normalise a manifest path ("folder\\file.rar", "*file.rar") to a lower-case file name for lookup. */
export function manifestKey(name: string): string {
  return name.replace(/^\*/, '').split(/[\\/]/).pop()!.trim().toLowerCase();
}

/**
 * Parse .md5 / .sha1 / .sha256 / SHA256SUMS ("hash  name" or "hash *name"), BSD style
 * ("SHA256 (name) = hash") and .sfv ("name crc32") files.
 */
export function parseChecksumManifest(manifestName: string, text: string): Map<string, ChecksumEntry> {
  return new Map(parseChecksumEntries(manifestName, text).map((e) => [manifestKey(e.name), { algo: e.algo, hash: e.hash }]));
}

/** Every entry with the path exactly as the manifest wrote it (relative paths, sub-folders). */
export function parseChecksumEntries(manifestName: string, text: string): (ChecksumEntry & { name: string })[] {
  const out: (ChecksumEntry & { name: string })[] = [];
  const sfv = manifestName.toLowerCase().endsWith('.sfv');
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    let name: string | undefined;
    let hash: string | undefined;
    let m = line.match(/^(MD5|SHA1|SHA256|SHA512)\s*\((.+)\)\s*=\s*([0-9a-f]+)$/i);
    if (m) {
      name = m[2];
      hash = m[3];
    } else if (sfv) {
      m = line.match(/^(.+?)\s+([0-9a-f]{8})$/i);
      if (m) [name, hash] = [m[1], m[2]];
    } else {
      m = line.match(/^([0-9a-f]{8,128})\s+\*?(.+)$/i);
      if (m) [hash, name] = [m[1], m[2]];
    }
    if (!name || !hash) continue;
    const algo = sfv ? 'crc32' : algoFromFile(manifestName, hash.length);
    if (algo) out.push({ name: name.replace(/^\*/, '').trim(), algo, hash: hash.toLowerCase() });
  }
  return out;
}
