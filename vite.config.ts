import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: path.resolve(__dirname, 'src/main/index.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            rollupOptions: {
              external: ['electron', 'child_process', 'fs', 'path', 'os', 'util'],
            },
          },
        },
      },
      {
        entry: path.resolve(__dirname, 'src/preload/index.ts'),
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/preload'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer/src'),
      '@shared': path.resolve(__dirname, 'src/preload'),
    },
  },
  root: path.resolve(__dirname, 'src/renderer'),
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
