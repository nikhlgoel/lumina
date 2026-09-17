// Pure helpers for unpacking downloaded archives with 7-Zip (7z.exe / 7zz).

export interface ArchiveListing {
  /** Uncompressed size of everything inside, for the free-space check. */
  totalBytes: number;
  files: number;
  encrypted: boolean;
}

/** Parse `7z l -slt` output. File blocks follow the archive header block after a "----------" line. */
export function parseListing(stdout: string): ArchiveListing {
  const body = stdout.split(/^-{10,}\s*$/m).slice(1).join('\n');
  let totalBytes = 0;
  let files = 0;
  let encrypted = false;
  for (const block of body.split(/\r?\n\r?\n/)) {
    if (!/^Path = /m.test(block)) continue;
    if (/^Folder = \+$/m.test(block) || /^Attributes = D/m.test(block)) continue;
    files++;
    totalBytes += Number(block.match(/^Size = (\d+)$/m)?.[1] ?? 0);
    if (/^Encrypted = \+$/m.test(block)) encrypted = true;
  }
  return { totalBytes, files, encrypted };
}

/** Latest percentage from 7-Zip's `-bsp1` progress stream (" 42% 13 - file.bin", with backspaces). */
export function parseProgress(chunk: string): number | null {
  const all = [...chunk.matchAll(/(\d{1,3})%/g)];
  const last = all[all.length - 1];
  if (!last) return null;
  const n = Number(last[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** Turn 7-Zip's exit code and error output into something a person can act on. */
export function unpackError(code: number | null, stderr: string): string {
  const e = stderr.toLowerCase();
  const volume = stderr.match(/Missing volume\s*:\s*(.+)/i)?.[1]?.trim();
  if (volume) return `A part of the archive is missing: ${volume.split(/[\\/]/).pop()}. Download it, then retry unpacking.`;
  if (e.includes('wrong password') || e.includes('encrypted')) return 'The archive is password-protected. Unpack it manually with its password.';
  if (e.includes('crc failed') || e.includes('data error') || e.includes('checksum error')) {
    return 'Part of the archive is damaged (checksum failed while unpacking). Retry the downloaded parts, then unpack again.';
  }
  if (e.includes('unexpected end of archive') || e.includes('there are some data after the end')) {
    return 'An archive part is incomplete. Retry the parts that failed verification, then unpack again.';
  }
  if (e.includes('cannot open the file as archive') || e.includes('can not open the file as archive')) {
    return 'The first part isn’t a readable archive. It may be damaged or not an archive at all.';
  }
  if (e.includes('there is not enough space') || e.includes('disk full')) return 'The disk is full.';
  if (code === 8) return 'Not enough memory to unpack this archive.';
  return `Unpacking failed (7-Zip exit code ${code ?? 'unknown'}).`;
}

/** The folder a repack's installer lives in: the shallowest folder holding setup.exe (or install.exe). */
export function installerIn(paths: string[]): string | null {
  const setups = paths
    .filter((p) => /(^|[\\/])(setup|install(er)?)\.exe$/i.test(p))
    .sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length);
  return setups[0] ?? null;
}
