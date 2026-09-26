import type { APIRoute } from 'astro';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { toIcs } from '../../lib/driving-bans/core.mjs';
export const prerender = false;
/** rolling=1 is retained for old subscriptions; it means current+next calendar month. */
export const GET: APIRoute = ({ request }) => {
  const url = new URL(request.url);
  const view = getDrivingBansSnapshot();
  const countries = [...new Set((url.searchParams.get('countries') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
  const type = url.searchParams.get('type') || 'all';
  const headers = { 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  for (const key of ['from', 'to']) {
    if (url.searchParams.has(key) && url.searchParams.get(key) !== view.window[key]) return new Response('The public feed covers the current and next calendar month only.', { status: 400, headers });
  }
  try {
    return new Response(toIcs(view, { countries, type, upcoming: url.searchParams.get('history') !== '1' }), { headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="dajc-driving-bans.ics"' } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Invalid calendar request', { status: 400, headers });
  }
};
