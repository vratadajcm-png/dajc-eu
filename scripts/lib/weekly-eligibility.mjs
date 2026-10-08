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
import { extractValidityPeriod, foldText } from './publication-date.mjs';

/** A source item is current news only if the source published it within this window (one week back). */
export const FRESHNESS_WINDOW_DAYS = 7;

/** How far ahead of the Thursday preparation a dated change may take effect (one month ahead). */
export const FORWARD_HORIZON_DAYS = 30;

/**
 * Days after the target week in which a dated change still counts as an
 * outlook item. The target week (Mon-Sun) ends 10 days after the Thursday
 * preparation, so this keeps the horizon at FORWARD_HORIZON_DAYS from
 * preparation.
 */
export const OUTLOOK_DAYS = FORWARD_HORIZON_DAYS - 10;

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
 * Effective (validity) dates stated explicitly in the record's own text, used
 * when the monitor did not record them. Never guessed: no wording, no date.
 */
export function deriveValidity(candidate = {}) {
  if (candidate.validFrom || candidate.validTo) return candidate;
  const period = extractValidityPeriod(`${candidate.title || ''} ${readableText(candidate.summary) || ''}`, { country: candidate.country });
  return period ? { ...candidate, validFrom: period.validFrom, validTo: period.validTo } : candidate;
}

/**
 * Freshness (spec §7). DISCOVERY date (firstSeenAt) never counts. A record is
 * current only on one of these grounds:
 *
 *   published    the official source published it within the edition's window
 *   takes-effect its verified validity starts inside the target week
 *   ends         its verified validity ends inside the target week
 *   outlook      it takes effect within OUTLOOK_DAYS after the target week
 *   ongoing      explicit start AND end dates show it is in force during the
 *                target week (a time-bounded restriction with real impact)
 *
 * Undated material, and older material none of these grounds covers, is out.
 * @returns {{ ok: true, basis: string, bases: string[] } | { ok: false, reason: string }}
 */
