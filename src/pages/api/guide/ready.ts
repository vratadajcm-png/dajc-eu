import type { APIRoute } from 'astro';
import { guideAiAvailabilityResponse } from '../../../lib/ask/guide-entry';

// Public, read-only readiness signal for the existing Ask DAJC · FAQ button.
// Ask endpoints remain gated; the public guide check always returns 200.
export const prerender = false;
export const GET: APIRoute = () => guideAiAvailabilityResponse();
