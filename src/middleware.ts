// Global request middleware. Its only job today is the DAJC Partner Portal
// feature gate: fail closed, server-side, before any portal route handler
// (page or API) ever runs.
//
// This is layer 1 of defense-in-depth. Layer 2 is that every portal route
// under src/pages/partner-portal/** independently re-checks
// isPartnerPortalEnabled() itself (see docs/PARTNER_PORTAL.md) - so even a
// route added later that forgets this file exists still fails closed on
// its own.
import { defineMiddleware } from 'astro:middleware';
import { isPartnerPortalEnabled, isPartnerPortalPath } from './portal/config/gate';

export const onRequest = defineMiddleware(async (context, next) => {
  if (isPartnerPortalPath(context.url.pathname)) {
    if (!isPartnerPortalEnabled()) {
      return new Response('Not found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          // Belt-and-suspenders against indexing even though nothing links
          // here and it's not in the sitemap - see docs/PARTNER_PORTAL.md.
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
          'Cache-Control': 'no-store',
        },
      });
    }

    const response = await next();
    // Every portal response, gate on or off, must be non-indexable and
    // must never be cached by a shared/CDN cache (sessions, invitation
    // state and audit data are all request-specific).
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  return next();
});
