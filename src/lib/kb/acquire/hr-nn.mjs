// Croatia: Narodne novine. Official machine-readable routes: XML sitemaps
// (listed in robots/sitemap.xml), ELI URIs (/eli/sluzbeni/<year>/<issue>/<article>)
// redirecting on the same host to article_metadata.aspx?...&format=json-ld.
// Limit: 3 requests/s, serial. Reuse terms of narodne-novine.nn.hr are NOT yet
// verified (registry status UNKNOWN), so documents are discovered and their
// JSON-LD read, but nothing is imported into the library until the terms are
// recorded.

import { PoliteClient } from './polite-fetch.mjs';

export const NN_BASE = 'https://narodne-novine.nn.hr';
export const NN_MIN_INTERVAL_MS = 334;
export const nnClient = (options = {}) => new PoliteClient({ minIntervalMs: NN_MIN_INTERVAL_MS, ...options });

export const parseSitemapIndex = (xml) => [...xml.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
export const parseSitemapUrls = (xml) => [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1].trim(), lastmod: m[2] ?? null }));
export const eliUrl = ({ part = 'sluzbeni', year, issue, article }) => `${NN_BASE}/eli/${part}/${year}/${issue}/${article}`;

/** Sitemap entries changed since a date (catalogue-based discovery). */
export async function discoverHrChanges(client, { since, years = [new Date().getUTCFullYear()] }) {
  const index = parseSitemapIndex(new TextDecoder().decode((await client.get(`${NN_BASE}/sitemap.xml`, { accept: 'application/xml' })).bytes));
  const wanted = index.filter((u) => years.some((y) => u.includes(`_${y}`)));
  const changed = [];
  for (const url of wanted) {
    const urls = parseSitemapUrls(new TextDecoder().decode((await client.get(url, { accept: 'application/xml' })).bytes));
    changed.push(...urls.filter((u) => !u.lastmod || u.lastmod.slice(0, 10) >= since));
  }
  return changed;
}

/** JSON-LD metadata of one article via its ELI URI. */
export async function fetchHrJsonLd(client, ref) {
  const res = await client.get(eliUrl(ref), { accept: 'application/ld+json' });
  return JSON.parse(new TextDecoder().decode(res.bytes));
}
