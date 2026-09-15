/// <reference types="vite/client" />
import type { LuminaAPI } from '@shared/types';

declare global {
  interface Window {
    luminaAPI: LuminaAPI;
  }
}
