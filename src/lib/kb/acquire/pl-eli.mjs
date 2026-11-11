// Poland: ELI API of the Sejm (https://api.sejm.gov.pl/eli.html, OpenAPI 3.0.3 at
// https://api.sejm.gov.pl/eli/openapi, retrieved 2026-11-09, sha256 c37b3a5a...2244).
// Endpoints used (all GET, JSON unless noted):
//   /acts/search      title, inForce, type, publisher, year, dateEffect*, pubDate*, limit (max 500), offset
//   /acts/{publisher}/{year}/{position}              details: inForce, validFrom, entryIntoForce, status, texts, keywords
//   /acts/{publisher}/{year}/{position}/references   amending/repealing/executive acts, "Inf. o tekście jednolitym"
//   /acts/{publisher}/{year}/{position}/text.pdf     official PDF (application/pdf)
//   /changes/acts     since (required), limit (max 500), offset: acts changed since a date
// The documentation states no request limit; the client keeps a conservative 2 requests/s, serially.

import { PoliteClient } from './polite-fetch.mjs';

export const ELI_BASE = 'https://api.sejm.gov.pl/eli';
export const PL_MIN_INTERVAL_MS = 500;
export const plClient = (options = {}) => new PoliteClient({ minIntervalMs: PL_MIN_INTERVAL_MS, ...options });

const json = async (client, url) => JSON.parse(new TextDecoder().decode((await client.get(url, { accept: 'application/json' })).bytes));
const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();

/** Pages through an offset/limit listing (items, totalCount). */
export async function* pagedItems(client, path, params, { pageSize = 500, maxItems = Infinity } = {}) {
  let offset = 0;
  for (;;) {
    const page = await json(client, `${ELI_BASE}${path}?${qs({ ...params, limit: pageSize, offset })}`);
    const items = page.items ?? [];
    for (const item of items) { if (maxItems-- <= 0) return; yield item; }
    offset += items.length;
    if (items.length === 0 || offset >= (page.totalCount ?? offset)) return;
  }
}

export const searchActs = (client, params, options) => pagedItems(client, '/acts/search', params, options);
export const changedActs = (client, since, options) => pagedItems(client, '/changes/acts', { since }, options);
export const actDetails = (client, eli) => json(client, `${ELI_BASE}/acts/${eli}`);
export const actReferences = (client, eli) => json(client, `${ELI_BASE}/acts/${eli}/references`);
export const actPdfUrl = (eli) => `${ELI_BASE}/acts/${eli}/text.pdf`;

// Relevance policy for road freight: API title queries mapped to the DAJC taxonomy.
export const PL_QUERIES = Object.freeze([
  { q: 'ruchu drogowym', topics: ['hgv_traffic_rules', 'driving_bans', 'closures_restrictions', 'oversize_heavy_transport', 'permits_exceptions_escorts', 'weights_dimensions_axles'], areas: ['D.weekend_holiday_bans', 'B.mass_categories', 'D.urban_restrictions', 'C.special_use_permits'] },
  { q: 'transporcie drogowym', topics: ['cross_border_cabotage', 'roadside_checks_documents'], areas: ['A.operator_licensing', 'A.cabotage_market_access', 'E.checks_sanctions'] },
  { q: 'czasie pracy kierowców', topics: ['driving_rest_times', 'tachograph'], areas: ['A.driving_rest_times', 'A.tachographs', 'A.working_time'] },
  { q: 'delegowaniu kierowców', topics: ['cross_border_cabotage'], areas: ['A.posting_of_drivers'] },
  { q: 'towarów niebezpiecznych', topics: ['adr_dangerous_goods'], areas: ['E.adr', 'D.adr_restrictions'] },
  { q: 'drogach publicznych', topics: ['oversize_heavy_transport', 'permits_exceptions_escorts', 'closures_restrictions'], areas: ['C.special_use_permits', 'C.fees', 'C.route_conditions'] },
  { q: 'warunków technicznych pojazdów', topics: ['weights_dimensions_axles', 'roadside_checks_documents'], areas: ['B.weights', 'B.dimensions', 'B.axle_loads', 'B.roadworthiness'] },
  { q: 'kierujących pojazdami', topics: ['roadside_checks_documents'], areas: ['A.driving_licences', 'A.driver_qualification'] },
  { q: 'opłacie elektronicznej', topics: ['tolls_charges_environmental'], areas: ['E.tolls_charges'] },
  { q: 'Inspekcji Transportu Drogowego', topics: ['roadside_checks_documents'], areas: ['E.checks_sanctions'] },
]);
const AMENDING = /\bo zmianie\b|zmieniając|zmieniaj/i;
const BASE_TYPES = new Set(['Ustawa', 'Rozporządzenie']);

