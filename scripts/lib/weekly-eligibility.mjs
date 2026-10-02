// Deterministic EU Oversize Weekly eligibility - the single place that decides
// whether a monitored finding may appear in the Weekly at all.
//
// It runs before verification (select-candidates), again inside verification,
// on every item the model returns (generated-item-filter) and once more in the
// final quality gate, so neither a prompt-following failure nor a retry can
// reintroduce material these rules exclude. The rules are editorial, not
// count-driven: nothing here ever relaxes because an edition is short.
//
// See docs/DAJC_WEEKLY_INTELLIGENCE_SPEC.md §2, §5 and §7.

import { checkOperationalRelevance } from './relevance-filter.mjs';
import { checkTransportDomainRelevance } from './transport-domain.mjs';
import { checkLongRoadClosure } from './closure-duration.mjs';
import { checkWeeklyDrivingBanPolicy } from './weekly-driving-ban-policy.mjs';
import { isValidIsoDate, validateDevelopmentDateRange } from './date-validation.mjs';
import { readableText } from './text-quality.mjs';

/** A source item is current news only if the source published it within this window. */
export const FRESHNESS_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

export function freshnessWindowStart(now, days = FRESHNESS_WINDOW_DAYS) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - days);
  return start;
}

/**
 * Start of an edition's freshness window. The window is anchored to the
 * edition's preparation day - the Thursday before its Friday 12:00 slot - so
 * a Friday recovery or Saturday catch-up run judges freshness exactly like
 * the Thursday run would have; an earlier run (e.g. a preview) uses its own
 * day.
 */
export function editionFreshSince(now, publicationSlot, days = FRESHNESS_WINDOW_DAYS) {
  const preparation = new Date(Math.min(now.getTime(), new Date(publicationSlot).getTime() - DAY_MS));
  return freshnessWindowStart(preparation, days);
}

/**
 * Freshness is proven by the source's own publication date, never by the
 * date DAJC discovered the page. A dated change that begins or ends inside
 * the target week is also current, even if it was announced earlier.
 */
export function checkFreshness(candidate = {}, { now, freshSince = null, weekStart, weekEnd, windowDays = FRESHNESS_WINDOW_DAYS } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('checkFreshness requires a valid `now`');
  }
  const published = isValidIsoDate(candidate.publishedAt) ? candidate.publishedAt : null;

  if (published) {
    const day = utcDay(published);
    if (day.getTime() > now.getTime() + DAY_MS) {
      return { ok: false, reason: `publication date ${published} lies in the future - not a verifiable publication date` };
    }
    if (day >= (freshSince || freshnessWindowStart(now, windowDays))) return { ok: true, basis: 'published' };
  }

  if (weekStart && weekEnd) {
    for (const key of ['validFrom', 'validTo']) {
      const value = candidate[key];
      if (!isValidIsoDate(value)) continue;
      const day = utcDay(value);
      if (day >= weekStart && day <= weekEnd) return { ok: true, basis: key };
    }
  }

  if (published) {
    return {
      ok: false,
      reason: `published ${published}, older than the ${windowDays}-day freshness window - a newly discovered old page is not news`,
    };
  }
  return { ok: false, reason: 'no verifiable publication or effective date - undated material is never published' };
}

// Homepage shapes - only when the URL has no query string (a CMS item such
// as "/?p=1234" or "/index.php?id=77" is a specific page).
const HOMEPAGE_PATHS = [
  /^\/?$/, // site root
  /^\/[a-z]{2}(?:[-_][a-z]{2})?(?:\.(?:html?|aspx|php))?\/?$/i, // language homepage: /fr.html, /en/
  /^\/(?:index|default|home|start|startseite|accueil)(?:\.(?:html?|aspx|php|jsp))?\/?$/i,
];

const GENERIC_PATHS = [
  /\/(?:faq[^/]*|kontakt|contact|impressum|imprint|datenschutz|privacy|sitemap|search|suche|about(?:-us)?|o-nas)\/?$/i,
  // project/programme pages are background material, not dated developments
  /\/(?:projects?|projekti|projekte|projekty|projets|progetti|proyectos)\//i,
  // listing / landing pages that aggregate many notices
  /\/(?:road-?closures?|roadworks?(?:\.html?)?|current-roadworks|traffic-?report|my-traffic|verkehrsmeldungen|baustellen|news|aktuelles|actualites|novinky|aktuality|vijesti|naujienos|uudised|nyheter|medienmitteilungen(?:-[a-z]+)?)\/?$/i,
  /\/regional\//i, // Presseportal regional listing
  /\/nr\/\d+\/?$/i, // Presseportal organisation page
];

