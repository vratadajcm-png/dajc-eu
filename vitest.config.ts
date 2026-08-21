import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Partner Portal unit/security tests (src/portal/__tests__/**, see
// docs/PARTNER_PORTAL.md) plus the EU Oversize Weekly pipeline's pure
// decision-logic tests (scripts/lib/__tests__/**, see
// docs/NEWS_AUTOMATION.md). The rest of dajc.eu has no test suite to
// integrate with.
export default defineConfig({
  resolve: {
    alias: {
      // src/middleware.ts imports the real "astro:middleware" virtual
      // module, which only resolves inside Astro's own pipeline - swap in
      // a faithful identity-function shim so the middleware's actual gate
      // logic can be unit tested without spinning up an Astro server.
      'astro:middleware': fileURLToPath(
        new URL('./src/portal/__tests__/shims/astro-middleware-shim.ts', import.meta.url)
      ),
    },
  },
  test: {
    include: ['src/portal/__tests__/**/*.test.ts', 'scripts/lib/__tests__/**/*.test.mjs'],
    environment: 'node',
  },
});
