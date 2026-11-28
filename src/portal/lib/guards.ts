// Shared request-handling helpers for Partner Portal routes.
import { isPartnerPortalEnabled } from '../config/gate';
import { isIntelligenceAccountsEnabled } from '../../lib/intelligence/entitlements';

const NOT_FOUND_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Cache-Control': 'no-store',
};

// Redundant, route-local re-check of the central gate. src/middleware.ts
// already blocks every /partner-portal/** request when the gate is
// disabled - this is intentional defense-in-depth so a route is never the
// single point of failure for the gate. See docs/PARTNER_PORTAL.md.
export function notFoundIfPortalDisabled(): Response | null {
  if (!isPartnerPortalEnabled()) {
    return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  }
  return null;
}

// Route-local re-check of the DAJC Intelligence accounts gate (release constant plus
// DAJC_INTELLIGENCE_ACCOUNTS_ENABLED); src/middleware.ts checks it first.
export function notFoundUnlessIntelligenceAccounts(): Response | null {
  if (!isIntelligenceAccountsEnabled()) {
    return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function redirectResponse(location: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
