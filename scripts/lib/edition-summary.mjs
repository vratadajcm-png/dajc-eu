// Keeps the edition-level copy (title, description, intro, operator checklist)
// consistent with the reports that are actually published.
//
// The model writes that copy for every candidate it saw, before cross-
// validation, filters and its own selection. W43 shipped a tachograph
// checklist line and W44's description promised "policy discussions in
// Hungary" for reports that were never in the edition. The checklist is
// therefore always rebuilt from the published reports, and any summary text
// naming a country without a published report is replaced deterministically.

import { dajcEuropeCoverage } from '../../config/europe-coverage.mjs';

const COUNTRY_NAMES = [...new Set(dajcEuropeCoverage.map(([, name]) => name.replace(/\s*\([^)]*\)/g, '')))];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COUNTRY_PATTERNS = COUNTRY_NAMES.map((name) => [name, new RegExp(`(?<![\\p{L}])${escapeRegExp(name)}(?![\\p{L}])`, 'iu')]);

/** Tracked country names mentioned in a text. Pure - exported for tests. */
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
 * Rebuilds the checklist and replaces title/description/intro text that names
 * a country without a published report. Mutates and returns `article`;
 * `fixed` lists the replaced fields.
 */
export function alignEditionSummary(article, { weekRangeLabel }) {
  const items = [...(article.developments || []), ...(article.europeRoundup || [])];
  const covered = new Set(items.flatMap((item) => mentionedCountries(`${item.country} ${item.where || ''} ${item.title || ''}`)));
  const countries = [...new Set(items.map((item) => item.country).filter(Boolean))];
  const strays = (text) => mentionedCountries(text).filter((name) => !covered.has(name));
  const fixed = [];

  if (strays(article.seoTitle).length > 0) {
    article.seoTitle = `EU Oversize Weekly: ${items[0]?.title || listCountries(countries)} | ${weekRangeLabel}`;
    fixed.push('seoTitle');
  }
  if (strays(article.metaDescription).length > 0) {
    const titles = items.slice(0, 3).map((item) => item.title).join('; ');
    article.metaDescription = `Verified changes for heavy and oversize road transport in Europe for ${weekRangeLabel}: ${titles}.`;
    fixed.push('metaDescription');
  }
  if (strays(article.intro).length > 0) {
    article.intro = `This edition covers the week of ${weekRangeLabel} and reports verified developments for heavy and oversize road transport in ${listCountries(countries)}.`;
    fixed.push('intro');
  }
  article.operatorChecklist = operatorChecklistFromReports(items);
  return { article, fixed };
}
