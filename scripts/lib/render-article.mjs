// Turns the validated, cross-checked article JSON (see openai-client.mjs /
// mock-generator.mjs, after cross-validation in generate-weekly-article.mjs)
// into frontmatter + Markdown body matching src/content.config.ts's schema
// and the structure required for EU Oversize Weekly articles.
//
// Categorization is mutually exclusive and each development is rendered
// EXACTLY ONCE - see scripts/lib/__tests__/render-article.test.mjs. This
// fixes the incident where every development was rendered under "Main
// developments" AND AGAIN under "Driving bans next week" and/or
// "Infrastructure watch" whenever its isDrivingBan/isInfrastructure flags
// were set, because the old renderer treated those flags as additive
// overlays instead of a single categorization.

function mdEscape(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim();
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

function renderDevelopmentItem(item) {
  const lines = [`### ${mdEscape(item.title)} (${mdEscape(item.country)})`, ''];
  lines.push(mdEscape(item.whatChanged));
  lines.push('');
  const meta = [];
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
  lines.push(`*Source: [${mdEscape(item.sourceName)}](${item.sourceUrl})*`);
  for (const extra of item.additionalSources || []) {
    lines.push(`*Also see: [${mdEscape(extra.name)}](${extra.url})*`);
  }
  return lines.join('\n');
}

function renderRoundupItem(item) {
  const bits = [];
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

  lines.push('', `*Source: [${mdEscape(item.sourceName)}](${item.sourceUrl})*`);
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

const SECTION_TITLES = {
  bans: 'Driving bans and exceptional-transport restrictions',
  infrastructure: 'Infrastructure restrictions',
  other: 'Other operational developments',
};

export function renderArticleMarkdown(article, { slug, publishedAt, nextPublicationLabel }) {
  const byCategory = { bans: [], infrastructure: [], other: [] };
  for (const item of article.developments) {
    byCategory[categorizeDevelopment(item)].push(item);
  }

  const sections = [];

  sections.push(`## Intro\n\n${mdEscape(article.intro)}`);

  for (const category of ['bans', 'infrastructure', 'other']) {
    const items = byCategory[category];
    if (items.length === 0) continue;
    const parts = [`## ${SECTION_TITLES[category]}`, ''];
    for (const item of items) parts.push(renderDevelopmentItem(item), '');
    sections.push(parts.join('\n').trim());
  }

  const roundup = Array.isArray(article.europeRoundup) ? article.europeRoundup : [];
  if (roundup.length > 0) {
    const parts = [
      '## Rest of Europe: verified operational roundup',
      '',
      'At least ten concise verified items from at least six countries. Only operationally useful changes are included; routine evergreen Sunday bans are omitted after 1 September 2026.',
      '',
    ];
    for (const item of roundup) parts.push(renderRoundupItem(item), '');
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
    uniqueSources.set(item.sourceUrl, { name: item.sourceName, url: item.sourceUrl });
    for (const extra of item.additionalSources || []) {
      uniqueSources.set(extra.url, { name: extra.name, url: extra.url });
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
