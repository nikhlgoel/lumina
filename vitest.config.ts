import { defineConfig } from 'vitest/config';
import path from 'node:path';

const r = (p: string) => path.resolve(import.meta.dirname, p);

export default defineConfig({
  resolve: {
    alias: { '@shared': r('src/shared'), '@core': r('src/core') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
