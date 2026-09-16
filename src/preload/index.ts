import { contextBridge, ipcRenderer } from 'electron';
import type { DownloadRequest, LuminaSettings, DownloadProgress, StorageDrive } from './types';

contextBridge.exposeInMainWorld('luminaAPI', {
  inspectUrl: (url: string) => ipcRenderer.invoke('media:inspect', url),
  startDownload: (request: DownloadRequest) => ipcRenderer.invoke('media:download', request),
  pauseDownload: (taskId: string) => ipcRenderer.invoke('media:pause', taskId),
  resumeDownload: (taskId: string) => ipcRenderer.invoke('media:resume', taskId),
  cancelDownload: (taskId: string) => ipcRenderer.invoke('media:cancel', taskId),
  
  getStorageDrives: () => ipcRenderer.invoke('storage:get-drives'),
  
  searchMusic: (query: string) => ipcRenderer.invoke('music:search', query),
  getStreamUrl: (videoId: string) => ipcRenderer.invoke('music:stream-url', videoId),
  getLyrics: (query: { title: string; artist?: string; duration?: number }) => ipcRenderer.invoke('lyrics:get', query),
  
  getDownloadedMedia: () => ipcRenderer.invoke('library:get-media'),
  
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<LuminaSettings>) => ipcRenderer.invoke('settings:save', settings),
  
  openFile: (filePath: string) => ipcRenderer.invoke('shell:open-file', filePath),
  openDirectory: (filePath: string) => ipcRenderer.invoke('shell:open-directory', filePath),
  selectDirectory: () => ipcRenderer.invoke('shell:select-directory'),
  selectTorrentFile: () => ipcRenderer.invoke('shell:select-torrent'),
  
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const handler = (_: any, data: DownloadProgress) => callback(data);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },
  
  onDrivesChanged: (callback: (drives: StorageDrive[]) => void) => {
    const handler = (_: any, data: StorageDrive[]) => callback(data);
    ipcRenderer.on('storage:drives-changed', handler);
    return () => ipcRenderer.removeListener('storage:drives-changed', handler);
  }
});
