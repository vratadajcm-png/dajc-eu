// Best-effort fetch + classification of one configured source into zero or
// more candidate findings. Sources can be read from a known RSS/Atom feed
// OR directly from an official HTML page. This matters because many European
// road authorities do not expose a usable feed.
//
// Every source remains isolated: one unreachable or malformed source never
// aborts the whole monitor run. HTML fallback only accepts links on the same
// official host (including www/subdomain variants), and the same conservative
// operational-relevance filter used for RSS items is applied before a link
// becomes a finding.

import Parser from 'rss-parser';
import { FINDING_TYPES } from './findings.mjs';
import { checkOperationalRelevance } from './relevance-filter.mjs';

const FETCH_TIMEOUT_MS = 12_000;
const FETCH_RETRIES = 2;
const MAX_ITEMS_PER_SOURCE = 15;
const MAX_HTML_FINDINGS_PER_SOURCE = 20;
const MAX_HTML_ANCHORS_SCANNED = 300;

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

const CLASSIFICATION_RULES = [
  { type: 'driving_ban', pattern: /driving ban|weekend ban|holiday ban|seasonal ban|fahrverbot|lkw-fahrverbot|interdiction de circuler|restriction de circulation|zakaz jazd|zákaz jízd|restricții de circulație|restricciones de circulación/i },
  { type: 'police_escort', pattern: /police escort|polizeieskorte|doprovod policie/i },
  { type: 'escort_requirement', pattern: /escort vehicle|pilot vehicle|begleitfahrzeug|BF[- ]?escort|véhicule pilote|vehículo piloto/i },
  { type: 'border_restriction', pattern: /border crossing|border restriction|grenzübergang|hraniční přechod|frontier crossing|poste frontière/i },
  { type: 'bridge_restriction', pattern: /\bbridge\b|brücke|brucke|\bviaduct\b|\bmost\b|pont|ponte/i },
  { type: 'tunnel_restriction', pattern: /\btunnel\b|\btunel\b|galleria/i },
  { type: 'road_closure', pattern: /road closure|closed to traffic|full closure|vollsperrung|sperrung|uzavírka|uzavierka|gesperrt|fermeture|chiusura|cierre|închidere/i },
  { type: 'roadworks', pattern: /roadworks|road works|construction works|stavební práce|baustelle|bauarbeiten|travaux|lavori|obras|lucrări/i },
  { type: 'permit_system', pattern: /permit system|digital permit|online permit|nový systém povolení|VEMAGS/i },
  { type: 'permit_change', pattern: /\bpermit\b|povolení|genehmigung|vergunning|autorisation|autorizzazione|permiso|autorizație/i },
  { type: 'route_restriction', pattern: /diversion|detour|alternative route|objížďka|umleitung|déviation|deviazione|desvío|deviere/i },
  { type: 'operational_change', pattern: /procedure change|new requirement|new rule|nové pravidlo|neue regel|nouvelle règle|nuova regola/i },
  { type: 'equipment', pattern: /equipment requirement|vehicle requirement|povinná výbava/i },
  { type: 'market', pattern: /market report|fleet growth|industry outlook/i },
];

function classify(text) {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return null;
}

const GENERAL_TRANSPORT_CONTEXT =
  /oversize|abnormal load|heavy transport|wide load|special transport|convoi exceptionnel|großraum|schwertransport|trasporto eccezionale|transporte especial|agabaritic|\bHGV\b|\blorry\b|\btruck\b|\bfreight\b|\bcargo\b|heavy vehicle|weight limit|height limit|axle load|\btoll\b|motorway|highway|autobahn|autoroute|autostrada|autopista|reconstruction|construction works/i;

function isRelevant(text, matchedType) {
  if (!checkOperationalRelevance(text).ok) return false;
  if (matchedType) return true;
  return GENERAL_TRANSPORT_CONTEXT.test(text);
}

const ROUTE_CODE_PATTERN = /\b([A-Z]\d{1,3})\b/;

