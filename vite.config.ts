import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron';

// Editors built on Electron (VS Code) leak this into child shells; it would make
// the app start as plain Node instead of opening a window.
delete process.env.ELECTRON_RUN_AS_NODE;

const r = (p: string) => path.resolve(import.meta.dirname, p);

const alias = {
  '@': r('src/renderer/src'),
  '@shared': r('src/shared'),
  '@core': r('src/core'),
};

export default defineConfig({
  root: r('src/renderer'),
  // Relative asset URLs so the built page works from file:// in Electron.
  base: './',
  resolve: { alias },
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: r('src/main/index.ts'),
        // Keep Chromium's sandbox on in development too.
        onstart: async ({ startup }) => {
          await startup(['.']);
        },
        vite: {
          resolve: { alias },
          build: {
            outDir: r('dist-electron/main'),
            emptyOutDir: true,
            sourcemap: true,
            lib: { entry: r('src/main/index.ts'), formats: ['es'], fileName: () => 'index.js' },
            rollupOptions: {
              // node-pty ships a real .node binary, so it has to stay a runtime require rather
              // than be inlined. electron-builder packs the package itself (see asarUnpack).
              external: [/^@lydell\/node-pty/],
            },
          },
        },
      },
      {
        entry: r('src/preload/index.ts'),
        onstart: ({ reload }) => reload(),
        vite: {
          resolve: { alias },
          build: {
            outDir: r('dist-electron/preload'),
            emptyOutDir: true,
            // Sandboxed preload scripts must be CommonJS.
            lib: { entry: r('src/preload/index.ts'), formats: ['cjs'], fileName: () => 'index.cjs' },
          },
        },
      },
    ]),
  ],
  build: {
    outDir: r('dist'),
    emptyOutDir: true,
  },
});
