/**
 * DAJC AI paid Driving Bans read-only entry, Phase A. OFF in production.
 * Reuses the existing verified register, AI tool contract and Ask identity.
 * No second model pipeline, no second rules database and no browser-provided
 * tenant or entitlement. No HTTP route or payment ingestion is installed.
 */
import { currentUserId } from '../ask/auth';
import type { AskStore } from '../ask/store/types';
import {
  AI_TOOLS, answerDrivingBansQuery, type AiAnswer,
} from '../intelligence/driving-bans-ai-contract';
import { readPublishedView, type PublishedView } from '../intelligence/driving-bans-query';
import { DAJC_AI_PAID_RELEASED, paidAccess, type SubscriptionLedger } from '../ask/paid/subscription';

export interface PaidBansDeps {
  store: AskStore;
  /** Server-only lookup in a future signed-webhook-backed subscription store. */
  findSubscription: (userId: string) => Promise<SubscriptionLedger | null>;
  sessionToken: string | undefined;
  tool: string;
  input: unknown;
  now: Date;
  env: Record<string, string | undefined>;
  /** No public route may provide this. Used solely by offline contract tests. */
  released?: boolean;
  view?: PublishedView;
}

export type PaidBansResult =
  | { status: 'DISABLED' | 'UNAUTHENTICATED' | 'NOT_PAID' | 'INVALID_TOOL'; answer: null }
  | { status: 'ANSWER'; answer: AiAnswer };

/** Financial or legal state is NEVER inferred from prompts or client JSON. */
export async function answerPaidDrivingBans(deps: PaidBansDeps): Promise<PaidBansResult> {
  // Block even a database read when disabled; the static release flag is OFF.
  if ((deps.released ?? DAJC_AI_PAID_RELEASED) !== true || deps.env.DAJC_AI_PAID_ENABLED !== 'true' ||
      deps.env.DAJC_AI_DRIVING_BANS_ENABLED !== 'true') {
    return { status: 'DISABLED', answer: null };
  }
  if (!(AI_TOOLS as readonly string[]).includes(deps.tool)) return { status: 'INVALID_TOOL', answer: null };

  const userId = await currentUserId(deps.sessionToken, { store: deps.store, now: deps.now });
  if (!userId) return { status: 'UNAUTHENTICATED', answer: null };
  const ledger = await deps.findSubscription(userId);
  const paid = paidAccess({
    authenticatedUserId: userId, ledger, now: deps.now, env: deps.env, released: deps.released,
  });
  if (!paid.allowed || !paid.paidUntil) return { status: 'NOT_PAID', answer: null };

  // Each individual Ask account is a distinct logical organisation for the
  // existing tenant-scoped Intelligence authorization contract. Never read an
  // organization ID or user ID from the incoming query/body.
  const organizationId = 'ask-personal:' + userId;
  const answer = answerDrivingBansQuery({
    tool: deps.tool, input: deps.input,
    subject: { organizationId, userId },
    entitlement: { organizationId, features: ['ai-assistant'], validUntil: paid.paidUntil },
    now: deps.now,
    view: deps.view ?? readPublishedView(deps.now),
    env: deps.env,
    // The *upstream* hard-off release gate above is independent of the
    // shared Intelligence product's release flag.
    released: true,
  });
  return { status: 'ANSWER', answer };
}
