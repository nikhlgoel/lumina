import { ipcMain, BrowserWindow, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { downloaderManager } from './downloader';
import { storageManager } from './storage';
import { musicManager } from './music';
import { settingsManager } from './settings';
import type { DownloadRequest, LuminaSettings } from '../preload/types';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Media Inspection & Download
  ipcMain.handle('media:inspect', async (_, url: unknown) => {
    if (typeof url !== 'string' || !url.trim() || url.length > 4096) {
      throw new Error('Invalid URL format');
    }
    return await downloaderManager.inspectUrl(url.trim());
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
