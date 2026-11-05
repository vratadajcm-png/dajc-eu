// The DAJC AI customer account: consents, conversation history, personal
// memory, error reports, data export and account deletion (GDPR).
//
// - Every function takes the authenticated userId resolved from the session
//   cookie by the route; nothing here accepts a user id from a request body.
// - Personal content is sealed with crypto.ts, bound to the owner, and kept
//   only with a recorded consent for that purpose; withdrawing a consent
//   deletes the data it covered at once.
// - Shared learning from customer content needs an approved legal policy
//   (DAJC_AI_SHARED_LEARNING_POLICY_APPROVED, false): until then the consent
//   cannot even be given.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isTrackedJurisdiction } from '../../../../config/europe-coverage.mjs';
import { vehicleQuerySchema } from '../../intelligence/driving-bans-relevance';
import { open, seal, type DataKeyring } from '../crypto';
import { redactPersonalData } from '../pipeline';
import { CONSENT_TEXT_VERSION } from '../paid/config';
import type { ConsentPurpose, FeedbackCategory, MemoryKind, PaidStore } from '../store/paid-types';
import { CONSENT_PURPOSES, FEEDBACK_CATEGORIES, MEMORY_KINDS } from '../store/paid-types';

/** Customer conversations may feed shared knowledge only under an approved legal policy. */
export const DAJC_AI_SHARED_LEARNING_POLICY_APPROVED = false;
/** Document analysis by an AI provider needs the paid document feature (see paid/documents.ts). */
const PAID_ONLY: ConsentPurpose[] = ['HISTORY', 'MEMORY', 'AI_PERSONAL_CONTEXT', 'DOCUMENT_ANALYSIS'];

export interface AccountDeps {
  paid: PaidStore;
  keyring: DataKeyring | null;
  now?: () => Date;
  retention: { historyDays: number; historyMaxEntries: number; memoryDays: number; memoryMaxItems: number };
  /** Whether the user currently has paid access (resolved by the route from the ledger). */
  paidActive: boolean;
}

const nowOf = (deps: Pick<AccountDeps, 'now'>) => deps.now?.() ?? new Date();

export async function consentState(userId: string, deps: AccountDeps) {
  const current = new Map((await deps.paid.getConsents(userId)).map((c) => [c.purpose, c]));
  return CONSENT_PURPOSES.map((purpose) => ({
    purpose,
    granted: current.get(purpose)?.granted === true,
    version: current.get(purpose)?.version ?? null,
    at: current.get(purpose)?.at.toISOString() ?? null,
    available: purpose === 'SHARED_LEARNING' ? DAJC_AI_SHARED_LEARNING_POLICY_APPROVED : (!PAID_ONLY.includes(purpose) || deps.paidActive) && deps.keyring !== null,
  }));
}

export type ConsentOutcome = 'ok' | 'invalid' | 'unavailable';

export async function setConsent(userId: string, purposeRaw: unknown, granted: unknown, deps: AccountDeps): Promise<ConsentOutcome> {
  const purpose = String(purposeRaw) as ConsentPurpose;
  if (!CONSENT_PURPOSES.includes(purpose) || typeof granted !== 'boolean') return 'invalid';
  if (granted) {
    if (purpose === 'SHARED_LEARNING' && !DAJC_AI_SHARED_LEARNING_POLICY_APPROVED) return 'unavailable';
    if ((PAID_ONLY.includes(purpose) && !deps.paidActive) || !deps.keyring) return 'unavailable';
  }
  const now = nowOf(deps);
  await deps.paid.recordConsent(userId, purpose, CONSENT_TEXT_VERSION, granted, now);
  if (!granted && purpose === 'HISTORY') await deps.paid.deleteHistory(userId, 'all');
  if (!granted && purpose === 'MEMORY') await deps.paid.deleteMemory(userId, 'all');
  await deps.paid.appendAudit({ actor: `user:${userId}`, action: granted ? 'CONSENT_GRANTED' : 'CONSENT_WITHDRAWN', subject: `user:${userId}`, details: { purpose, version: CONSENT_TEXT_VERSION } }, now);
  return 'ok';
}

export async function hasConsent(userId: string, purpose: ConsentPurpose, deps: Pick<AccountDeps, 'paid'>): Promise<boolean> {
  return (await deps.paid.getConsents(userId)).some((c) => c.purpose === purpose && c.granted);
}

// --- History -----------------------------------------------------------------

export interface HistoryContent {
  question: string;
  answer: unknown;
  lang: string;
  level: string;
}

