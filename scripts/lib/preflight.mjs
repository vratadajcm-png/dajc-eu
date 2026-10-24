// Configuration preflight for the Friday publish pipeline. Kept as a pure,
// side-effect-free check (no process.exit, no console output) so it can be
// unit tested directly - see scripts/lib/__tests__/preflight.test.mjs -
// without network calls or an astro build.
//
// The edition is written by Claude (scripts/lib/article-writer.mjs). A missing
// ANTHROPIC_API_KEY on a real (non---mock) run is a configuration error, not a
// "no news this week" outcome: generate-weekly-article.mjs must treat it as a
// hard failure (non-zero exit), unlike the not-enough-verified-data cases,
// which legitimately exit 0.
export function checkClaudeKeyPreflight({ mock, apiKey }) {
  if (mock) return { ok: true };
  if (!apiKey) {
    return {
      ok: false,
      reason:
        'ANTHROPIC_API_KEY is not set and --mock was not requested. This is a ' +
        'configuration error, not a "no news this week" case - failing this ' +
        'run instead of silently skipping it.',
    };
  }
  return { ok: true };
}