function guessLocation(text, fallback) {
  const match = text.match(ROUTE_CODE_PATTERN);
  return match ? match[1] : fallback;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value = '') {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function sameOfficialHost(candidateUrl, sourceUrl) {
  try {
    const a = normalizedHost(new URL(candidateUrl).hostname);
    const b = normalizedHost(new URL(sourceUrl).hostname);
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  } catch {
    return false;
  }
}

function resolveLink(href, baseUrl) {
  if (!href || /^(?:mailto:|tel:|javascript:|#)/i.test(href)) return null;
  try {
    const url = new URL(href, baseUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function toFinding({ source, title, summary, sourceUrl }) {
  const text = `${title} ${summary || ''}`;
  const type = classify(text) || 'infrastructure';
  return {
    country: COUNTRY_NAMES[source.country] || source.country,
    region: null,
    location: guessLocation(text, source.authority),
    type,
    title,
    summary: summary ? summary.slice(0, 600) : null,
    validFrom: null,
    validTo: null,
    impact: null,
    recommendedAction: null,
    sourceName: source.name,
    sourceUrl,
    confidence: 'unverified',
  };
}

/**
 * Extract operationally relevant links from an official HTML listing/home page.
 * Exported for deterministic unit tests; network fetching stays in
 * fetchSourceFindings().
 */
export function extractHtmlFindings(html, source, pageUrl = source.url) {
  const findings = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  let scanned = 0;
  while ((match = anchorRe.exec(html)) && scanned < MAX_HTML_ANCHORS_SCANNED) {
    scanned += 1;
    const href = match[1] || match[2] || match[3] || '';
    const sourceUrl = resolveLink(href, pageUrl);
    if (!sourceUrl || !sameOfficialHost(sourceUrl, source.url) || seen.has(sourceUrl)) continue;

    const title = stripHtml(match[4] || '');
    if (title.length < 8 || title.length > 280) continue;

    // A small surrounding slice often carries route codes, restriction type,
    // dates or a short teaser even when the anchor itself is terse.
    const before = Math.max(0, match.index - 450);
    const after = Math.min(html.length, anchorRe.lastIndex + 450);
    const context = stripHtml(html.slice(before, after));
    const text = `${title} ${context}`;
    const matchedType = classify(text);
    if (!isRelevant(text, matchedType)) continue;

    seen.add(sourceUrl);
    findings.push(toFinding({
      source,
      title,
      summary: context === title ? null : context,
      sourceUrl,
    }));

    if (findings.length >= MAX_HTML_FINDINGS_PER_SOURCE) break;
  }

  return findings;
}

function discoverFeedLinks(html, pageUrl) {
  const urls = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) || []) {
    if (!/rel\s*=\s*["'][^"']*alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["'](?:application\/(?:rss\+xml|atom\+xml)|text\/xml)/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const resolved = resolveLink(href?.[1] || href?.[2] || href?.[3] || '', pageUrl);
    if (resolved) urls.push(resolved);
  }
  return [...new Set(urls)];
}

async function fetchWithTimeout(url, timeoutMs, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DajcOversizeMonitor/2.0; +https://dajc.eu)',
        Accept: accept,
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithRetry(url, accept) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, accept);
      if (res.ok) return { ok: true, text: await res.text(), finalUrl: res.url || url };
      lastError = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
    }
  }
  return { ok: false, error: lastError || 'unreachable' };
}

async function parseFeed(raw, source, feedUrl, parser) {
  const feed = await parser.parseString(raw);
  const items = (feed.items || []).slice(0, MAX_ITEMS_PER_SOURCE);
  return items
    .filter((item) => {
      const text = `${item.title || ''} ${item.contentSnippet || item.summary || ''}`;
      return isRelevant(text, classify(text));
    })
    .map((item) => toFinding({
      source,
      title: item.title || '(untitled)',
      summary: item.contentSnippet || item.summary || null,
      sourceUrl: item.link || feedUrl || source.url,
    }));
}

function htmlCandidates(source) {
  const configured = Array.isArray(source.htmlUrls) ? source.htmlUrls : [];
  return [...new Set([...configured, source.url].filter(Boolean))];
}

/**
 * @returns {Promise<{
 *   source: string,
 *   status: 'ok'|'unavailable',
 *   findings: object[],
 *   method?: 'feed'|'html',
 *   sourceUrlUsed?: string,
 *   error?: string
 * }>}
 */
export async function fetchSourceFindings(source, { now = new Date().toISOString() } = {}) {
  void now;
  const parser = new Parser({ timeout: FETCH_TIMEOUT_MS });
  let readableFeed = null;
  let lastError = null;

  // Known feeds are cheapest and most structured, so try them first.
  if (source.feedUrl) {
    const fetched = await fetchTextWithRetry(
      source.feedUrl,
      'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
    );
    if (fetched.ok) {
      try {
        const findings = await parseFeed(fetched.text, source, fetched.finalUrl, parser);
        readableFeed = fetched.finalUrl;
        if (findings.length > 0) {
          return { source: source.id, status: 'ok', method: 'feed', sourceUrlUsed: fetched.finalUrl, findings };
        }
      } catch (err) {
        lastError = `feed parse failed: ${err?.message || err}`;
      }
    } else {
      lastError = fetched.error;
    }
  }

  // No useful feed result: inspect the official HTML page. This is the key
  // fallback for authorities that publish only web pages.
  for (const pageUrl of htmlCandidates(source)) {
    const fetched = await fetchTextWithRetry(
      pageUrl,
      'text/html, application/xhtml+xml, application/rss+xml, application/atom+xml, */*'
    );
    if (!fetched.ok) {
      lastError = fetched.error;
      continue;
    }

    const htmlFindings = extractHtmlFindings(fetched.text, source, fetched.finalUrl);
    if (htmlFindings.length > 0) {
      return { source: source.id, status: 'ok', method: 'html', sourceUrlUsed: fetched.finalUrl, findings: htmlFindings };
    }

    // Some sites advertise a non-standard feed only from <link rel=alternate>.
    // Try discovered official feeds before concluding that the page simply
    // contains no operationally relevant item today.
    for (const discoveredFeed of discoverFeedLinks(fetched.text, fetched.finalUrl)) {
      const feedFetch = await fetchTextWithRetry(
        discoveredFeed,
        'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      );
      if (!feedFetch.ok) continue;
      try {
        const findings = await parseFeed(feedFetch.text, source, feedFetch.finalUrl, parser);
        if (findings.length > 0) {
          return { source: source.id, status: 'ok', method: 'feed', sourceUrlUsed: feedFetch.finalUrl, findings };
        }
        readableFeed = feedFetch.finalUrl;
      } catch {
        // keep trying other discovered feeds / pages
      }
    }

    // The official HTML itself was reachable and checked even if no relevant
    // link was found. Report this as a successful source check, not as a fake
    // "no feed reachable" failure.
    return { source: source.id, status: 'ok', method: 'html', sourceUrlUsed: fetched.finalUrl, findings: [] };
  }

  if (readableFeed) {
    return { source: source.id, status: 'ok', method: 'feed', sourceUrlUsed: readableFeed, findings: [] };
  }

  return { source: source.id, status: 'unavailable', findings: [], error: lastError || 'no official source endpoint reachable' };
}

export { FINDING_TYPES };
