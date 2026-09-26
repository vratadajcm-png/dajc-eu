import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Existing portal/config/news suites plus the canonical Driving Bans contract.
export default defineConfig({
  resolve: {
    alias: {
      'astro:middleware': fileURLToPath(new URL('./src/portal/__tests__/shims/astro-middleware-shim.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/portal/__tests__/**/*.test.ts', 'src/config/__tests__/**/*.test.ts', 'scripts/lib/__tests__/**/*.test.mjs', 'src/lib/driving-bans/**/*.test.ts'],
    environment: 'node',
  },
});