const GENERIC_TITLE =
  /^(?:aktuelles aus\b|polizei\w*\b|kreispolizeibeh|bundespolizei\w*\b|road closures? and delays|current road closures|map of road closures|traffic (?:&|and) highways road information map|road information map|current roadworks|zahtjevi i suglasnosti|faq\b|le gouvernement luxembourgeois|startseite|home ?page|newsroom$|news$|aktuelles$|medienmitteilungen$)/i;

function wordCount(title) {
  return String(title || '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Rejects pages that are not one specific, dated development: homepages,
 * listing/landing pages, project and FAQ pages, organisation pages and bare
 * topic titles such as "Izvanredni prijevoz" or "Promet.si".
 */
export function checkSpecificDevelopment(candidate = {}) {
  let url;
  try {
    url = new URL(candidate.sourceUrl);
  } catch {
    return { ok: false, reason: 'source URL is not a valid absolute URL' };
  }
  const { pathname, search } = url;
  if ((!search && HOMEPAGE_PATHS.some((re) => re.test(pathname))) || GENERIC_PATHS.some((re) => re.test(pathname))) {
    return { ok: false, reason: 'generic homepage/listing/project/landing page, not a specific development' };
  }
  const title = String(candidate.sourceTitle || candidate.title || '').trim();
  if (GENERIC_TITLE.test(title)) {
    return { ok: false, reason: `generic page title "${title}", not a specific development` };
  }
  if (wordCount(title) < 3) {
    return { ok: false, reason: `bare topic/landing title "${title}", not a specific development` };
  }
  return { ok: true };
}

const ENFORCEMENT_CAMPAIGN =
  /kontroll(?:aktion|woche|tag)|schwerpunktkontrolle|gro(?:ß|ss)kontrolle|lkw-kontrolle|roadpol|truck (?:&|and) bus|enforcement (?:operation|campaign|week)|kontrola n[aá]kladn|akcja.{0,30}ci(?:ę|e)(?:ż|z)arow/i;

/**
 * Police press feeds mostly carry crime, accidents and single local
 * movements (one escorted transport, one load that shifted). Those are not
 * Weekly intelligence; only announced enforcement campaigns are.
 */
export function checkSourceSuitability(candidate = {}, sourceMeta = null) {
  if (sourceMeta?.type !== 'police') return { ok: true };
  const text = `${candidate.title || ''} ${readableText(candidate.summary) || ''}`;
  if (ENFORCEMENT_CAMPAIGN.test(text)) return { ok: true };
  return {
    ok: false,
    reason: 'police press release about a single local event - incident and one-off movement reports are not Weekly intelligence',
  };
}

/**
 * Unchanged information is not repeated: a source already cited by an
 * earlier edition is eligible again only if the source published it again
 * after that edition went out.
 * @param {Map<string, { slug: string, publishedAt: string }>} previousEditions
 */
export function checkNotPreviouslyPublished(candidate = {}, previousEditions = new Map()) {
  const prior = candidate.sourceUrl ? previousEditions?.get(candidate.sourceUrl) : null;
  if (!prior) return { ok: true };
  const priorDay = String(prior.publishedAt || '').slice(0, 10);
  if (isValidIsoDate(candidate.publishedAt) && isValidIsoDate(priorDay) && candidate.publishedAt > priorDay) {
    return { ok: true };
  }
  return { ok: false, reason: `already published in ${prior.slug} - unchanged information is not repeated` };
}

/**
 * Every Weekly rule that can be decided from the monitored record itself.
 * @param {object} candidate - a finding (title/summary/sourceUrl/publishedAt/...)
 * @param {{ now: Date, weekStart?: Date, weekEnd?: Date,
 *   previousEditions?: Map<string, object>, sourceMetaFor?: (c: object) => object|null }} ctx
 */
export function checkWeeklyEligibility(candidate = {}, ctx = {}) {
  const text = `${candidate.title || ''} ${readableText(candidate.summary) || ''}`;
  const checks = [
    () => checkOperationalRelevance(text, { now: ctx.now }),
    () => checkTransportDomainRelevance(candidate),
    () => checkLongRoadClosure(candidate),
    () => checkWeeklyDrivingBanPolicy(candidate),
    () => checkSpecificDevelopment(candidate),
    () => checkSourceSuitability(candidate, ctx.sourceMetaFor ? ctx.sourceMetaFor(candidate) : null),
    () => checkFreshness(candidate, ctx),
    () => (ctx.weekStart && ctx.weekEnd
      ? validateDevelopmentDateRange({ validFrom: candidate.validFrom, validTo: candidate.validTo }, ctx)
      : { ok: true }),
    () => checkNotPreviouslyPublished(candidate, ctx.previousEditions),
  ];
  for (const check of checks) {
    const result = check();
    if (!result.ok) return result;
  }
  return { ok: true };
}
