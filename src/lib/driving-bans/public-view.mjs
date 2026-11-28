/**
 * Public-only projection of the canonical Driving Bans snapshot.
 * A country appears only when a rule is individually primary-source verified
 * or the entire publication window has an explicitly verified NO_BAN review.
 * This does not grant whole-country verification to a verified regional rule.
 * The internal 50-jurisdiction registry and canonical dataset remain unchanged.
 */
export function officialDrivingBansView(view) {
  const primarySources = new Map(view.sources
    .filter(source => source.role === 'PRIMARY' && source.availability !== 'SOURCE_UNAVAILABLE')
    .map(source => [source.source_id, source]));
  const events = view.events.filter(event =>
    event.verification_state === 'PRIMARY_VERIFIED'
    && Boolean(event.verified_at)
    && primarySources.get(event.source_id)?.url === event.source_url
  );
  const eventIds = new Set(events.map(event => event.uid));
  const counts = new Map();
  for (const event of events) counts.set(event.jurisdiction, (counts.get(event.jurisdiction) || 0) + 1);
  const noBanVerified = row =>
    row.ban_state === 'NO_BAN' && row.coverage_complete
    && row.verification_state === 'PRIMARY_VERIFIED' && Boolean(row.last_verified)
    && row.no_ban_evidence?.some(evidence =>
      evidence.explicit_no_ban === true && primarySources.has(evidence.source_id));
  const jurisdictions = view.jurisdictions
    .filter(row => counts.has(row.jurisdiction) || noBanVerified(row))
    .map(row => ({
      ...row,
      event_count: counts.get(row.jurisdiction) || 0,
      source_ids: row.source_ids.filter(id => primarySources.has(id)),
    }));
  const usedSourceIds = new Set(events.map(event => event.source_id));
  for (const row of jurisdictions) {
    if (noBanVerified(row)) for (const evidence of row.no_ban_evidence) usedSourceIds.add(evidence.source_id);
  }
  return {
    ...view,
    jurisdictions,
    events,
    upcoming_events: view.upcoming_events.filter(event => eventIds.has(event.uid)),
    sources: view.sources.filter(source => usedSourceIds.has(source.source_id) && primarySources.has(source.source_id)),
    tracked_jurisdictions: view.jurisdictions.length,
    publication_policy: 'PRIMARY_SOURCE_VERIFIED_SCOPES_ONLY',
  };
}
