// Pre-publish quality gate for a generated EU Oversize Weekly article.
// Every check here is a hard blocker - if any fails, generate-weekly-article.mjs
// must not write the article file, and must exit non-zero so the run shows
// up as a clearly failed GitHub Actions run (see docs/NEWS_AUTOMATION.md
// "Quality gate" and "Hard-failure conditions").

import { articleFrontmatterSchema } from './article-schema.mjs';
import { validateDevelopmentDateRange } from './date-validation.mjs';

const MIN_BODY_LENGTH = 400;
const MIN_REPORTS = 10;
const MIN_REPORTS_POST_SUMMER = 4;
const POST_SUMMER_POLICY_DATE = new Date('2026-09-01T00:00:00Z');
const MAX_REPORTS = 12;
const MIN_ROUNDUP_REPORTS = 10;
const MIN_ROUNDUP_COUNTRIES = 6;
const MIN_RECOMMENDED_ACTION_LENGTH = 10;

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ frontmatter: object, body: string, developments: object[],
 *   weekStart?: Date, weekEnd?: Date }} args
 */
export function runQualityGate({ frontmatter, body, developments, europeRoundup, weekStart, weekEnd }) {
  const errors = [];
  const roundupItems = Array.isArray(europeRoundup) ? europeRoundup : [];

  const parsed = articleFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`frontmatter.${issue.path.join('.')}: ${issue.message}`);
    }
  }

  if (!body || body.trim().length === 0) {
    errors.push('article body is empty');
  } else if (body.trim().length < MIN_BODY_LENGTH) {
    errors.push(`article body is suspiciously short (${body.trim().length} chars, minimum ${MIN_BODY_LENGTH})`);
  }

  const items = developments || [];
  const minReports =
    weekEnd && weekEnd >= POST_SUMMER_POLICY_DATE ? MIN_REPORTS_POST_SUMMER : MIN_REPORTS;

  if (europeRoundup !== undefined && roundupItems.length < MIN_ROUNDUP_REPORTS) {
    errors.push(
      `Rest-of-Europe roundup has only ${roundupItems.length} report(s) - at least ${MIN_ROUNDUP_REPORTS} verified additional developments are required`
    );
  }
  if (europeRoundup !== undefined) {
    const roundupCountries = new Set(
      roundupItems.map((item) => String(item.country || '').trim()).filter(Boolean)
    );
    if (roundupCountries.size < MIN_ROUNDUP_COUNTRIES) {
      errors.push(
        `Rest-of-Europe roundup covers only ${roundupCountries.size} countr${roundupCountries.size === 1 ? 'y' : 'ies'} - at least ${MIN_ROUNDUP_COUNTRIES} distinct countries are required`
      );
    }
  }

  if (items.length === 0) {
    errors.push('article has zero developments - nothing significant to report');
  } else {
    if (items.length < minReports) {
      errors.push(
        `article has only ${items.length} lead report(s) - this edition requires at least ${minReports} distinct, verified, genuinely useful lead reports. Never pad with evergreen Sunday bans or filler.`
      );
    }
    if (items.length > MAX_REPORTS) {
      errors.push(
        `article has ${items.length} reports - a live weekly publication allows at most ${MAX_REPORTS}. Trim to the most operationally significant reports rather than padding or splitting.`
      );
    }

    const seenSourceUrls = new Map();
    const seenTitles = new Map();
    let hasDrivingBan = false;

    const allItems = [
      ...items.map((item, i) => ({ item, label: `developments[${i}]` })),
      ...roundupItems.map((item, i) => ({ item, label: `europeRoundup[${i}]` })),
    ];

    allItems.forEach(({ item, label: baseLabel }, i) => {
      const label = `${baseLabel} ("${item.title || 'untitled'}")`;

      if (!item.title) errors.push(`${label.replace(/ \(".*"\)/, '')} is missing a title`);
      if (!item.sourceUrl) errors.push(`${label} has no sourceUrl`);
      else if (!isValidUrl(item.sourceUrl)) errors.push(`${label} has an invalid sourceUrl: "${item.sourceUrl}"`);
      if (!item.sourceName) errors.push(`${label} has no sourceName`);

      if (!item.recommendedAction || item.recommendedAction.trim().length < MIN_RECOMMENDED_ACTION_LENGTH) {
        errors.push(`${label} has no meaningful recommendedAction for an operator/dispatcher`);
      }

      if (weekStart && weekEnd) {
        const dateCheck = validateDevelopmentDateRange(
          { validFrom: item.validFrom, validTo: item.validTo },
          { weekStart, weekEnd }
        );
        if (!dateCheck.ok) errors.push(`${label}: ${dateCheck.reason}`);
      }

      if (item.sourceUrl) {
        if (seenSourceUrls.has(item.sourceUrl)) {
          errors.push(`${label} duplicates a sourceUrl already used by report ${seenSourceUrls.get(item.sourceUrl)} - lead reports and the Europe roundup must be disjoint`);
        } else {
          seenSourceUrls.set(item.sourceUrl, i);
        }
      }

      // Two genuinely distinct restrictions (e.g. Austria's general
      // nationwide weekend ban and its additional summer corridor
      // restrictions) are allowed to share a country and weekend - only an
      // exact (normalized) title repeat is treated as a duplicate report.
      const normalized = normalizeTitle(item.title);
      if (normalized) {
        if (seenTitles.has(normalized)) {
          errors.push(`${label} duplicates a title already used by report ${seenTitles.get(normalized)} - lead reports and the Europe roundup must be disjoint`);
        } else {
          seenTitles.set(normalized, i);
        }
      }

      if (item.isDrivingBan) hasDrivingBan = true;
    });

    if (!hasDrivingBan) {
      errors.push('article contains no driving-ban / exceptional-transport-restriction report - at least one is required every week');
    }

    const usedSourceUrls = new Set();
    for (const item of [...items, ...roundupItems]) {
      if (item.sourceUrl) usedSourceUrls.add(item.sourceUrl);
      for (const extra of item.additionalSources || []) {
        if (extra.url) usedSourceUrls.add(extra.url);
      }
    }
    for (const source of frontmatter?.sources || []) {
      if (!usedSourceUrls.has(source.url)) {
        errors.push(`frontmatter lists source "${source.url}" which is not cited by any report in the article body`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
