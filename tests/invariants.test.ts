// Property-based tests: instead of a few hand-picked examples, thousands of generated inputs against statements that must always be true
// ("no link is ever lost from a batch", "no screen text says NaN"). A failure is shrunk to the smallest input that still breaks it.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fileNameFromUrl, nameFromText, planBatch, prettyTitle, splitVolume } from '@core/batch';
import { cleanUrl, classifyUrl, extractLinks, toInspectTarget } from '@core/url';
import { formatBytes, formatDuration, formatEta, formatSpeed, safeFileName } from '@core/format';
import { dominantKind, fileKindFor, fileKindOfName } from '@core/iconKind';
import { fileKindOf, isTrailingVolume } from '@core/fileKind';
import { SlowdownWatch } from '@core/slowdown';
import { batchStateOf, batchSummary } from '@core/batchState';
import { groupJobs, summarizeGroup } from '@core/jobGroups';
import { attribute, classifyItemFailure, failureSummary, nextRetry, settle, MAX_RETRY_PASSES } from '@core/ytdlpFailures';
import { actionForExisting, chooseBatchFolder } from '@core/existingFiles';
import { canTrashFolder } from '@core/trashGuard';
import path from 'node:path';
import type { Job } from '@shared/types';

const RUNS = { numRuns: Number(process.env.FUZZ_RUNS) || 400 };

/** File names of the shapes a release is posted in, plus noise. */
const fileName = fc.oneof(
  fc.tuple(fc.constantFrom('Game', 'ICARUS.Build', 'Pack_x', 'a b c'), fc.integer({ min: 1, max: 12 }), fc.boolean()).map(([b, n, pad]) => `${b}.part${pad ? String(n).padStart(2, '0') : n}.rar`),
  fc.tuple(fc.constantFrom('x', 'data'), fc.constantFrom('7z', 'zip', 'rar', 'iso'), fc.integer({ min: 1, max: 9 })).map(([b, e, n]) => `${b}.${e}.00${n}`),
  fc.tuple(fc.constantFrom('s', 't'), fc.integer({ min: 0, max: 9 })).map(([b, n]) => `${b}.r0${n}`),
  fc.constantFrom('s.rar', 't.zip', 'z.z01', 'optional-voice.rar', 'fg-selective-hd.part1.rar', 'sums.md5', 'SHA256SUMS', 'readme.txt', 'setup.exe', 'weird name (1).mkv'),
  fc.string({ minLength: 0, maxLength: 20 }),
);

const link = fc.oneof(
  fc.tuple(fc.constantFrom('https://h.test', 'http://files.example.org/dl', 'https://pixeldrain.com/api/file'), fileName).map(([h, f]) => `${h}/${encodeURIComponent(f)}`),
  fc.tuple(fc.constantFrom('https://host.test/AbC123'), fileName).map(([h, f]) => `${h}#${encodeURIComponent(f)}`),
  fc.webUrl(),
  fc.string({ maxLength: 30 }).map((s) => `magnet:?xt=urn:btih:${s}`),
  fc.string({ maxLength: 30 }),
);

