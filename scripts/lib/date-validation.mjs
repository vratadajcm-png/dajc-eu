// Deterministic date validation for EU Oversize Weekly developments -
// independent of the language model. The model can be (and is, see
// openai-client.mjs) instructed not to invent or misplace dates, but only a
// plain-code check here can *guarantee* a stale or premature development
// never reaches a published article, regardless of what the model returns.
//
// Used in two places: verify-candidates.mjs (drops a candidate whose
// already-known validFrom/validTo doesn't overlap the target week, before
// spending an OpenAI call on it) and quality-gate.mjs (the final, mandatory
// check on every development the model actually returned).

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value) {
  if (!value || typeof value !== 'string') return false;
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toUtcDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`);
}

/**
 * Validates one development's validFrom/validTo against the target week's
 * [weekStart, weekEnd] range (both inclusive UTC dates, e.g. from
 * isoWeekStart/isoWeekEnd in week.mjs).
 *
 * An empty/missing validFrom or validTo means "unknown" and is not itself
 * an error - the point of this check is to reject dates that ARE present
 * but wrong (already ended, not started yet, malformed, or reversed), not
 * to require every development to carry exact dates.
 *
 * A validTo that falls after weekEnd, or a validFrom before weekStart, is
 * fine - a development is allowed to extend beyond the target week on
 * either side (e.g. France's Saturday-to-Monday window spills one day into
 * the following ISO week by design).
 */
export function validateDevelopmentDateRange({ validFrom, validTo } = {}, { weekStart, weekEnd }) {
  if (!weekStart || !weekEnd) {
    throw new Error('validateDevelopmentDateRange requires weekStart and weekEnd');
  }
  const from = validFrom || null;
  const to = validTo || null;

  if (from && !isValidIsoDate(from)) {
    return { ok: false, reason: `invalid validFrom date "${from}"` };
  }
  if (to && !isValidIsoDate(to)) {
    return { ok: false, reason: `invalid validTo date "${to}"` };
  }

  if (from && to && toUtcDate(from) > toUtcDate(to)) {
    return { ok: false, reason: `validFrom (${from}) is after validTo (${to}) - reversed date range` };
  }

  if (to && toUtcDate(to) < weekStart) {
    return {
      ok: false,
      reason: `validTo (${to}) is before the target week starts (${weekStart.toISOString().slice(0, 10)}) - this development had already ended`,
    };
  }
  if (from && toUtcDate(from) > weekEnd) {
    return {
      ok: false,
      reason: `validFrom (${from}) is after the target week ends (${weekEnd.toISOString().slice(0, 10)}) - this development had not started yet`,
    };
  }

  return { ok: true };
}
