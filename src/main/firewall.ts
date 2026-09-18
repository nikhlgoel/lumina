// Windows Firewall access for the bundled tools that open listening sockets. aria2c listens for torrent peers, so
// Windows shows its "Allow access?" prompt the first time. If a person clicks Cancel, Windows records a block and
// there's no obvious way back — inbound peers are refused from then on. This gives them a button to re-grant it:
// one elevated step clears any inbound block rules for the tool and adds a named allow rule.
//
// Everything here is a no-op off Windows. Nothing user-typed reaches the command line — the only variable is the
// bundled binary's own path, which we resolve and verify is an existing .exe before using it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FirewallStatus, FirewallTool } from '../shared/types';
import { tools } from './tools';
import { logger } from './log';

const log = logger('firewall');

const isWindows = process.platform === 'win32';

/** Bundled tools that need inbound network access (a listening socket), and the fixed rule name we manage for each. */
interface ManagedTool {
  key: string;
  label: string;
  rule: string;
  program: string;
}

function managedTools(): ManagedTool[] {
  if (!isWindows) return [];
  const out: ManagedTool[] = [];
  // aria2c is the only bundled tool that accepts inbound connections (torrent peers). Others are outbound-only,
  // which Windows allows by default. The list is kept as an array so more can be added if that ever changes.
  const specs: { key: string; label: string; tool: 'aria2c' }[] = [{ key: 'aria2c', label: 'Torrent engine (aria2)', tool: 'aria2c' }];
  for (const spec of specs) {
    let program = '';
    try {
      program = tools.require(spec.tool);
    } catch {
      continue; // tool not available → nothing to allow
    }
    if (!path.isAbsolute(program) || !fs.existsSync(program)) continue;
    out.push({ key: spec.key, label: spec.label, rule: `Lumina - ${spec.label} (In)`, program });
  }
  return out;
}

/** Run netsh without elevation (reading rules doesn't need admin) and return combined output + exit code. */
function netsh(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('netsh', args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));
    child.on('error', () => resolve({ code: -1, out }));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

/** True when our named allow rule exists for this tool. */
async function isGranted(tool: ManagedTool): Promise<boolean> {
  const { code, out } = await netsh(['advfirewall', 'firewall', 'show', 'rule', `name=${tool.rule}`]);
  return code === 0 && /Enabled:\s*Yes/i.test(out) && /Allow/i.test(out);
}

export async function firewallStatus(): Promise<FirewallStatus> {
  const managed = managedTools();
  if (!isWindows || managed.length === 0) return { supported: false, tools: [] };
  const list: FirewallTool[] = await Promise.all(
    managed.map(async (t): Promise<FirewallTool> => ({ key: t.key, label: t.label, granted: await isGranted(t) })),
  );
  return { supported: true, tools: list };
}

/**
 * Add allow rules for every managed tool in one elevated step (a single UAC prompt). We write a small batch file
 * with fixed commands, then launch it elevated and wait. For each tool: delete any inbound rules already bound to
 * that exact program (this clears Windows' auto-created block from an earlier "Cancel"), then add our allow rule.
 */
export async function grantFirewallAccess(): Promise<FirewallStatus> {
  const managed = managedTools();
  if (!isWindows || managed.length === 0) return { supported: false, tools: [] };

  const lines = ['@echo off'];
  for (const t of managed) {
    lines.push(`netsh advfirewall firewall delete rule name=all dir=in program="${t.program}" >nul 2>&1`);
    lines.push(`netsh advfirewall firewall add rule name="${t.rule}" dir=in action=allow program="${t.program}" enable=yes profile=private,public`);
  }
  lines.push('exit /b %errorlevel%');

  const batPath = path.join(os.tmpdir(), `lumina-firewall-${Date.now()}.bat`);
  fs.writeFileSync(batPath, lines.join('\r\n'), 'utf8');

  try {
    await runElevated(batPath);
    log.info(`Granted firewall access for: ${managed.map((t) => t.key).join(', ')}`);
  } catch (err) {
    log.warn('Firewall grant did not complete', err);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    fs.rmSync(batPath, { force: true });
  }
  return firewallStatus();
}

/** Launch a batch file elevated via PowerShell's Start-Process -Verb RunAs, and reject if it fails or is refused. */
function runElevated(batPath: string): Promise<void> {
  // -PassThru + -Wait lets us read the elevated process's exit code; a refused UAC prompt makes Start-Process throw.
  const psCommand = `$ErrorActionPreference='Stop'; try { $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','"${batPath}"' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], { windowsHide: true });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else if (code === 1223) reject(new Error('You didn’t allow the change (Windows asked for permission). Try again and choose Yes.'));
      else reject(new Error(`Couldn’t update the firewall (code ${code}). You can also allow the tool manually in Windows Defender Firewall.`));
    });
  });
}
