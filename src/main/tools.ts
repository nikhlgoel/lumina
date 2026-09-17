import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { ToolName, ToolStatus } from '../shared/types';
import { bundledBinDir, bundledModelsDir, downloadedModelsDir, exe, updatedBinDir } from './paths';
import { runTool } from './process';
import { settings } from './settings';
import { logger } from './log';

const log = logger('tools');
const TOOL_NAMES: ToolName[] = ['yt-dlp', 'ffmpeg', 'ffprobe', 'aria2c', 'whisper-cli', '7z'];

const VERSION_ARGS: Record<ToolName, string[]> = {
  'yt-dlp': ['--version'],
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
  aria2c: ['--version'],
  'whisper-cli': ['--help'],
  '7z': ['i'],
};

function parseVersion(name: ToolName, out: string): string | null {
  const first = out.split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (name === 'yt-dlp') return first.trim() || null;
  if (name === 'aria2c') return first.match(/aria2 version (\S+)/)?.[1] ?? null;
  if (name === 'ffmpeg' || name === 'ffprobe') return first.match(/version (\S+)/)?.[1] ?? null;
  if (name === '7z') return out.match(/7-Zip (?:\(a\) |\(z\) )?(\d+\.\d+)/)?.[1] ?? null;
  return out.includes('usage') || out.includes('options') ? 'available' : null;
}

class ToolManager extends EventEmitter<{ changed: [ToolStatus[]] }> {
  private statuses = new Map<ToolName, ToolStatus>();

  /** Candidate paths in priority order. */
  private candidates(name: ToolName): { path: string; source: ToolStatus['source'] }[] {
    const list: { path: string; source: ToolStatus['source'] }[] = [];
    const custom = settings.get().advanced.customToolPaths[name];
    if (custom) list.push({ path: custom, source: 'custom' });
    if (name === 'yt-dlp') list.push({ path: path.join(updatedBinDir(), exe('yt-dlp')), source: 'updated' });
    // 7-Zip's Linux build is named 7zz; distro packages provide 7z or 7zz.
    const names = name === '7z' && process.platform !== 'win32' ? ['7zz', '7z'] : [name];
    for (const n of names) list.push({ path: path.join(bundledBinDir(), exe(n)), source: 'bundled' });
    for (const n of names) list.push({ path: exe(n), source: 'system' });
    return list;
  }

  async probe(name: ToolName): Promise<ToolStatus> {
    let lastError = 'Not found';
    for (const c of this.candidates(name)) {
      if (c.source !== 'system' && !fs.existsSync(c.path)) continue;
      try {
        const r = await runTool(c.path, VERSION_ARGS[name], { timeoutMs: 20_000, env: this.env() });
        const version = parseVersion(name, `${r.stdout}\n${r.stderr}`);
        if (version) {
          const status: ToolStatus = { name, ok: true, path: c.path, version, source: c.source };
          this.statuses.set(name, status);
          return status;
        }
        lastError = `Unexpected output from ${c.path}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    const status: ToolStatus = { name, ok: false, path: null, version: null, source: 'missing', error: lastError };
    this.statuses.set(name, status);
    return status;
  }

  async probeAll(): Promise<ToolStatus[]> {
    const all = await Promise.all(TOOL_NAMES.map((n) => this.probe(n)));
    for (const s of all) {
      if (!s.ok) log.warn(`${s.name} unavailable: ${s.error}`);
      else log.info(`${s.name} ${s.version} (${s.source})`);
    }
    this.emit('changed', all);
    return all;
  }

  list(): ToolStatus[] {
    return TOOL_NAMES.map((n) => this.statuses.get(n) ?? { name: n, ok: false, path: null, version: null, source: 'missing' });
  }

  /** Path to a working tool, or a clear error people can act on. */
  require(name: ToolName): string {
    const s = this.statuses.get(name);
    if (s?.ok && s.path) return s.path;
    throw new Error(`${name} is not available. Open Settings › Advanced › Tools to repair it.`);
  }

  has(name: ToolName): boolean {
    return Boolean(this.statuses.get(name)?.ok);
  }

  /** Folder containing ffmpeg/ffprobe for yt-dlp's --ffmpeg-location. */
  ffmpegDir(): string {
    const p = this.require('ffmpeg');
    return path.isAbsolute(p) ? path.dirname(p) : p;
  }

  /**
   * yt-dlp needs a JavaScript runtime for YouTube. Electron's own binary runs as Node 24
   * when ELECTRON_RUN_AS_NODE is set, so no extra runtime has to ship.
   */
  jsRuntime(): string {
    return `node:${process.execPath}`;
  }

  env(): NodeJS.ProcessEnv {
    const bin = bundledBinDir();
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    };
  }

  whisperModelPath(model: 'base' | 'small'): string | null {
    const file = `ggml-${model}.bin`;
    for (const dir of [bundledModelsDir(), downloadedModelsDir()]) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /** Download the newest yt-dlp release into the writable bin folder. */
  async updateYtdlp(): Promise<ToolStatus> {
    const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
    const repo = settings.get().updates.ytdlpChannel === 'nightly' ? 'yt-dlp/yt-dlp-nightly-builds' : 'yt-dlp/yt-dlp';
    const base = `https://github.com/${repo}/releases/latest/download`;
    const sums = await (await fetch(`${base}/SHA2-256SUMS`)).text();
    const expected = sums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${asset}`) || l.trim().endsWith(`*${asset}`))?.split(/\s+/)[0];
    if (!expected) throw new Error('Could not verify the yt-dlp release (checksum missing).');

    const res = await fetch(`${base}/${asset}`);
    if (!res.ok) throw new Error(`yt-dlp download failed (${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected.toLowerCase()) throw new Error('yt-dlp download failed its checksum; nothing was changed.');

    const dest = path.join(updatedBinDir(), exe('yt-dlp'));
    const tmp = `${dest}.new`;
    fs.writeFileSync(tmp, bytes, { mode: 0o755 });
    fs.renameSync(tmp, dest);
    const status = await this.probe('yt-dlp');
    settings.update({ updates: { lastYtdlpCheck: Date.now() } });
    this.emit('changed', this.list());
    return status;
  }

  /** Sites change often; keep yt-dlp current in the background (weekly, checksum-verified). */
  async autoUpdate(): Promise<void> {
    const s = settings.get().updates;
    if (!s.autoUpdateYtdlp || Date.now() - s.lastYtdlpCheck < 7 * 86_400_000) return;
    try {
      const repo = s.ytdlpChannel === 'nightly' ? 'yt-dlp/yt-dlp-nightly-builds' : 'yt-dlp/yt-dlp';
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
      const latest = res.ok ? ((await res.json()) as { tag_name?: string }).tag_name : null;
      const current = this.statuses.get('yt-dlp')?.version;
      if (latest && current && latest.replace(/^v/, '') === current) {
        settings.update({ updates: { lastYtdlpCheck: Date.now() } });
        return;
      }
      const status = await this.updateYtdlp();
      log.info(`yt-dlp auto-updated to ${status.version}`);
    } catch (err) {
      log.warn('yt-dlp auto-update failed', err);
    }
  }
}

export const tools = new ToolManager();
