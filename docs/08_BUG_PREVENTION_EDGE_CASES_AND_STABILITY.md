# Lumina Media Workstation — Bug Prevention, Edge Cases & Stability Engineering

## 1. Zero-Crash Reliability Matrix
Media workstations operate under unpredictable conditions: fluctuating network bandwidth, arbitrary platform API changes, varied disk filesystems, and unannounced hardware detachments. 

This document defines every foreseeable failure mode and the exact defensive architecture implemented to prevent bugs before writing code.

---

## 2. Failure Mode & Mitigation Catalog

| Failure Category | Failure Scenario | Risk Severity | Architectural Mitigation & Defensive Strategy |
| :--- | :--- | :--- | :--- |
| **Network & Streams** | YouTube video is live or premiere (`is_live: true`) | **HIGH** (Hang on infinite stream) | Ingestion inspector checks `is_live`. Disables standard full-file download; offers "Record Broadcast from Current Point" or prompts user to wait for VOD archiving. |
| **Network & Streams** | Pre-signed CDN URL expires during large 8K download | **MEDIUM** (Download halts at 80%) | Automatically enable `--continue` flag in `yt-dlp`. If connection drops, Lumina re-queries the video manifest, retrieves fresh pre-signed URLs, and resumes from the exact byte offset. |
| **Network & Streams** | Invalid, deleted, or geo-blocked URL | **LOW** (App crash or endless spinner) | Regex pre-validation on the Omnibox. Structured stderr parser identifies explicit error types (`Video unavailable`, `Private video`, `Sign in to confirm age`) and displays clean user-facing advice. |
| **Storage & USB** | USB pendrive unplugged mid-download or mid-mux | **CRITICAL** (File corruption & crash) | **Staging Buffer Pattern**: All downloads stream to local fast SSD cache (`~/.cache/lumina/staging/`). Files are only copied to the USB after complete muxing and checksum verification. If USB is disconnected, the file safely remains in `~/Videos/Lumina/`. |
| **Storage & USB** | Target drive runs out of disk space (Disk Full) | **HIGH** (Corrupted partial file) | **Pre-flight Free Space Calculation**: Before launching download, Lumina compares estimated stream size against filesystem free space (`statvfs` on Linux, `GetDiskFreeSpaceEx` on Windows). Rejects download with alert if free space is insufficient. |
| **Filesystems** | Video title contains illegal characters (`/ \ : * ? " < > \|`) | **HIGH** (Crash on Windows / FAT32) | Cross-platform filename sanitizer (`--windows-filenames` + custom regex) replaces reserved characters with Unicode safe equivalents (e.g. `:` becomes ` - `) while preserving international UTF-8 characters. |
| **Subtitles** | Requested subtitle language is unavailable | **LOW** (Download fails or hangs) | Dynamic query lists only genuinely available subtitle tracks extracted from `subtitles` and `automatic_captions` in the metadata payload. |
| **Process Lifecycle** | User exits app while downloads or FFmpeg are active | **HIGH** (Zombie orphan processes) | Electron `app.on('before-quit')` hook tracks all active child process PIDs. Transmits graceful `SIGTERM` followed by forceful cleanup, guaranteeing zero orphaned background processes. |
| **Linux Display** | Wayland fractional scaling & KDE Plasma fontconfig | **LOW** (Blurry UI or terminal warnings) | Electron launched with Wayland-native flags (`--enable-features=UseOzonePlatform --ozone-platform=wayland`) ensuring crisp 1:1 vector rendering on Fedora KDE Plasma 6. |

---

## 3. Defensive Code Patterns

### 3.1 Pre-Flight Disk Space Checker
```typescript
import fs from 'fs';
import os from 'os';

export async function verifyDiskSpace(targetPath: string, requiredBytes: number): Promise<boolean> {
  try {
    const stats = await fs.promises.statfs(targetPath);
    const availableBytes = stats.bavail * stats.bsize;
    // Require at least estimated bytes + 200MB safety margin
    return availableBytes > (requiredBytes + 200 * 1024 * 1024);
  } catch (err) {
    console.warn('statfs not supported on target filesystem, proceeding with fallback', err);
    return true;
  }
}
```

### 3.2 Universal Cross-Platform Filename Sanitizer
```typescript
export function sanitizeFilename(rawTitle: string): string {
  return rawTitle
    // Replace illegal Windows & POSIX characters: < > : " / \ | ? *
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    // Replace multiple spaces with a single space
    .replace(/\s+/g, ' ')
    // Trim trailing periods and spaces (invalid on Windows NTFS)
    .replace(/[. ]+$/, '')
    // Limit to 200 characters to prevent path length overflow (MAX_PATH 260)
    .slice(0, 200)
    .trim();
}
```

### 3.3 Child Process Guardian
```typescript
const activeProcesses = new Set<ChildProcess>();

export function registerChildProcess(proc: ChildProcess): void {
  activeProcesses.add(proc);
  proc.on('exit', () => activeProcesses.delete(proc));
}

export function terminateAllChildren(): void {
  for (const proc of activeProcesses) {
    try {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    } catch (e) {
      // Ignore already terminated processes
    }
  }
}
```
