import { searchWithPerplexitySearch, SEARCH_GROUPS } from './lib/web-search.mjs';
import { generateArticleWithClaude } from './lib/openai-client.mjs';

// Bounded read-only provider rehearsal. Never creates content or posts.
if (!process.env.PERPLEXITY_API_KEY || !process.env.ANTHROPIC_API_KEY) {
  console.error('Required provider secret not visible'); process.exit(1);
}
try {
  const leads = await searchWithPerplexitySearch(SEARCH_GROUPS[0],
    'Official Czech Republic oversized road transport permits recent news October 2026');
  console.log('PASS Search + Claude URL classification; candidates: ' + leads.length);
  const article = await generateArticleWithClaude({
    candidates: [], requiredSourceUrls: [],
    weekRangeLabel: 'test only', targetWeekStart: '2026-10-26', targetWeekEnd: '2026-11-01',
  });
  if (!Array.isArray(article.developments) || !Array.isArray(article.europeRoundup))
    throw new Error('Claude did not return expected article schema');
  console.log('PASS Claude article schema; no source candidates intentionally provided');
  console.log('NO publication, no PR, no social posting, no production change');
} catch (e) {
  console.error('FAIL provider rehearsal: ' + e.message); process.exit(1);
}