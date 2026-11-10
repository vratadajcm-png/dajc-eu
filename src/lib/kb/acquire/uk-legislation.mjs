// United Kingdom: Legislation API of legislation.gov.uk (The National Archives).
// Documentation read 2026-11-09: https://www.legislation.gov.uk/developer ,
// /developer/uris (identifier, document and representation URIs), /developer/formats
// (data.xml, data.feed Atom, data.rdf), /developer/searching (title/type/year listings).
// Verified live on the same day:
//   /{type}/data.feed?title=...&page=N   Atom listing, <leg:page>/<leg:morePages>, entries carry
//                                        ukm:DocumentMainType, ukm:Year, ukm:Number
//   /new/data.feed                       newly published legislation (change discovery)
//   /{type}/{year}/{number}/data.xml     Legislation XML: root RestrictStartDate (version valid from),
//                                        dc:title, dc:modified, ukm:DocumentStatus, P1group/P1 provisions
// Licence: Open Government Licence v3.0. robots.txt: Crawl-delay 5 s (the client paces at 5 s, serially).

import { PoliteClient } from './polite-fetch.mjs';

export const UK_BASE = 'https://www.legislation.gov.uk';
export const UK_MIN_INTERVAL_MS = 5000;
export const ukClient = (options = {}) => new PoliteClient({ minIntervalMs: UK_MIN_INTERVAL_MS, ...options });
const text = async (client, url, accept) => new TextDecoder().decode((await client.get(url, { accept })).bytes);

const decodeEntities = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e.toLowerCase()] ?? m;
});
const plain = (xml) => decodeEntities(xml.replace(/<CommentaryRef[^>]*\/>/g, '').replace(/<\/(?:Text|Para|P\d?para|Title|Number|Pnumber|P\d|tr|entry)>/g, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();

/** One Atom page of a listing: entries and the paging state. */
export function parseFeed(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]).map((e) => {
    const v = (tag) => new RegExp(`<ukm:${tag}[^>]*Value="([^"]*)"`).exec(e)?.[1] ?? null;
    return { id: /<id>([^<]+)<\/id>/.exec(e)?.[1] ?? null, title: decodeEntities(/<title>([^<]*)<\/title>/.exec(e)?.[1] ?? ''), type: v('DocumentMainType'), year: v('Year'), number: v('Number') };
  }).filter((e) => e.id);
  return { entries, page: Number(/<leg:page>(\d+)/.exec(xml)?.[1] ?? 1), morePages: Number(/<leg:morePages>(\d+)/.exec(xml)?.[1] ?? 0) };
}

export const TYPE_PATH = { UnitedKingdomPublicGeneralAct: 'ukpga', UnitedKingdomStatutoryInstrument: 'uksi', WelshStatutoryInstrument: 'wsi', ScottishStatutoryInstrument: 'ssi', NorthernIrelandStatutoryRule: 'nisr' };

export async function* listFeed(client, path, params, { maxPages = 20 } = {}) {
  for (let page = 1; page <= maxPages; page++) {
    const feed = parseFeed(await text(client, `${UK_BASE}/${path}/data.feed?${new URLSearchParams({ ...params, page: String(page) })}`, 'application/atom+xml'));
    for (const e of feed.entries) yield e;
    if (feed.morePages <= 0) return;
  }
}

