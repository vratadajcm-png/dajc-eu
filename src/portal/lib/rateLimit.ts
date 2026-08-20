// DB-backed rate limiting for auth and invitation flows. In-memory counters
// would not work here: each on-demand portal route runs as an independent
// serverless invocation with no shared process memory, so the counter has
// to live somewhere all instances see - the same Postgres database
// everything else already uses.
import { and, gte, sql } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { rateLimitEvents } from '../db/schema';

export interface RateLimitConfig {
  /** Logical action being limited, e.g. "login_request", "invitation_accept". */
  action: string;
  /** Sliding window in seconds. */
  windowSeconds: number;
  /** Max allowed events within the window before further attempts are denied. */
  maxAttempts: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

// `identifier` is caller-chosen: an IP address for anonymous flows (login
// request, invitation accept-attempt), or a partner/invitation id for
// per-resource limits. Recording happens unconditionally so a flood of
// denied attempts still counts against the window (no free retries by
// spamming a route that itself refuses to record on denial).
export async function checkAndRecordRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const db = getPortalDb();
  const bucketKey = `${config.action}:${identifier}`;
  const windowStart = new Date(Date.now() - config.windowSeconds * 1000);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rateLimitEvents)
    .where(and(sql`${rateLimitEvents.bucketKey} = ${bucketKey}`, gte(rateLimitEvents.createdAt, windowStart)));

  if (count >= config.maxAttempts) {
    return { allowed: false, remaining: 0 };
  }

  await db.insert(rateLimitEvents).values({ bucketKey });

  return { allowed: true, remaining: Math.max(0, config.maxAttempts - count - 1) };
}
