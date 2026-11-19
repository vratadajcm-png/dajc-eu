// Keeps the edition-level copy (title, description, intro, operator checklist)
// consistent with the reports that are actually published.
//
// The model writes that copy for every candidate it saw, before cross-
// validation, filters and its own selection. W43 shipped a tachograph
// checklist line and W44's description promised "policy discussions in
// Hungary" for reports that were never in the edition. The checklist is
// therefore always rebuilt from the retained reports. Country matching alone
// cannot detect an unsupported second story from a country still represented
// in the edition (W47: Italian draft legislation vs. retained enforcement news).
// No model-written edition summary survives selection or filtering.

import { dajcEuropeCoverage } from '../../config/europe-coverage.mjs';

const COUNTRY_NAMES = [...new Set(dajcEuropeCoverage.map(([, name]) => name.replace(/\s*\([^)]*\)/g, '')))];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Adjectives and other names that also point at a country. The W44
// correction run of 24 October promised "a Czech draft toll increase" in an
// intro whose Czech report the model had dropped.
const COUNTRY_ALIASES = {
  Albania: ['Albanian'], Andorra: ['Andorran'], Armenia: ['Armenian'], Austria: ['Austrian'],
  Azerbaijan: ['Azerbaijani'], 'Bosnia and Herzegovina': ['Bosnian', 'Bosnia'], Belgium: ['Belgian'],
  Bulgaria: ['Bulgarian'], Belarus: ['Belarusian'], Switzerland: ['Swiss'], Cyprus: ['Cypriot'],
  Czechia: ['Czech', 'Czech Republic'], Germany: ['German'], Denmark: ['Danish'], Estonia: ['Estonian'],
  Spain: ['Spanish'], Finland: ['Finnish'], France: ['French'], Greece: ['Greek'], Croatia: ['Croatian'],
  Hungary: ['Hungarian'], Ireland: ['Irish'], Iceland: ['Icelandic'], Italy: ['Italian'],
  Kazakhstan: ['Kazakh'], Lithuania: ['Lithuanian'], Luxembourg: ['Luxembourgish'], Latvia: ['Latvian'],
  Moldova: ['Moldovan'], Montenegro: ['Montenegrin'], 'North Macedonia': ['Macedonian'], Malta: ['Maltese'],
  Netherlands: ['Dutch', 'Holland'], Norway: ['Norwegian'], Poland: ['Polish'], Portugal: ['Portuguese'],
  Romania: ['Romanian'], Serbia: ['Serbian'], Russia: ['Russian'], Sweden: ['Swedish'], Slovenia: ['Slovenian'],
  Slovakia: ['Slovak'], Türkiye: ['Turkey', 'Turkish'], Ukraine: ['Ukrainian'],
  'United Kingdom': ['UK', 'British', 'Britain', 'England', 'Scotland', 'Wales'], Kosovo: ['Kosovar'],
};

const COUNTRY_PATTERNS = COUNTRY_NAMES.map((name) => {
  const names = [name, ...(COUNTRY_ALIASES[name] || [])].map(escapeRegExp).join('|');
  return [name, new RegExp(`(?<![\\p{L}])(?:${names})(?![\\p{L}])`, 'iu')];
});

/** Tracked countries named in a text, by name or adjective. Pure - exported for tests. */
export function mentionedCountries(text) {
  const value = String(text || '');
  return COUNTRY_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

/** One checklist line per published report that carries an operator action. */
export function operatorChecklistFromReports(items = []) {
  return items
    .filter((item) => String(item.recommendedAction || '').trim())
    .map((item) => `${item.country}: ${String(item.recommendedAction).trim()}`);
}

function listCountries(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Rebuilds ALL edition-level copy from the reports that survived every filter.
 * Retained report titles are copied without paraphrasing or truncating legal
 * qualifications. Their source claims still require the final independent
 * review. Mutates and returns `article`; `fixed` lists changed summary fields.
 */
export function alignEditionSummary(article, { weekRangeLabel }) {
  const items = [...(article.developments || []), ...(article.europeRoundup || [])];
  const countries = [...new Set(items.map((item) => String(item.country || '').trim()).filter(Boolean))];
  const titles = items.slice(0, 3).map((item) => String(item.title || '').trim()).filter(Boolean);
  const headline = titles[0] || listCountries(countries);
  const reports = titles.length ? ` Reports: ${titles.join('; ')}.` : '';
  const geography = countries.length ? ` in ${listCountries(countries)}` : '';
  const summary = {
    seoTitle: `EU Oversize Weekly${headline ? `: ${headline}` : ''} | ${weekRangeLabel}`,
    metaDescription: `European road freight briefing for ${weekRangeLabel}${geography}.${reports}`,
    intro: `This edition covers the week of ${weekRangeLabel} and reports developments for commercial road freight${geography}, with priority for heavy, oversize and special transport.${reports}`,
  };
  const fixed = [];
  for (const [field, value] of Object.entries(summary)) {
    if (article[field] !== value) fixed.push(field);
    article[field] = value;
  }
  article.operatorChecklist = operatorChecklistFromReports(items);
  return { article, fixed };
}
