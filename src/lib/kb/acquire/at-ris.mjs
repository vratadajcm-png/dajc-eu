// Austria: RIS OGD API v2.6 (data.bka.gv.at). The publisher's robots.txt
// disallows generic agents for the whole host (state 2026-11-09), so this client
// refuses to run (ROBOTS_DISALLOWED) unless the publisher has granted an access
// arrangement, whose reference is supplied via a GitHub Environment secret and
// recorded in the evidence. Limits: 0.5 requests/s, strictly serial.
// UNTESTED_LIVE: the query parameters follow the published OGD API v2.6 and have
// not been exercised against the service (robots.txt), so nothing here counts as
// a working Austrian connector until a live proof exists.

import { PoliteClient } from './polite-fetch.mjs';

export const RIS_BASE = 'https://data.bka.gv.at/ris/api/v2.6';
export const RIS_MIN_INTERVAL_MS = 2000;

export function risClient(env = process.env, options = {}) {
  const reference = env.DAJC_KB_AT_RIS_AUTHORIZATION_REF || null;
  return new PoliteClient({ minIntervalMs: RIS_MIN_INTERVAL_MS, authorization: reference ? { reference } : null, ...options });
}

export const risUrls = {
  /** Consolidated federal law (BrKons) on a given date, paged. */
  consolidated: ({ title, fassungVom, page = 1, perPage = 20 }) => `${RIS_BASE}/Bundesrecht?${new URLSearchParams({ Applikation: 'BrKons', Titel: title, ...(fassungVom ? { FassungVom: fassungVom } : {}), Seitennummer: String(page), DokumenteProSeite: perPage === 100 ? 'Hundred' : perPage === 50 ? 'Fifty' : perPage === 20 ? 'Twenty' : 'Ten' })}`,
  /** Change history of documents (Historyabfrage) in a date range. */
  history: ({ application = 'BrKons', from, to, page = 1 }) => `${RIS_BASE}/History?${new URLSearchParams({ Anwendung: application, AenderungenVon: from, AenderungenBis: to, Seitennummer: String(page), DokumenteProSeite: 'Hundred' })}`,
};

/** Documents changed in a period (catalogue-based discovery), or the refusal kind. */
export async function discoverAtChanges(client, { from, to }) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const res = await client.get(risUrls.history({ from, to, page }), { accept: 'application/json' });
    const json = JSON.parse(new TextDecoder().decode(res.bytes));
    const body = json?.OgdSearchResult?.OgdDocumentResults;
    const refs = [].concat(body?.OgdDocumentReference ?? []);
    out.push(...refs);
    const hits = Number(body?.Hits?.['#text'] ?? body?.Hits ?? 0);
    if (page * 100 >= hits) break;
  }
  return out;
}
