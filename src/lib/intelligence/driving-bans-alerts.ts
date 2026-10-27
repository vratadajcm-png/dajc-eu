import { buildAlertCandidates, type IntelligenceAlertRecipient } from './alerts';
import { intelligenceChangeSchema, type IntelligenceChange } from './preferences';
import { detectChanges } from '../driving-bans/legal-changes.mjs';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';
import { hydrateCanonical } from '../driving-bans/core.mjs';

/**
 * Bridge from classified Driving Bans changes (src/lib/driving-bans/legal-changes.mjs)
 * to the existing Intelligence alert pipeline (preferences.ts / alerts.ts). Metadata-only
 * changes never alert; a lost source alerts as withdrawn verification, never as a
 * cancelled ban.
 */

type LegalChange = ReturnType<typeof detectChanges>[number];

const MAPPING: Record<string, { changeType: IntelligenceChange['changeType']; materiality: IntelligenceChange['materiality'] } | undefined> = {
  NEW_RULE: { changeType: 'added', materiality: 'high' },
  AMENDED_RULE: { changeType: 'changed', materiality: 'high' },
  CANCELLED_RULE: { changeType: 'cancelled', materiality: 'high' },
  SUPERSEDED_RULE: { changeType: 'changed', materiality: 'medium' },
  NEW_EXCEPTION: { changeType: 'changed', materiality: 'medium' },
  REMOVED_EXCEPTION: { changeType: 'changed', materiality: 'high' },
  SOURCE_UNAVAILABLE: { changeType: 'changed', materiality: 'high' },
  EXPIRED_EVIDENCE: { changeType: 'changed', materiality: 'medium' },
};

export function legalChangeToIntelligenceChange(change: LegalChange, observedAt: string): IntelligenceChange | null {
  const mapped = MAPPING[change.type];
  if (!mapped || !change.jurisdiction) return null;
  const prefix = change.type === 'SOURCE_UNAVAILABLE' ? 'Verification withdrawn (ban NOT cancelled)' : change.type === 'EXPIRED_EVIDENCE' ? 'Not sufficiently verified' : change.type.replaceAll('_', ' ').toLowerCase();
  return intelligenceChangeSchema.parse({
    id: change.change_id,
    jurisdiction: change.jurisdiction,
    topic: 'driving-ban',
    ...mapped,
    effectiveFrom: change.legal_effective_from ? `${change.legal_effective_from}T00:00:00.000Z` : undefined,
    observedAt,
    summary: `${prefix}: ${change.ban_id ?? change.source_id ?? change.jurisdiction}. ${change.user_impact}`,
  });
}

export function buildDrivingBansAlerts(args: { changes: LegalChange[]; recipients: IntelligenceAlertRecipient[]; createdAt: string }) {
  const changes = args.changes.map(change => legalChangeToIntelligenceChange(change, args.createdAt)).filter((change): change is IntelligenceChange => change !== null);
  return buildAlertCandidates({ changes, recipients: args.recipients, createdAt: args.createdAt });
}

/** Rules whose validity ends within the given number of days: "relevant rule expires" notices. */
export function expiringRuleNotices(view: { events: Array<{ ban_id: string; jurisdiction: string; valid_to: string; title: string; source_url: string; source_authority: string }> }, now: Date, days: number, observedAt = now.toISOString()): IntelligenceChange[] {
  const today = now.toISOString().slice(0, 10);
  const limit = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const seen = new Map<string, IntelligenceChange>();
  for (const event of view.events) {
    if (event.valid_to < today || event.valid_to > limit || seen.has(event.ban_id)) continue;
    seen.set(event.ban_id, intelligenceChangeSchema.parse({
      id: `expiry:${event.ban_id}:${event.valid_to}`, jurisdiction: event.jurisdiction, topic: 'driving-ban', changeType: 'changed', materiality: 'medium',
      effectiveTo: `${event.valid_to}T23:59:59.999Z`, sourceUrl: event.source_url, sourceLabel: event.source_authority, observedAt,
      summary: `Rule ${event.ban_id} (${event.title}) ends on ${event.valid_to}; check whether it is renewed.`,
    }));
  }
  return [...seen.values()];
}

/**
 * Driving Bans History: per-rule entries across dataset versions (e.g. from git history),
 * each with the classified changes and the evidence that backed the version.
 */
export function buildRuleHistory(versions: Array<{ dataset_version: string; data: unknown }>, banId: string) {
  const hydrated = versions.map(version => ({ version: version.dataset_version, data: hydrateCanonical(version.data, dajcEuropeCoverage) }));
  const entries = [];
  for (let index = 0; index < hydrated.length; index++) {
    const current = hydrated[index].data.rules.find((rule: { ban_id: string }) => rule.ban_id === banId);
    const changes = index === 0 ? [] : detectChanges(hydrated[index - 1].data, hydrated[index].data, { detectedAt: hydrated[index].version }).filter(change => change.ban_id === banId || (change.ban_id ?? '').split(',').includes(banId));
    if (!current && !changes.length) continue;
    if (index > 0 && !changes.length) continue;
    entries.push({
      dataset_version: hydrated[index].version,
      present: Boolean(current),
      status: current?.status ?? null, sequence: current?.sequence ?? null, verified_at: current?.verified_at ?? null,
      source_version: current?.source_version ?? null, evidence_ids: current?.evidence_ids ?? [],
      changes: changes.map(change => ({ change_id: change.change_id, type: change.type, field: change.field, legal_change: change.legal_change })),
    });
  }
  return entries;
}
