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
