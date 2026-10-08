// Turns the validated, cross-checked article JSON (see openai-client.mjs /
// mock-generator.mjs, after cross-validation in generate-weekly-article.mjs)
// into frontmatter + Markdown body matching src/content.config.ts's schema
// and the structure required for EU Oversize Weekly articles.
//
// Lead reports are rendered as ONE list, in the order the pipeline decided
// (edition-order.mjs: importance first, then Central Europe first), so the
// published order is exactly the deterministic, tested order. Each
// development carries one category label and is rendered EXACTLY ONCE - see
// scripts/lib/__tests__/render-article.test.mjs (the W35 incident rendered
// developments twice because category flags were additive overlays).

// Article text comes from an LLM that read third-party pages, so it is
// untrusted: a prompt-injected source must not be able to put raw HTML into
// the published page (Astro renders raw HTML inside Markdown). Escaping the
// three HTML metacharacters keeps the visible text identical.
function mdEscape(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

// Only absolute http(s) links may reach the article (no javascript:, data:
// or relative targets). Parentheses and spaces are percent-encoded so a URL
// cannot break out of the Markdown link syntax. Throws, so a bad source
// fails the edition instead of publishing an unsafe link.
export function safeUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    throw new Error(`Unsafe source URL rejected: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsafe source URL rejected: ${JSON.stringify(url)}`);
  }
  return parsed.href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
}

function formatDateRange(item) {
  const from = item.validFrom ? item.validFrom : null;
  const to = item.validTo ? item.validTo : null;
  if (from && to && from === to) return from;
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return null;
}

function outlookLine(item, weekEnd) {
  return weekEnd && item.validFrom && item.validFrom > weekEnd
    ? `**Outlook:** takes effect ${item.validFrom}, after the week covered by this edition`
    : null;
}

function renderDevelopmentItem(item, { weekEnd = null } = {}) {
  const lines = [`### ${mdEscape(item.title)} (${mdEscape(item.country)})`, ''];
  lines.push(mdEscape(item.whatChanged));
  lines.push('');
  const meta = [`**Category:** ${CATEGORY_LABELS[categorizeDevelopment(item)]}`];
  const outlook = outlookLine(item, weekEnd);
  if (outlook) meta.push(outlook);
  if (item.where) meta.push(`**Where:** ${mdEscape(item.where)}`);
  if (item.vehicleScope) meta.push(`**Affected vehicles:** ${mdEscape(item.vehicleScope)}`);
  const range = formatDateRange(item);
  if (item.timeWindow) meta.push(`**When:** ${mdEscape(item.timeWindow)}`);
  else if (range) meta.push(`**When:** ${range}`);
  if (meta.length) {
    lines.push(meta.join('  \n'));
    lines.push('');
  }
  if (item.impact) {
    lines.push(`**Impact:** ${mdEscape(item.impact)}`);
    lines.push('');
  }
  if (item.recommendedAction) {
    lines.push(`**Recommended action:** ${mdEscape(item.recommendedAction)}`);
    lines.push('');
  }
  if (item.exemptions) {
    lines.push(`**Exemptions/conditions:** ${mdEscape(item.exemptions)}`);
    lines.push('');
  }
  lines.push(`*Source: [${mdEscape(item.sourceName)}](${safeUrl(item.sourceUrl)})*`);
  for (const extra of item.additionalSources || []) {
    lines.push(`*Also see: [${mdEscape(extra.name)}](${safeUrl(extra.url)})*`);
  }
  return lines.join('\n');
}

function renderRoundupItem(item, { weekEnd = null } = {}) {
  const bits = [];
  if (weekEnd && item.validFrom && item.validFrom > weekEnd) bits.push(`Outlook: takes effect ${item.validFrom}`);
  const range = formatDateRange(item);
  if (item.where) bits.push(`Where: ${mdEscape(item.where)}`);
  if (item.timeWindow) bits.push(`When: ${mdEscape(item.timeWindow)}`);
  else if (range) bits.push(`When: ${range}`);

  const lines = [
    `### ${mdEscape(item.title)} (${mdEscape(item.country)})`,
    '',
    mdEscape(item.whatChanged),
  ];

  if (bits.length > 0) lines.push('', `**${bits.join(' · ')}**`);

  const action = item.recommendedAction || item.impact;
  if (action) lines.push('', `**Operator action:** ${mdEscape(action)}`);

  lines.push('', `*Source: [${mdEscape(item.sourceName)}](${safeUrl(item.sourceUrl)})*`);
  return lines.join('\n');
}

