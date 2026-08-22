// Best-effort fetch + classification of one configured source into zero or
// more candidate findings. Every source is isolated in try/catch - one
// unreachable or malformed source must never abort the whole monitor run
// (see docs/NEWS_AUTOMATION.md "Failure safety").

import Parser from 'rss-parser';
import { FINDING_TYPES } from './findings.mjs';
import { checkOperationalRelevance } from './relevance-filter.mjs';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ITEMS_PER_SOURCE = 15;

const COUNTRY_NAMES = {
  AL: 'Albania', AT: 'Austria', BA: 'Bosnia and Herzegovina', BE: 'Belgium',
  BG: 'Bulgaria', BY: 'Belarus', CH: 'Switzerland', CY: 'Cyprus',
  CZ: 'Czechia', DE: 'Germany', DK: 'Denmark', EE: 'Estonia', ES: 'Spain',
  FI: 'Finland', FR: 'France', GR: 'Greece', HR: 'Croatia', HU: 'Hungary',
  IE: 'Ireland', IS: 'Iceland', IT: 'Italy', LT: 'Lithuania', LU: 'Luxembourg',
  LV: 'Latvia', MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro',
  MK: 'North Macedonia', MT: 'Malta', NL: 'Netherlands', NO: 'Norway',
  PL: 'Poland', PT: 'Portugal', RO: 'Romania', RS: 'Serbia', SE: 'Sweden',
  SI: 'Slovenia', SK: 'Slovakia', TR: 'Turkey', UA: 'Ukraine', UK: 'United Kingdom',
  XK: 'Kosovo',
};

// Ordered classification rules: first matching type wins. Heuristic and
// intentionally conservative - the Friday editorial pass (OpenAI) re-checks
// and can recategorize before publication, this first pass only needs to be
// good enough to route findings into data/oversize for human/AI review.
const CLASSIFICATION_RULES = [
  { type: 'driving_ban', pattern: /driving ban|weekend ban|holiday ban|seasonal ban|fahrverbot|zakaz jazd|zákaz jízd/i },
  { type: 'police_escort', pattern: /police escort|polizeieskorte|doprovod policie/i },
  { type: 'escort_requirement', pattern: /escort vehicle|pilot vehicle|begleitfahrzeug|BF[- ]?escort/i },
  { type: 'border_restriction', pattern: /border crossing|border restriction|grenzübergang|hraniční přechod/i },
  { type: 'bridge_restriction', pattern: /\bbridge\b|brücke|brucke|\bviaduct\b|\bmost\b/i },
  { type: 'tunnel_restriction', pattern: /\btunnel\b|\btunel\b/i },
  { type: 'road_closure', pattern: /road closure|closed to traffic|uzavírka|uzavierka|gesperrt/i },
  { type: 'roadworks', pattern: /roadworks|road works|construction works|stavební práce|baustelle/i },
  { type: 'permit_system', pattern: /permit system|digital permit|online permit|nový systém povolení/i },
  { type: 'permit_change', pattern: /\bpermit\b|povolení|genehmigung|vergunning/i },
  { type: 'route_restriction', pattern: /diversion|detour|alternative route|objížďka/i },
  { type: 'operational_change', pattern: /procedure change|new requirement|new rule|nové pravidlo/i },
  { type: 'equipment', pattern: /equipment requirement|vehicle requirement|povinná výbava/i },
  { type: 'market', pattern: /market report|fleet growth|industry outlook/i },
];

function classify(text) {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return null;
}

// Relevance gate. Several configured sources (e.g. general police press
// aggregators like "Blaulicht" or a national police feed) publish mostly
// unrelated crime/administrative news alongside the rare traffic-relevant
// item - without this gate, generic press releases ("person arrested for
// weapon possession", procurement notices, financial reports) would be
// picked up as fallback "infrastructure" findings just for mentioning a
// road name. A CLASSIFICATION_RULES match (driving ban, escort, border,
// bridge/tunnel, closure, roadworks, permit, route) is inherently
// transport-specific and always accepted; anything that only reaches the
// generic fallback must ALSO show clear heavy/oversize-transport context.
const GENERAL_TRANSPORT_CONTEXT =
  /oversize|abnormal load|heavy transport|wide load|special transport|convoi exceptionnel|\bHGV\b|\blorry\b|\btruck\b|\bfreight\b|\bcargo\b|heavy vehicle|weight limit|height limit|axle load|\btoll\b|motorway|highway|reconstruction|construction works/i;

// EXCLUSION_PATTERNS (crime/administrative noise) and the one-off-incident /
// procurement-notice / unconfirmed-planned-works checks now live in
// relevance-filter.mjs, shared with the Friday pipeline's independent
// re-check in verify-candidates.mjs - see that file for why both call sites
// exist. Kept here as the first, cheapest gate: a stuck-lorry incident or a
// procurement notice should never even enter data/oversize/<week>/findings.json.
function isRelevant(text, matchedType) {
  if (!checkOperationalRelevance(text).ok) return false;
  if (matchedType) return true; // specific transport-restriction pattern already matched
  return GENERAL_TRANSPORT_CONTEXT.test(text);
}

// Common European route/motorway code, e.g. "A3", "D1", "M6", "E55".
const ROUTE_CODE_PATTERN = /\b([A-Z]\d{1,3})\b/;

function guessLocation(text, fallback) {
  const match = text.match(ROUTE_CODE_PATTERN);
  return match ? match[1] : fallback;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DajcOversizeMonitor/1.0; +https://dajc.eu)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

function feedCandidates(source) {
  const candidates = [];
  if (source.feedUrl) candidates.push(source.feedUrl);
  const base = source.url.replace(/\/$/, '');
  candidates.push(`${base}/feed`, `${base}/feed/`, `${base}/rss`);
  return [...new Set(candidates)];
}

/**
 * @returns {Promise<{ source: string, status: 'ok'|'no_feed', findings: object[], error?: string }>}
 */
export async function fetchSourceFindings(source, { now = new Date().toISOString() } = {}) {
  const parser = new Parser({ timeout: FETCH_TIMEOUT_MS });
  const candidates = feedCandidates(source);

  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!res.ok) continue;
      const raw = await res.text();
      const feed = await parser.parseString(raw);
      const items = (feed.items || []).slice(0, MAX_ITEMS_PER_SOURCE);

      const findings = items
        .filter((item) => {
          const text = `${item.title || ''} ${item.contentSnippet || item.summary || ''}`;
          return isRelevant(text, classify(text));
        })
        .map((item) => {
          const text = `${item.title || ''} ${item.contentSnippet || item.summary || ''}`;
          const type = classify(text) || 'infrastructure';
          return {
            country: COUNTRY_NAMES[source.country] || source.country,
            region: null,
            location: guessLocation(text, source.authority),
            type,
            title: item.title || '(untitled)',
            summary: (item.contentSnippet || item.summary || '').slice(0, 600) || null,
            validFrom: null,
            validTo: null,
            impact: null,
            recommendedAction: null,
            sourceName: source.name,
            sourceUrl: item.link || source.url,
            confidence: 'unverified',
          };
        });

      return { source: source.id, status: 'ok', feedUrlUsed: url, findings };
    } catch {
      // try next candidate
    }
  }

  return { source: source.id, status: 'no_feed', findings: [] };
}

export { FINDING_TYPES };