/** Stores one exchange when the user consented to history; returns whether it was stored. */
export async function rememberExchange(userId: string, content: HistoryContent, deps: AccountDeps): Promise<boolean> {
  if (!deps.keyring || !deps.paidActive || !(await hasConsent(userId, 'HISTORY', deps))) return false;
  const now = nowOf(deps);
  const sealed = seal(deps.keyring, 'history', userId, { ...content, question: redactPersonalData(content.question) });
  await deps.paid.addHistory(userId, { ...sealed, createdAt: now, expiresAt: new Date(now.getTime() + deps.retention.historyDays * 86_400_000) }, deps.retention.historyMaxEntries);
  return true;
}

export async function listHistory(userId: string, deps: AccountDeps, limit = 50) {
  if (!deps.keyring) return [];
  const rows = await deps.paid.listHistory(userId, nowOf(deps), Math.min(Math.max(limit, 1), 200));
  return rows.map((row) => {
    try {
      return { id: row.id, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), ...open<HistoryContent>(deps.keyring!, 'history', userId, row) };
    } catch {
      return { id: row.id, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), unreadable: true };
    }
  });
}

// --- Memory ------------------------------------------------------------------

const name = z.string().trim().min(1).max(80);
const jurisdiction = z.string().refine(isTrackedJurisdiction, 'Untracked jurisdiction');
export const memorySchemas: Record<MemoryKind, z.ZodTypeAny> = {
  VEHICLE: z.object({ name, vehicle: vehicleQuerySchema }).strict(),
  CARGO: z.object({
    name,
    lengthM: z.number().positive().max(100).optional(),
    widthM: z.number().positive().max(20).optional(),
    heightM: z.number().positive().max(20).optional(),
    massKg: z.number().positive().max(500_000).optional(),
    indivisible: z.boolean().optional(),
  }).strict(),
  ROUTE: z.object({ name, jurisdictions: z.array(jurisdiction).min(1).max(20), roads: z.array(z.string().trim().min(1).max(40)).max(30).default([]) }).strict(),
  PREFERENCE: z.object({ name, lang: z.enum(['en', 'cs']).optional(), jurisdictions: z.array(jurisdiction).max(20).optional() }).strict(),
};

export type MemoryOutcome = { status: 'ok'; id: string } | { status: 'invalid' | 'no_consent' | 'limit' | 'not_found' | 'unavailable' };

export async function saveMemory(userId: string, input: { id?: unknown; kind?: unknown; content?: unknown }, deps: AccountDeps): Promise<MemoryOutcome> {
  if (!deps.keyring || !deps.paidActive) return { status: 'unavailable' };
  if (!(await hasConsent(userId, 'MEMORY', deps))) return { status: 'no_consent' };
  const kind = String(input.kind) as MemoryKind;
  if (!MEMORY_KINDS.includes(kind)) return { status: 'invalid' };
  const parsed = memorySchemas[kind].safeParse(input.content);
  if (!parsed.success) return { status: 'invalid' };
  const id = typeof input.id === 'string' && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : null;
  if (input.id !== undefined && input.id !== null && !id) return { status: 'invalid' };
  const now = nowOf(deps);
  const sealed = seal(deps.keyring, 'memory', userId, { kind, ...parsed.data });
  const result = await deps.paid.upsertMemory(userId, { id, kind, ...sealed, now, expiresAt: new Date(now.getTime() + deps.retention.memoryDays * 86_400_000) }, deps.retention.memoryMaxItems);
  return result.status === 'ok' ? { status: 'ok', id: result.id } : { status: result.status };
}

export async function listMemory(userId: string, deps: AccountDeps) {
  if (!deps.keyring) return [];
  return (await deps.paid.listMemory(userId, nowOf(deps))).map((row) => {
    try {
      return { id: row.id, kind: row.kind, updatedAt: row.updatedAt.toISOString(), content: open<Record<string, unknown>>(deps.keyring!, 'memory', userId, row) };
    } catch {
      return { id: row.id, kind: row.kind, updatedAt: row.updatedAt.toISOString(), content: null, unreadable: true };
    }
  });
}

/** One memory item of the signed-in user, decrypted; null if it is not theirs. */
export async function memoryItem(userId: string, id: unknown, kind: MemoryKind, deps: AccountDeps): Promise<Record<string, unknown> | null> {
  if (typeof id !== 'string') return null;
  const item = (await listMemory(userId, deps)).find((m) => m.id === id && m.kind === kind);
  return item?.content ?? null;
}

// --- Feedback ("report an error") -------------------------------------------

export function answerFingerprint(answer: unknown): string {
  return createHash('sha256').update(JSON.stringify(answer ?? null), 'utf8').digest('hex');
}

