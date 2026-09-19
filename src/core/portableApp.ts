// Running Lumina *from* a USB stick, rather than exporting media *to* one.
//
// (src/core/portable.ts is the other thing: the folder layout Lumina writes onto a drive. This file
// decides whether the app itself is running portably, and where its data should live.)
//
// The whole feature is one decision: where does userData go? Normally it is in AppData on the PC,
// which is exactly wrong for a stick you carry between machines — your library, settings and
// playlists would be left behind on whichever computer you last used. In portable mode it goes in a
// folder next to the executable, on the drive.
//
// Pure, with the filesystem injected, so every branch can be tested without a USB stick.

/** Where a portable install keeps everything, relative to the executable. */
export const PORTABLE_DATA_DIR = 'Lumina-Data';

/**
 * Dropping this file next to the executable turns portable mode on.
 *
 * It exists for the copy-the-folder case: someone who copies an unpacked Lumina onto a drive has no
 * `PORTABLE_EXECUTABLE_DIR`, and should not have to run an installer to get portable behaviour.
 */
export const PORTABLE_MARKER = 'lumina-portable.txt';

export interface PortableProbe {
  /**
   * `PORTABLE_EXECUTABLE_DIR` — electron-builder sets this for its portable target, to the folder
   * the .exe was launched from. On a USB stick that is the stick.
   */
  portableExecutableDir?: string | undefined;
  /** `LUMINA_PORTABLE` — an explicit override, used by tests and by anyone with an unusual layout. */
  override?: string | undefined;
  /** Folder holding the running executable. */
  execDir: string;
  exists: (path: string) => boolean;
  join: (...parts: string[]) => string;
}

/**
 * The folder a portable install lives in, or null when this is an ordinary installed copy.
 *
 * Order matters: an explicit override beats everything, then electron-builder's own signal, then
 * the marker file or an existing data folder beside the executable.
 */
export function portableBase(probe: PortableProbe): string | null {
  const override = (probe.override ?? '').trim();
  if (override) return override;

  const fromBuilder = (probe.portableExecutableDir ?? '').trim();
  if (fromBuilder) return fromBuilder;

  const dir = (probe.execDir ?? '').trim();
  if (!dir) return null;
  if (probe.exists(probe.join(dir, PORTABLE_MARKER))) return dir;
  // An existing data folder means this copy has already been run portably before.
  if (probe.exists(probe.join(dir, PORTABLE_DATA_DIR))) return dir;
  return null;
}

/** Where userData should point, or null to leave Electron's default alone. */
export function portableDataPath(probe: PortableProbe): string | null {
  const base = portableBase(probe);
  return base === null ? null : probe.join(base, PORTABLE_DATA_DIR);
}

export const isPortable = (probe: PortableProbe): boolean => portableBase(probe) !== null;