/**
 * Discovery: base acts in force whose title matches a query, with the latest
 * consolidated-text notice from the act's own references. Returns candidates; nothing is stored.
 */
export async function discoverPlCandidates(client, { queries = PL_QUERIES, perQueryMax = 200 } = {}) {
  const byEli = new Map();
  for (const query of queries) {
    for await (const a of searchActs(client, { title: query.q, inForce: '1' }, { maxItems: perQueryMax })) {
      if (!BASE_TYPES.has(a.type) || AMENDING.test(a.title) || !a.ELI) continue;
      const known = byEli.get(a.ELI);
      if (known) { known.topics = [...new Set([...known.topics, ...query.topics])]; known.areas = [...new Set([...known.areas, ...query.areas])]; continue; }
      byEli.set(a.ELI, { eli: a.ELI, title: a.title, type: a.type, displayAddress: a.displayAddress, status: a.status, textPDF: a.textPDF === true, topics: [...query.topics], areas: [...query.areas] });
    }
  }
  return [...byEli.values()];
}

/** The latest consolidated-text notice of a base act (references "Inf. o tekście jednolitym"), or null. */
export async function latestConsolidation(client, eli) {
  const refs = await actReferences(client, eli);
  const notices = (refs['Inf. o tekście jednolitym'] ?? []).map((r) => r.act).filter((a) => a?.ELI && a.textPDF !== false && a.status !== 'uchylony');
  notices.sort((a, b) => String(b.announcementDate).localeCompare(String(a.announcementDate)) || String(b.ELI).localeCompare(String(a.ELI)));
  return { notice: notices[0] ?? null, references: refs };
}

/** Manifest-shaped, validated entry for one candidate, or a reason it cannot be imported. */
export async function planPlEntry(client, candidate, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const details = await actDetails(client, candidate.eli);
  if (details.inForce !== 'IN_FORCE') return { skip: `inForce=${details.inForce}` };
  const { notice } = await latestConsolidation(client, candidate.eli);
  const source = notice ?? (details.textPDF ? { ELI: candidate.eli, title: details.title, displayAddress: details.displayAddress, announcementDate: details.announcementDate, own: true } : null);
  if (!source) return { skip: 'no official PDF text' };
  const effectiveFrom = (notice ? notice.announcementDate : null) ?? details.validFrom ?? details.entryIntoForce ?? details.promulgation ?? details.announcementDate ?? null;
  if (!effectiveFrom) return { skip: 'no effective or announcement date in the API metadata' };
  const evidence = `${ELI_BASE}/acts/${candidate.eli}`;
  return {
    entry: {
      sourceId: 'pl-sejm-eli', jurisdiction: 'PL', officialNumber: details.displayAddress, title: details.title,
      legalCategory: details.type === 'Ustawa' ? 'NATIONAL_ACT' : 'NATIONAL_REGULATION',
      issuingBody: [...(details.releasedBy ?? []), ...(details.authorizedBody ?? [])].join(', ') || 'Rzeczpospolita Polska',
      topics: candidate.topics, legalAreas: candidate.areas,
      version: {
        label: notice ? `${details.displayAddress}, tekst jednolity: ${notice.displayAddress} (obwieszczenie z ${notice.announcementDate})` : `${details.displayAddress} (tekst ogłoszony)`,
        language: 'pl', url: actPdfUrl(source.ELI), authenticity: 'OFFICIAL_PUBLICATION', issuedOn: details.announcementDate ?? null,
        effectiveFrom, effectiveTo: null, validity: 'IN_FORCE', validityCheckedOn: today, validityEvidenceUrl: evidence,
        notes: `Status ${details.status}; ELI ${candidate.eli}${notice ? `; consolidated text ${notice.ELI}` : ''}. Validity from the ELI API field inForce (act in force since ${details.validFrom ?? details.entryIntoForce ?? 'n/a'}); effective_from of a consolidation is the date of its notice. Checked ${today}; later amendments not yet in a consolidated text are listed in the act references.`,
      },
    },
    eli: candidate.eli, consolidatedEli: notice?.ELI ?? null,
  };
}
