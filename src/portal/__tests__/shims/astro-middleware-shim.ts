// Test-only stand-in for the "astro:middleware" virtual module, which only
// resolves inside Astro's own build/dev pipeline. `defineMiddleware` is
// purely a type-inference identity helper in real Astro, so an identity
// function is a faithful shim for unit testing src/middleware.ts in
// isolation (no Astro server required).
export function defineMiddleware(handler: unknown) {
  return handler;
}
