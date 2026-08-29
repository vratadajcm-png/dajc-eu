// Legacy compatibility hook retained for the generator pipeline.
// The old implementation promoted official annual-calendar restrictions until
// a fixed 10-report lead floor was reached. That behavior is intentionally
// removed: DAJC Weekly is now change-driven and must not inject unchanged
// year-round Sunday bans merely to satisfy an article count.

export function ensureOfficialCalendarLeadFloor(article) {
  const developments = [...(article.developments || [])];
  const europeRoundup = [...(article.europeRoundup || [])].filter(
    (item) => item.recommendedAction && item.recommendedAction.trim().length >= 10
  );

  return {
    article: { ...article, developments, europeRoundup },
    added: 0,
    promoted: 0,
  };
}
