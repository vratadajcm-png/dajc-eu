// Configuration preflight for the Friday publish pipeline. Kept as a pure,
// side-effect-free check (no process.exit, no console output) so it can be
// unit tested directly - see scripts/lib/__tests__/preflight.test.mjs -
// without spinning up network calls, OpenAI, or an astro build.
//
// A missing OPENAI_API_KEY on a real (non---mock) run is a configuration
// error, not a "no news this week" outcome: generate-weekly-article.mjs
// must treat it as a hard failure (non-zero exit), unlike the various
// not-enough-verified-data cases which legitimately exit 0.
export function checkOpenAiKeyPreflight({ mock, apiKey }) {
  if (mock) return { ok: true };
  if (!apiKey) {
    return {
      ok: false,
      reason:
        'OPENAI_API_KEY is not set and --mock was not requested. This is a ' +
        'configuration error, not a "no news this week" case - failing this ' +
        'run instead of silently skipping it.',
    };
  }
  return { ok: true };
}

// Primary production research/writer provider: Perplexity Sonar. A missing
// key is a configuration failure, never a claim that there is no news.
export function checkSonarKeyPreflight({ mock, apiKey }) {
  if (mock) return { ok: true };
  return apiKey ? { ok: true } : { ok: false, reason: 'PERPLEXITY_API_KEY is not configured; no article may be generated or published' };
}
