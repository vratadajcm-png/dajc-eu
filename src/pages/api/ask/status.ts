import type { APIRoute } from 'astro';
import { handleStatus } from '../../../lib/ask/handlers';
import { getAskRuntime } from '../../../lib/ask/runtime';

// Ask DAJC AI - see docs/ASK_DAJC_AI.md. 404 while DAJC_ASK_ENABLED is not "true"
// or the configuration is incomplete.
export const prerender = false;

export const ALL: APIRoute = ({ request, url, cookies, clientAddress }) =>
  handleStatus({ request, url, cookies, clientAddress }, getAskRuntime());
