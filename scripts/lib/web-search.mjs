// Web-search discovery for the EU Oversize Weekly.
//
// The daily monitor uses Perplexity Sonar web-grounded source discovery via
// Chat Completions instead of crawling a fixed list of authority pages. One search runs per region group; Central Europe is searched country
// by country so it is never crowded out.
//
// The model only DISCOVERS links. Nothing it says is trusted as evidence:
// every returned URL is fetched, and the finding is built from the page
// itself - its own heading, text and publication date
// (publication-date.mjs). A model-reported date is kept only when that exact
// date appears in the page text. Pages that cannot be fetched, are not
// specific articles, or whose own text shows no connection to freight
// vehicles over 12 t / oversize transport are dropped here, before they are
// ever recorded. Editorial eligibility is then decided later, unchanged, by
// weekly-eligibility.mjs.

import { dajcEuropeCoverage, coverageName, isTrackedJurisdiction, resolveCoverageScope, coverageRegions, geographicScopePolicy } from '../../config/europe-coverage.mjs';
import { scopeFinding } from './geographic-scope.mjs';
import OpenAI from 'openai';
import { FINDING_TYPES } from './findings.mjs';
import {
  classify, extractDetailHeading, extractDetailText, fetchTextWithRetry, guessLocation,
} from './fetch-source.mjs';
import { extractPublicationDate, extractValidityPeriod, findDates } from './publication-date.mjs';
import { checkOperationalRelevance } from './relevance-filter.mjs';
import { checkTransportDomainRelevance } from './transport-domain.mjs';
import { looksBinary } from './text-quality.mjs';
import { FRESHNESS_WINDOW_DAYS, FORWARD_HORIZON_DAYS } from './weekly-eligibility.mjs';
import { sourceTier, isOfficialPublisher, needsSecondaryDiscovery, PRIMARY_TIER, SECONDARY_TIER } from './source-policy.mjs';

const DEFAULT_SEARCH_MODEL = 'sonar-pro';
// Secondary pass is triggered only by a sparse primary-source result per area.
const MAX_ITEMS_PER_SEARCH = 12;
const SEARCH_CONCURRENCY = 3;
const VERIFY_CONCURRENCY = 6;
const MAX_SUMMARY_CHARS = 1_800;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Search groups in operator-first order. `codes` are the coverage codes the
 * group answers for (config/europe-coverage.mjs).
 */
const SEARCH_GROUP_DEFINITIONS = [
  { id: 'cz', codes: ['CZ'], languages: 'Czech, English' },
  { id: 'de', codes: ['DE'], languages: 'German, English' },
  { id: 'at', codes: ['AT'], languages: 'German, English' },
  { id: 'sk', codes: ['SK'], languages: 'Slovak, English' },
  { id: 'pl', codes: ['PL'], languages: 'Polish, English' },
  { id: 'hu', codes: ['HU'], languages: 'Hungarian, English' },
  { id: 'ch-li', codes: ['CH', 'LI'], languages: 'German, French, Italian, English' },
  { id: 'si-hr', codes: ['SI', 'HR'], languages: 'Slovenian, Croatian, English' },
  { id: 'fr', codes: ['FR', 'MC'], languages: 'French, English' },
  { id: 'benelux', codes: ['BE', 'NL', 'LU'], languages: 'Dutch, French, German, English' },
  { id: 'it', codes: ['IT', 'SM'], languages: 'Italian, English' },
  { id: 'ro-bg-md', codes: ['RO', 'BG', 'MD'], languages: 'Romanian, Bulgarian, English' },
  { id: 'iberia', codes: ['ES', 'PT', 'AD'], languages: 'Spanish, Portuguese, Catalan, English' },
  { id: 'uk-ie', codes: ['UK', 'IE'], languages: 'English' },
  { id: 'nordics', codes: ['DK', 'SE', 'NO', 'FI', 'IS'], languages: 'Danish, Swedish, Norwegian, Finnish, English' },
  { id: 'baltics', codes: ['EE', 'LV', 'LT'], languages: 'Estonian, Latvian, Lithuanian, English' },
  { id: 'balkans', codes: ['RS', 'BA', 'ME', 'MK', 'AL', 'XK', 'GR'], languages: 'local languages, English' },
  { id: 'east', codes: ['UA', 'TR', 'GE', 'AM', 'AZ', 'BY', 'RU', 'KZ'], languages: 'local languages, English' },
  { id: 'islands', codes: ['CY', 'MT'], languages: 'Greek, Maltese, English' },
];
export const SEARCH_GROUPS = SEARCH_GROUP_DEFINITIONS.map(group => ({
  ...group, countries: group.codes.map(coverageName),
}));
const groupedCodes = SEARCH_GROUPS.flatMap(group => group.codes);
if (groupedCodes.length !== dajcEuropeCoverage.length || new Set(groupedCodes).size !== groupedCodes.length || !groupedCodes.every(isTrackedJurisdiction)) throw new Error('Search groups must partition the central registry exactly once');

