// Shared "is this actually an operational restriction" gate, used both by
// the daily monitor's ingestion (fetch-source.mjs) and, independently and
// again, by the Friday pipeline's pre-OpenAI verification
// (verify-candidates.mjs). Two call sites on purpose: a candidate already
// sitting in data/oversize/<week>/findings.json may have entered before
// this filter existed (or under a looser version of it), so the weekly
// pipeline must not trust the daily filter alone.
//
// This exists because of two real incidents in the first published EU
// Oversize Weekly W35 article: a one-off "lorry got stuck" incident near
// Hildesheim was reported as an ongoing "road closure", and a routine
// procurement/tender notice for bridge rehabilitation works in Albania was
// reported as an active bridge restriction. Neither is a genuine,
// currently-in-effect operational restriction.

export const EXCLUSION_PATTERNS =
  /\bweapon(s)?\b|firearm|narcotic|drug possession|arrested for|detained for|domestic violence|robbery|burglary|homicide|murder|assault charge|driving licence suspended|driving ban for the driver|deported|court sentence|criminal proceedings/i;

// Individually true, but not an ongoing/upcoming operational restriction.
export const NON_RESTRICTION_PATTERNS = [
  {
    reason: 'one-off vehicle breakdown/stuck-vehicle incident, not an ongoing restriction',
    pattern: /got stuck|stuck (lorry|truck|vehicle)|vehicle (has )?broken down|breakdown blocking|breakdown is blocking/i,
  },
  {
    reason: 'one-off accident/collision, not an ongoing restriction',
    pattern: /traffic accident|road accident|(single|multi)[- ]vehicle crash|collision (occurred|involving)|crashed into|has crashed/i,
  },
  {
    reason: 'theft report, not a traffic restriction',
    pattern: /\btheft\b|stolen (cargo|vehicle|goods|lorry|truck)/i,
  },
  {
    reason: 'procurement/tender notice, not a traffic restriction',
    pattern: /procurement notice|invitation to tender|call for tenders?|request for (proposals|quotation)s?|contract award notice|tender notice/i,
  },
  {
    reason: 'planned/future works without a confirmed traffic restriction',
    pattern: /(is |are )?planning to (begin|start|carry out)|works (are )?expected to (begin|start)|feasibility study|preliminary design|out to tender/i,
  },
  {
    reason: 'personal international-driving-permit guidance, not a freight operational restriction',
    pattern: /international driving permit|international driving licence|permiso internacional|conducir en el extranjero/i,
  },
  {
    reason: 'personal driver-licensing administration, not an oversize/freight operational change',
    pattern: /permisos? de conducir|permiso por puntos|autoescuel|centro de formaci[oó]n|canjes? de permisos|recuperaci[oó]n de permisos|driving licen[cs]e|driver licen[cs]e|f[uü]hrerausweis/i,
  },
  {
    reason: 'generic authority/navigation page, not a specific operational development',
    pattern: /wetten,? regels en vergunningen|laws,? rules and permits|datenschutzerkl[aä]rung|newsletter baustellenmeldungen|^autobahnbr[uü]cken\b|^baustellenkarte\b/i,
  },
];

/**
 * @param {string} text - candidate title + summary (and, where available,
 *   fetched source page text) concatenated.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkOperationalRelevance(text) {
  const safeText = text || '';
  if (EXCLUSION_PATTERNS.test(safeText)) {
    return { ok: false, reason: 'generic crime/administrative content, not transport-relevant' };
  }
  for (const { reason, pattern } of NON_RESTRICTION_PATTERNS) {
    if (pattern.test(safeText)) return { ok: false, reason };
  }

  // HTML archives can expose old restrictions as if they were fresh because
  // the monitor only discovered the page today. If text explicitly mentions
  // years but none reaches the current year, treat it as historical archive
  // material. Current-year text, undated standing information and maintained
  // calendar findings remain eligible.
  const years = [...safeText.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  const currentYear = new Date().getUTCFullYear();
  if (years.length > 0 && Math.max(...years) < currentYear) {
    return { ok: false, reason: 'historical archive item predating the current year' };
  }

  return { ok: true };
}
