// Web-search discovery for the EU Oversize Weekly.
//
// The daily monitor finds news through OpenAI's web search (Responses API,
// `web_search_preview` tool) instead of crawling a fixed list of authority
// pages. One search runs per region group; Central Europe is searched country
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

const DEFAULT_SEARCH_MODEL = 'gpt-4.1';
const MAX_ITEMS_PER_SEARCH = 12;
const SEARCH_CONCURRENCY = 3;
const VERIFY_CONCURRENCY = 6;
const MAX_SUMMARY_CHARS = 1_800;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Search groups in operator-first order. `codes` are the coverage codes the
 * group answers for (config/europe-coverage.mjs).
 */
export const SEARCH_GROUPS = [
  { id: 'cz', countries: ['Czechia'], codes: ['CZ'], languages: 'Czech, English' },
  { id: 'de', countries: ['Germany'], codes: ['DE'], languages: 'German, English' },
  { id: 'at', countries: ['Austria'], codes: ['AT'], languages: 'German, English' },
  { id: 'sk', countries: ['Slovakia'], codes: ['SK'], languages: 'Slovak, English' },
  { id: 'pl', countries: ['Poland'], codes: ['PL'], languages: 'Polish, English' },
  { id: 'hu', countries: ['Hungary'], codes: ['HU'], languages: 'Hungarian, English' },
  { id: 'ch-li', countries: ['Switzerland', 'Liechtenstein'], codes: ['CH', 'LI'], languages: 'German, French, Italian, English' },
  { id: 'si-hr', countries: ['Slovenia', 'Croatia'], codes: ['SI', 'HR'], languages: 'Slovenian, Croatian, English' },
  { id: 'fr', countries: ['France', 'Monaco'], codes: ['FR', 'MC'], languages: 'French, English' },
  { id: 'benelux', countries: ['Belgium', 'Netherlands', 'Luxembourg'], codes: ['BE', 'NL', 'LU', 'FLA', 'WAL', 'BRU'], languages: 'Dutch, French, German, English' },
  { id: 'it', countries: ['Italy', 'San Marino', 'Vatican City'], codes: ['IT', 'SM', 'VA', 'RSM'], languages: 'Italian, English' },
  { id: 'ro-bg-md', countries: ['Romania', 'Bulgaria', 'Moldova'], codes: ['RO', 'BG', 'MD', 'TRN', 'GAG'], languages: 'Romanian, Bulgarian, English' },
  { id: 'iberia', countries: ['Spain', 'Portugal', 'Andorra', 'Gibraltar'], codes: ['ES', 'PT', 'AD', 'GI', 'CAT', 'BAS', 'GAL', 'CEU', 'MLL', 'CAN', 'AZO', 'MAD'], languages: 'Spanish, Portuguese, Catalan, English' },
  { id: 'uk-ie', countries: ['United Kingdom', 'Ireland'], codes: ['UK', 'IE', 'ENG', 'SCT', 'WLS', 'NIR', 'GG', 'JE', 'IM', 'ALDERNEY'], languages: 'English' },
  { id: 'nordics', countries: ['Denmark', 'Sweden', 'Norway', 'Finland', 'Iceland'], codes: ['DK', 'SE', 'NO', 'FI', 'IS', 'AX', 'FO', 'GL', 'SVALBARD', 'JANMAYEN'], languages: 'Danish, Swedish, Norwegian, Finnish, English' },
  { id: 'baltics', countries: ['Estonia', 'Latvia', 'Lithuania'], codes: ['EE', 'LV', 'LT'], languages: 'Estonian, Latvian, Lithuanian, English' },
  { id: 'balkans', countries: ['Serbia', 'Bosnia and Herzegovina', 'Montenegro', 'North Macedonia', 'Albania', 'Kosovo', 'Greece'], codes: ['RS', 'BA', 'ME', 'MK', 'AL', 'XK', 'GR', 'FBIH', 'RSBA'], languages: 'local languages, English' },
  { id: 'east', countries: ['Ukraine', 'Türkiye', 'Georgia', 'Armenia', 'Azerbaijan', 'Belarus', 'Russia (European part)', 'Kazakhstan (European transit)'], codes: ['UA', 'TR', 'GE', 'AM', 'AZ', 'BY', 'AB', 'SO', 'RU', 'KZ'], languages: 'local languages, English' },
  { id: 'islands', countries: ['Cyprus', 'Malta'], codes: ['CY', 'MT', 'SBA', 'NCY'], languages: 'Greek, Maltese, English' },
];

const SEARCH_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    country: { type: 'string', description: 'English country name the development applies to.' },
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
  required: ['country', 'title', 'url', 'sourceName', 'publishedAt', 'validFrom', 'validTo', 'summary', 'type', 'oversize'],
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

