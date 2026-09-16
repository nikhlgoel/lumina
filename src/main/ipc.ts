import { ipcMain, BrowserWindow, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { downloaderManager } from './downloader';
import { storageManager } from './storage';
import { musicManager } from './music';
import { lyricsManager } from './lyrics';
import { settingsManager } from './settings';
import { repackCrawler } from './repackCrawler';
import type { DownloadRequest, LuminaSettings, RepackPackage } from '../preload/types';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Media Inspection & Download
  ipcMain.handle('media:inspect', async (_, url: unknown) => {
    if (typeof url !== 'string' || !url.trim() || url.length > 4096) {
      throw new Error('Invalid URL format');
    }
    return await downloaderManager.inspectUrl(url.trim());
  });

  // Lumina 2.0 Deep Link & Repack Crawler
  ipcMain.handle('repack:crawl-links', async (_, rawText: unknown) => {
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw new Error('No links provided for inspection');
    }
    return await repackCrawler.crawlMultiLinks(rawText.trim());
  });

  ipcMain.handle('repack:download-package', async (_, pkg: unknown, targetDir?: unknown) => {
    if (!pkg || typeof pkg !== 'object') {
      throw new Error('Invalid repack package payload');
    }
    const customDir = typeof targetDir === 'string' && targetDir.trim() ? targetDir.trim() : undefined;
    return await repackCrawler.startRepackDownload(pkg as RepackPackage, customDir);
  });

  ipcMain.handle('repack:resolve-direct', async (_, url: unknown) => {
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Invalid URL provided');
    }
    const parts = await repackCrawler.probeAndResolveUrl(url.trim());
    const part = parts[0];
    if (!part) {
      throw new Error('Could not resolve direct link');
    }
    return {
      directUrl: part.directUrl || part.rawUrl,
      filename: part.filename,
      sizeBytes: part.sizeBytes,
      sizeStr: part.sizeStr
    };
  });

  ipcMain.handle('media:download', async (_, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid download request payload');
    }
    return await downloaderManager.startDownload(request as DownloadRequest);
  });

  ipcMain.handle('media:cancel', async (_, taskId: unknown) => {
    if (typeof taskId !== 'string' || !taskId.trim()) return false;
    return downloaderManager.cancelDownload(taskId.trim());
  });

  // Storage & Drives
  ipcMain.handle('storage:get-drives', async () => {
    return await storageManager.getDrives();
  });

  // Music Discovery & Streaming
  ipcMain.handle('music:search', async (_, query: unknown) => {
    if (typeof query !== 'string') return [];
    return await musicManager.searchMusic(query);
  });

  ipcMain.handle('music:stream-url', async (_, videoId: unknown) => {
    if (typeof videoId !== 'string') return '';
    return await musicManager.getStreamUrl(videoId);
  });

  ipcMain.handle('lyrics:get', async (_, query: unknown) => {
    if (!query || typeof query !== 'object') return null;
    const q = query as { title?: unknown; artist?: unknown; duration?: unknown };
    if (typeof q.title !== 'string' || !q.title.trim() || q.title.length > 500) {
      return null;
    }
    const artist = typeof q.artist === 'string' ? q.artist.slice(0, 300) : undefined;
    const duration = typeof q.duration === 'number' && !isNaN(q.duration) ? q.duration : undefined;
    return await lyricsManager.getLyrics({
      title: q.title.trim(),
      artist,
      duration
    });
  });

  // Local Media Library
  ipcMain.handle('library:get-media', async () => {
    return await musicManager.getDownloadedMedia();
  });

  // Settings
  ipcMain.handle('settings:get', async () => {
    return settingsManager.get();
  });

  ipcMain.handle('settings:save', async (_, newSettings: unknown) => {
    if (!newSettings || typeof newSettings !== 'object') {
      return settingsManager.get();
    }
    return settingsManager.save(newSettings as Partial<LuminaSettings>);
  });

  // Shell Actions (Protected & Sanitized)
  ipcMain.handle('shell:open-file', async (_, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) return;
    const resolved = path.resolve(filePath.trim());
    if (fs.existsSync(resolved)) {
      await shell.openPath(resolved);
    }
  });

  ipcMain.handle('shell:open-directory', async (_, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return;
    const resolved = path.resolve(targetPath.trim());
    if (fs.existsSync(resolved)) {
      await shell.showItemInFolder(resolved);
    }
  });

  ipcMain.handle('shell:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('shell:select-torrent', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select .torrent File',
      properties: ['openFile'],
      filters: [
        { name: 'Torrent Files', extensions: ['torrent'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Window Controls
  ipcMain.on('window:minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow.isMaximized();
  });

  // Live Progress & Hardware Streamers
  downloaderManager.onProgress((progress) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download:progress', progress);
    }
  });

  storageManager.onChange((drives) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('storage:drives-changed', drives);
    }
  });
}
