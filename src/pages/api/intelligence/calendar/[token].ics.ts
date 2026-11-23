import type { APIRoute } from 'astro';
import { notFoundUnlessIntelligenceAccounts } from '../../../../portal/lib/guards';
import { readPublishedDrivingBans } from '../../../../lib/intelligence/driving-bans-adapter';
import { handleCalendarFeedRequest } from '../../../../lib/intelligence/driving-bans-calendar';
import { createDbCalendarTokenStore, resolveEntitlement } from '../../../../lib/intelligence/accounts';

export const prerender = false;

/**
 * Personal DAJC Intelligence calendar (secret URL). Behind the accounts gate here and in
 * src/middleware.ts; the handler checks the module, the calendar feature and the
 * organisation's entitlement again on every fetch.
 */
export const GET: APIRoute = async ({ request, params }) => {
  const disabled = notFoundUnlessIntelligenceAccounts();
  if (disabled) return disabled;
  const now = new Date();
  return handleCalendarFeedRequest({
    request,
    token: params.token,
    store: createDbCalendarTokenStore(),
    resolveEntitlement: organisationId => resolveEntitlement(organisationId, now),
    readView: at => readPublishedDrivingBans(at) as never,
    now,
  });
};
export const HEAD = GET;
