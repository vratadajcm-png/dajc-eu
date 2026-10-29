import { coverageName, corridorOnlyJurisdictions, isTrackedJurisdiction } from '../../../../config/europe-coverage.mjs';
import { hostAllowed } from './safe-fetch.mjs';

/**
 * Where research looks for each tracked jurisdiction. Starting points are the
 * sources the registry already relies on (canonical.json), the PRIMARY entries of
 * the Source Registry (PR #81) and the official authority domains. Web search only
 * adds candidate URLs on those official hosts; anything else is discarded.
 */

const hostOf = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const stripFragment = url => { try { const u = new URL(url); u.hash = ''; return u.href; } catch { return url; } };

// Search terms in the official languages; an untranslated jurisdiction is searched in English only.
const LOCAL_TERMS = {
  AT: 'Lkw Fahrverbot', DE: 'Lkw Fahrverbot', CH: 'Lastwagen Fahrverbot Sonntagsfahrverbot', LI: 'Lastwagen Fahrverbot', LU: 'interdiction de circulation poids lourds',
  FR: 'interdiction de circulation poids lourds', BE: 'rijverbod vrachtwagens interdiction de circulation poids lourds', MC: 'interdiction de circulation poids lourds',
  IT: 'divieti di circolazione mezzi pesanti calendario', SM: 'divieti di circolazione mezzi pesanti', ES: 'restricciones a la circulación camiones', AD: 'restriccions circulació camions',
  PT: 'restrições à circulação veículos pesados', CZ: 'zákaz jízdy nákladních vozidel', SK: 'zákaz jazdy nákladných vozidiel', PL: 'zakaz ruchu pojazdów ciężarowych',
  HU: 'tehergépjármű forgalomkorlátozás hétvégi', SI: 'omejitev prometa tovornih vozil', HR: 'zabrana prometa teretnih vozila', RO: 'restricții de circulație camioane',
  BG: 'ограничение движение тежкотоварни', GR: 'απαγόρευση κυκλοφορίας φορτηγών', RS: 'zabrana saobraćaja teretnih vozila', ME: 'zabrana saobraćaja teretnih vozila',
  BA: 'zabrana saobraćaja teretnih vozila', MK: 'забрана сообраќај товарни возила', NL: 'rijverbod vrachtwagens', DK: 'kørselsforbud lastbiler', SE: 'trafikförbud tung lastbil',
  NO: 'kjøreforbud tunge kjøretøy', FI: 'raskaan liikenteen ajokielto', EE: 'raskeveokite liikluspiirang', LV: 'kravas transporta satiksmes ierobežojumi', LT: 'sunkiasvorių transporto priemonių eismo ribojimai',
  UA: 'обмеження руху вантажних автомобілів', TR: 'ağır vasıta trafik yasağı otoyol', RU: 'ограничение движения грузовых автомобилей трасса', KZ: 'ограничение движения грузового транспорта трасса',
};

/** Research target for one jurisdiction: known sources and the hosts research may fetch from. */
export function researchTarget(code, { rawCanonical, catalogEntries = [], authorityDomains = {} }) {
  if (!isTrackedJurisdiction(code)) throw new Error(`Untracked jurisdiction ${code}`);
  const sources = new Map(rawCanonical.sources.map(source => [source.source_id, source]));
  const used = new Set(rawCanonical.rules.filter(rule => rule.jurisdiction === code).flatMap(rule => [rule.source_id, ...(rule.evidence_ids || [])]));
  for (const id of rawCanonical.jurisdiction_reviews?.[code]?.source_ids || []) used.add(id);
  const known = [];
  for (const id of used) {
    const source = sources.get(id);
    if (source?.role === 'PRIMARY') known.push({ url: source.url, source_id: source.source_id, authority: source.authority, role: 'PRIMARY', origin: 'REGISTRY', content_sha256: source.content_sha256 ?? null });
  }
  for (const entry of catalogEntries) {
    if (entry.jurisdiction !== code || entry.role !== 'PRIMARY' || !entry.url || !['LEGAL_EVIDENCE', 'MACHINE_INTERFACE'].includes(entry.evidence_use)) continue;
    if (known.some(item => stripFragment(item.url) === stripFragment(entry.url))) continue;
    known.push({ url: entry.url, source_id: entry.source_id, authority: entry.authority, role: 'PRIMARY', origin: 'SOURCE_REGISTRY', content_sha256: entry.content_sha256 ?? null, licence: entry.licence, rights: entry.rights });
  }
  const allowedHosts = [...new Set([...(authorityDomains[code] || []), ...known.map(item => hostOf(item.url)).filter(Boolean)])];
  return { jurisdiction: code, name: coverageName(code), corridor_only: corridorOnlyJurisdictions.includes(code), known, allowedHosts, searchDomains: allowedHosts.slice(0, 20) };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Short keyword queries; the search engine never receives customer data. */
export function searchQueries(target, window) {
  const months = [...new Set([window.from, window.to].map(date => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`))].join(' ');
  const scope = target.corridor_only ? ' motorway main road corridor' : '';
  const english = `${target.name} HGV truck driving ban${scope} ${months} official`;
  const local = LOCAL_TERMS[target.jurisdiction];
  return [english, ...(local ? [`${local} ${window.from.slice(0, 4)}${scope}`] : []), `${target.name} public holidays ${window.from.slice(0, 4)} truck restrictions`];
}

/**
 * Candidate documents for one jurisdiction. Registry sources are always re-checked
 * (their availability matters even when no search provider is configured).
 */
export async function discoverDocuments(target, { orchestrator = null, window, maxDocuments = 6, leadUrls = [], useSearch = true }) {
  const items = [], discarded = [], seen = new Set(), errors = [];
  const add = item => {
    const url = stripFragment(item.url);
    if (seen.has(url)) return;
    seen.add(url);
    if (!hostAllowed(hostOf(url) ?? '', target.allowedHosts)) { discarded.push({ url, reason: 'NOT_AN_ALLOWED_OFFICIAL_HOST' }); return; }
    if (items.length < maxDocuments) items.push({ ...item, url, state: 'DISCOVERED' });
  };
  for (const url of leadUrls) add({ url, origin: 'LEAD', role: 'PRIMARY', source_id: null, authority: null });
  for (const item of target.known) add(item);
  if (useSearch && orchestrator && items.length < maxDocuments) {
    try {
      const result = await orchestrator.run('discover', { queries: searchQueries(target, window), domains: target.searchDomains, maxResults: 10 }, { purpose: 'official source discovery', subject: target.jurisdiction, dataClass: 'public-legal' });
      for (const hit of result.results) add({ url: hit.url, title: hit.title, origin: 'SEARCH', role: 'PRIMARY', source_id: null, authority: hostOf(hit.url), search_provider: result.provider });
    } catch (error) {
      errors.push({ stage: 'discover', error: error.name, message: error.message });
      if (error.name === 'BudgetExceededError') throw error;
    }
  }
  return { items, discarded, errors };
}
