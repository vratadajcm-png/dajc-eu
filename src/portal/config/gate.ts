// Central feature gate for the entire DAJC Partner Portal.
//
// Deny-by-default, fail-closed: the portal is enabled if and only if
// DAJC_PARTNER_PORTAL_ENABLED is the EXACT string "true". Anything else -
// missing, empty, "TRUE", "1", "yes", whitespace - is treated as disabled.
// Every portal route, the global middleware, and the email sender all call
// this same function; there is exactly one place that can turn the portal
// on. See docs/PARTNER_PORTAL.md.
export function isPartnerPortalEnabled(): boolean {
  return process.env.DAJC_PARTNER_PORTAL_ENABLED === 'true';
}

// Base path every portal route lives under. Centralized so the middleware
// gate and route code can never drift on what "the portal" covers.
export const PARTNER_PORTAL_BASE_PATH = '/partner-portal';

export function isPartnerPortalPath(pathname: string): boolean {
  return pathname === PARTNER_PORTAL_BASE_PATH || pathname.startsWith(`${PARTNER_PORTAL_BASE_PATH}/`);
}
