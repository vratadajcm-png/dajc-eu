import type { APIRoute } from 'astro';
import { guideAiAvailabilityResponse } from '../../../lib/ask/guide-entry';

// Public, read-only readiness signal for the existing Ask DAJC · FAQ button.
// Ask endpoints remain 404 when disabled; this endpoint always returns 200.
export const prerender = false;
export const GET: APIRoute = () => guideAiAvailabilityResponse();
