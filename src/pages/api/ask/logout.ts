import type { APIRoute } from 'astro';
import { handleLogout } from '../../../lib/ask/handlers';
import { getAskRuntime } from '../../../lib/ask/runtime';

// Ask DAJC AI - see docs/ASK_DAJC_AI.md. 404 while DAJC_ASK_ENABLED is not "true"
// or the configuration is incomplete.
export const prerender = false;

export const ALL: APIRoute = ({ request, url, cookies, clientAddress }) =>
  handleLogout({ request, url, cookies, clientAddress }, getAskRuntime());
