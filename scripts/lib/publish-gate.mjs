// Explicit publish gate for the Friday workflow's commit step (invoked via
// scripts/publish-gate-commit.mjs). Pure decision function - unit tested in
// scripts/lib/__tests__/publish-gate.test.mjs - kept separate from the git
// plumbing so "did we actually publish an article this run" never again
// gets decided implicitly by whatever happened to be staged.
//
// This exists because the first live run committed with the message
// "content: publish EU Oversize Weekly 2026-W34" even though
// generate-weekly-article.mjs had aborted before writing any article - the
// commit only contained the routine data/oversize refresh, but the old
// inline `git add data/oversize src/content/news/eu-oversize && git commit`
// step couldn't tell the difference. articleAdded here must reflect a real,
// new file under src/content/news/eu-oversize - a data-only change must
// never produce a "publish" commit message.

const ARTICLE_FILENAME_PATTERN = /^eu-oversize-weekly-(?:preview-)?(\d{4})-w(\d{2})\.md$/i;

export function publicationBranchFor(week, { preview = false, correction = false } = {}) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week || '')) throw new Error('Invalid publication week');
  return `automation/weekly-${week.toLowerCase()}${preview ? '-preview' : ''}${correction ? '-correction' : ''}`;
}

/**
 * A second, distinct incident (fixed alongside the one above): even after
 * articleAdded/dataChanged were correctly distinguished, the commit message
 * for a real publish still used `isoWeekLabel(new Date())` - the week the
 * DATA was collected in - instead of the week the just-published article is
 * actually about (always 7 days later). A W35 article was committed as
 * "...2026-W34". The week must come from the article's own filename, not be
 * recomputed independently.
 *
 * @param {string} statusOutput - raw `git status --porcelain
 *   --untracked-files=all -- src/content/news/eu-oversize` output.
 * @returns {{ ok: true, week: string, filename: string } | { ok: false, reason: string }}
 */
export function extractArticleWeekFromStatus(statusOutput) {
  const filenames = (statusOutput || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim().split(/[/\\]/).pop());

  const matches = filenames
    .map((filename) => ({ filename, match: filename.match(ARTICLE_FILENAME_PATTERN) }))
    .filter((entry) => entry.match);

  if (matches.length === 0) {
    return { ok: false, reason: `no file matching eu-oversize-weekly-YYYY-wNN.md found among changed paths: ${filenames.join(', ') || '(none)'}` };
  }
  if (matches.length > 1) {
    return { ok: false, reason: `ambiguous - more than one article file changed: ${matches.map((m) => m.filename).join(', ')}` };
  }

  const [, year, week] = matches[0].match;
  return { ok: true, week: `${year}-W${week}`, filename: matches[0].filename };
}

/**
 * Whether the article change in `git status --porcelain` output replaces an
 * existing (tracked) file rather than adding a new one - a manual correction.
 */
export function isArticleReplacement(statusOutput) {
  return (statusOutput || '')
    .split('\n')
    .filter((line) => ARTICLE_FILENAME_PATTERN.test(line.slice(3).trim().split(/[/\\]/).pop() || ''))
    .some((line) => /M/.test(line.slice(0, 2)));
}

export function decidePublishCommit({ articleAdded, articleReplaced = false, dataChanged, week }) {
  if (articleAdded) {
    return {
      commit: true,
      addPaths: ['data/oversize', 'src/content/news/eu-oversize'],
      message: articleReplaced
        ? `content: replace EU Oversize Weekly ${week} with corrected edition`
        : `content: publish EU Oversize Weekly ${week}`,
    };
  }
  if (dataChanged) {
    return {
      commit: true,
      addPaths: ['data/oversize'],
      message: 'data: refresh oversize findings (no article published this run)',
    };
  }
  return { commit: false, addPaths: [], message: null };
}

/**
 * Sources that keep an autonomous final edition out of protected auto-merge.
 * Claude approved the W44 Search edition built on a third-hand relay
 * (24tv.ua citing 40ton.net citing Trafikverket); an edition citing anything
 * but official authorities therefore always waits for human review.
 * @param {string} articleMarkdown - the article file content
 * @param {(url: string) => string} tierOf - source-policy.sourceTier
 * @returns {string[]} cited source URLs that are not official
 */
export function autoMergeBlockers(articleMarkdown, tierOf) {
  const frontmatter = String(articleMarkdown || '').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
  const urls = [...frontmatter.matchAll(/^\s+url:\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
  if (urls.length === 0) return ['(no cited source)'];
  return urls.filter((url) => tierOf(url) !== 'official');
}

/**
 * Open publication PRs relevant to the target edition. `pending` is the
 * target week's PR, including regenerated `-retry-<run>` branches (W44's
 * retry PR was invisible to the old exact-branch lookup). `stale` are open
 * edition PRs for weeks that have already passed - W43's PR sat unmerged for
 * nine days without any alert.
 * @param {{ headRefName: string, url: string }[]} pulls - open PRs into main
 */
export function classifyEditionPulls(pulls, { branch, targetWeek }) {
  const isTarget = (head) => head === branch || head.startsWith(`${branch}-retry-`);
  const pending = pulls.find((pull) => isTarget(String(pull.headRefName || ''))) || null;
  const stale = pulls.filter((pull) => {
    const match = String(pull.headRefName || '').match(/^automation\/weekly-(\d{4})-w(\d{2})(?:-|$)/);
    return match && `${match[1]}-W${match[2]}` < targetWeek;
  });
  return { pending, stale };
}
