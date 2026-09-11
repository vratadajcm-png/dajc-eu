// Shared operational-relevance gate used by daily ingestion and Friday verification.

export const EXCLUSION_PATTERNS =
  /\bweapon(s)?\b|firearm|narcotic|drug possession|arrested for|detained for|domestic violence|robbery|burglary|homicide|murder|assault charge|driving licence suspended|driving ban for the driver|deported|court sentence|criminal proceedings/i;

export const NON_RESTRICTION_PATTERNS = [
  {
    reason: 'completed school/public-building renovation is not current heavy/oversize transport intelligence',
    pattern: /(?:completion|completed|finished|conclusion).{0,90}(?:school|educational|public building).{0,90}(?:renovation|reconstruction|rehabilitation|infrastructure)|(?:school|educational).{0,90}(?:renovation|reconstruction).{0,90}(?:completed|finished)/i,
  },
  {
    reason: 'generic completed civic project without a current transport restriction or abnormal-load consequence',
    pattern: /(?:completed|completion of).{0,100}(?:school infrastructure|school reconstruction|urban beautification|public-space renovation)/i,
  },
  {
    reason: 'one-off vehicle breakdown/stuck-vehicle incident, not an ongoing restriction',
    pattern: /got stuck|stuck (lorry|truck|vehicle)|vehicle (has )?broken down|breakdown blocking|breakdown is blocking/i,
  },
  {
    reason: 'one-off accident/collision, not an ongoing restriction',
    pattern: /traffic accident|road accident|(single|multi)[- ]vehicle crash|collision (occurred|involving)|crashed into|has crashed/i,
  },
  { reason: 'theft report, not a traffic restriction', pattern: /\btheft\b|stolen (cargo|vehicle|goods|lorry|truck)/i },
  { reason: 'procurement/tender notice, not a traffic restriction', pattern: /procurement notice|invitation to tender|call for tenders?|request for (proposals|quotation)s?|contract award notice|tender notice/i },
  { reason: 'planned/future works without a confirmed traffic restriction', pattern: /(is |are )?planning to (begin|start|carry out)|works (are )?expected to (begin|start)|feasibility study|preliminary design|out to tender/i },
  { reason: 'personal international-driving-permit guidance, not a freight operational restriction', pattern: /international driving permit|international driving licence|permiso internacional|conducir en el extranjero/i },
  { reason: 'personal driver-licensing administration, not an oversize/freight operational change', pattern: /permisos? de conducir|permiso por puntos|autoescuel|centro de formaci[oó]n|canjes? de permisos|recuperaci[oó]n de permisos|driving licen[cs]e|driver licen[cs]e|f[uü]hrerausweis/i },
  { reason: 'generic authority/navigation page, not a specific operational development', pattern: /wetten,? regels en vergunningen|laws,? rules and permits|datenschutzerkl[aä]rung|newsletter baustellenmeldungen|^autobahnbr[uü]cken\b|^baustellenkarte\b/i },
  { reason: 'toll revenue/statistics report, not an operational toll-rule change', pattern: /toll collection.{0,80}(?:billion|million|grew|growth|year[- ]on[- ]year|revenue)|(?:billion|million).{0,80}toll(?:s| collection)|mýtného.{0,80}(?:miliard|milion)|výběr mýta.{0,80}(?:miliard|milion)/i },
];

export function checkOperationalRelevance(text) {
  const safeText = text || '';
  if (EXCLUSION_PATTERNS.test(safeText)) return { ok: false, reason: 'generic crime/administrative content, not transport-relevant' };
  for (const { reason, pattern } of NON_RESTRICTION_PATTERNS) {
    if (pattern.test(safeText)) return { ok: false, reason };
  }

  // Discovery is not freshness: explicitly historical pages stay excluded even
  // when the crawler encounters them for the first time this week.
  const years = [...safeText.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  const currentYear = new Date().getUTCFullYear();
  if (years.length > 0 && Math.max(...years) < currentYear) {
    return { ok: false, reason: 'historical archive item predating the current year' };
  }

  return { ok: true };
}
