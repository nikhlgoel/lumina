import { describe, it, expect } from 'vitest';
import {
  PORTABLE_APP_DIR, PORTABLE_VERSION_FILE, canInstall, describeInstallState, folderConflict, hasRoom,
  installState, looksLikeInstall, planInstall, roomNeeded, shouldCopyEntry,
} from '@core/portableInstall';
import { PORTABLE_DATA_DIR, PORTABLE_MARKER } from '@core/portableApp';

const join = (...p: string[]) => p.join('/').replace(/\/{2,}/g, '/');
const MB = 1024 * 1024;

describe('installState', () => {
  it('reports nothing there', () => {
    expect(installState({ appDirExists: false, version: null }, '3.0.0')).toBe('absent');
  });

  it('reports a matching build as current', () => {
    expect(installState({ appDirExists: true, version: '3.0.0' }, '3.0.0')).toBe('current');
  });

  it('reports a different build as outdated, in either direction', () => {
    expect(installState({ appDirExists: true, version: '2.9.0' }, '3.0.0')).toBe('outdated');
    // A newer copy on the drive is still "not what we are running" — never silently ignored.
    expect(installState({ appDirExists: true, version: '3.1.0' }, '3.0.0')).toBe('outdated');
  });

  it('says unknown for a folder with no version file rather than assuming', () => {
    expect(installState({ appDirExists: true, version: null }, '3.0.0')).toBe('unknown');
    expect(installState({ appDirExists: true, version: '   ' }, '3.0.0')).toBe('unknown');
  });

  it('ignores stray whitespace around a version', () => {
    expect(installState({ appDirExists: true, version: ' 3.0.0\n' }, '3.0.0')).toBe('current');
  });

  it('handles prerelease versions exactly, not loosely', () => {
    expect(installState({ appDirExists: true, version: '3.0.0-alpha.0' }, '3.0.0-alpha.0')).toBe('current');
    expect(installState({ appDirExists: true, version: '3.0.0-alpha.0' }, '3.0.0-alpha.1')).toBe('outdated');
  });
});

describe('describeInstallState', () => {
  it('promises that an update leaves the library alone', () => {
    expect(describeInstallState('outdated', '2.9.0')).toContain('leave your library');
  });

  it('warns plainly when there is no version file', () => {
    expect(describeInstallState('unknown', null)).toContain('overwrite');
  });

  it('always says something, for every state', () => {
    for (const state of ['absent', 'current', 'outdated', 'unknown'] as const) {
      expect(describeInstallState(state, '1.0.0').length, state).toBeGreaterThan(10);
    }
  });
});

describe('room', () => {
  it('asks for more than the raw size, since a filesystem needs slack', () => {
    expect(roomNeeded(100 * MB)).toBeGreaterThan(100 * MB);
  });

  it('accepts a drive with plenty of space and refuses one without', () => {
    expect(hasRoom(100 * MB, 500 * MB)).toBe(true);
    expect(hasRoom(100 * MB, 100 * MB)).toBe(false);
    expect(hasRoom(100 * MB, 0)).toBe(false);
  });

  it('refuses the exact-fit case, because an exactly full drive cannot be written', () => {
    const app = 200 * MB;
    expect(hasRoom(app, app)).toBe(false);
    expect(hasRoom(app, roomNeeded(app))).toBe(true);
  });
});

describe('planInstall', () => {
  const plan = planInstall('E:/', join);

  it('keeps the app in its own folder so the drive root stays the user’s', () => {
    expect(plan.appDir).toBe(`E:/${PORTABLE_APP_DIR}`);
  });

  it('puts the marker, data folder and version file inside that folder', () => {
    expect(plan.markerFile).toBe(`E:/${PORTABLE_APP_DIR}/${PORTABLE_MARKER}`);
    expect(plan.dataDir).toBe(`E:/${PORTABLE_APP_DIR}/${PORTABLE_DATA_DIR}`);
    expect(plan.versionFile).toBe(`E:/${PORTABLE_APP_DIR}/${PORTABLE_VERSION_FILE}`);
  });

  it('works for a drive with a deeper root', () => {
    expect(planInstall('D:/Sticks/Blue', join).appDir).toBe(`D:/Sticks/Blue/${PORTABLE_APP_DIR}`);
  });
});

