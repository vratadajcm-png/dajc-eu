// Discovery of new or changed legal acts at the official publisher, per
// jurisdiction. Only jurisdictions with a working, robots.txt-compliant API are
// implemented; for all others the audit reports DISCOVERY_NOT_IMPLEMENTED -
// absence of a finding is never evidence that no law changed.

export const TRANSPORT_KEYWORDS = Object.freeze(['ruchu drogowym', 'transporcie drogowym', 'drogow', 'pojazd', 'kierowc', 'tachograf', 'przewóz', 'autostrad', 'ADR', 'niebezpiecznych']);

/** Polish Sejm ELI API: acts of a year that changed after `since` and match transport keywords. */
export async function discoverPl({ year, since, fetchImpl = globalThis.fetch, keywords = TRANSPORT_KEYWORDS, robots = null }) {
  const url = `https://api.sejm.gov.pl/eli/acts/DU/${year}`;
  if (robots) await robots.admit(url);
  const res = await fetchImpl(url, { headers: { 'user-agent': 'DAJC legal library importer (+https://www.dajc.eu)' }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const kw = keywords.map((k) => k.toLowerCase());
  return (data.items || [])
    .filter((a) => String(a.changeDate || '').slice(0, 10) >= since && kw.some((k) => String(a.title || '').toLowerCase().includes(k)))
    .map((a) => ({ jurisdiction: 'PL', eli: a.ELI, title: a.title, status: a.status, changeDate: a.changeDate, url: `https://api.sejm.gov.pl/eli/acts/${a.ELI}` }));
}

export const DISCOVERY = Object.freeze({ PL: discoverPl });
