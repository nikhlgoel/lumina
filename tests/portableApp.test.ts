import { describe, it, expect } from 'vitest';
import {
  PORTABLE_DATA_DIR, PORTABLE_MARKER, isPortable, portableBase, portableDataPath,
  type PortableProbe,
} from '@core/portableApp';

/** A probe with a fake filesystem: only the listed paths exist. */
const probe = (over: Partial<PortableProbe> & { present?: string[] } = {}): PortableProbe => {
  const present = new Set(over.present ?? []);
  return {
    execDir: over.execDir ?? 'C:/Program Files/Lumina',
    portableExecutableDir: over.portableExecutableDir,
    override: over.override,
    exists: (p) => present.has(p),
    // Collapses repeated separators the way node's path.join does, so 'E:/' + 'x' is 'E:/x'.
    join: (...parts) => parts.join('/').replace(/\/{2,}/g, '/'),
  };
};

describe('portableBase', () => {
  it('is null for an ordinary installed copy', () => {
    expect(portableBase(probe())).toBeNull();
    expect(isPortable(probe())).toBe(false);
  });

  it('uses electron-builder’s PORTABLE_EXECUTABLE_DIR, which is the stick', () => {
    expect(portableBase(probe({ portableExecutableDir: 'E:/' }))).toBe('E:/');
  });

  it('turns on when the marker file sits beside the executable', () => {
    const p = probe({ execDir: 'E:/Lumina', present: [`E:/Lumina/${PORTABLE_MARKER}`] });
    expect(portableBase(p)).toBe('E:/Lumina');
  });

  it('turns on when a data folder from a previous portable run is already there', () => {
    const p = probe({ execDir: 'E:/Lumina', present: [`E:/Lumina/${PORTABLE_DATA_DIR}`] });
    expect(portableBase(p)).toBe('E:/Lumina');
  });

  it('lets an explicit override win over everything else', () => {
    const p = probe({
      override: 'D:/Chosen',
      portableExecutableDir: 'E:/',
      execDir: 'E:/Lumina',
      present: [`E:/Lumina/${PORTABLE_MARKER}`],
    });
    expect(portableBase(p)).toBe('D:/Chosen');
  });

  it('prefers the builder signal over a marker file', () => {
    const p = probe({ portableExecutableDir: 'E:/', execDir: 'C:/Apps', present: [`C:/Apps/${PORTABLE_MARKER}`] });
    expect(portableBase(p)).toBe('E:/');
  });

  it('ignores blank and whitespace-only values rather than treating them as a directory', () => {
    expect(portableBase(probe({ override: '   ', portableExecutableDir: '' }))).toBeNull();
    expect(portableBase(probe({ portableExecutableDir: '  ' }))).toBeNull();
  });

  it('trims a value that has stray spaces around it', () => {
    expect(portableBase(probe({ override: '  D:/Stick  ' }))).toBe('D:/Stick');
  });

  it('returns null when there is no executable directory to work from', () => {
    expect(portableBase(probe({ execDir: '' }))).toBeNull();
  });
});

describe('portableDataPath', () => {
  it('puts the data folder beside the executable, on the drive', () => {
    expect(portableDataPath(probe({ portableExecutableDir: 'E:/' }))).toBe(`E:/${PORTABLE_DATA_DIR}`);
  });

  it('is null for an installed copy, so Electron keeps its own default', () => {
    expect(portableDataPath(probe())).toBeNull();
  });

  it('follows the override', () => {
    expect(portableDataPath(probe({ override: 'D:/Stick' }))).toBe(`D:/Stick/${PORTABLE_DATA_DIR}`);
  });
});
