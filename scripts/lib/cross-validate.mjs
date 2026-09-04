// Cross-validates generated reports against the verified candidate set.
// Source URL is the immutable identity. Factual source-controlled fields are
// restored from the verified record so the model cannot alter source identity
// or invent textual date placeholders such as "Ongoing" / "Indefinite".
export function crossValidateDevelopments(developments = [], verifiedCandidates = []) {
  const byUrl = new Map(
    verifiedCandidates.filter((c) => c?.sourceUrl).map((c) => [c.sourceUrl, c])
  );
  const kept = [];
  for (const item of developments || []) {
    const candidate = byUrl.get(item?.sourceUrl);
    if (!candidate) continue;
    kept.push({
      ...item,
      country: candidate.country || item.country || '',
      sourceName: candidate.sourceName || item.sourceName || '',
      sourceUrl: candidate.sourceUrl,
      // Candidate dates have already passed deterministic verification before
      // the OpenAI synthesis call. They are therefore authoritative. If the
      // official source does not provide an exact date, keep it unknown (null)
      // rather than accepting a model-generated prose placeholder.
      validFrom: candidate.validFrom || null,
      validTo: candidate.validTo || null,
      additionalSources: candidate.additionalSources || item.additionalSources || [],
    });
  }
  return { kept, droppedCount: (developments || []).length - kept.length };
}
