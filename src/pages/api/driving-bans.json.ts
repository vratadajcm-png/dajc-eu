import type { APIRoute } from 'astro';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
export const prerender = false;
export const GET: APIRoute = () => new Response(JSON.stringify(getDrivingBansSnapshot()), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
