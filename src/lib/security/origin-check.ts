// Same-origin (CSRF) check for every on-demand request, run first in
// src/middleware.ts. It is Astro's built-in rule (security.checkOrigin,
// astro/dist/core/app/origin-check.js) with exactly one exception, because
// Astro offers no per-route opt-out: security.checkOrigin is therefore false
// in astro.config.mjs and this module takes its place.
//
// The rule (unchanged from Astro): a non-safe method (anything but GET, HEAD,
// OPTIONS) is refused with 403 when it is not same-origin AND either carries a
// form-like content type (application/x-www-form-urlencoded,
// multipart/form-data, text/plain) or carries no content type at all.
// origin-check.test.ts proves the decision equals Astro's for every request
// outside the exception.
//
// The exception: a payment provider that returns the customer with a
// cross-site form POST, where the request authenticates itself with the
// provider's signature, verified by the route before anything changes. It is
// limited to an exact path, POST and one content type; nothing else is
// widened. GP webpay may return with GET (query string) or POST (form); both
// carry DIGEST/DIGEST1 signed with GP's private key, and the GET form was
// never subject to the origin check anyway.

const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const SIGNED_CROSS_SITE_POSTS: ReadonlyArray<{ path: string; contentType: string; reason: string }> = [
  { path: '/api/ask/billing/return/gpwebpay', contentType: 'application/x-www-form-urlencoded', reason: 'GP webpay return, RSA-signed (DIGEST, DIGEST1)' },
];

/** Astro's rule, verbatim in behaviour. */
export function isForbiddenCrossOrigin(request: Request, url: URL, isPrerendered: boolean): boolean {
  if (isPrerendered) return false;
  if (SAFE_METHODS.includes(request.method)) return false;
  const sameOrigin = request.headers.get('origin') === url.origin;
  const contentType = request.headers.get('content-type');
  if (contentType !== null) {
    const lower = contentType.toLowerCase();
    return FORM_CONTENT_TYPES.some((type) => lower.includes(type)) && !sameOrigin;
  }
  return !sameOrigin;
}

/** The one documented exception: exact path, POST, exact media type. */
export function isSignedCrossSitePost(request: Request, url: URL): boolean {
  if (request.method !== 'POST') return false;
  const mediaType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return SIGNED_CROSS_SITE_POSTS.some((entry) => entry.path === url.pathname && entry.contentType === mediaType);
}

/** A 403 response when the request must be refused, otherwise null. */
export function originCheck(request: Request, url: URL, isPrerendered: boolean): Response | null {
  if (!isForbiddenCrossOrigin(request, url, isPrerendered)) return null;
  if (isSignedCrossSitePost(request, url)) return null;
  return new Response(`Cross-site ${request.method} form submissions are forbidden`, { status: 403 });
}