/** Title queries for road freight (Legislation API title operators), mapped to the DAJC taxonomy. */
export const UK_QUERIES = Object.freeze([
  { path: 'ukpga', title: '"road traffic"', topics: ['hgv_traffic_rules', 'roadside_checks_documents'], areas: ['E.checks_sanctions', 'D.exemptions_sanctions'] },
  { path: 'uksi', title: '"construction and use"', topics: ['weights_dimensions_axles', 'oversize_heavy_transport'], areas: ['B.weights', 'B.dimensions', 'B.axle_loads'] },
  { path: 'uksi', title: '"special types"', topics: ['oversize_heavy_transport', 'permits_exceptions_escorts'], areas: ['C.oversize_limits', 'C.special_use_permits', 'C.escorts'] },
  { path: 'uksi', title: '"goods vehicles"', topics: ['weights_dimensions_axles', 'roadside_checks_documents'], areas: ['A.operator_licensing', 'B.weights'] },
  { path: 'ukpga', title: '"goods vehicles"', topics: ['cross_border_cabotage'], areas: ['A.operator_licensing'] },
  { path: 'uksi', title: '"drivers hours"', topics: ['driving_rest_times', 'tachograph'], areas: ['A.driving_rest_times', 'A.tachographs'] },
  { path: 'uksi', title: '"carriage of dangerous goods"', topics: ['adr_dangerous_goods'], areas: ['E.adr'] },
  { path: 'uksi', title: '"road transport" + operator', topics: ['cross_border_cabotage'], areas: ['A.operator_licensing', 'A.international_transport'] },
  { path: 'uksi', title: '"road user charging" + goods', topics: ['tolls_charges_environmental'], areas: ['E.tolls_charges'] },
  { path: 'uksi', title: '"driver certificate of professional competence"', topics: ['roadside_checks_documents'], areas: ['A.driver_qualification'] },
]);
const NOT_BASE = /\(amendment\)|\bamendment\b|\(repealed|\brepealed\b|\brevoked\b|\(revoked|\bcommencement\b|\btransitional\b/i;

/** Discovery of base acts/instruments (not amendments, not repealed) matching the queries. */
export async function discoverUkCandidates(client, { queries = UK_QUERIES, maxPages = 5 } = {}) {
  const byId = new Map();
  for (const q of queries) {
    for await (const e of listFeed(client, q.path, { title: q.title }, { maxPages })) {
      const path = TYPE_PATH[e.type];
      if (!path || path !== q.path || NOT_BASE.test(e.title) || !/^[0-9]{4}$/.test(e.year ?? '') || !/^[1-9][0-9]*$/.test(e.number ?? '')) continue;
      const id = `${path}/${e.year}/${e.number}`;
      const known = byId.get(id);
      if (known) { known.topics = [...new Set([...known.topics, ...q.topics])]; known.areas = [...new Set([...known.areas, ...q.areas])]; continue; }
      byId.set(id, { id, title: e.title, path, year: e.year, number: e.number, topics: [...q.topics], areas: [...q.areas] });
    }
  }
  return [...byId.values()];
}

/** Newly published legislation (change discovery for the monthly audit). */
export async function discoverUkNew(client, { maxPages = 3 } = {}) {
  const out = [];
  for await (const e of listFeed(client, 'new', {}, { maxPages })) out.push(e);
  return out;
}

export const ukDataUrl = (id) => {
  if (typeof id !== 'string' || !/^(?:ukpga|uksi|wsi|ssi|nisr)\/[0-9]{4}\/[1-9][0-9]*$/.test(id)) {
    throw new Error('invalid UK legislation identifier');
  }
  return `${UK_BASE}/${id}/data.xml`;
};

/** Legislation XML -> metadata and citable provisions (sections/regulations and schedules). */
export function parseLegislationXml(xml) {
  const root = /<Legislation\b[^>]*>/.exec(xml)?.[0];
  if (!root) throw new Error('not a legislation.gov.uk Legislation XML document');
  const attr = (a) => new RegExp(`${a}="([^"]*)"`).exec(root)?.[1] ?? null;
  const meta = {
    title: decodeEntities(/<dc:title>([^<]*)<\/dc:title>/.exec(xml)?.[1] ?? ''), modified: /<dc:modified>([^<]*)</.exec(xml)?.[1] ?? null, enacted: /<dc:date>([^<]*)</.exec(xml)?.[1] ?? null,
    validFrom: attr('RestrictStartDate'), validTo: attr('RestrictEndDate'), extent: attr('RestrictExtent'), status: /<ukm:DocumentStatus Value="([^"]*)"/.exec(xml)?.[1] ?? null,
    documentUri: attr('DocumentURI'), unappliedEffects: (xml.match(/<ukm:UnappliedEffect\b/g) ?? []).length,
  };
  const body = xml.slice(xml.indexOf('<Body'));
  const provisions = [];
  const push = (anchorType, label, number, heading, raw) => {
    const t = plain(raw);
    if (!t) return;
    for (let i = 0; i < t.length; i += 3500) provisions.push({ ordinal: provisions.length + 1, anchorType, anchorLabel: label, anchorNumber: number, heading, pageFrom: 1, pageTo: 1, text: t.slice(i, i + 3500), massMentions: [] });
  };
  for (const m of body.matchAll(/<P1group\b[^>]*>([\s\S]*?)<\/P1group>/g)) {
    const title = plain(/<Title>([\s\S]*?)<\/Title>/.exec(m[1])?.[1] ?? '');
    const number = plain(/<Pnumber>([\s\S]*?)<\/Pnumber>/.exec(m[1])?.[1] ?? '') || null;
    if (number) push('SECTION', `${/\/uksi\/|\/ssi\/|\/wsi\/|\/nisr\//.test(meta.documentUri ?? '') ? 'regulation' : 'section'} ${number}`, number, title || null, m[1].replace(/<Title>[\s\S]*?<\/Title>/, ''));
  }
  for (const m of xml.matchAll(/<Schedule\b[^>]*>([\s\S]*?)<\/Schedule>/g)) {
    const n = plain(/<Number>([\s\S]*?)<\/Number>/.exec(m[1])?.[1] ?? '');
    push('ANNEX', n || 'Schedule', n.replace(/\D+/g, '') || null, plain(/<TitleBlock>[\s\S]*?<Title>([\s\S]*?)<\/Title>/.exec(m[1])?.[1] ?? '') || null, m[1]);
  }
  return { meta, provisions };
}

