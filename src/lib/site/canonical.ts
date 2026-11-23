/** One canonical spelling for all public DAJC.eu page paths.
 * Redirects are a separate hosting concern; this fixes metadata and sitemap agreement.
 */
export function canonicalPathname(pathname: string): string {
  if (!pathname.startsWith('/')) throw new TypeError('Expected an absolute URL pathname');
  return pathname === '/' ? '/' : pathname.replace(/\/+$/, '') || '/';
}

export function canonicalSiteUrl(pathname: string, origin = 'https://www.dajc.eu'): string {
  return new URL(canonicalPathname(pathname), origin).toString();
}
