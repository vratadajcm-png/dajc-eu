// Deterministic filter for every item the model returns. The model may only
// select, structure and phrase verified candidates; this filter re-applies
// the complete Weekly eligibility check to the underlying verified record and
// the text-level rules to the model's own wording, so a prompt-following
// failure can never publish something the rules exclude.

import { validateDevelopmentDateRange } from './date-validation.mjs';
import { checkLongRoadClosure } from './closure-duration.mjs';
import { checkTransportDomainRelevance } from './transport-domain.mjs';
import { checkWeeklyDrivingBanPolicy } from './weekly-driving-ban-policy.mjs';
import { checkWeeklyEligibility } from './weekly-eligibility.mjs';

/**
 * Checks one generated item. `candidate` is the verified record behind the
 * item's sourceUrl (when known) and is judged with the full eligibility rules.
 */
export function checkGeneratedItem(item, { weekStart, weekEnd, candidate = null, eligibilityContext = null } = {}) {
  if (!item?.sourceUrl) return { ok: false, reason: 'missing sourceUrl' };

  // Text-level rules on the model's own wording first ...
  const closure = checkLongRoadClosure(item);
  if (!closure.ok) return closure;

  const ban = checkWeeklyDrivingBanPolicy(item);
  if (!ban.ok) return ban;

  // ... then the full eligibility of the verified record behind the item.
  if (candidate && eligibilityContext) {
    const eligibility = checkWeeklyEligibility(candidate, eligibilityContext);
    if (!eligibility.ok) return eligibility;
  } else {
    const domain = checkTransportDomainRelevance(item);
    if (!domain.ok) return domain;
  }

  if (weekStart && weekEnd) {
    const date = validateDevelopmentDateRange(
      { validFrom: item.validFrom, validTo: item.validTo },
      { weekStart, weekEnd }
    );
    if (!date.ok) return date;
  }

  if (!item.recommendedAction || item.recommendedAction.trim().length < 10) {
    return { ok: false, reason: 'no meaningful recommendedAction' };
  }
  return { ok: true };
}

export function filterGeneratedItems(
  items = [],
  { weekStart, weekEnd, usedSourceUrls = new Set(), candidatesByUrl = null, eligibilityContext = null } = {}
) {
  const kept = [];
  const dropped = [];
  const seen = new Set(usedSourceUrls);

  for (const item of items || []) {
    let reason = null;
    if (!item?.sourceUrl) reason = 'missing sourceUrl';
    else if (seen.has(item.sourceUrl)) reason = 'duplicate sourceUrl';
    else if (candidatesByUrl && !candidatesByUrl.has(item.sourceUrl)) reason = 'sourceUrl is not a verified candidate';

    if (!reason) {
      const result = checkGeneratedItem(item, {
        weekStart,
        weekEnd,
        candidate: candidatesByUrl?.get(item.sourceUrl) ?? null,
        eligibilityContext,
      });
      if (!result.ok) reason = result.reason;
    }

    if (reason) {
      dropped.push({ item, reason });
      continue;
    }

    seen.add(item.sourceUrl);
    kept.push(item);
  }

  return { kept, dropped };
}
