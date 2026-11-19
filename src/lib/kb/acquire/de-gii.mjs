// Gesetze im Internet (BMJ): catalogue gii-toc.xml, per-law xml.zip.
// The catalogue is the discovery source (it lists every federal law); a policy
// table decides which laws are relevant to road freight and how they map to the
// DAJC taxonomy. The original (xml.zip, a ZIP of the official XML) is archived.

import { inflateRawSync } from 'node:zlib';

export const GII_TOC_URL = 'https://www.gesetze-im-internet.de/gii-toc.xml';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return entities[e.toLowerCase()] ?? m;
});

export function parseGiiToc(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>\s*<title>([\s\S]*?)<\/title>\s*<link>([\s\S]*?)<\/link>\s*<\/item>/g)) {
    const link = decode(m[2]).trim().replace(/^http:/, 'https:');
    const slug = /gesetze-im-internet\.de\/([^/]+)\/xml\.zip$/.exec(link)?.[1];
    if (slug) out.push({ slug, title: decode(m[1]).trim(), url: link });
  }
  return out;
}

// Road-freight relevance policy: title pattern -> DAJC taxonomy.
export const DE_POLICY = Object.freeze([
  { re: /^Straßenverkehrs-Ordnung$/, topics: ['hgv_traffic_rules', 'driving_bans', 'closures_restrictions', 'oversize_heavy_transport', 'permits_exceptions_escorts', 'weights_dimensions_axles'], areas: ['D.weekend_holiday_bans', 'B.mass_categories', 'D.urban_restrictions'] },
  { re: /^Straßenverkehrsgesetz$/, topics: ['hgv_traffic_rules', 'roadside_checks_documents'], areas: ['E.checks_sanctions'] },
  { re: /^Straßenverkehrs-Zulassungs-Ordnung$/, topics: ['weights_dimensions_axles', 'oversize_heavy_transport', 'roadside_checks_documents'], areas: ['B.weights', 'B.dimensions', 'B.axle_loads', 'B.roadworthiness'] },
  { re: /^Güterkraftverkehrsgesetz$/, topics: ['cross_border_cabotage', 'roadside_checks_documents'], areas: ['A.operator_licensing', 'A.cabotage_market_access'] },
  { re: /Fahrpersonalgesetz$/, topics: ['driving_rest_times', 'tachograph'], areas: ['A.driving_rest_times', 'A.tachographs'] },
  { re: /^Fahrpersonalverordnung$/, topics: ['driving_rest_times', 'tachograph'], areas: ['A.driving_rest_times', 'A.tachographs', 'A.working_time'] },
  { re: /Gefahrgutbeförderungsgesetz$/, topics: ['adr_dangerous_goods'], areas: ['E.adr'] },
  { re: /^Gefahrgutverordnung Straße, Eisenbahn und Binnenschifffahrt$/, topics: ['adr_dangerous_goods'], areas: ['E.adr'] },
  { re: /^Verordnung über die Grundqualifikation und Weiterbildung der Fahrer/, topics: ['roadside_checks_documents'], areas: ['A.driver_qualification'] },
  { re: /^Fahrerlaubnis-Verordnung$/, topics: ['roadside_checks_documents'], areas: ['A.driving_licences'] },
  { re: /^Bundesfernstraßenmautgesetz$/, topics: ['tolls_charges_environmental'], areas: ['E.tolls_charges'] },
]);

/** Catalogue entries relevant to road freight, with the taxonomy they map to. */
export function selectDeLaws(toc) {
  return toc.flatMap((t) => {
    const p = DE_POLICY.find((x) => x.re.test(t.title));
    return p ? [{ ...t, topics: p.topics, areas: p.areas, legalCategory: /Verordnung|Ordnung/.test(t.title) ? 'NATIONAL_REGULATION' : 'NATIONAL_ACT' }] : [];
  });
}

/** Files of a ZIP (central directory; stored and deflated entries). */
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt ZIP directory');
    const method = dv.getUint16(p + 10, true); const csize = dv.getUint32(p + 20, true); const usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true); const el = dv.getUint16(p + 30, true); const cl = dv.getUint16(p + 32, true); const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(off + 26, true); const lel = dv.getUint16(off + 28, true);
    const raw = bytes.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    if (usize > 200 * 1024 * 1024) throw new Error('ZIP entry too large');
    files.push({ name, data: method === 0 ? raw : method === 8 ? new Uint8Array(inflateRawSync(raw, { maxOutputLength: 200 * 1024 * 1024 })) : (() => { throw new Error(`ZIP method ${method} unsupported`); })() });
    p += 46 + nl + el + cl;
  }
  return files;
}

const strip = (s) => decode(s.replace(/<(?:br|BR)\s*\/?>/g, '\n').replace(/<\/(?:P|DD|DT|LA|row|entry)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();

/** Gesetze-im-Internet XML -> metadata and notional pages (20 norms each) for the provision splitter. */
export function parseGiiXml(xml) {
  const norms = [...xml.matchAll(/<norm\b[^>]*>([\s\S]*?)<\/norm>/g)].map((m) => m[1]);
  if (norms.length === 0) throw new Error('no <norm> element: not a Gesetze-im-Internet document');
  const first = norms[0];
  const tag = (s, t) => { const m = new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`).exec(s); return m ? strip(m[1]) : null; };
  const meta = {
    abbreviation: tag(first, 'jurabk'), title: tag(first, 'langue') ?? tag(first, 'kurzue'), issuedOn: tag(first, 'ausfertigung-datum'),
    standComment: tag(first, 'standkommentar'), norms: norms.length,
  };
  const blocks = norms.map((n) => {
    const enbez = tag(n, 'enbez'); const titel = tag(n, 'titel');
    const body = tag(n, 'Content') ?? tag(n, 'text') ?? '';
    return [enbez ? `${enbez}${titel ? ` ${titel}` : ''}` : titel, body].filter(Boolean).join('\n');
  }).filter(Boolean);
  const pages = [];
  for (let i = 0; i < blocks.length; i += 20) pages.push({ pageNo: pages.length + 1, text: blocks.slice(i, i + 20).join('\n') });
  return { meta, pages };
}
