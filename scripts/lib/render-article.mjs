// Turns the validated, cross-checked article JSON (see openai-client.mjs /
// mock-generator.mjs, after cross-validation in generate-weekly-article.mjs)
// into frontmatter + Markdown body matching src/content.config.ts's schema
// and the structure required for EU Oversize Weekly articles.

function mdEscape(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim();
}

function formatDateRange(item) {
  const from = item.validFrom ? item.validFrom : null;
  const to = item.validTo ? item.validTo : null;
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
  const range = formatDateRange(item);
  if (range) meta.push(`**When:** ${range}`);
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
  lines.push(`*Source: [${mdEscape(item.sourceName)}](${item.sourceUrl})*`);
  return lines.join('\n');
}

export function renderArticleMarkdown(article, { slug, publishedAt, nextPublicationLabel }) {
  const grouped = new Map();
  for (const item of article.developments) {
    const list = grouped.get(item.country) || [];
    list.push(item);
    grouped.set(item.country, list);
  }

  const sections = [];

  sections.push(`## Intro\n\n${mdEscape(article.intro)}`);

  const mainParts = ['## Main developments', ''];
  for (const [country, items] of grouped) {
    mainParts.push(`### ${country}`);
    mainParts.push('');
    for (const item of items) {
      mainParts.push(renderDevelopmentItem(item));
      mainParts.push('');
    }
  }
  sections.push(mainParts.join('\n').trim());

  const bans = article.developments.filter((d) => d.isDrivingBan);
  if (bans.length > 0) {
    const parts = ['## Driving bans next week', ''];
    for (const item of bans) parts.push(renderDevelopmentItem(item), '');
    sections.push(parts.join('\n').trim());
  }

  const infra = article.developments.filter((d) => d.isInfrastructure);
  if (infra.length > 0) {
    const parts = ['## Infrastructure watch', ''];
    for (const item of infra) parts.push(renderDevelopmentItem(item), '');
    sections.push(parts.join('\n').trim());
  }

  sections.push(`## What operators should watch next week\n\n${mdEscape(article.operatorsWatchNextWeek)}`);

  const uniqueSources = new Map();
  for (const item of article.developments) {
    uniqueSources.set(item.sourceUrl, { name: item.sourceName, url: item.sourceUrl });
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