/**
 * Assigns each development to exactly one category, in priority order.
 * A driving ban / exceptional-transport movement restriction is reported
 * there even if it also happens to touch infrastructure - it never appears
 * a second time under "Infrastructure restrictions".
 */
export function categorizeDevelopment(item) {
  if (item.isDrivingBan) return 'bans';
  if (item.isInfrastructure) return 'infrastructure';
  return 'other';
}

// General HGV driving bans are not part of this product (they live in the
// separate DAJC Driving Bans service); the "bans" category only ever holds
// movement restrictions explicitly scoped to exceptional/oversize transport.
const CATEGORY_LABELS = {
  bans: 'Exceptional-transport movement restriction',
  infrastructure: 'Infrastructure restriction',
  other: 'Operational development',
};

export function renderArticleMarkdown(article, { slug, publishedAt, updatedAt = null, nextPublicationLabel, weekEnd = null }) {
  const sections = [];

  sections.push(`## Intro\n\n${mdEscape(article.intro)}`);

  if (article.developments.length > 0) {
    const parts = ['## Lead reports', ''];
    for (const item of article.developments) parts.push(renderDevelopmentItem(item, { weekEnd }), '');
    sections.push(parts.join('\n').trim());
  }

  const roundup = Array.isArray(article.europeRoundup) ? article.europeRoundup : [];
  if (roundup.length > 0) {
    const parts = ['## Rest of Europe: verified operational roundup', ''];
    for (const item of roundup) parts.push(renderRoundupItem(item, { weekEnd }), '');
    sections.push(parts.join('\n').trim());
  }

  const checklist =
    Array.isArray(article.operatorChecklist) && article.operatorChecklist.length > 0
      ? article.operatorChecklist
      : article.operatorsWatchNextWeek
        ? [article.operatorsWatchNextWeek]
        : [];
  if (checklist.length > 0) {
    sections.push(
      ['## Operator checklist', '', ...checklist.map((c) => `- ${mdEscape(c)}`)].join('\n')
    );
  }

  const uniqueSources = new Map();
  for (const item of [...article.developments, ...roundup]) {
    uniqueSources.set(item.sourceUrl, { name: item.sourceName, url: safeUrl(item.sourceUrl) });
    for (const extra of item.additionalSources || []) {
      uniqueSources.set(extra.url, { name: extra.name, url: safeUrl(extra.url) });
    }
  }
  const sourcesList = [...uniqueSources.values()];
  sections.push(
    ['## Sources', '', ...sourcesList.map((s) => `- [${mdEscape(s.name)}](${s.url})`)].join('\n')
  );

  if (nextPublicationLabel) {
    sections.push(`## Next EU Oversize Weekly\n\n${nextPublicationLabel}.`);
  }

  const body = sections.join('\n\n') + '\n';

  const frontmatter = {
    title: article.seoTitle,
    description: article.metaDescription,
    slug,
    category: 'eu-oversize',
    publishedAt,
    ...(updatedAt ? { updatedAt } : {}),
    language: 'en',
    author: 'DAJC',
    status: 'published',
    sources: sourcesList,
  };

  return { frontmatter, body, sourcesList };
}

export function toFrontmatterYaml(frontmatter) {
  const lines = ['---'];
  lines.push(`title: ${JSON.stringify(frontmatter.title)}`);
  lines.push(`description: ${JSON.stringify(frontmatter.description)}`);
  lines.push(`slug: ${JSON.stringify(frontmatter.slug)}`);
  lines.push(`category: ${JSON.stringify(frontmatter.category)}`);
  lines.push(`publishedAt: ${frontmatter.publishedAt}`);
  if (frontmatter.updatedAt) lines.push(`updatedAt: ${frontmatter.updatedAt}`);
  lines.push(`language: ${JSON.stringify(frontmatter.language)}`);
  lines.push(`author: ${JSON.stringify(frontmatter.author)}`);
  lines.push(`status: ${JSON.stringify(frontmatter.status)}`);
  lines.push('sources:');
  for (const s of frontmatter.sources) {
    lines.push(`  - name: ${JSON.stringify(s.name)}`);
    lines.push(`    url: ${JSON.stringify(s.url)}`);
  }
  lines.push('---');
  return lines.join('\n');
}