describe('shouldCopyEntry', () => {
  it('never copies the user’s data folder — an update must not touch the library', () => {
    expect(shouldCopyEntry(PORTABLE_DATA_DIR)).toBe(false);
    expect(shouldCopyEntry(PORTABLE_DATA_DIR.toUpperCase())).toBe(false);
  });

  it('never copies the marker or version file, which are written fresh at the end', () => {
    expect(shouldCopyEntry(PORTABLE_MARKER)).toBe(false);
    expect(shouldCopyEntry(PORTABLE_VERSION_FILE)).toBe(false);
  });

  it('skips crash dumps and logs from the machine being copied from', () => {
    expect(shouldCopyEntry('Crashpad')).toBe(false);
    expect(shouldCopyEntry('logs')).toBe(false);
  });

  it('copies the things that make the app work', () => {
    for (const name of ['Lumina.exe', 'resources', 'locales', 'ffmpeg.dll', 'chrome_100_percent.pak']) {
      expect(shouldCopyEntry(name), name).toBe(true);
    }
  });
});

describe('canInstall', () => {
  const base = { packaged: true, driveRoot: 'E:/', appBytes: 700 * MB, freeBytes: 4000 * MB, writable: true };

  it('allows a normal case', () => {
    expect(canInstall(base)).toEqual({ ok: true });
  });

  it('refuses a development build, which is not self-contained', () => {
    const r = canInstall({ ...base, packaged: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('installed Lumina');
  });

  it('refuses with no drive selected', () => {
    expect(canInstall({ ...base, driveRoot: '' }).ok).toBe(false);
    expect(canInstall({ ...base, driveRoot: '   ' }).ok).toBe(false);
  });

  it('refuses a read-only drive', () => {
    const r = canInstall({ ...base, writable: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('read-only');
  });

  it('refuses when the app could not be measured, rather than copying nothing', () => {
    expect(canInstall({ ...base, appBytes: 0 }).ok).toBe(false);
    expect(canInstall({ ...base, appBytes: -1 }).ok).toBe(false);
  });

  it('refuses a full drive and says how much is needed', () => {
    const r = canInstall({ ...base, freeBytes: 100 * MB });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('Not enough room');
      expect(r.reason).toMatch(/\d+ MB is needed/);
      expect(r.reason).toMatch(/\d+ MB is free/);
    }
  });

  it('checks the development build first, so the message is the most useful one', () => {
    const r = canInstall({ ...base, packaged: false, writable: false, freeBytes: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('development build');
  });
});

describe('folderConflict — the real stick that started this', () => {
  it('recognises a folder Lumina actually put there', () => {
    expect(looksLikeInstall([PORTABLE_VERSION_FILE, 'Lumina.exe'])).toBe(true);
    expect(looksLikeInstall([PORTABLE_MARKER])).toBe(true);
    expect(looksLikeInstall(['Lumina.exe', 'resources'])).toBe(true);
  });

  it('does NOT mistake a user’s own media folder for an install', () => {
    // Exactly what was on the test machine's USB stick: F:\Lumina with the owner's music in it.
    expect(looksLikeInstall(['English Songs', 'Videos'])).toBe(false);
    expect(folderConflict(true, ['English Songs', 'Videos'])).toBe(true);
  });

  it('allows an empty folder and a folder that is not there at all', () => {
    expect(folderConflict(true, [])).toBe(false);
    expect(folderConflict(false, ['anything'])).toBe(false);
  });

  it('refuses to install over someone’s files, and says what to do', () => {
    const r = canInstall({
      packaged: true, driveRoot: 'F:/', appBytes: 700 * MB, freeBytes: 20_000 * MB, writable: true,
      destExists: true, destEntries: ['English Songs', 'Videos'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('your own files');
      expect(r.reason).toContain('Rename or move it');
    }
  });

  it('still allows an update over a genuine older install', () => {
    expect(canInstall({
      packaged: true, driveRoot: 'F:/', appBytes: 700 * MB, freeBytes: 20_000 * MB, writable: true,
      destExists: true, destEntries: [PORTABLE_VERSION_FILE, 'Lumina.exe', 'resources'],
    })).toEqual({ ok: true });
  });

  it('is case-insensitive, because Windows is', () => {
    expect(looksLikeInstall(['LUMINA.EXE'])).toBe(true);
    expect(looksLikeInstall([PORTABLE_VERSION_FILE.toUpperCase()])).toBe(true);
  });
});
