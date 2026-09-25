// Structured German motorway restrictions from the Autobahn GmbH des Bundes
// traffic API (verkehr.autobahn.de, the data behind autobahn.de's traffic map).
//
// Why a dedicated adapter: long-running width and weight limits (e.g. A4 Köln
// "BW Eifeltor": max. 3.25 m passage width and 44 t gross weight until 2029)
// are published only as structured roadworks records, never as a news item or
// an HTML traffic notice, so the generic feed/HTML scan cannot discover them.
//
// Nearly every roadworks record carries a passage width (3.25 m is simply a
// narrowed lane), so only records that matter for heavy/oversize planning are
// kept: an explicit gross-weight limit, or a passage width of at most
// MAX_RELEVANT_WIDTH_M. Short ad-hoc windows ("Die Baustelle ist zu folgenden
// Zeiträumen gültig", typically single nights) are ignored; only records with a
// defined construction phase ("Zeitraum dieser Bauphase") are used. Records of
// one project on one motorway are merged into a single finding.

const API_BASE = 'https://verkehr.autobahn.de/o/autobahn';
const FETCH_TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;
export const MAX_RELEVANT_WIDTH_M = 3.0;
// A width is still worth stating next to a weight limit while it is at most
// a single narrowed lane; wider passages are not a constraint worth listing.
const MAX_REPORTED_WIDTH_M = 3.5;

export const AUTOBAHN_SOURCE_NAME = 'Autobahn GmbH des Bundes - roadworks restrictions';

function parseGermanDate(value) {
  const m = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${m[2]}-${m[1]}`;
  return Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime()) ? null : iso;
}

function parseNumber(value) {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one roadworks record. Returns null when the record is not a
 * phase-defined width/weight restriction relevant for heavy transport.
 */
export function parseRoadworksRestriction(record, road) {
  const lines = (record?.description || []).map((line) => String(line).trim());
  const text = lines.join(' ');
  if (!/Zeitraum dieser Bauphase/.test(text)) return null;

  const width = parseNumber(text.match(/Maximale Durchfahrtsbreite:\s*([\d.,]+)\s*m/)?.[1] ?? NaN);
  const weight = parseNumber(text.match(/zul[äa]ssiges Gesamtgewicht:\s*([\d.,]+)\s*t/i)?.[1] ?? NaN);
  const relevantWidth = width != null && width <= MAX_RELEVANT_WIDTH_M;
  if (weight == null && !relevantWidth) return null;

  const phaseStart = parseGermanDate(text.match(/Beginn:\s*([\d.]+)/)?.[1]);
  const phaseEnd = parseGermanDate(text.match(/Ende:\s*([\d.]+)/)?.[1]);
  const projectEnd = parseGermanDate(text.match(/Ende der Gesamtma[ßs]nahme:\s*([\d.]+)/)?.[1]);
  if (!phaseStart || !phaseEnd) return null;

  const nonEmpty = lines.filter(Boolean);
  const project = nonEmpty[nonEmpty.length - 1] || '';
  // Main-carriageway records are titled "A4 | Köln-West - Köln-Eifeltor" with
  // the direction as subtitle; ramp records carry only the project as title
  // and describe the ramp in the subtitle.
  const title = String(record.title || '');
  const subtitle = String(record.subtitle || '').trim();
  const hasSection = title.includes('|');

  return {
    road,
    identifier: record.identifier,
    project,
    section: hasSection ? title.split('|').slice(1).join('|').trim() : subtitle,
    direction: hasSection ? subtitle : '',
    width,
    weight,
    phaseStart,
    phaseEnd,
    projectEnd,
  };
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

/** Merge parsed records of one project on one motorway into a finding. */
export function restrictionFinding(records) {
  // Most restrictive record first (lowest weight, then narrowest width), with
  // the identifier as a stable tie-breaker so the source URL does not flap.
  const sorted = [...records].sort((a, b) =>
    (a.weight ?? Infinity) - (b.weight ?? Infinity) ||
    (a.width ?? Infinity) - (b.width ?? Infinity) ||
    String(a.identifier).localeCompare(String(b.identifier))
  );
  const primary = sorted[0];
  const weights = records.map((r) => r.weight).filter((v) => v != null);
  const widths = records.map((r) => r.width).filter((v) => v != null);
  const minWeight = weights.length ? Math.min(...weights) : null;
  const minWidth = widths.length ? Math.min(...widths) : null;
  const validFrom = records.map((r) => r.phaseStart).sort()[0];
  const validTo = records.map((r) => r.phaseEnd).sort().at(-1);
  const projectEnd = records.map((r) => r.projectEnd).filter(Boolean).sort().at(-1) || null;
  const sections = [...new Set(records.map((r) => r.section).filter(Boolean))];
  const directions = [...new Set(records.map((r) => r.direction).filter(Boolean))];

  const limits = [
    minWeight != null ? `max. gross vehicle weight ${minWeight} t` : null,
    minWidth != null && (minWeight == null || minWidth <= MAX_REPORTED_WIDTH_M) ? `max. passage width ${minWidth} m` : null,
  ].filter(Boolean);
  const location = `${primary.road} ${sections[0] || ''}`.trim();
  const projectLabel = primary.project && !sections.includes(primary.project) ? ` (${primary.project})` : '';

  const summary = [
    `Autobahn GmbH roadworks restriction on the ${primary.road}${projectLabel}: ${limits.join(', ')}.`,
    `Affected sections: ${sections.join('; ')}${directions.length ? ` (direction: ${directions.join('; ')})` : ''}.`,
    `Current construction phase ${formatDate(validFrom)} to ${formatDate(validTo)}${projectEnd ? `; overall project until ${formatDate(projectEnd)}` : ''}.`,
    minWeight != null
      ? `Vehicles above ${minWeight} t gross weight, including heavy and abnormal transports, cannot use the restricted section without an authorised alternative.`
      : `Wide loads cannot pass the narrowed section; abnormal-transport routes through this section need checking.`,
  ].join(' ');

  return {
    country: 'Germany',
    region: null,
    location,
    type: minWeight != null ? 'weight_restriction' : 'width_restriction',
    title: `${location}${projectLabel}: ${limits.join(', ')}`,
    summary,
    validFrom,
    validTo,
    impact: limits.join(', '),
    recommendedAction:
      'Check the restricted section against planned heavy and abnormal-transport routes and permits; obtain an alternative authorised route where the limit is exceeded.',
    routeScope: `${primary.road}: ${sections.join('; ')}`,
    vehicleScope: minWeight != null ? `Vehicles above ${minWeight} t gross weight` : `Vehicles or loads wider than ${minWidth} m`,
    sourceName: AUTOBAHN_SOURCE_NAME,
    sourceUrl: `${API_BASE}/details/roadworks/${encodeURIComponent(primary.identifier)}`,
    confidence: 'unverified',
    isStructuredRestriction: true,
    isInfrastructure: true,
  };
}

/** Group parsed records per motorway + project and build findings. */
export function buildRestrictionFindings(parsedRecords) {
  const groups = new Map();
  for (const record of parsedRecords) {
    if (!record) continue;
    const key = `${record.road}::${record.project || record.section}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()].map(restrictionFinding);
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; DajcOversizeMonitor/1.0; +https://dajc.eu)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch every motorway's roadworks and return relevant restriction findings,
 * in the same result shape as fetchSourceFindings().
 */
