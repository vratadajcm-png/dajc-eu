const DAY_MS = 24 * 60 * 60 * 1000;

function parseIso(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function durationFromStructuredDates(candidate) {
  const start = parseIso(candidate.validFrom);
  const end = parseIso(candidate.validTo);
  if (!start || !end || end < start) return null;
  return (end - start) / DAY_MS;
}

function extractDatesFromText(text) {
  const dates = [];

  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) dates.push(d);
  }

  for (const m of text.matchAll(/\b(\d{1,2})[.\/]([01]?\d)[.\/](20\d{2})\b/g)) {
    const day = String(Number(m[1])).padStart(2, '0');
    const month = String(Number(m[2])).padStart(2, '0');
    const d = new Date(`${m[3]}-${month}-${day}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) dates.push(d);
  }

  return dates;
}

function explicitDurationDays(text) {
  const normalized = String(text || '').toLowerCase();

  const unitPatterns = [
    { re: /\b(\d+(?:[.,]\d+)?)\s*(?:day|days|jours?|tage?n?|giorni|d[ií]as?|zile|dana)\b/i, factor: 1 },
    { re: /\b(\d+(?:[.,]\d+)?)\s*(?:week|weeks|semaines?|wochen?|settimane?|semanas?|s[aă]pt[aă]m[aâ]ni|ned[eě]l[ei]|tjedana)\b/i, factor: 7 },
    { re: /\b(\d+(?:[.,]\d+)?)\s*(?:month|months|mois|monate?n?|mesi|meses|luni|m[eě]s[ií]c[eů]?|mjesec[ai]?)\b/i, factor: 30.4375 },
    { re: /\b(\d+(?:[.,]\d+)?)\s*(?:year|years|ans?|jahre?n?|anni|a[nñ]os|ani|rok[yů]?|godin[ae]?)\b/i, factor: 365.25 },
  ];

  for (const { re, factor } of unitPatterns) {
    const m = normalized.match(re);
    if (m) return Number(m[1].replace(',', '.')) * factor;
  }

  if (/several months|multiple months|plusieurs mois|mehrere monate|varios meses|alcuni mesi|několik měsíců|niekoľko mesiacov/i.test(normalized)) {
    return 60;
  }

  const dates = extractDatesFromText(normalized);
  if (dates.length >= 2) {
    const times = dates.map((d) => d.getTime()).sort((a, b) => a - b);
    return (times[times.length - 1] - times[0]) / DAY_MS;
  }

  return null;
}

// Roadworks notices name themselves in the title; matched on the folded
// (lower-case, accent-free) title only, so an incidental mention elsewhere
// does not turn a permit or toll item into "roadworks".
const ROADWORKS_TITLE =
  /roadworks|road works|resurfacing|maintenance works|construction works|lane closure|single[- ]lane|bauarbeiten|baustelle|fahrbahnsanierung|deckenerneuerung|sanierung|travaux|renouvellement de la couche|couche de roulement|lavori|manutenzione|obras|radovi|odrzavanj|prace na|opravy|oprava|rekonstrukc|remont|przebudow|felujit|lucrari/;

// Real dimension/weight/axle, permit or escort restrictions are judged on
// their operational impact, not by the closure-duration rule (spec §6).
const DIMENSION_OR_PERMIT_RESTRICTION = new RegExp([
  'weight (?:limit|restriction)', 'height (?:limit|restriction)', 'width (?:limit|restriction)', 'axle[- ]?load',
  'tonnage (?:limit|restriction)', 'gewichtsbeschrank', 'hohenbeschrank', 'breitenbeschrank', 'achslast',
  'durchfahrtshohe', 'lichte hohe', 'omezeni (?:hmotnosti|vysky|sirky|nosnosti)', 'nosnost',
  'ograniczenie (?:nacisku|tonazu|wysokosci|szerokosci)', 'sulykorlatoz', 'tengelyterhel',
  'limitation de (?:tonnage|poids|hauteur|largeur)', 'limite di (?:peso|massa|altezza|larghezza)',
  'limite de (?:peso|altura|anchura)', 'ogranicenje (?:nosivosti|osovinsk|visine|sirine)',
  '(?:closed|banned|prohibited|gesperrt|verboten|zakazan|uzavren|zamkniet|interdit|vietat|prohibid|zabranjen|tilos)\\s+(?:for|to|fur|pro|dla|pour|per|para|za)\\s+(?:all\\s+)?(?:vehicles|fahrzeuge|lorries|lkw|trucks|hgvs?|vozidla|pojazdy|vehicules|veicoli|vehiculos|vozila)\\s+(?:over|above|uber|nad|powyzej|de plus de|oltre|de mas de|preko|iznad)\\s*\\d',
  '(?:vehicles|fahrzeuge|lorries|lkw|trucks|hgvs?|vozidla|pojazdy|vehicules|veicoli|vehiculos|vozila)\\s+(?:over|above|uber|nad|powyzej|de plus de|oltre|de mas de|preko|iznad)\\s*\\d+(?:[.,]\\d+)?\\s?(?:t|tonnes?|tons?|tonnen)\\b[^.]{0,40}(?:closed|banned|prohibited|gesperrt|verboten|zakazan|uzavren|zamkniet|interdit|vietat|prohibid|zabranjen|tilos|nicht (?:befahrbar|passierbar))',
  'escort (?:requirement|rule|obligation)', 'begleitpflicht', '\\bbf[34]\\b', 'police escort', 'polizeibegleit',
  'bewilligungspflicht', 'genehmigungspflicht', 'permit (?:requirement|condition|procedure|regime)',
  'abnormal[- ]load (?:route|corridor)', 'exceptional[- ]transport (?:route|corridor)', 'ausnahmetransport(?:route|korridor|strecke)',
].join('|'));

function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ßẞ]/g, 'ss').toLowerCase();
}

/**
 * The closure rule (spec §6): a general road/motorway closure - and likewise
 * roadworks - is publishable only with a proven planned duration of MORE than
 * 30 days. Exactly 30, fewer, or unknown: excluded. A genuine
 * dimension/weight/axle, permit or escort restriction is exempt and judged on
 * its operational impact instead.
 */
export function checkLongRoadClosure(candidate, { minDaysExclusive = 30 } = {}) {
  const text = `${candidate?.title || ''} ${candidate?.summary || candidate?.whatChanged || ''} ${candidate?.impact || ''}`;
  const looksLikeClosure =
    candidate?.type === 'road_closure' ||
    /road closure|motorway closure|full closure|closed to traffic|vollsperrung|voll gesperrt|sperrung der (?:straße|strasse|autobahn|bundesstraße)|uzav[ií]rka|uz[aá]vierka|fermeture (?:totale|de la route|de l'autoroute)|chiusura (?:totale|stradale|autostradale)|cierre (?:total|de carretera|de autopista)|închidere (?:totală|drum|autostradă)/i.test(text);
  const looksLikeRoadworks = ROADWORKS_TITLE.test(fold(candidate?.title));
  if (!looksLikeClosure && !looksLikeRoadworks) return { ok: true };
  if (DIMENSION_OR_PERMIT_RESTRICTION.test(fold(text))) return { ok: true, exempt: 'dimension/weight/permit/escort restriction' };

  const kind = looksLikeClosure ? 'road closure' : 'roadworks';
  const structured = durationFromStructuredDates(candidate);
  const inferred = structured ?? explicitDurationDays(text);

  if (inferred == null) {
    return {
      ok: false,
      reason: `${kind} has no verifiable planned duration longer than ${minDaysExclusive} days`,
    };
  }

  if (inferred <= minDaysExclusive) {
    return {
      ok: false,
      reason: `${kind} is planned for only ${Math.round(inferred * 10) / 10} days; weekly policy requires more than ${minDaysExclusive} days`,
    };
  }

  return { ok: true, durationDays: inferred };
}
