import type { EventChannel, EventPayloads, InvokeChannel, InvokeInputs, InvokeOutputs, LuminaBridge } from '@shared/ipc';

declare global {
  interface Window {
    lumina: LuminaBridge;
  }
}

/** Call the main process. Errors arrive as "Error invoking remote method 'x': Error: message"; strip the wrapper. */
export async function call<K extends InvokeChannel>(
  channel: K,
  ...args: InvokeInputs[K] extends void ? [] : [InvokeInputs[K]]
): Promise<InvokeOutputs[K]> {
  try {
    return await window.lumina.invoke(channel, ...args);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

export function on<K extends EventChannel>(channel: K, listener: (payload: EventPayloads[K]) => void): () => void {
  return window.lumina.on(channel, listener);
}

export const platform = () => window.lumina.platform;

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
export const pathForFile = (file: File) => window.lumina.pathForFile(file);
