// Publication-date evidence for monitored findings.
//
// Discovery date is not publication freshness (docs/DAJC_WEEKLY_INTELLIGENCE_SPEC.md
// §2): a page the crawler first sees this week can be months old. The Weekly
// therefore needs the date the official source itself published the item.
// This module extracts it deterministically, in order of reliability:
//
//   jsonld    schema.org "datePublished" on the page itself
//   meta      article:published_time, DC/dcterms dates, govuk:first-published-at, ...
//   feed      RSS/Atom item date (Atom <updated> is a modification date, so the
//             page's own first-publication metadata wins when present)
//   label     a labelled date in the page text ("Veröffentlicht am 19. August 2026")
//   time      the first <time datetime> inside <main>/<article>
//   leading   the first date at the very top of the extracted page text
//   url       a date embedded in the URL (".../ts_17.09.2026_...", "/2026/09/30/")
//
// A date in the future cannot be a publication date (it is an effective or
// event date) and is ignored. No evidence means no date - never "today".

const MONTHS = new Map(Object.entries({
  // English
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  // German
  januar: 1, janner: 1, februar: 2, feber: 2, marz: 3, mai: 5, juni: 6, juli: 7,
  oktober: 10, dezember: 12,
  // French
  janvier: 1, fevrier: 2, mars: 3, avril: 4, juin: 6, juillet: 7, aout: 8, septembre: 9,
  octobre: 10, novembre: 11, decembre: 12,
  // Italian
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8,
  settembre: 9, ottobre: 10, dicembre: 12,
  // Spanish / Portuguese
  enero: 1, febrero: 2, abril: 4, mayo: 5, junio: 6, julio: 7, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12,
  janeiro: 1, fevereiro: 2, marco: 3, maio: 5, junho: 6, julho: 7, setembro: 9, outubro: 10,
  novembro: 11, dezembro: 12,
  // Dutch
  januari: 1, februari: 2, maart: 3, mei: 5, augustus: 8,
  // Czech (nominative + genitive) / Slovak (genitive)
  leden: 1, ledna: 1, unor: 2, unora: 2, brezen: 3, brezna: 3, duben: 4, dubna: 4,
  kveten: 5, kvetna: 5, cerven: 6, cervna: 6, cervenec: 7, cervence: 7, srpen: 8, srpna: 8,
  zari: 9, rijen: 10, rijna: 10, prosinec: 12, prosince: 12,
  januara: 1, februara: 2, marca: 3, aprila: 4, maja: 5, juna: 6, jula: 7, augusta: 8,
  septembra: 9, oktobra: 10, novembra: 11, decembra: 12,
  // Polish (genitive)
  stycznia: 1, lutego: 2, kwietnia: 4, czerwca: 6, lipca: 7, sierpnia: 8, wrzesnia: 9,
  pazdziernika: 10, grudnia: 12,
  // listopad/listopada is November in Czech/Polish but October in Croatian;
  // resolved per country in monthNumber().
  listopad: 11, listopada: 11, listopadu: 11,
  // Croatian / Bosnian / Serbian / Montenegrin (Latin script)
  sijecnja: 1, veljace: 2, ozujka: 3, travnja: 4, svibnja: 5, lipnja: 6, srpnja: 7,
  kolovoza: 8, rujna: 9, studenoga: 11, studenog: 11, prosinca: 12,
  mart: 3, maj: 5, jun: 6, avgust: 8, septembar: 9, oktobar: 10, novembar: 11, decembar: 12,
  // Slovenian
  marec: 3, junij: 6, julij: 7, januarja: 1, februarja: 2, junija: 6, julija: 7, avgusta: 8,
  // Hungarian
  marcius: 3, aprilis: 4, majus: 5, junius: 6, julius: 7, augusztus: 8, szeptember: 9,
  // Romanian
  ianuarie: 1, februarie: 2, martie: 3, aprilie: 4, iunie: 6, iulie: 7, septembrie: 9,
  octombrie: 10, noiembrie: 11, decembrie: 12,
  // Lithuanian (genitive)
  sausio: 1, vasario: 2, kovo: 3, balandzio: 4, geguzes: 5, birzelio: 6, liepos: 7,
  rugpjucio: 8, rugsejo: 9, spalio: 10, lapkricio: 11, gruodzio: 12,
  // Estonian / Norwegian / Danish / Swedish
  jaanuar: 1, veebruar: 2, marts: 3, aprill: 4, juuni: 6, juuli: 7, oktoober: 10, detsember: 12,
  desember: 12, augusti: 8,
  // Finnish (partitive)
  tammikuuta: 1, helmikuuta: 2, maaliskuuta: 3, huhtikuuta: 4, toukokuuta: 5, kesakuuta: 6,
  heinakuuta: 7, elokuuta: 8, syyskuuta: 9, lokakuuta: 10, marraskuuta: 11, joulukuuta: 12,
}));