export async function fetchAutobahnRestrictionFindings(source, { fetchImpl = fetch } = {}) {
  let roads;
  try {
    roads = (await fetchJson(`${API_BASE}/`, fetchImpl)).roads || [];
  } catch (err) {
    return { source: source.id, status: 'unavailable', findings: [], error: `road list: ${err?.message || err}` };
  }

  const parsed = [];
  let failedRoads = 0;
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < roads.length) {
      const road = String(roads[nextIndex++]).trim();
      try {
        const data = await fetchJson(`${API_BASE}/${encodeURIComponent(road)}/services/roadworks`, fetchImpl);
        for (const record of data.roadworks || []) parsed.push(parseRoadworksRestriction(record, road));
      } catch {
        failedRoads += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, roads.length) }, worker));

  if (roads.length > 0 && failedRoads === roads.length) {
    return { source: source.id, status: 'unavailable', findings: [], error: 'all motorway roadworks requests failed' };
  }

  return {
    source: source.id,
    status: 'ok',
    method: 'api',
    sourceUrlUsed: `${API_BASE}/`,
    findings: buildRestrictionFindings(parsed),
  };
}

/**
 * A structured restriction whose current phase began before `since` is an
 * ongoing (unchanged) restriction rather than a new/changed one. The weekly
 * uses ongoing restrictions only to supplement an edition with fewer than
 * 20 lead reports.
 */
export function isOngoingRestriction(finding, since) {
  if (!finding?.isStructuredRestriction || !finding.validFrom || !since) return false;
  return new Date(`${finding.validFrom}T00:00:00Z`) < since;
}
