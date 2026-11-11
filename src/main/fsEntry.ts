import fs from 'node:fs';
import path from 'node:path';
import { entryKind, type EntryKind } from '../core/walkEntry';

/** What a listed entry of `dir` is, looking through a link to what it points at (see core/walkEntry.ts). */
export const kindOfEntry = (dir: string, entry: fs.Dirent): EntryKind =>
  entryKind(entry, () => {
    try {
      return fs.statSync(path.join(dir, entry.name));
    } catch {
      return null; // a link to nowhere, or something that cannot be read
    }
  });