/** Downloads data.xml of a candidate and builds the validated entry plus the structured download. */
export async function acquireUkDocument(client, candidate, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const url = ukDataUrl(candidate.id);
  const got = await client.get(url, { accept: 'application/xml', maxBytes: 60 * 1024 * 1024 });
  const { meta, provisions } = parseLegislationXml(new TextDecoder().decode(got.bytes));
  if (/repealed|revoked/i.test(meta.title) || meta.validTo) return { skip: `not in force (${meta.validTo ? `valid to ${meta.validTo}` : 'title says repealed/revoked'})` };
  if (!meta.validFrom) return { skip: 'no RestrictStartDate in the XML' };
  const primary = candidate.path === 'ukpga';
  return {
    entry: {
      sourceId: 'uk-legislation', jurisdiction: 'UK', officialNumber: candidate.id, title: meta.title || candidate.title, legalCategory: primary ? 'NATIONAL_ACT' : 'NATIONAL_REGULATION',
      issuingBody: 'United Kingdom (published by The National Archives)', topics: candidate.topics, legalAreas: candidate.areas,
      version: {
        label: `${meta.title} (revised version valid from ${meta.validFrom}; XML modified ${meta.modified ?? 'n/a'})`, language: 'en', url, authenticity: 'CONSOLIDATED_DOCUMENTATION',
        issuedOn: meta.enacted && /^\d{4}-\d{2}-\d{2}$/.test(meta.enacted) ? meta.enacted : null, effectiveFrom: meta.validFrom, effectiveTo: null, validity: 'IN_FORCE', validityCheckedOn: today, validityEvidenceUrl: meta.documentUri?.replace(/^http:/, 'https:') ?? url,
        notes: `Extent ${meta.extent ?? 'n/a'}; document status ${meta.status ?? 'n/a'}; ${meta.unappliedEffects} unapplied effects (amendments not yet in the text). Revised versions are not the authoritative text. Contains public sector information licensed under the Open Government Licence v3.0.`,
      },
    },
    download: { bytes: got.bytes, finalUrl: got.finalUrl, mediaType: 'application/xml', extension: 'xml', pages: [{ pageNo: 1, text: provisions.map((p) => `${p.anchorLabel}${p.heading ? ` ${p.heading}` : ''}\n${p.text}`).join('\n') }], provisions, extractionNote: `Text extracted from Legislation XML (${provisions.length} provisions).` },
  };
}