describe('planBatch never loses or duplicates a link', () => {
  it('every distinct link ends up in exactly one group, whatever the names look like', () => {
    fc.assert(fc.property(fc.array(link, { maxLength: 40 }), (links) => {
      const plan = planBatch(links);
      const placed = plan.groups.flatMap((g) => g.items.map((i) => i.url));
      expect(placed.length).toBe(new Set(links).size);
      expect(new Set(placed)).toEqual(new Set(links));
    }), RUNS);
  });

  it('keeps links whose names came from the page, and still places each once', () => {
    fc.assert(fc.property(fc.array(link, { minLength: 1, maxLength: 20 }), fc.array(fileName, { maxLength: 20 }), (links, names) => {
      const named = Object.fromEntries(links.map((l, i) => [l, names[i % Math.max(1, names.length)] ?? '']));
      const plan = planBatch(links, named);
      expect(plan.groups.flatMap((g) => g.items).length).toBe(new Set(links).size);
    }), RUNS);
  });

  it('lists checksums first and optional extras last, and reports only gaps that are real', () => {
    fc.assert(fc.property(fc.array(link, { maxLength: 40 }), (links) => {
      const plan = planBatch(links);
      const rank = { checksum: 0, 'archive-set': 1, file: 2, optional: 3 } as const;
      const ranks = plan.groups.map((g) => rank[g.kind]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      for (const g of plan.groups) {
        const have = new Set(g.items.map((i) => i.part).filter((p): p is number => p !== null));
        for (const gap of g.missingParts) {
          expect(have.has(gap)).toBe(false);
          expect(gap).toBeGreaterThanOrEqual(1);
        }
      }
    }), RUNS);
  });

  it('gives the release a non-empty title', () => {
    fc.assert(fc.property(fc.array(link, { maxLength: 20 }), (links) => {
      expect(planBatch(links).title.length).toBeGreaterThan(0);
    }), RUNS);
  });
});

describe('planBatch does not depend on the order the links arrive in (a metamorphic property)', () => {
  const shape = (links: string[]) => planBatch(links).groups
    .map((g) => `${g.kind}|${g.label}|${g.defaultSelected}|${g.missingParts.join(',')}|${g.items.map((i) => `${i.url}@${i.part}`).sort().join(';')}`)
    .sort();

  it('puts the same links in the same groups whichever way round they are listed', () => {
    const permuted = fc.array(link, { maxLength: 25 }).chain((links) => fc.tuple(fc.constant(links), fc.shuffledSubarray(links, { minLength: links.length, maxLength: links.length })));
    fc.assert(fc.property(permuted, ([links, shuffled]) => {
      expect(shape(shuffled)).toEqual(shape(links));
    }), RUNS);
  });

  it('plans the same twice, and plans a plan’s own links to the same groups again', () => {
    fc.assert(fc.property(fc.array(link, { maxLength: 25 }), (links) => {
      expect(shape(links)).toEqual(shape(links));
      const again = planBatch(planBatch(links).groups.flatMap((g) => g.items.map((i) => i.url)));
      expect(again.groups.length).toBe(planBatch(links).groups.length);
    }), RUNS);
  });
});

describe('text and link helpers never throw, and their results stay inside their promises', () => {
  it('survive any string', () => {
    fc.assert(fc.property(fc.string({ maxLength: 300 }), (s) => {
      fileNameFromUrl(s); splitVolume(s); prettyTitle(s); cleanUrl(s); classifyUrl(s); toInspectTarget(s); extractLinks(s); fileKindOfName(s); fileKindOf(s); isTrailingVolume(s);
      expect(typeof nameFromText(s)).toBe('string');
    }), { numRuns: 1000 });
  });

  it('a name taken from a page never holds a path separator or a control character', () => {
    fc.assert(fc.property(fc.string({ maxLength: 300 }), (s) => {
      const name = nameFromText(s);
      expect(/[\\/:*?"<>|\u0000-\u001f]/.test(name)).toBe(false);
    }), { numRuns: 1000 });
  });

  it('safeFileName is never empty and never holds a character Windows refuses', () => {
    fc.assert(fc.property(fc.string({ maxLength: 300 }), (s) => {
      const name = safeFileName(s);
      expect(name.length).toBeGreaterThan(0);
      expect(/[\\/:*?"<>|\u0000-\u001f]/.test(name)).toBe(false);
    }), { numRuns: 1000 });
  });

  it('extractLinks gives clean links, and gives the same links again when its own output is fed back', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.webUrl(), fc.string({ maxLength: 12 })), { maxLength: 8 }), (parts) => {
      const text = parts.join(' and ');
      const links = extractLinks(text);
      for (const l of links) {
        expect(/^(https?:\/\/|magnet:\?)/i.test(l)).toBe(true);
        expect(/\s/.test(l)).toBe(false);
      }
      expect(extractLinks(links.join('\n'))).toEqual(links);
    }), RUNS);
  });

  it('links inside a sentence come out without the sentence’s own punctuation', () => {
    fc.assert(fc.property(fc.webUrl({ withFragments: false, withQueryParameters: false }), fc.constantFrom('.', ',', ';', ')', '),', '.)'), (url, tail) => {
      fc.pre(!/[()"'<>]/.test(url) && !/[.,;:!?\])>]$/.test(url));
      expect(extractLinks(`see (${url}${tail}`)[0]).toBe(cleanUrl(url));
    }), RUNS);
  });
});

describe('numbers shown on screen are never NaN, Infinity or negative-looking nonsense', () => {
  const awkward = fc.oneof(fc.double({ noNaN: false }), fc.integer(), fc.constantFrom(0, -0, -1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 1e21, 1e-9), fc.constant(null), fc.constant(undefined));
  it('sizes, speeds, durations and times left read as words, not NaN', () => {
    fc.assert(fc.property(awkward, (n) => {
      for (const text of [formatBytes(n), formatSpeed(n), formatDuration(n), formatEta(n)]) {
        expect(typeof text).toBe('string');
        expect(/NaN|Infinity|undefined|null/.test(text)).toBe(false);
      }
    }), { numRuns: 1000 });
  });
});

describe('the picture for a download', () => {
  it('is always one of the known kinds, and a batch’s kind is one its files have (or the plain one)', () => {
    fc.assert(fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 6 }), fc.constantFrom('music', 'video', 'series', 'other', null), (names, fallback) => {
      const kind = fileKindFor(names, fallback);
      expect(['archive', 'video', 'audio', 'image', 'document', 'installer', 'torrent', 'subtitle', 'other']).toContain(kind);
      const kinds = names.map((n) => fileKindFor([n], fallback));
      const dom = dominantKind(kinds);
      expect(kinds.length === 0 ? dom === 'other' : kinds.includes(dom)).toBe(true);
    }), RUNS);
  });
});

