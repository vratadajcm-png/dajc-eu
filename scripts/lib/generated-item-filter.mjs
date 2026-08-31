import { validateDevelopmentDateRange } from './date-validation.mjs';
import { checkLongRoadClosure } from './closure-duration.mjs';
import { checkTransportDomainRelevance } from './transport-domain.mjs';

export function filterGeneratedItems(items = [], { weekStart, weekEnd, usedSourceUrls = new Set() } = {}) {
  const kept = [];
  const dropped = [];
  const seen = new Set(usedSourceUrls);

  for (const item of items || []) {
    let reason = null;
    if (!item?.sourceUrl) reason = 'missing sourceUrl';
    else if (seen.has(item.sourceUrl)) reason = 'duplicate sourceUrl';
    else {
      const domain = checkTransportDomainRelevance(item);
      if (!domain.ok) reason = domain.reason;
    }

    if (!reason) {
      const closure = checkLongRoadClosure(item);
      if (!closure.ok) reason = closure.reason;
    }

    if (!reason && weekStart && weekEnd) {
      const date = validateDevelopmentDateRange(
        { validFrom: item.validFrom, validTo: item.validTo },
        { weekStart, weekEnd }
      );
      if (!date.ok) reason = date.reason;
    }

    if (!reason && (!item.recommendedAction || item.recommendedAction.trim().length < 10)) {
      reason = 'no meaningful recommendedAction';
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