const SEARCH_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    country: { type: 'string', enum: dajcEuropeCoverage.map(([, name]) => name), description: 'Tracked parent country the development applies to.' },
    region: { type: ['string', 'null'], description: 'Exact regional applicability copied from the source page, or null for country-level/road-specific scope. Never broaden a regional notice to the whole country.' },
    title: { type: 'string', description: 'Headline of the source article, in its original language.' },
    url: { type: 'string', description: 'Direct URL of the specific article or notice (never a homepage or listing).' },
    sourceName: { type: 'string', description: 'Publisher, e.g. the road authority, ministry or trade publication.' },
    publishedAt: { type: ['string', 'null'], description: 'YYYY-MM-DD publication date shown on the page, or null.' },
    validFrom: { type: ['string', 'null'], description: 'YYYY-MM-DD date the change takes effect, or null.' },
    validTo: { type: ['string', 'null'], description: 'YYYY-MM-DD date the change ends, or null.' },
    summary: { type: 'string', description: 'Two or three factual English sentences: what changes, where, for which vehicles, when.' },
    type: { type: 'string', enum: FINDING_TYPES },
    oversize: { type: 'boolean', description: 'True when it explicitly concerns oversize/abnormal/exceptional transport.' },
  },
  required: ['country', 'region', 'title', 'url', 'sourceName', 'publishedAt', 'validFrom', 'validTo', 'summary', 'type', 'oversize'],
  additionalProperties: false,
};

const SEARCH_RESULT_FORMAT = {
  type: 'json_schema',
  name: 'dajc_web_search_findings',
  strict: true,
  schema: {
    type: 'object',
    properties: { items: { type: 'array', items: SEARCH_ITEM_SCHEMA } },
    required: ['items'],
    additionalProperties: false,
  },
};

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Each group is searched twice: once only for oversize/abnormal transport (the
 * priority topic, so it is never crowded out) and once for other changes that
 * affect goods vehicles over 12 t.
 */
export const SEARCH_FOCUSES = ['oversize', 'heavy'];
export const FALLBACK_SEARCH_FOCUSES = ['oversize', 'operations'];