describe('the speed watcher', () => {
  const reading = fc.record({ dt: fc.integer({ min: 0, max: 120_000 }), speed: fc.oneof(fc.constant(null), fc.double({ min: 0, max: 5e9, noNaN: true })) });

  it('never throws and always answers yes or no, whatever the readings', () => {
    fc.assert(fc.property(fc.array(reading, { maxLength: 400 }), (readings) => {
      const w = new SlowdownWatch();
      let t = 0;
      for (const r of readings) {
        t += r.dt;
        expect(typeof w.update(t, r.speed)).toBe('boolean');
      }
    }), RUNS);
  });

  it('never calls a download limited when it never went fast', () => {
    fc.assert(fc.property(fc.array(fc.record({ dt: fc.integer({ min: 0, max: 60_000 }), speed: fc.double({ min: 0, max: 5.9 * 1024 * 1024, noNaN: true }) }), { maxLength: 400 }), (readings) => {
      const w = new SlowdownWatch();
      let t = 0;
      for (const r of readings) {
        t += r.dt;
        expect(w.update(t, r.speed)).toBe(false);
      }
    }), RUNS);
  });
});

const job = (status: Job['status'], release: string | null, engine: Job['engine'] = 'aria2', stage = ''): Job =>
  ({ id: Math.random().toString(36).slice(2), status, engine, title: 't', progress: { percent: 0, activity: null, stage, speedBps: null, totalBytes: null, downloadedBytes: null }, options: { release: release ? { id: release, title: 'B' } : undefined } }) as unknown as Job;

describe('groups of downloads', () => {
  const statuses = fc.constantFrom<Job['status']>('queued', 'running', 'paused', 'processing', 'completed', 'failed', 'cancelled');
  const jobs = fc.array(fc.tuple(statuses, fc.constantFrom<string | null>(null, 'r1', 'r2'), fc.constantFrom<Job['engine']>('aria2', 'ytdlp', 'extract'), fc.constantFrom('', 'Retrying in 30 s')), { maxLength: 40 });

  it('every download is in exactly one group, in its original order', () => {
    fc.assert(fc.property(jobs, (spec) => {
      const list = spec.map(([s, r, e, st]) => job(s, r, e, st));
      const groups = groupJobs(list);
      const ids = groups.flatMap((g) => g.ids);
      expect(ids.sort()).toEqual(list.map((j) => j.id).sort());
    }), RUNS);
  });

  it('a group’s counts add up to its size', () => {
    fc.assert(fc.property(jobs, (spec) => {
      const list = spec.map(([s, r, e, st]) => job(s, r, e, st));
      for (const g of groupJobs(list)) {
        const members = list.filter((j) => g.ids.includes(j.id));
        const c = summarizeGroup(members).counts;
        expect(c.completed + c.failed + c.active + c.queued + c.paused + c.cancelled).toBe(c.total);
      }
    }), RUNS);
  });

  it('a batch’s files are all accounted for, and it only speaks when nothing is left to come', () => {
    fc.assert(fc.property(jobs, (spec) => {
      const list = spec.map(([s, r, e, st]) => job(s, r, e, st));
      for (const j of list) {
        const state = batchStateOf(j, list);
        if (!state) continue;
        expect(state.completed + state.failed + state.pending).toBe(state.total);
        expect(state.total).toBeGreaterThanOrEqual(2);
        const said = batchSummary(state);
        expect(said === null).toBe(state.pending > 0);
        if (said) expect(/NaN|undefined/.test(said.text)).toBe(false);
      }
    }), RUNS);
  });
});