export async function reportError(userId: string, input: { category?: unknown; answer?: unknown; comment?: unknown }, deps: AccountDeps & { rateLimit: (key: string) => Promise<boolean> }): Promise<'ok' | 'invalid' | 'limited'> {
  const category = String(input.category) as FeedbackCategory;
  const answer = input.answer as { level?: unknown; sources?: Array<{ url?: unknown }> } | undefined;
  if (!FEEDBACK_CATEGORIES.includes(category) || !answer || typeof answer !== 'object') return 'invalid';
  const level = typeof answer.level === 'string' ? answer.level.slice(0, 40) : 'UNKNOWN';
  const comment = typeof input.comment === 'string' ? redactPersonalData(input.comment.trim()).slice(0, 1000) : '';
  if (!(await deps.rateLimit(`feedback:${userId}`))) return 'limited';
  // Only official source URLs of the answer are kept in clear text.
  const sourceUrls = (Array.isArray(answer.sources) ? answer.sources : [])
    .map((s) => (typeof s?.url === 'string' ? s.url : ''))
    .filter((url) => /^https:\/\/[^\s]{4,500}$/.test(url))
    .slice(0, 10);
  const now = nowOf(deps);
  const sealed = comment && deps.keyring ? seal(deps.keyring, 'feedback', userId, { comment }) : null;
  await deps.paid.addFeedback(userId, {
    createdAt: now, category, answerLevel: level, answerFingerprint: answerFingerprint(input.answer), sourceUrls,
    keyId: sealed?.keyId ?? null, commentCiphertext: sealed?.ciphertext ?? null,
    sharedLearningConsent: DAJC_AI_SHARED_LEARNING_POLICY_APPROVED && (await hasConsent(userId, 'SHARED_LEARNING', deps)),
  });
  await deps.paid.appendAudit({ actor: `user:${userId}`, action: 'ERROR_REPORTED', subject: `user:${userId}`, details: { category, level } }, now);
  return 'ok';
}

// --- Data subject rights -----------------------------------------------------

/** Everything DAJC holds about the signed-in user, decrypted for them (Art. 15/20 GDPR). */
export async function exportAccount(userId: string, deps: AccountDeps) {
  const data = await deps.paid.exportUserData(userId);
  const decrypt = <T>(purpose: 'history' | 'memory' | 'feedback', row: { keyId: string | null; ciphertext: string | null }) => {
    if (!deps.keyring || !row.keyId || !row.ciphertext) return null;
    try {
      return open<T>(deps.keyring, purpose, userId, { keyId: row.keyId, ciphertext: row.ciphertext });
    } catch {
      return null;
    }
  };
  return {
    exportedAt: nowOf(deps).toISOString(),
    note: 'DAJC stores no e-mail address (only a one-way fingerprint), no card or bank data.',
    userId,
    consents: data.consents.map((c) => ({ ...c, at: c.at.toISOString() })),
    history: data.history.map((h) => ({ id: h.id, createdAt: h.createdAt.toISOString(), expiresAt: h.expiresAt.toISOString(), content: decrypt('history', h) })),
    memory: data.memory.map((m) => ({ id: m.id, kind: m.kind, updatedAt: m.updatedAt.toISOString(), content: decrypt('memory', m) })),
    errorReports: data.feedback.map((f) => ({ id: f.id, createdAt: f.createdAt.toISOString(), category: f.category, level: f.answerLevel, sources: f.sourceUrls, comment: decrypt<{ comment: string }>('feedback', { keyId: f.keyId, ciphertext: f.commentCiphertext })?.comment ?? null, status: f.status })),
    paidUsage: data.usage,
    subscription: data.subscription ? { provider: data.subscription.provider, periods: data.subscription.settled, reversed: data.subscription.reversedPaymentRefs, cancelAtPeriodEnd: data.subscription.cancelAtPeriodEnd } : null,
    refunds: data.refunds.map((r) => ({ paymentRef: r.paymentRef, status: r.status, createdAt: r.createdAt.toISOString() })),
  };
}

/**
 * Deletes the account (Art. 17 GDPR). Renewal is cancelled first so no
 * further charge happens; billing records required by tax law stay, without
 * any link to the e-mail fingerprint.
 */
export async function deleteAccount(userId: string, deps: AccountDeps & { cancelRenewal: () => Promise<'requested' | 'no_subscription' | 'unavailable'> }): Promise<'deleted' | 'unavailable'> {
  // Never leave a renewing card subscription behind a deleted account.
  if ((await deps.cancelRenewal()) === 'unavailable') return 'unavailable';
  await deps.paid.deleteUser(userId, nowOf(deps));
  return 'deleted';
}
