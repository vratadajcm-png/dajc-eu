// Pre-publish quality gate for a generated EU Oversize Weekly article.
// Every check here is a hard blocker - if any fails, generate-weekly-article.mjs
// must not write the article file, and must exit non-zero so the run shows
// up as a clearly failed GitHub Actions run (see docs/NEWS_AUTOMATION.md
// "Quality gate" and "Hard-failure conditions").

import { articleFrontmatterSchema } from './article-schema.mjs';
import { validateDevelopmentDateRange } from './date-validation.mjs';

const MIN_BODY_LENGTH = 400;
const MIN_REPORTS = 8;
const MAX_REPORTS = 12;
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
export function runQualityGate({ frontmatter, body, developments, weekStart, weekEnd }) {
  const errors = [];

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

  if (items.length === 0) {
    errors.push('article has zero developments - nothing significant to report');
  } else {
    if (items.length < MIN_REPORTS) {
      errors.push(
        `article has only ${items.length} report(s) - a live weekly publication requires at least ${MIN_REPORTS} distinct, verified, genuinely useful reports. If fewer than ${MIN_REPORTS} are available, this is expected: do not publish, this is not an error.`
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

    items.forEach((item, i) => {
      const label = `developments[${i}] ("${item.title || 'untitled'}")`;

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
          errors.push(`${label} duplicates the sourceUrl already used by developments[${seenSourceUrls.get(item.sourceUrl)}] - the same source must not back two separate reports`);
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
          errors.push(`${label} duplicates the title already used by developments[${seenTitles.get(normalized)}] - the same restriction must not be rendered as two reports`);
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
    for (const item of items) {
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
