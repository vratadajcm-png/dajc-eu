// Cross-validation of the model's returned developments against the actual
// verified candidate set (see generate-weekly-article.mjs). The model is
// instructed to copy sourceUrl/sourceName exactly from the supplied
// candidates and never invent one - this is the concrete enforcement of
// that instruction: any development whose sourceUrl does not match a
// verified candidate, character for character, is dropped before it can
// reach the article. Pulled out as a pure function so it is unit-testable
// without an OpenAI call.
export function crossValidateDevelopments(developments, verifiedCandidates) {
  const verifiedUrls = new Set(verifiedCandidates.map((c) => c.sourceUrl));
  const kept = developments.filter((item) => verifiedUrls.has(item.sourceUrl));
  return { kept, droppedCount: developments.length - kept.length };
}
