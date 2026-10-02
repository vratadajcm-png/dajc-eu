// Pre-selection for the Weekly: every finding must first pass the complete
// deterministic eligibility check (weekly-eligibility.mjs). Only then are the
// survivors ranked - by how recently the source published them, how directly
// they concern exceptional/heavy transport, and DAJC's Central-Europe-first
// presentation preference. Ranking never makes an ineligible item eligible.

import { checkWeeklyEligibility, deriveValidity, FRESHNESS_WINDOW_DAYS } from './weekly-eligibility.mjs';
import { isCriticalWeeklyCandidate } from './critical-floor.mjs';
import { foldText } from './publication-date.mjs';

const SPECIFIC_TYPES = new Set([
  'permit_change', 'permit_system', 'escort_requirement',
  'police_escort', 'border_restriction', 'bridge_restriction',
  'tunnel_restriction', 'route_restriction', 'road_closure', 'roadworks',
  'weight_restriction', 'axle_load_restriction', 'height_restriction',
  'width_restriction', 'toll_change', 'port_restriction', 'ferry_restriction',
  'weather_restriction', 'enforcement', 'legislation', 'digitalisation',
  'equipment', 'market', 'project_cargo', 'industry_project',
]);

const CENTRAL_EUROPE = /^(czechia|czech republic|germany|austria|slovakia|poland|hungary|switzerland|slovenia)$/i;
const CONNECTED_CORE = /^(croatia|italy|france|belgium|netherlands|luxembourg|romania)$/i;
const MAX_PER_SOURCE = 6;
const MAX_TOTAL = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One record per source URL; the most recently checked record wins. */
export function dedupeFindingsByUrl(findings = []) {
  const byUrl = new Map();
  for (const finding of findings) {
    if (!finding?.sourceUrl) continue;
    const known = byUrl.get(finding.sourceUrl);
    if (!known || String(finding.lastCheckedAt || '') > String(known.lastCheckedAt || '')) {
      byUrl.set(finding.sourceUrl, finding);
    }
  }
  return [...byUrl.values()];
}

function titleTokens(title) {
  return new Set(
    foldText(title)
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 2)
  );
}

function sameDevelopmentTitle(a, b) {
  const smaller = Math.min(a.size, b.size);
  if (smaller < 2) return false;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  // One title is wholly contained in the other ("Batteridrevne hjullastere"
  // vs "Batteridrevne hjullastere imponerer i tunnel"), or the wording is
  // essentially identical. Two closures of different sections of one road
  // share most words but not all, and stay separate.
  return shared === smaller || shared / (a.size + b.size - shared) >= 0.9;
}

/**
 * The same development is often published on several pages of one authority
 * (news item, topic page, PDF). Keep one record per development: same country
 * and the same title wording -> keep the most recently published one.
 */
export function dedupeNearDuplicates(findings = []) {
  const kept = [];
  for (const finding of findings) {
    const tokens = titleTokens(finding.title);
    const duplicateIndex = kept.findIndex((other) => (
      String(other.country || '') === String(finding.country || '') &&
      sameDevelopmentTitle(tokens, titleTokens(other.title))
    ));
    if (duplicateIndex < 0) {
      kept.push(finding);
    } else if (String(finding.publishedAt || '') > String(kept[duplicateIndex].publishedAt || '')) {
      kept[duplicateIndex] = finding;
    }
  }
  return kept;
}

function score(finding, now) {
  let total = 0;
  const published = finding.publishedAt ? new Date(`${finding.publishedAt}T00:00:00Z`) : null;
  const ageDays = published ? Math.max(0, (now - published) / DAY_MS) : FRESHNESS_WINDOW_DAYS;
  total += Math.max(0, FRESHNESS_WINDOW_DAYS - ageDays) / 2;
  if (SPECIFIC_TYPES.has(finding.type)) total += 3;
  const text = `${finding.title || ''} ${finding.summary || ''}`;
  if (/exceptional transport|oversize|abnormal load|ausnahmetransport|schwertransport|convoi exceptionnel|trasporto eccezionale|transporte especial|izvanredni prijevoz|nadrozm[eě]rn|nadmern/i.test(text)) total += 6;
  if (/escort|begleit|pilot vehicle|doprovod|accompagnement/i.test(text)) total += 5;
  if (/toll|vignette|road user charge|via toll|maut|m[ýy]to/i.test(text)) total += 3;
  if (finding.summary && finding.summary.length > 40) total += 1;
  if (finding.impact) total += 1;
  if (finding.recommendedAction) total += 1;

  // DAJC operator-first presentation preference. This affects ranking only;
  // every eligibility rule above has already been applied unchanged.
  const country = String(finding.country || '');
  if (CENTRAL_EUROPE.test(country)) total += 12;
  else if (CONNECTED_CORE.test(country)) total += 5;
  return total;
}

/**
 * @param {object[]} findings - this week's monitored findings
 * @param {Parameters<typeof checkWeeklyEligibility>[1]} ctx
 * @returns {{ selected: object[], rejected: { finding: object, reason: string }[] }}
 */
export function selectCandidates(findings, ctx) {
  const rejected = [];
  const eligible = [];
  // Effective dates stated in the record's own text travel with the
  // candidate from here on (to the model, cross-validation and the gate).
  for (const finding of dedupeFindingsByUrl(findings).map(deriveValidity)) {
    if (finding.status === 'expired' || finding.status === 'superseded') {
      rejected.push({ finding, reason: `status ${finding.status}` });
      continue;
    }
    const result = checkWeeklyEligibility(finding, ctx);
    if (!result.ok) {
      rejected.push({ finding, reason: result.reason });
      continue;
    }
    eligible.push(finding);
  }

  const unique = dedupeNearDuplicates(eligible);
  for (const finding of eligible) {
    if (!unique.includes(finding)) rejected.push({ finding, reason: 'same development as another selected source (near-duplicate title)' });
  }

  const ranked = (list) => list
    .map((finding) => ({ finding, score: score(finding, ctx.now) }))
    .sort((a, b) => b.score - a.score);
  const critical = ranked(unique.filter((f) => isCriticalWeeklyCandidate(f, ctx))).map(({ finding }) => finding);
  const ordinary = ranked(unique.filter((f) => !critical.includes(f)));

  const perSourceCount = new Map();
  const selected = [...critical];
  for (const { finding } of ordinary) {
    if (selected.length >= MAX_TOTAL + critical.length) break;
    const count = perSourceCount.get(finding.sourceName) || 0;
    if (count >= MAX_PER_SOURCE) continue;
    perSourceCount.set(finding.sourceName, count + 1);
    selected.push(finding);
  }

  return { selected, rejected };
}
