import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths';
import { logger } from './log';

const log = logger('secrets');
const file = (name: string) => path.join(dataDir(), 'accounts', `${name}.bin`);

/** Store small secrets (tokens) encrypted with the OS keychain (DPAPI on Windows, Keychain, libsecret). */
export function saveSecret(name: string, value: unknown) {
  const json = JSON.stringify(value);
  fs.mkdirSync(path.dirname(file(name)), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('OS encryption unavailable; not persisting secret', { name });
    return;
  }
  fs.writeFileSync(file(name), safeStorage.encryptString(json), { mode: 0o600 });
}

export function loadSecret<T>(name: string): T | null {
  try {
    if (!fs.existsSync(file(name)) || !safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file(name)))) as T;
  } catch (err) {
    log.warn(`Could not read secret ${name}`, err);
    return null;
  }
}

export function deleteSecret(name: string) {
  fs.rmSync(file(name), { force: true });
}
