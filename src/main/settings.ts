import { app } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { mergeSettings, settingsSchema, type Settings, type SettingsPatch } from '../shared/settings';
import { settingsFile } from './paths';
import { logger } from './log';

const log = logger('settings');

function withOsDefaults(s: Settings): Settings {
  const storage = { ...s.storage };
  const lumina = (dir: string) => path.join(dir, 'Lumina');
  if (!storage.musicDir) storage.musicDir = lumina(app.getPath('music'));
  if (!storage.videoDir) storage.videoDir = lumina(app.getPath('videos'));
  if (!storage.seriesDir) storage.seriesDir = path.join(storage.videoDir, 'Series');
  if (!storage.otherDir) storage.otherDir = lumina(app.getPath('downloads'));
  if (!storage.libraryRoots.length) {
    storage.libraryRoots = [app.getPath('music'), app.getPath('videos')];
  }
  return { ...s, storage };
}

class SettingsStore extends EventEmitter<{ changed: [Settings] }> {
  private current: Settings = withOsDefaults(settingsSchema.parse({}));

  load(): Settings {
    try {
      const raw = fs.existsSync(settingsFile()) ? JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) : {};
      this.current = withOsDefaults(settingsSchema.parse(raw));
    } catch (err) {
      log.warn('Settings file unreadable; using defaults', err);
      this.current = withOsDefaults(settingsSchema.parse({}));
    }
    return this.current;
  }

  get(): Settings {
    return this.current;
  }

  update(patch: SettingsPatch): Settings {
    return this.replace(mergeSettings(this.current, patch));
  }

  /** Replace everything (import), re-validating so a hand-edited file can't break the app. */
  replace(next: unknown): Settings {
    this.current = withOsDefaults(settingsSchema.parse(next));
    this.persist();
    this.emit('changed', this.current);
    return this.current;
  }

  /** Reset one section, or everything except saved folders. */
  reset(section?: string): Settings {
    const defaults = settingsSchema.parse({});
    if (section && section in defaults && section !== 'version') {
      return this.replace({ ...this.current, [section]: defaults[section as keyof Settings] });
    }
    return this.replace({ ...defaults, storage: this.current.storage });
  }

  private persist() {
    const file = settingsFile();
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.current, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      log.error('Could not save settings', err);
    }
  }
}

export const settings = new SettingsStore();