const FOCUS_TOPICS = {
  oversize: `ONLY oversize / abnormal / exceptional / special transport (Schwertransport, Ausnahmetransport, nadrozměrná přeprava, convoi exceptionnel, trasporto eccezionale, transporte especial ...):
- permits and permit systems, application portals, fees
- escort, private-escort and police-escort rules
- movement windows and time restrictions for abnormal loads
- approved abnormal-load routes, diversions for abnormal loads
- bridges or tunnels newly restricted or reopened for abnormal loads`,
  operations: `Latest European news and tangible professional updates relevant to truck drivers, dispatchers, fleet/transport managers or road-freight companies (prefer oversize and heavy haulage):
- truck-driver working conditions, duty, cabotage, tachograph, rest, parking, safety, occupational training and operational tools
- dispatcher workflow, permits, customs, e-CMR/eFTI, slot booking, traffic systems and digitalisation
- fleet operations, transport insurance, telematics, route planning, truck/trailer/heavy-haul technology and maintenance
- diesel, energy and operating costs, service availability, supply chains, industry projects, employer/operator changes with real freight-operational consequences
- verified market, company and industry developments that directly affect road transport workers or transport businesses; exclude generic earnings-only press releases`,
  heavy: `Changes that affect goods vehicles over 12 t (not specifically oversize):
- new or changed weight, axle-load, height or width limits; bridges or tunnels closed or restricted for trucks
- closures or diversions of motorways and main freight routes lasting more than 30 days
- truck tolls and road charges (new rates, new tolled sections, new systems)
- border crossings and customs procedures for goods traffic; ferries/RoRo for trucks
- new rules for HGV operators or drivers: tachograph, e-CMR, ADR, cabotage, announced enforcement campaigns`,
};

/** The prompt for one search group and focus. Pure - exported for tests. */
export function buildSearchPrompt(group, now = new Date(), focus = 'oversize', tier = PRIMARY_TIER) {
  if (!group.codes?.length || !group.codes.every(isTrackedJurisdiction)) throw new Error('Untracked search jurisdiction');
  const since = isoDay(new Date(now.getTime() - FRESHNESS_WINDOW_DAYS * DAY_MS));
  const today = isoDay(now);
  const horizon = isoDay(new Date(now.getTime() + FORWARD_HORIZON_DAYS * DAY_MS));
  return `Today is ${today}. You are researching news for a weekly briefing for road freight operators running vehicles over 12 tonnes, where oversize/abnormal transport has priority.
Countries: ${group.codes.map(coverageName).join(', ')}. Search in ${group.languages}.
Regional applicability to preserve inside these countries: ${group.codes.flatMap(code => coverageRegions(code).map(region => `${code}: ${region}`)).join('; ') || 'national and regional rules with their exact scope'}.

TOPIC:
${FOCUS_TOPICS[focus] || FOCUS_TOPICS.oversize}

DATES - STRICT:
Return a page only if its visible publication date is between ${since} and ${today}, OR it announces a change that takes effect or ends between ${today} and ${horizon}. Skip every page that shows an older date and no such upcoming effective date. Search news sections and press releases of the last days, not evergreen pages.

NEVER RETURN: general recurring truck driving bans (Sunday, holiday, weekend, night, summer bans - they are covered elsewhere), accidents, incidents, crime, short local roadworks, tenders, unrelated statistics, service or company homepages, guides, FAQs, listing pages, undated pages. ${focus === 'operations' ? 'INCLUDE recent material transport-company, driver, dispatcher, fleet and industry news when it has specific practical consequences for road-freight operations; not unsubstantiated promotional claims.' : 'Do not include mere sales results, generic company announcements or promotional news with no proven freight-operational significance.'}

Search only the listed tracked countries. Retain regional road, permit, toll and escort conditions under their country with exact regional applicability. Exclude untracked dependencies, French/Dutch overseas territories and Vatican City; keep the listed regional locations within their tracked country; never inherit rules from an administering country. For KZ, RU and TR: ${geographicScopePolicy.corridor_scope} ${geographicScopePolicy.corridor_evidence} Search these corridors, not their whole territories. XK is an operational jurisdiction, without a diplomatic-recognition claim.

${tier === PRIMARY_TIER
 ? 'FIRST PASS: Prioritize and return OFFICIAL PRIMARY sources such as government, road and permit authorities, road operators, enforcement bodies, ports and toll agencies. Do not use trade news if an official notice is accessible. Search official sites directly.'
 : 'SECOND PASS, OPEN-WEB DISCOVERY: Search across ALL accessible European specialist transport news sites, trade magazines, industry associations, driver and dispatcher publications, company and OEM operator blogs, technology providers and independent freight outlets in their local languages. DO NOT restrict this to a whitelist of sites or require an official authority corroboration for ordinary industry or professional news. For legal rules, permits and actual road restrictions, attribute the report to its publisher and avoid claiming it is an official binding notice unless backed by an authoritative source. This is a fallback search only, not an instruction to pad the edition.'}
Each item must link to the specific article. Copy dates exactly as shown on the page; use null when the page shows none. Return at most ${MAX_ITEMS_PER_SEARCH} items; return an empty list when nothing qualifies - never pad.`;
}

