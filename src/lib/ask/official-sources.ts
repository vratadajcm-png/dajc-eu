// Official-domain sources for answers. Reuses the article pipeline's source
// policy and fetcher read-only (scripts/lib is never modified):
//   - source-policy.mjs decides what an official publisher is and excludes
//     DAJC's own sites, exactly as for the Weekly;
//   - fetch-source.mjs fetchTextWithRetry() downloads the page.
// A URL is used only if it is an official publisher both before and after
// redirects. Page content is data for the models, never instructions.

import { isOfficialPublisher, isOwnPublication } from '../../../scripts/lib/source-policy.mjs';
import { fetchTextWithRetry } from '../../../scripts/lib/fetch-source.mjs';
import { looksBinary } from '../../../scripts/lib/text-quality.mjs';
import { extractPublicationDate } from '../../../scripts/lib/publication-date.mjs';
import { cleanUrl } from '../../../scripts/lib/web-search.mjs';
import { coverageName } from '../../../config/europe-coverage.mjs';
import { htmlToText, pageTitle } from './text';

export type FetchPage = (url: string) => Promise<{ ok: boolean; text?: string; finalUrl?: string; error?: string }>;

export interface OfficialPage {
  url: string;
  host: string;
  title: string | null;
  text: string;
  publishedAt: string | null;
}

const MIN_TEXT_CHARS = 200;
const IP_HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

export function defaultFetchPage(url: string) {
  return fetchTextWithRetry(url, 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1');
}

/** Official publisher, not DAJC's own site, plain http(s) on a default port, no IP hosts or credentials. */
export function isAllowedSourceUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password || url.port) return false;
  if (IP_HOST.test(url.hostname)) return false;
  return isOfficialPublisher(url.toString()) && !isOwnPublication(url.toString());
}

export function normalizeSourceUrl(raw: string): string | null {
  try {
    return cleanUrl(raw);
  } catch {
    return null;
  }
}

export async function fetchOfficialPage(
  rawUrl: string,
  { fetchPage = defaultFetchPage, jurisdiction = null, now = new Date() }: { fetchPage?: FetchPage; jurisdiction?: string | null; now?: Date } = {},
): Promise<{ ok: true; page: OfficialPage } | { ok: false; reason: string }> {
  const requested = normalizeSourceUrl(rawUrl);
  if (!requested || !isAllowedSourceUrl(requested)) return { ok: false, reason: 'not an allowed official source' };
  const fetched = await fetchPage(requested);
  if (!fetched?.ok) return { ok: false, reason: `not reachable (${fetched?.error || 'unknown'})` };
  const finalUrl = normalizeSourceUrl(fetched.finalUrl || requested);
  if (!finalUrl || !isAllowedSourceUrl(finalUrl)) return { ok: false, reason: 'redirected outside the allowed official sources' };
  const html = fetched.text || '';
  // PDFs and other binaries cannot be read as text in Phase 1.
  if (looksBinary(html)) return { ok: false, reason: 'binary document' };
  const text = htmlToText(html);
  if (text.length < MIN_TEXT_CHARS) return { ok: false, reason: 'no readable text' };
  let publishedAt: string | null = null;
  try {
    publishedAt = extractPublicationDate({ html, text: text.slice(0, 5000), url: finalUrl, country: jurisdiction ? coverageName(jurisdiction) : '', now })?.date ?? null;
  } catch {
    publishedAt = null;
  }
  return {
    ok: true,
    page: { url: finalUrl, host: new URL(finalUrl).hostname.replace(/^www\./, ''), title: pageTitle(html), text, publishedAt },
  };
}
