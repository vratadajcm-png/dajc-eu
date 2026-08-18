// Pre-publish quality gate for a generated EU Oversize Weekly article.
// Every check here is a hard blocker - if any fails, generate-weekly-article.mjs
// must not write the article file. See docs/NEWS_AUTOMATION.md "Quality gate".

import { articleFrontmatterSchema } from './article-schema.mjs';

const MIN_BODY_LENGTH = 400;

export function runQualityGate({ frontmatter, body, developments }) {
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

  if (!developments || developments.length === 0) {
    errors.push('article has zero developments - nothing significant to report');
  } else {
    developments.forEach((item, i) => {
      if (!item.sourceUrl) errors.push(`developments[${i}] ("${item.title}") has no sourceUrl`);
      if (!item.sourceName) errors.push(`developments[${i}] ("${item.title}") has no sourceName`);
      if (!item.title) errors.push(`developments[${i}] is missing a title`);
    });
  }

  return { ok: errors.length === 0, errors };
}
