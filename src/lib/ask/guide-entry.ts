// Public read-only state for the existing "Ask DAJC · FAQ" site guide.
// Unlike /api/ask/* this endpoint must never return 404 while Ask is disabled;
// it reveals only a boolean, not configuration details, keys, quotas or sessions.
import { getAskConfig, type AskEnv } from './config';

export function isGuideAiAvailable(env: AskEnv = process.env): boolean {
  return getAskConfig(env) !== null;
}

export function guideAiAvailabilityResponse(env: AskEnv = process.env): Response {
  return new Response(JSON.stringify({ available: isGuideAiAvailable(env) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
