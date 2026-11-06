import type { APIRoute } from 'astro';
import { getAccountRuntime } from '../../../../lib/ask/account/runtime';
import { handleBilling } from '../../../../lib/ask/account-handlers';

// DAJC AI account / paid DAJC AI - see docs/DAJC_AI_PAID_OPERATIONS.md.
// 404 while Ask DAJC AI, DAJC_AI_ACCOUNT_ENABLED or (for paid routes) the
// paid release and configuration are not all in place.
export const prerender = false;

export const ALL: APIRoute = ({ params, request, url, cookies, clientAddress }) =>
  handleBilling(String(params.action ?? ''), { request, url, cookies, clientAddress }, getAccountRuntime());
