import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS } from '../shared/channels';
import type { EventChannel, InvokeChannel, LuminaBridge } from '../shared/ipc';

const bridge: LuminaBridge = {
  invoke: ((channel: InvokeChannel, payload?: unknown) => ipcRenderer.invoke(channel, payload)) as LuminaBridge['invoke'],
  on: (channel, listener) => {
    if (!EVENT_CHANNELS.includes(channel as EventChannel)) throw new Error(`Unknown event channel: ${channel}`);
    const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('lumina', bridge);