export function checkFreshness(candidate = {}, {
  now, freshSince = null, weekStart, weekEnd, windowDays = FRESHNESS_WINDOW_DAYS, outlookDays = OUTLOOK_DAYS,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('checkFreshness requires a valid `now`');
  }
  const published = isValidIsoDate(candidate.publishedAt) ? candidate.publishedAt : null;
  const bases = [];

  if (published) {
    const day = utcDay(published);
    if (day.getTime() > now.getTime() + DAY_MS) {
      return { ok: false, reason: `publication date ${published} lies in the future - not a verifiable publication date` };
    }
    if (day >= (freshSince || freshnessWindowStart(now, windowDays))) bases.push('published');
  }

  if (weekStart && weekEnd) {
    const from = isValidIsoDate(candidate.validFrom) ? utcDay(candidate.validFrom) : null;
    const to = isValidIsoDate(candidate.validTo) ? utcDay(candidate.validTo) : null;
    const outlookEnd = new Date(weekEnd.getTime() + outlookDays * DAY_MS);
    if (from && from >= weekStart && from <= weekEnd) bases.push('takes-effect');
    if (to && to >= weekStart && to <= weekEnd) bases.push('ends');
    if (from && from > weekEnd && from <= outlookEnd) bases.push('outlook');
    if (from && to && from <= weekEnd && to >= weekStart && !bases.includes('takes-effect') && !bases.includes('ends')) bases.push('ongoing');
  }

  if (bases.length > 0) return { ok: true, basis: bases[0], bases };
  if (published) {
    return {
      ok: false,
      reason: `published ${published}, older than the ${windowDays}-day freshness window and not taking effect, ending or in force with explicit dates in the target week - a newly discovered old page is not news`,
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

const RESTRICTION_TERMS =
  /restrict|limit|\bban\b|prohibit|closure|closed|detour|diversion|permit|escort|weight|height|width|axle|tonnage|\b\d+(?:[.,]\d+)?\s?t\b|beschrank|sperr|umleitung|verbot|bewilligung|genehmigung|omezen|uzav|objizd|povolen|zakaz|ogranicz|ogranicen|zabran|limitation|interdi|fermeture|deviation|limitazion|divieto|chiusura|deviazione|restricci|cierre|desvio|prohib/;

// Matched on the folded (lower-case, accent-free) source title.
const EDITORIAL_EXCLUSIONS = [
  {
    reason: 'completed project or opening without a current operational restriction',
    pattern: /\b(?:completed|completion|finished|opened|opening|inaugurat\w*|handed over|put into (?:service|operation)|valmis|dokoncen\w*|otvoril\w*|odovzdan\w*|otevren\w*|fertiggestellt|abgeschlossen|eroffnet|freigegeben|inaugure\w*|mise en service|completat\w*|terminad\w*|ukoncz\w*|oddan\w*|zavrsen\w*|dovrsen\w*|pusten\w* u promet|predan\w* prometu)\b/,
    unlessRestriction: true,
  },
  {
    reason: 'pedestrian/cycling facility, not heavy-transport intelligence',
    pattern: /pedestrian|footpath|footbridge|sidewalk|cycle (?:path|lane|way|route)|cycleway|bike (?:path|lane)|bicycle|radweg|gehweg|fussweg|fussganger|pieton|piste cyclable|voie verte|pista ciclabile|pedonal|ciclovia|carril bici|peatonal|cyklostezk|cyklotras|chodnik|sciezk\w* rowerow|biciklist|pjesack|kolesar|jalgratta|jalgtee|jalakaija|sykkelvei|cykelvag/,
  },
  {
    reason: 'school/civic/public-space project, not heavy-transport intelligence',
    pattern: /\bschool|\bschule\b|\becole\b|\bscuola\b|\bescuela\b|\bskol[ay]?\b|\bszkol|kindergarten|\bkita\b|playground|spielplatz|public space|town square|city park|stadtpark|marktplatz|namesti|town hall|rathaus|library|bibliothek|museum|\bchurch|\bkirche\b|stadium|sports hall|swimming pool/,
  },
  {
    reason: 'event/PR item without an operational change',
    pattern: /campaign|kampan|kampanj|awareness|conferen|konferen|ceremon|anniversar|jubilaum|\baward|\bprize\b|\bvisit\b|\bvisite\b|\bbesuch|navstev|exhibition|ausstellung|concert|festival|salario minimo|minimum wage|\bcoins?\b|monete|\binno\b|\bhymn/,
    unlessRestriction: true,
    unlessEnforcement: true,
  },
  {
    reason: 'market/financial news, not an operational change',
    pattern: /market report|market outlook|industry outlook|sales figures|quarterly results|annual results|annual report|\brevenue|\bprofit\b|turnover|\bumsatz|\bgewinn\b/,
  },
];

/**
 * Hard editorial exclusions (spec §7): completed projects and openings,
 * pedestrian/cycling facilities, school/civic/public-space projects, PR and
 * event items, market/financial news.
 */
export function checkEditorialExclusions(candidate = {}) {
  const title = foldText(candidate.sourceTitle || candidate.title);
  const text = foldText(`${candidate.title || ''} ${readableText(candidate.summary) || ''}`);
  for (const rule of EDITORIAL_EXCLUSIONS) {
    if (!rule.pattern.test(title)) continue;
    if (rule.unlessRestriction && RESTRICTION_TERMS.test(text)) continue;
    if (rule.unlessEnforcement && ENFORCEMENT_CAMPAIGN.test(text)) continue;
    return { ok: false, reason: rule.reason };
  }
  return { ok: true };
}

/**
 * Unchanged information is not repeated: a source already cited by an
 * earlier edition is eligible again only if the source published it again
 * after that edition went out, or if the change takes effect or ends in the
 * target week (a reason to report it again).
 * @param {Map<string, { slug: string, publishedAt: string }>} previousEditions
 */
export function checkNotPreviouslyPublished(candidate = {}, previousEditions = new Map(), { freshnessBases = [] } = {}) {
  const prior = candidate.sourceUrl ? previousEditions?.get(candidate.sourceUrl) : null;
  if (!prior) return { ok: true };
  if (freshnessBases.includes('takes-effect') || freshnessBases.includes('ends')) return { ok: true };
  const priorDay = String(prior.publishedAt || '').slice(0, 10);
  if (isValidIsoDate(candidate.publishedAt) && isValidIsoDate(priorDay) && candidate.publishedAt > priorDay) {
    return { ok: true };
  }
  return { ok: false, reason: `already published in ${prior.slug} - unchanged information is not repeated` };
}

/**
 * Every Weekly rule that can be decided from the monitored record itself.
 * @param {object} candidate - a finding (title/summary/sourceUrl/publishedAt/...)
 * @param {{ now: Date, freshSince?: Date, weekStart?: Date, weekEnd?: Date,
 *   previousEditions?: Map<string, object>, sourceMetaFor?: (c: object) => object|null }} ctx
 * @returns {{ ok: true, freshness?: string } | { ok: false, reason: string }}
 */
export function checkWeeklyEligibility(rawCandidate = {}, ctx = {}) {
  const candidate = deriveValidity(rawCandidate);
  const text = `${candidate.title || ''} ${readableText(candidate.summary) || ''}`;
  const checks = [
    () => checkOperationalRelevance(text, { now: ctx.now }),
    () => checkEditorialExclusions(candidate),
    () => checkTransportDomainRelevance(candidate),
    () => checkLongRoadClosure(candidate),
    () => checkWeeklyDrivingBanPolicy(candidate),
    () => checkSpecificDevelopment(candidate),
    () => checkSourceSuitability(candidate, ctx.sourceMetaFor ? ctx.sourceMetaFor(candidate) : null),
  ];
  for (const check of checks) {
    const result = check();
    if (!result.ok) return result;
  }

  const freshness = checkFreshness(candidate, ctx);
  if (!freshness.ok) return freshness;

  if (ctx.weekStart && ctx.weekEnd) {
    const dates = validateDevelopmentDateRange(
      { validFrom: candidate.validFrom, validTo: candidate.validTo },
      { weekStart: ctx.weekStart, weekEnd: ctx.weekEnd, outlookDays: OUTLOOK_DAYS }
    );
    if (!dates.ok) return dates;
  }

  const repetition = checkNotPreviouslyPublished(candidate, ctx.previousEditions, { freshnessBases: freshness.bases });
  if (!repetition.ok) return repetition;

  return { ok: true, freshness: freshness.basis };
}
