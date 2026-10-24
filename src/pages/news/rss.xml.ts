import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildNewsRss, isNewsEntryPublic, NEWS_PAGE_CACHE_CONTROL } from '../../config/news';

// On demand like /news, so a Weekly appears in the feed at its Friday 12:00
// Europe/Prague slot without a rebuild. Same visibility rules as /news:
// drafts and hidden Platform/Ecosystem material never enter the feed.
export const prerender = false;

export const GET: APIRoute = async ({ site }) => {
  const now = new Date();
  const euOversize = await getCollection('eu-oversize', ({ data }) => isNewsEntryPublic(data, now));
  const platform = await getCollection('platform', ({ data }) => data.status === 'published');
  const origin = (site?.origin ?? 'https://www.dajc.eu').replace(/\/$/, '');
  return new Response(buildNewsRss([...euOversize, ...platform], origin), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': NEWS_PAGE_CACHE_CONTROL },
  });
};