const FOCUS_TOPICS = {
  oversize: `ONLY oversize / abnormal / exceptional / special transport (Schwertransport, Ausnahmetransport, nadrozměrná přeprava, convoi exceptionnel, trasporto eccezionale, transporte especial ...):
- permits and permit systems, application portals, fees
- escort, private-escort and police-escort rules
- movement windows and time restrictions for abnormal loads
- approved abnormal-load routes, diversions for abnormal loads
- bridges or tunnels newly restricted or reopened for abnormal loads`,
  heavy: `Changes that affect goods vehicles over 12 t (not specifically oversize):
- new or changed weight, axle-load, height or width limits; bridges or tunnels closed or restricted for trucks
- closures or diversions of motorways and main freight routes lasting more than 30 days
- truck tolls and road charges (new rates, new tolled sections, new systems)
- border crossings and customs procedures for goods traffic; ferries/RoRo for trucks
- new rules for HGV operators or drivers: tachograph, e-CMR, ADR, cabotage, announced enforcement campaigns`,
};

/** The prompt for one search group and focus. Pure - exported for tests. */
export function buildSearchPrompt(group, now = new Date(), focus = 'oversize') {
  const since = isoDay(new Date(now.getTime() - FRESHNESS_WINDOW_DAYS * DAY_MS));
  const today = isoDay(now);
  const horizon = isoDay(new Date(now.getTime() + FORWARD_HORIZON_DAYS * DAY_MS));
  return `Today is ${today}. You are researching news for a weekly briefing for road freight operators running vehicles over 12 tonnes, where oversize/abnormal transport has priority.
Countries: ${group.countries.join(', ')}. Search in ${group.languages}.

TOPIC:
${FOCUS_TOPICS[focus] || FOCUS_TOPICS.oversize}

DATES - STRICT:
Return a page only if its visible publication date is between ${since} and ${today}, OR it announces a change that takes effect or ends between ${today} and ${horizon}. Skip every page that shows an older date and no such upcoming effective date. Search news sections and press releases of the last days, not evergreen pages.

NEVER RETURN: general recurring truck driving bans (Sunday, holiday, weekend, night, summer bans - they are covered elsewhere), accidents, incidents, crime, short local roadworks, tenders, statistics, company/market news, service or company pages, guides, FAQs, homepages, listing pages, undated pages.

Prefer official sources (road authorities, ministries, police, toll operators) and established transport trade media. Each item must link to the specific article. Copy dates exactly as shown on the page; use null when the page shows none. Return at most ${MAX_ITEMS_PER_SEARCH} items; return an empty list when nothing qualifies - never pad.`;
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

  // Binary documents (PDF) cannot be read as text here: only the URL date is
  // evidence, and the page text cannot confirm the transport context.
  if (looksBinary(fetched.text || '')) return { ok: false, reason: 'binary document - page text cannot be verified' };

  const pageText = extractDetailText(fetched.text || '');
  if (pageText.length < 120) return { ok: false, reason: 'page has no readable article text' };

  const title = extractDetailHeading(fetched.text || '') || String(item.title || '').trim();
  const evidence = `${title} ${pageText}`;
  if (!checkOperationalRelevance(evidence, { now }).ok) return { ok: false, reason: 'page is not an operational development' };
  if (!checkTransportDomainRelevance({ title, summary: pageText }).ok) {
    return { ok: false, reason: 'page text shows no freight-vehicle (>12 t) or oversize-transport context' };
  }

  const country = String(item.country || '').trim();
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
      region: null,
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
export async function searchGroup(client, group, { now = new Date(), model, focuses = SEARCH_FOCUSES } = {}) {
  const items = [];
  const seen = new Set();
  const errors = [];
  for (const focus of focuses) {
    try {
      const response = await client.responses.create({
        model: model || process.env.OPENAI_SEARCH_MODEL || DEFAULT_SEARCH_MODEL,
        tools: [{ type: 'web_search_preview', search_context_size: 'high' }],
        input: buildSearchPrompt(group, now, focus),
        text: { format: SEARCH_RESULT_FORMAT },
      });
      for (const item of parseSearchResponse(response.output_text)) {
        if (seen.has(item.url)) continue;
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
export async function discoverWithWebSearch({ apiKey, now = new Date(), groups = SEARCH_GROUPS, client = null, fetchPage } = {}) {
  const api = client || new OpenAI({ apiKey });
  const searched = await pool(groups, SEARCH_CONCURRENCY, (group) => searchGroup(api, group, { now }));

  const report = [];
  const findings = [];
  const seen = new Set();
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const result = searched[i];
    const entry = { group, status: result.status, error: result.error, hits: result.items.length, kept: 0, rejected: [] };
    const verified = await pool(result.items, VERIFY_CONCURRENCY, (item) => verifySearchItem(item, { now, ...(fetchPage ? { fetchPage } : {}) }));
    verified.forEach((outcome, index) => {
      if (!outcome.ok) {
        entry.rejected.push({ url: result.items[index].url, reason: outcome.reason });
        return;
      }
      if (seen.has(outcome.finding.sourceUrl)) return;
      seen.add(outcome.finding.sourceUrl);
      entry.kept += 1;
      findings.push({ ...outcome.finding, searchGroup: group.id });
    });
    report.push(entry);
  }
  return { findings, groups: report };
}
