// Global request middleware applies private investor response headers and the
// DAJC Partner Portal feature gate: fail closed before any portal route handler
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
  // These sections are deliberately private, regardless of navigation or
  // indexing settings. Never invoke their page handlers on the public site.
  if (/^\/(?:platform|partners|integration-ecosystem)(?:\/|$)/i.test(context.url.pathname)) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/',
        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (context.url.pathname === '/investor' || context.url.pathname.startsWith('/investor/')) {
    const response = await next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('CDN-Cache-Control', 'no-store');
    response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
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

  const response = await next();
  // A mistyped public page should lead visitors back to the public homepage.
  // Preserve API and missing-asset status codes so clients never receive HTML.
  if (response.status === 404 && context.request?.method === 'GET'
    && context.request.headers.get('accept')?.includes('text/html')
    && !/^\/(?:api|assets|_astro)(?:\/|$)/i.test(context.url.pathname)
    && !/\.[a-z0-9]+$/i.test(context.url.pathname)) {
    return new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  }
  return response;
});
