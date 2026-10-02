// Critical-news coverage (docs/DAJC_WEEKLY_INTELLIGENCE_SPEC.md §4).
//
// A verified change that directly governs exceptional/oversize transport -
// permits, escorts, movement conditions, limits, transport-relevant border or
// toll procedures - must not be left out of the edition. "Fresh" here means
// the SOURCE published it recently (weekly-eligibility.mjs checkFreshness),
// never that DAJC's crawler happened to find the page this week: the old
// discovery-based test flagged a 6 May 2026 announcement as critical news in
// October and forced it into the W41 edition as raw German text.
//
// This module only identifies critical developments and checks coverage. It
// never writes report text itself; missing critical items are written by the
// model (openai-client.mjs generateRequiredItemsWithOpenAI) and the quality
// gate blocks publication if one is still missing.

import { checkFreshness } from './weekly-eligibility.mjs';
import { readableText } from './text-quality.mjs';

const HIGH_SIGNAL_TYPES = new Set([
  'permit_change',
  'permit_system',
  'escort_requirement',
  'police_escort',
  'border_restriction',
  'operational_change',
  'equipment',
  'route_restriction',
  // only reachable for movement restrictions explicitly scoped to exceptional
  // transport: general truck bans never pass weekly-eligibility.mjs
  'driving_ban',
]);

const OVERSIZE_SIGNAL =
  /exceptional transport|exceptional vehicle|oversize|oversized|abnormal load|wide load|heavy transport|schwertransport|gro[ßs]raum|ausnahmetransport|convoi exceptionnel|transport exceptionnel|trasporto eccezionale|transporte especial|izvanredni prijevoz|agabaritic|special transport|pilot vehicle|escort vehicle|begleitfahrzeug|private escort|police escort|route permit|special permit|overweight permit|overdimension|nadrozm[eě]rn|nadmern/i;

const REGULATORY_SIGNAL =
  /permit|authorisation|authorization|bewilligung|genehmigung|escort|begleit|pilot vehicle|new rule|new requirement|regulation|verordnung|decree|law|gesetz|procedure|digital system|toll system|weight restriction|height restriction|width restriction|border restriction/i;

export function isCriticalWeeklyCandidate(candidate, ctx = {}) {
  if (!candidate?.sourceUrl || !ctx.now) return false;
  if (!checkFreshness(candidate, ctx).ok) return false;

  const text = `${candidate.title || ''} ${readableText(candidate.summary) || ''}`;
  return OVERSIZE_SIGNAL.test(text) && (HIGH_SIGNAL_TYPES.has(candidate.type) || REGULATORY_SIGNAL.test(text));
}

function criticalTopicKey(candidate) {
  const text = `${candidate.title || ''} ${candidate.summary || ''}`.toLowerCase();
  if (/escort|begleit|pilot vehicle|accompagnement|doprovod/.test(text)) return 'escort';
  if (/permit|bewilligung|genehmigung|authori[sz]ation|povolen/.test(text)) return 'permit';
  if (/weight|height|width|axle|dimension|s[uú]ly|hmotnost|výšk|šíř/.test(text)) return 'limits';
  if (/border|customs|transit|grenz|hrani/.test(text)) return 'border';
  if (/toll|maut|péage|pedaggio|peaje|m[aý]to/.test(text)) return 'toll';
  return 'other';
}

/**
 * Verified critical candidates grouped per development (country + topic):
 * several official pages about one change form one group, and the edition
 * covers the group once.
 * @returns {{ key: string, candidates: object[] }[]}
 */
export function criticalWeeklyGroups(verifiedCandidates = [], ctx = {}) {
  const groups = new Map();
  for (const candidate of verifiedCandidates) {
    if (!isCriticalWeeklyCandidate(candidate, ctx)) continue;
    const key = `${candidate.country || ''}::${criticalTopicKey(candidate)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  return [...groups.entries()].map(([key, candidates]) => ({ key, candidates }));
}

function citedUrls(items = []) {
  const urls = new Set();
  for (const item of items) {
    if (item?.sourceUrl) urls.add(item.sourceUrl);
    for (const extra of item?.additionalSources || []) if (extra?.url) urls.add(extra.url);
  }
  return urls;
}

/** Critical groups that no lead or Rest-of-Europe item cites yet. */
export function missingCriticalGroups(article, groups = []) {
  const cited = citedUrls([...(article.developments || []), ...(article.europeRoundup || [])]);
  return groups.filter((group) => !group.candidates.some((c) => cited.has(c.sourceUrl)));
}

/**
 * Attaches the group's other official pages to the item that covers the
 * group as "Also see" sources - but only pages that are not already a
 * report's own primary source, so no URL is ever cited twice.
 */
export function attachCriticalGroupSources(article, groups = []) {
  const developments = [...(article.developments || [])];
  const europeRoundup = [...(article.europeRoundup || [])];
  const items = [...developments, ...europeRoundup];
  const primaryUrls = new Set(items.map((item) => item.sourceUrl).filter(Boolean));
  const attached = new Set();

  for (const group of groups) {
    const groupUrls = new Set(group.candidates.map((c) => c.sourceUrl));
    const owner = items.find((item) => groupUrls.has(item.sourceUrl));
    if (!owner) continue;
    const existing = new Set((owner.additionalSources || []).map((x) => x.url));
    const extras = group.candidates
      .filter((c) => c.sourceUrl !== owner.sourceUrl && !primaryUrls.has(c.sourceUrl) && !existing.has(c.sourceUrl) && !attached.has(c.sourceUrl))
      .map((c) => ({ name: c.sourceName || c.title, url: c.sourceUrl }));
    for (const extra of extras) attached.add(extra.url);
    owner.additionalSources = [...(owner.additionalSources || []), ...extras];
  }

  return { ...article, developments, europeRoundup };
}
