// Pre-publish quality gate for DAJC European Oversize & Special Transport Intelligence.
// Every check here is a hard blocker for malformed, duplicate or unverifiable output.

import { articleFrontmatterSchema } from './article-schema.mjs';
import { validateDevelopmentDateRange } from './date-validation.mjs';

const MIN_BODY_LENGTH = 400;
const MAX_REPORTS = 30;
const MAX_ROUNDUP_REPORTS = 20;
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

export function runQualityGate({ frontmatter, body, developments, europeRoundup, weekStart, weekEnd }) {
  const errors = [];
  const items = Array.isArray(developments) ? developments : [];
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

  if (items.length === 0) {
    errors.push('article has zero lead developments - nothing significant to report');
  }
  if (items.length > MAX_REPORTS) {
    errors.push(`article has ${items.length} lead reports - maximum is ${MAX_REPORTS}; move additional useful verified items to Around Europe`);
  }
  if (roundupItems.length > MAX_ROUNDUP_REPORTS) {
    errors.push(`Around Europe has ${roundupItems.length} reports - maximum is ${MAX_ROUNDUP_REPORTS}; retain only the strongest additional updates`);
  }

  const seenSourceUrls = new Map();
  const seenTitles = new Map();
  const allItems = [
    ...items.map((item, i) => ({ item, label: `developments[${i}]` })),
    ...roundupItems.map((item, i) => ({ item, label: `europeRoundup[${i}]` })),
  ];

  allItems.forEach(({ item, label: baseLabel }, i) => {
    const label = `${baseLabel} ("${item.title || 'untitled'}")`;

    if (!item.title) errors.push(`${baseLabel} is missing a title`);
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
        errors.push(`${label} duplicates a sourceUrl already used by report ${seenSourceUrls.get(item.sourceUrl)} - lead reports and Around Europe must be disjoint`);
      } else {
        seenSourceUrls.set(item.sourceUrl, i);
      }
    }

    const normalized = normalizeTitle(item.title);
    if (normalized) {
      if (seenTitles.has(normalized)) {
        errors.push(`${label} duplicates a title already used by report ${seenTitles.get(normalized)} - lead reports and Around Europe must be disjoint`);
      } else {
        seenTitles.set(normalized, i);
      }
    }
  });

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

  return { ok: errors.length === 0, errors };
}