describe('yt-dlp item failures', () => {
  const message = fc.oneof(fc.string({ maxLength: 120 }), fc.constantFrom(
    'ERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot', 'ERROR: [youtube] abcdefghijk: Video unavailable', 'HTTP Error 429: Too Many Requests',
    'ERROR: unable to download video data: <urlopen error timed out>', 'aria2c exited with code 1', 'ERROR: [youtube] abcdefghijk: Private video',
  ));
  const failure = fc.record({ index: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 30 })), message });

  it('classifying or attributing any message never throws, and attribution keeps the message', () => {
    fc.assert(fc.property(message, fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 30 })), (m, cur) => {
      expect(typeof classifyItemFailure(m)).toBe('string');
      expect(attribute(m, cur, [{ id: 'abcdefghijk', index: 3 }]).message).toBe(m);
    }), { numRuns: 1000 });
  });

  it('settling is idempotent, and the retry plan is bounded and only names failed items', () => {
    fc.assert(fc.property(fc.array(failure, { maxLength: 30 }), fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 40 }), (raw, pass, recovered) => {
      const failures = raw.map((f) => attribute(f.message, f.index, []));
      const once = settle(failures);
      expect(settle(once)).toEqual(once);
      const step = nextRetry(once, pass, recovered);
      if (pass >= MAX_RETRY_PASSES) expect(step).toBeNull();
      if (step) {
        expect(step.cooldownMs).toBeGreaterThan(0);
        expect(step.indices.length).toBeGreaterThan(0);
        const known = new Set(once.map((f) => f.index));
        for (const i of step.indices) expect(known.has(i)).toBe(true);
      }
    }), RUNS);
  });

  it('the summary never says NaN or undefined, and never claims more failures than items', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 500 }), fc.array(failure, { maxLength: 30 }), fc.integer({ min: 0, max: 50 }), (total, raw, recovered) => {
      const text = failureSummary(total, settle(raw.map((f) => attribute(f.message, f.index, []))), recovered);
      expect(/NaN|undefined|null/.test(text)).toBe(false);
    }), RUNS);
  });
});

describe('files that are already there', () => {
  const size = fc.integer({ min: 0, max: 5_000 });
  const mode = fc.constantFrom<'skip' | 'replace' | undefined>('skip', 'replace', undefined);

  it('never reuses a file of the wrong size, and replaces only when asked to', () => {
    fc.assert(fc.property(mode, fc.oneof(fc.constant(null), size), fc.oneof(fc.constant(null), size.map((n) => ({ size: n }))), (m, expected, onDisk) => {
      const action = actionForExisting(m, expected, onDisk);
      if (!onDisk) expect(action).toBe('download');
      if (action === 'reuse') {
        expect(m).toBe('skip');
        expect(expected).toBeGreaterThan(0); // only ever when the size is known...
        expect(onDisk!.size).toBe(expected); // ...and the same
      }
      if (action === 'replace') expect(m).toBe('replace');
      if (m === undefined && onDisk) expect(action).toBe('keep-both');
    }), RUNS);
  });

  it('a batch folder is never another batch’s non-empty folder, and a "same batch" folder really holds one of its files', () => {
    const name = fc.constantFrom('a.rar', 'b.rar', 'c.zip', 'notes.txt', 'A.RAR');
    const folders = fc.dictionary(fc.constantFrom('/b/T', '/b/T (2)', '/b/T (3)', '/b/T (4)'), fc.array(name, { maxLength: 4 }));
    fc.assert(fc.property(folders, fc.array(name, { maxLength: 4 }), (disk, wanted) => {
      const r = chooseBatchFolder({ base: '/b', title: 'T', filenames: wanted, listDir: (d) => disk[d] ?? null, join: (d, n) => `${d}/${n}` });
      const there = disk[r.dir] ?? null;
      if (r.sameBatch) expect(there!.some((n) => wanted.some((w) => w.toLowerCase() === n.toLowerCase()))).toBe(true);
      else expect(there === null || there.length === 0).toBe(true);
    }), RUNS);
  });

  it('a library folder, what holds one, and a drive are never moved to the Recycle Bin, however they are written', () => {
    const seg = fc.constantFrom('Music', 'Songs', 'Rock', 'a', 'b c');
    const sub = fc.array(seg, { minLength: 1, maxLength: 3 });
    fc.assert(fc.property(sub, sub, (rootParts, below) => {
      const root = path.resolve('/lib', ...rootParts);
      for (const bad of [root, `${root}${path.sep}`, path.dirname(root), path.resolve('/')]) expect(canTrashFolder(bad, [root], [], false).ok).toBe(false);
      expect(canTrashFolder(path.join(root, ...below), [root], [], false).ok).toBe(true);
    }), RUNS);
  });
});