/** Parse the structured output of one search call. Pure - exported for tests. */
export function parseSearchResponse(text) {
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return items.filter((item) => {
    if (!item || typeof item.url !== 'string') return false;
    try {
      const url = new URL(item.url);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }).slice(0, MAX_ITEMS_PER_SEARCH);
}

function isIsoDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// Control characters or U+FFFD mean the model mangled an escape (W42 shipped
// "Stra\u00007fenwesen" for "Straßenwesen"); fall back to the host name.
const MANGLED = /[\u0000-\u001f\u007f\ufffd]/;

/** Publisher name for a finding: the model's, unless it is empty or mangled. */
export function cleanSourceName(name, sourceUrl) {
  const text = String(name || '').trim();
  if (text && !MANGLED.test(text)) return text;
  return new URL(sourceUrl).hostname.replace(/^www\./, '');
}

/** Strip tracking parameters OpenAI adds to cited links. */
export function cleanUrl(raw) {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

/**
 * Turn one search hit into a finding using only what the fetched page proves.
 * @param {object} item - parsed search item
 * @param {{ fetchPage?: (url: string) => Promise<{ok: boolean, text?: string, finalUrl?: string, error?: string}>, now?: Date }} deps
 * @returns {Promise<{ ok: true, finding: object } | { ok: false, reason: string }>}
 */
export async function verifySearchItem(item, { fetchPage = (url) => fetchTextWithRetry(url, 'text/html, application/xhtml+xml, */*'), now = new Date() } = {}) {
  const scope = scopeFinding({ ...item, sourceUrl: item.sourceUrl || item.url });
  if (!scope.ok) return scope;
  let sourceUrl;
  try {
    sourceUrl = cleanUrl(item.url);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }

  const fetched = await fetchPage(sourceUrl);
  if (!fetched?.ok) return { ok: false, reason: `page not reachable (${fetched?.error || 'unknown error'})` };
  if (fetched.finalUrl) {
    try {
      sourceUrl = cleanUrl(fetched.finalUrl);
    } catch {
      // keep the requested URL
    }
  }
  if (scope.finding.corridorEvidence && scope.finding.corridorEvidence.sourceUrl !== sourceUrl) return { ok: false, reason: 'CORRIDOR_SOURCE_REDIRECT_REQUIRES_REVIEW' };

  // Binary documents (PDF) cannot be read as text here: only the URL date is
  // evidence, and the page text cannot confirm the transport context.
  if (looksBinary(fetched.text || '')) return { ok: false, reason: 'binary document - page text cannot be verified' };

  const pageText = extractDetailText(fetched.text || '');
  if (pageText.length < 120) return { ok: false, reason: 'page has no readable article text' };

  const title = extractDetailHeading(fetched.text || '') || String(item.title || '').trim();
  const evidence = `${title} ${pageText}`;
  const normalizeEvidence = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (scope.finding.corridorEvidence && !normalizeEvidence(evidence).includes(normalizeEvidence(scope.finding.corridorEvidence.excerpt))) return { ok: false, reason: 'CORRIDOR_SOURCE_EVIDENCE_CHANGED' };
  if (item.region && !evidence.toLocaleLowerCase().includes(item.region.toLocaleLowerCase())) return { ok: false, reason: 'REGIONAL_SCOPE_REQUIRES_REVIEW' };
  if (!checkOperationalRelevance(evidence, { now }).ok) return { ok: false, reason: 'page is not an operational development' };
  if (!checkTransportDomainRelevance({ title, summary: pageText }).ok) {
    return { ok: false, reason: 'page text shows no freight-vehicle (>12 t) or oversize-transport context' };
  }

  const country = scope.finding.country;
  let publication = extractPublicationDate({ html: fetched.text, text: pageText, url: sourceUrl, country, now });
  if (!publication && isIsoDay(item.publishedAt) && findDates(pageText, { country }).some((d) => d.iso === item.publishedAt)) {
    publication = { date: item.publishedAt, source: 'page-text' };
  }

  const validity = extractValidityPeriod(evidence, { country });

  // An old page announcing nothing upcoming is not worth recording.
  const staleBefore = isoDay(new Date(now.getTime() - FRESHNESS_WINDOW_DAYS * DAY_MS));
  const horizon = isoDay(new Date(now.getTime() + FORWARD_HORIZON_DAYS * DAY_MS));
  const upcoming = [validity?.validFrom, validity?.validTo].some((d) => d && d >= isoDay(now) && d <= horizon);
  if (publication?.date && publication.date < staleBefore && !upcoming) {
    return { ok: false, reason: `published ${publication.date}, older than ${FRESHNESS_WINDOW_DAYS} days, nothing upcoming` };
  }

  const type = FINDING_TYPES.includes(item.type) ? item.type : (classify(evidence) || 'infrastructure');

  return {
    ok: true,
    finding: {
      country,
      jurisdiction: scope.finding.jurisdiction,
      region: scope.finding.region || null,
      ...(scope.finding.corridorEvidence ? { corridorEvidence: scope.finding.corridorEvidence } : {}),
      location: guessLocation(evidence, null),
      type,
      title,
      // The page's own text is the evidence every later rule is judged on.
      summary: pageText.slice(0, MAX_SUMMARY_CHARS),
      searchSummary: String(item.summary || '').slice(0, 600),
      validFrom: validity?.validFrom ?? null,
      validTo: validity?.validTo ?? null,
      impact: null,
      recommendedAction: null,
      publishedAt: publication?.date ?? null,
      publishedAtSource: publication?.source ?? null,
      sourceName: cleanSourceName(item.sourceName, sourceUrl),
      sourceUrl,
      discoveredVia: 'web-search',
      sourceTier: sourceTier(sourceUrl),
      oversize: Boolean(item.oversize),
      confidence: 'unverified',
    },
  };
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Run one web search for a group.
 * @returns {Promise<{ status: 'ok', items: object[] } | { status: 'unavailable', error: string, items: [] }>}
 */
export async function searchGroup(client, group, { now = new Date(), model, focuses = SEARCH_FOCUSES, tier = PRIMARY_TIER } = {}) {
  if (!group.codes?.length || !group.codes.every(isTrackedJurisdiction)) throw new Error('Untracked search jurisdiction');
  const items = [];
  const seen = new Set();
  const errors = [];
  for (const focus of focuses) {
    try {
      // Production: Perplexity Sonar's web-grounded OpenAI-compatible Chat Completions.
      // Legacy injected responses.create is preserved only for deterministic unit tests.
      const prompt = buildSearchPrompt(group, now, focus, tier);
      const sonar = Boolean(client.chat?.completions?.create);
      const response = sonar
        ? await client.chat.completions.create({
            model: model || process.env.PERPLEXITY_SEARCH_MODEL || DEFAULT_SEARCH_MODEL,
            messages: [
              { role: 'system', content: 'Discover specific European transport-source URLs. Return JSON only; no invented dates or sources.' },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_schema', json_schema: { schema: SEARCH_RESULT_FORMAT.schema } },
          })
        : await client.responses.create({
            model: model || process.env.OPENAI_SEARCH_MODEL || 'gpt-4.1',
            tools: [{ type: 'web_search_preview', search_context_size: 'high' }],
            input: prompt,
            text: { format: SEARCH_RESULT_FORMAT },
          });
      const output = sonar ? response.choices?.[0]?.message?.content : response.output_text;
      for (const item of parseSearchResponse(output)) {
        const scope = resolveCoverageScope(item.country);
        if (!scope || !group.codes.includes(scope.jurisdiction) || seen.has(item.url)) continue;
        seen.add(item.url);
        items.push(item);
      }
    } catch (err) {
      errors.push(`${focus}: ${err?.message || String(err)}`);
    }
  }
  // One failed focus still leaves a usable search; only a total failure is
  // reported as unavailable.
  if (errors.length === focuses.length) return { status: 'unavailable', error: errors.join('; '), items: [] };
  return { status: 'ok', items, ...(errors.length ? { error: errors.join('; ') } : {}) };
}

/**
 * Search every group, then verify each hit against its own page.
 * @returns {Promise<{ findings: object[], groups: { group: object, status: string, error?: string, hits: number, kept: number, rejected: { url: string, reason: string }[] }[] }>}
 */
export async function discoverWithWebSearch({
  apiKey, now = new Date(), groups = SEARCH_GROUPS, client = null, fetchPage,
  secondaryThreshold = undefined,
} = {}) {
  const api = client || new OpenAI({ apiKey, baseURL: 'https://api.perplexity.ai' });
  const verifier = item => verifySearchItem(item, { now, ...(fetchPage ? { fetchPage } : {}) });

  async function discoverGroup(group) {
    const first = await searchGroup(api, group, { now, tier: PRIMARY_TIER });
    const rejected = [], accepted = [], localSeen = new Set();
    let primaryCount = 0;
    async function collect(result, tier) {
      const checked = await pool(result.items, VERIFY_CONCURRENCY, verifier);
      checked.forEach((outcome, index) => {
        if (!outcome.ok) {
          rejected.push({ url: result.items[index].url, jurisdiction: resolveCoverageScope(result.items[index].country)?.jurisdiction, reason: outcome.reason });
          return;
        }
        const record = outcome.finding;
        if (localSeen.has(record.sourceUrl)) return;
        localSeen.add(record.sourceUrl);
        if (isOfficialPublisher(record.sourceUrl)) primaryCount += 1;
        accepted.push({ ...record, searchGroup: group.id, discoveryPass: tier });
      });
    }
    await collect(first, PRIMARY_TIER);
    let second = null;
    // Always expand if official-primary evidence is absent or sparse.
    // This threshold controls SEARCH ONLY, not article minimums or quality.
    if (needsSecondaryDiscovery(primaryCount, secondaryThreshold)) {
      second = await searchGroup(api, group, {
        now, tier: SECONDARY_TIER, focuses: FALLBACK_SEARCH_FOCUSES,
      });
      await collect(second, SECONDARY_TIER);
    }
    const status = first.status === 'ok' || second?.status === 'ok' ? 'ok' : 'unavailable';
    const errors = [first.error, second?.error].filter(Boolean);
    return {
      report: {
        group, status, ...(errors.length ? { error: errors.join('; ') } : {}),
        hits: first.items.length + (second?.items.length || 0),
        kept: accepted.length, primaryCount,
        fallbackSearched: Boolean(second), industryCount: accepted.filter(x => x.sourceTier === SECONDARY_TIER).length,
        rejected,
      },
      accepted,
    };
  }

  const perGroup = await pool(groups, SEARCH_CONCURRENCY, discoverGroup);
  const report = [], findings = [], seen = new Set();
  for (const result of perGroup) {
    report.push(result.report);
    // Official sources lead whenever a domain was identified as authoritative.
    const ordered = [...result.accepted].sort((a, b) =>
      (a.sourceTier === PRIMARY_TIER ? 0 : 1) - (b.sourceTier === PRIMARY_TIER ? 0 : 1));
    for (const finding of ordered) {
      if (seen.has(finding.sourceUrl)) continue;
      seen.add(finding.sourceUrl);
      findings.push(finding);
    }
  }
  return { findings, groups: report };
}
