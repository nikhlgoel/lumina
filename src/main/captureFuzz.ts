// Development-only: hostile input to the app's IPC channels, in the real app, in a scratch profile.
// Run: LUMINA_CAPTURE=<dir> LUMINA_PROBE_FUZZ=<scratch dir> LUMINA_CAPTURE_ONLY='probe-ipc-fuzz|probe-ipc-fuzz-log' electron . --user-data-dir=<scratch>
//
// Every channel that only reads or asks (the names are matched, nothing that writes, deletes, runs, opens or sends) is called with about twenty kinds of garbage:
// wrong types, huge strings, path traversal, prototype pollution, deep nesting, huge arrays. What is checked: every call settles (rejecting is fine, hanging is not),
// the main process still answers afterwards, nothing was added to Object.prototype, the log shows no unhandled error, and the channels that take a path refuse a
// path outside anything the person has opened.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { inputSchemas } from '../shared/ipc';
import { logsDir } from './paths';

const SAFE = /^(?:[a-z-]+:)(?:info|status|list|get|stats|items|playlists|files|detail|usage|sizes|interfaces|supported-sites|key-status|models|shells|ports|tasks|portable-status|import-preview|abs-path|original|search|query|songs|videos|albums|inspect|names|resolve|resolve-path|loudness|folder|read|shields|current)$/;
// Network readers that are slow or leave the machine are left out: this is about validation and robustness, not the network.
const SKIP = /^(?:media:inspect|media:play|page:files|links:names|search:|update:|lyrics:get|tools:supported-sites|usb:|dlna:|firewall:|sync:|hosts:|extension:)/;
const logFile = () => path.join(logsDir(), 'lumina.log');
const countBad = () => {
  try { return (fs.readFileSync(logFile(), 'utf8').match(/Unhandled|uncaught|Uncaught|crash\]/g) ?? []).length; } catch { return 0; }
};
let before = 0;

const script = (channels: string[], mustRefuse: Record<string, unknown>) => `(async () => {
  const channels = ${JSON.stringify(channels)};
  const mustRefuse = ${JSON.stringify(mustRefuse)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deep = (n) => { let o = {}; for (let i = 0; i < n; i++) o = { a: o }; return o; };
  const payloads = [
    undefined, null, 0, -1, 1e308, true, 'x', '', 'A'.repeat(1000000), '../../../../Windows/win.ini', 'C:/Windows/System32/drivers/etc/hosts', '\\\\\\\\?\\\\C:\\\\Windows', 'file:///C:/Windows/win.ini',
    {}, [], [[]], { id: 'x' }, { id: 'A'.repeat(100000) }, { url: 'javascript:alert(1)' }, { url: 'http://127.0.0.1:1/' }, { path: 'C:/Windows/win.ini' }, { path: '../../x' },
    { query: 'a'.repeat(100000) }, { query: '\\u0000\\u202e' }, JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}'),
    deep(2000), Array.from({ length: 100000 }, (_, i) => i), { ids: Array.from({ length: 50000 }, (_, i) => String(i)) },
  ];
  // The bridge may throw at once (a value it cannot copy) or reject later: both are a refusal.
  const call = async (ch, p) => { try { return { ok: true, v: await window.lumina.invoke(ch, p) }; } catch (e) { return { ok: false, e: String(e && e.message || e).slice(0, 80) }; } };
  const results = { settled: 0, hung: [], accepted: {}, total: 0 };
  for (const ch of channels) {
    for (const [i, p] of payloads.entries()) {
      results.total++;
      const outcome = await Promise.race([
        call(ch, p),
        sleep(8000).then(() => 'HUNG'),
      ]);
      if (outcome === 'HUNG') { results.hung.push(ch + '#' + i); continue; }
      results.settled++;
      if (outcome.ok) (results.accepted[ch] ??= []).push(i);
    }
  }
  // Channels that take a path must refuse one outside anything the person has opened.
  const leaks = [];
  for (const [ch, payload] of Object.entries(mustRefuse)) {
    const o = await Promise.race([call(ch, payload), sleep(8000).then(() => ({ ok: 'HUNG' }))]);
    if (o.ok === true) leaks.push(ch + ' accepted ' + JSON.stringify(payload).slice(0, 60) + ' -> ' + JSON.stringify(o.v).slice(0, 80));
  }
  const alive = await Promise.race([window.lumina.invoke('app:info').then(() => true, () => false), sleep(5000).then(() => false)]);
  return JSON.stringify({ channels: channels.length, total: results.total, settled: results.settled, hung: results.hung, alive, prototypeClean: ({}).polluted === undefined && Object.prototype.polluted === undefined, leaks, acceptedCount: Object.fromEntries(Object.entries(results.accepted).map(([k, v]) => [k, v.length])) });
})()`;

export function fuzzSteps(scratch: string): { name: string; script: string; delay?: number; before?: (win: BrowserWindow) => void }[] {
  const all = Object.keys(inputSchemas);
  const channels = all.filter((c) => SAFE.test(c) && !SKIP.test(c));
  const skipped = all.filter((c) => !channels.includes(c));
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, 'ipc-fuzz-channels.json'), JSON.stringify({ fuzzed: channels, skipped: skipped.length }, null, 1));
  const outside = 'C:/Windows/win.ini';
  const mustRefuse: Record<string, unknown> = {
    'ide:read': { path: outside }, 'ide:abs-path': { path: '../../../Windows/win.ini' }, 'ide:list': { path: 'C:/Windows' }, 'ide:files': { path: 'C:/Windows' },
    'player:resolve-path': { path: outside }, 'ide:original': { path: outside }, 'ide:search': { query: 'a', path: 'C:/Windows' },
  };
  return [
    { name: 'probe-ipc-fuzz', delay: 500, before: () => { before = countBad(); }, script: script(channels, mustRefuse) },
    {
      name: 'probe-ipc-fuzz-log',
      delay: 300,
      before: () => { fs.writeFileSync(path.join(scratch, 'ipc-fuzz-log.json'), JSON.stringify({ badBefore: before, badAfter: countBad() })); },
      script: '0',
    },
  ];
}
