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

export function checkLongRoadClosure(candidate, { minDaysExclusive = 30 } = {}) {
  if (candidate?.type !== 'road_closure') return { ok: true };

  const structured = durationFromStructuredDates(candidate);
  const text = `${candidate.title || ''} ${candidate.summary || ''}`;
  const inferred = structured ?? explicitDurationDays(text);

  if (inferred == null) {
    return {
      ok: false,
      reason: `road closure has no verifiable planned duration longer than ${minDaysExclusive} days`,
    };
  }

  if (inferred <= minDaysExclusive) {
    return {
      ok: false,
      reason: `road closure is planned for only ${Math.round(inferred * 10) / 10} days; weekly policy requires more than ${minDaysExclusive} days`,
    };
  }

  return { ok: true, durationDays: inferred };
}
