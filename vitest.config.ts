import { defineConfig } from 'vitest/config';
import path from 'node:path';

const r = (p: string) => path.resolve(import.meta.dirname, p);

export default defineConfig({
  resolve: {
    alias: { '@shared': r('src/shared'), '@core': r('src/core') },
  },
  // Tests always run against the full build; a variant is a packaging choice, not a behaviour
  // the logic under test is allowed to branch on.
  define: { __LUMINA_IDE__: 'true', __LUMINA_BROWSER__: 'true' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
