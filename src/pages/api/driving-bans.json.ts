import type { APIRoute } from 'astro';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { officialDrivingBansView } from '../../lib/driving-bans/public-view.mjs';
export const prerender = false;
export const GET: APIRoute = () => {
  const view = officialDrivingBansView(getDrivingBansSnapshot());
  return new Response(JSON.stringify(view), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-DAJC-Coverage-Version': view.coverage_version, 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
};
