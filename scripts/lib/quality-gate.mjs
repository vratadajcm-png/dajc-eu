// Pre-publish quality gate for DAJC European Oversize & Special Transport Intelligence.
// Every check here is a hard blocker for malformed, duplicate, stale, out-of-scope
// or unverifiable output.
//
// QUALITY > COUNT. The gate enforces maximums (30 lead reports, 15 Rest-of-Europe
// updates) but no minimum beyond "an edition needs at least one lead report".
// 17 + 8, 9 + 0 or 25 + 12 are all publishable when every item is genuine; a
// short edition is never a reason to fail, and nothing in the pipeline pads
// an edition toward the 20-30 / 10-15 range of a well-supplied week.

import { articleFrontmatterSchema } from './article-schema.mjs';
import { checkGeneratedItem } from './generated-item-filter.mjs';

const MIN_BODY_LENGTH = 400;
export const MIN_LEAD_REPORTS = 1;
export const MAX_REPORTS = 30;
export const MAX_ROUNDUP_REPORTS = 15;

// Internal publishing mechanics must never reach public copy.
const INTERNAL_EDITORIAL_LEAK_PATTERNS = [
  /\bonly\s+\*?\*?\d+\s+(?:substantive\s+)?reports?\b/i,
  /\b20[–-]30\s+lead\b/i,
  /\b10[–-]1[05][- ]item\b/i,
  /\bat least (?:ten|10) concise\b/i,
  /\bfrom at least (?:six|6) (?:distinct )?(?:countries|jurisdictions)\b/i,
  /\b(?:minimum(?: of)?|at least) (?:20|twenty|10|ten) (?:substantive |lead |verified )*(?:reports|items|topics)\b/i,
  /\bverified\s+candidate\s+pool\b/i,
  /\bcandidates?\s+(?:pool|set|list)\b/i,
  /\bverified\s+(?:source|candidate)\s+set\b/i,
  /\bminimum\s+(?:of\s+)?(?:six|6)\s+(?:distinct\s+)?(?:countries|jurisdictions)\b/i,
  /\bdoes\s+not\s+pad\s+this\s+edition\b/i,
  /\bquality\s+gate\b/i,
  /\binternal\s+editorial\b/i,
];

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
 * @param {object} input
 * @param {Map<string, object>} [input.candidatesByUrl] - verified candidates;
 *   when given, every item must belong to one and that record must still pass
 *   the full Weekly eligibility check (freshness, scope, no repetition, ...).
 * @param {object} [input.eligibilityContext] - see weekly-eligibility.mjs
 * @param {string[][]} [input.requiredSourceGroups] - critical developments;
 *   each must be cited by at least one of its official URLs.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/;

export function runQualityGate({
  frontmatter,
  body,
  developments,
  europeRoundup,
  weekStart,
  weekEnd,
  candidatesByUrl = null,
  eligibilityContext = null,
  requiredSourceGroups = [],
}) {
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

  // Control characters (W42 shipped a NUL byte inside a source name) break
  // rendering and are never legitimate article text.
  const textFields = [body, ...[...items, ...roundupItems].flatMap((item) => [item.title, item.sourceName, item.whatChanged])];
  if (textFields.some((text) => typeof text === 'string' && CONTROL_CHARS.test(text))) {
    errors.push('article contains control characters (mangled text)');
  }

  if (body) {
    for (const pattern of INTERNAL_EDITORIAL_LEAK_PATTERNS) {
      if (pattern.test(body)) {
        errors.push('public article contains internal DAJC editorial/publishing mechanics');
        break;
      }
    }
  }

  if (items.length < MIN_LEAD_REPORTS) {
    errors.push('edition has no lead report - there is nothing verified to publish');
  }
  if (items.length > MAX_REPORTS) {
    errors.push(`article has ${items.length} lead reports - maximum is ${MAX_REPORTS}`);
  }
  if (roundupItems.length > MAX_ROUNDUP_REPORTS) {
    errors.push(`Rest of Europe has ${roundupItems.length} reports - maximum is ${MAX_ROUNDUP_REPORTS}`);
  }

  const seenUrls = new Map();
  const seenTitles = new Map();
  const allItems = [
    ...items.map((item, i) => ({ item, label: `developments[${i}]` })),
    ...roundupItems.map((item, i) => ({ item, label: `europeRoundup[${i}]` })),
  ];

  allItems.forEach(({ item, label: baseLabel }) => {
    const label = `${baseLabel} ("${item.title || 'untitled'}")`;

    if (!item.title) errors.push(`${baseLabel} is missing a title`);
    if (!item.sourceUrl) errors.push(`${label} has no sourceUrl`);
    else if (!isValidUrl(item.sourceUrl)) errors.push(`${label} has an invalid sourceUrl: "${item.sourceUrl}"`);
    if (!item.sourceName) errors.push(`${label} has no sourceName`);

    if (item.sourceUrl && candidatesByUrl && !candidatesByUrl.has(item.sourceUrl)) {
      errors.push(`${label} cites a source that is not a verified candidate`);
    } else if (item.sourceUrl) {
      const check = checkGeneratedItem(item, {
        weekStart,
        weekEnd,
        candidate: candidatesByUrl?.get(item.sourceUrl) ?? null,
        eligibilityContext,
      });
      if (!check.ok) errors.push(`${label}: ${check.reason}`);
    }

    // Every URL - primary or "Also see" - may be cited by one report only.
    const urls = [item.sourceUrl, ...(item.additionalSources || []).map((x) => x?.url)].filter(Boolean);
    for (const url of urls) {
      if (seenUrls.has(url)) {
        errors.push(`${label} cites "${url}", already cited by ${seenUrls.get(url)} - every development appears once`);
      } else {
        seenUrls.set(url, baseLabel);
      }
    }

    const normalized = normalizeTitle(item.title);
    if (normalized) {
      if (seenTitles.has(normalized)) {
        errors.push(`${label} duplicates the title of ${seenTitles.get(normalized)} - every development appears once`);
      } else {
        seenTitles.set(normalized, baseLabel);
      }
    }
  });

  for (const source of frontmatter?.sources || []) {
    if (!seenUrls.has(source.url)) {
      errors.push(`frontmatter lists source "${source.url}" which is not cited by any report in the article body`);
    }
  }

  for (const group of requiredSourceGroups) {
    const urls = (group || []).filter(Boolean);
    if (urls.length > 0 && !urls.some((url) => seenUrls.has(url))) {
      errors.push(`critical verified development omitted from publication: required source "${urls[0]}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}