const CROATIAN_CONTEXT = /^(croatia|bosnia and herzegovina|hr|ba)$/i;

const MONTH_ALTERNATION = [...MONTHS.keys()].sort((a, b) => b.length - a.length).join('|');

// Text is folded to lower-case ASCII before matching (see foldText), so the
// month alternation above only needs unaccented forms.
const DATE_PATTERNS = [
  // 2026-10-01 (optionally followed by a time)
  { kind: 'iso', re: /\b(20\d{2})-(\d{2})-(\d{2})(?=$|[^\d])/g, parts: (m) => [m[1], m[2], m[3]] },
  // 01.10.2026 / 31. 08. 2026 / 17/09/2026 / 06/23/2026 (US order only when unambiguous)
  { kind: 'numeric', re: /\b(\d{1,2})\s?[./]\s?(\d{1,2})\s?[./]\s?(20\d{2})(?!\d)/g, parts: (m) => numericParts(m[1], m[2], m[3]) },
  // 19. August 2026 / 1er octobre 2026 / 17. syyskuuta 2026
  { kind: 'dmy', re: new RegExp(`\\b(\\d{1,2})(?:\\.|er|st|nd|rd|th)?\\s+(?:de\\s+)?(${MONTH_ALTERNATION})\\.?,?\\s+(?:de\\s+)?(20\\d{2})\\b`, 'g'), parts: (m, ctx) => [m[3], monthNumber(m[2], ctx), m[1]] },
  // October 1, 2026 / Sept. 30th 2026
  { kind: 'mdy', re: new RegExp(`\\b(${MONTH_ALTERNATION})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'g'), parts: (m, ctx) => [m[3], monthNumber(m[1], ctx), m[2]] },
  // 2026. oktober 1. (Hungarian) / 2026 m. rugsejo 17 d. (Lithuanian)
  { kind: 'ymd', re: new RegExp(`\\b(20\\d{2})\\.?\\s+(?:m\\.\\s+)?(${MONTH_ALTERNATION})\\.?\\s+(\\d{1,2})\\b`, 'g'), parts: (m, ctx) => [m[1], monthNumber(m[2], ctx), m[3]] },
];

function numericParts(a, b, year) {
  const first = Number(a);
  const second = Number(b);
  // European day.month.year by default; US month/day/year only when the
  // second number cannot be a month (e.g. 06/23/2026).
  if (second > 12 && first <= 12) return [year, first, second];
  return [year, second, first];
}

function monthNumber(name, { country } = {}) {
  const key = String(name || '').toLowerCase().replace(/\.$/, '');
  if (/^listopad/.test(key) && CROATIAN_CONTEXT.test(String(country || ''))) return 10;
  return MONTHS.get(key) ?? null;
}

export function foldText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[ßẞ]/g, 'ss')
    .toLowerCase();
}

function isoFromParts(year, month, day) {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/**
 * All calendar dates written in `text`, in reading order.
 * @returns {{ iso: string, index: number, kind: string }[]}
 */
export function findDates(text, ctx = {}) {
  const folded = foldText(text);
  const found = [];
  for (const { kind, re, parts } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(folded))) {
      const [y, mo, d] = parts(m, ctx);
      const iso = isoFromParts(y, mo, d);
      if (iso) found.push({ iso, index: m.index, length: m[0].length, kind });
    }
  }
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  // Drop matches nested inside an earlier, longer match.
  const result = [];
  let coveredTo = -1;
  for (const item of found) {
    if (item.index < coveredTo) continue;
    result.push({ iso: item.iso, index: item.index, kind: item.kind });
    coveredTo = item.index + item.length;
  }
  return result;
}

/** Normalises a feed/metadata timestamp ("2026-10-01T11:33:53+02:00", RFC 822, ...) to YYYY-MM-DD. */
export function toIsoDay(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const isoPrefix = raw.match(/^(20\d{2})[-/](\d{2})[-/](\d{2})/);
  if (isoPrefix) return isoFromParts(isoPrefix[1], isoPrefix[2], isoPrefix[3]);
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return findDates(raw)[0]?.iso ?? null;
}

const PUBLICATION_LABEL =
  /(?:ver[oö]ffentlicht(?:\s+am)?|publiziert(?:\s+am)?|erstellt\s+am|first\s+published|published(?:\s+on)?|date\s+published|publi[ée]e?\s+le|mis\s+en\s+ligne\s+le|pubblicato(?:\s+il)?|publicado(?:\s+(?:el|em))?|gepubliceerd(?:\s+op)?|objavljeno|objavljen|zve[rř]ejn[eě]no|datum\s+zve[rř]ejn[eě]n[ií]|uverejnen[eé]|zverejnen[eé]|opublikowano|data\s+publikacji|k[oö]zz[eé]t[eé]ve|megjelent|publicat(?:\s+la)?|paskelbta|public[eē]ts|avaldatud|publisert|publicerad|udgivet|julkaistu)\s*:?\s*/gi;

const META_DATE_KEYS = new Set([
  'article:published_time', 'og:published_time', 'datepublished', 'date', 'dc.date',
  'dc.date.issued', 'dcterms.date', 'dcterms.issued', 'dcterms.created', 'publish-date',
  'publish_date', 'publication_date', 'publication-date', 'pubdate', 'sailthru.date',
  'parsely-pub-date', 'govuk:first-published-at',
]);

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function mainScope(html) {
  for (const tag of ['main', 'article']) {
    const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (m) return m[1];
  }
  return '';
}

function acceptable(iso, now) {
  if (!iso) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  if (d < new Date('2000-01-01T00:00:00Z')) return false;
  // One day of tolerance for time-zone differences between source and runner.
  return d.getTime() <= now.getTime() + 24 * 60 * 60 * 1000;
}

function fromStructuredHtml(html, now) {
  if (!html) return null;
  for (const m of html.matchAll(/"datePublished"\s*:\s*"([^"]+)"/g)) {
    const iso = toIsoDay(m[1]);
    if (acceptable(iso, now)) return { date: iso, source: 'jsonld' };
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop') || '').toLowerCase();
    if (!META_DATE_KEYS.has(key)) continue;
    const iso = toIsoDay(attr(tag, 'content'));
    if (acceptable(iso, now)) return { date: iso, source: 'meta' };
  }
  return null;
}

function fromLabel(text, now, ctx) {
  PUBLICATION_LABEL.lastIndex = 0;
  let m;
  while ((m = PUBLICATION_LABEL.exec(text))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 48);
    const first = findDates(tail, ctx)[0];
    if (first && first.index <= 12 && acceptable(first.iso, now)) return { date: first.iso, source: 'label' };
  }
  return null;
}

function fromTimeTag(html, now) {
  const scope = mainScope(html || '');
  const m = scope.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i);
  const iso = m ? toIsoDay(m[1]) : null;
  return acceptable(iso, now) ? { date: iso, source: 'time' } : null;
}

const LEADING_TEXT_CHARS = 240;

function fromLeadingText(text, now, ctx) {
  const first = findDates(String(text || '').slice(0, LEADING_TEXT_CHARS), ctx)[0];
  return first && acceptable(first.iso, now) ? { date: first.iso, source: 'leading-text' } : null;
}

function fromUrl(url, now) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const patterns = [
    /(?:^|[^\d])(\d{2})\.(\d{2})\.(20\d{2})(?!\d)/, // ts_17.09.2026_...
    /\/(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/, // /2026/09/30/
    /(?:^|[^\d])(20\d{2})-(\d{2})-(\d{2})(?!\d)/, // /2026-09-30-...
  ];
  for (const re of patterns) {
    const m = pathname.match(re);
    if (!m) continue;
    const iso = re === patterns[0] ? isoFromParts(m[3], m[2], m[1]) : isoFromParts(m[1], m[2], m[3]);
    if (acceptable(iso, now)) return { date: iso, source: 'url' };
  }
  return null;
}

/**
 * Best publication-date evidence for one item.
 * @param {{ feedDate?: string|null, html?: string, text?: string, url?: string, country?: string, now?: Date }} input
 * @returns {{ date: string, source: string } | null}
 */
export function extractPublicationDate({ feedDate = null, html = '', text = '', url = '', country = '', now = new Date() } = {}) {
  const ctx = { country };
  const structured = fromStructuredHtml(html, now);
  if (structured) return structured;
  const feed = toIsoDay(feedDate);
  if (acceptable(feed, now)) return { date: feed, source: 'feed' };
  return (
    fromLabel(text, now, ctx) ||
    fromTimeTag(html, now) ||
    fromLeadingText(text, now, ctx) ||
    fromUrl(url, now)
  );
}
