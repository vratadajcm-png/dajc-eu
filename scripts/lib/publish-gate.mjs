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

const ARTICLE_FILENAME_PATTERN = /^eu-oversize-weekly-(\d{4})-w(\d{2})\.md$/i;

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

export function decidePublishCommit({ articleAdded, dataChanged, week }) {
  if (articleAdded) {
    return {
      commit: true,
      addPaths: ['data/oversize', 'src/content/news/eu-oversize'],
      message: `content: publish EU Oversize Weekly ${week}`,
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
