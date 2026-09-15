import { ipcMain, BrowserWindow, shell, dialog } from 'electron';
import { downloaderManager } from './downloader';
import { storageManager } from './storage';
import { musicManager } from './music';
import { settingsManager } from './settings';
import type { DownloadRequest, LuminaSettings } from '../preload/types';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Media Inspection & Download
  ipcMain.handle('media:inspect', async (_, url: string) => {
    return await downloaderManager.inspectUrl(url);
  });

  ipcMain.handle('media:download', async (_, request: DownloadRequest) => {
    return await downloaderManager.startDownload(request);
  });

  ipcMain.handle('media:cancel', async (_, taskId: string) => {
    return downloaderManager.cancelDownload(taskId);
  });

  // Storage & Drives
  ipcMain.handle('storage:get-drives', async () => {
    return await storageManager.getDrives();
  });

  // Music Discovery & Streaming
  ipcMain.handle('music:search', async (_, query: string) => {
    return await musicManager.searchMusic(query);
  });

  ipcMain.handle('music:stream-url', async (_, videoId: string) => {
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

  ipcMain.handle('settings:save', async (_, newSettings: Partial<LuminaSettings>) => {
    return settingsManager.save(newSettings);
  });

  // Shell Actions
  ipcMain.handle('shell:open-file', async (_, filePath: string) => {
    await shell.openPath(filePath);
  });

  ipcMain.handle('shell:open-directory', async (_, targetPath: string) => {
    await shell.showItemInFolder(targetPath);
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
