import { describe, expect, it } from 'vitest';
import { decidePublishCommit, extractArticleWeekFromStatus } from '../publish-gate.mjs';

describe('decidePublishCommit', () => {
  it('produces a publish commit when a new article was added', () => {
    const decision = decidePublishCommit({ articleAdded: true, dataChanged: true, week: '2026-W34' });
    expect(decision.commit).toBe(true);
    expect(decision.message).toBe('content: publish EU Oversize Weekly 2026-W34');
    expect(decision.addPaths).toEqual(['data/oversize', 'src/content/news/eu-oversize']);
  });

  it('never labels a data-only refresh as a publish', () => {
    const decision = decidePublishCommit({ articleAdded: false, dataChanged: true, week: '2026-W34' });
    expect(decision.commit).toBe(true);
    expect(decision.message).not.toMatch(/^content: publish/);
    expect(decision.message.startsWith('data:')).toBe(true);
    expect(decision.addPaths).toEqual(['data/oversize']);
  });

  it('skips the commit entirely when nothing changed', () => {
    const decision = decidePublishCommit({ articleAdded: false, dataChanged: false, week: '2026-W34' });
    expect(decision.commit).toBe(false);
    expect(decision.addPaths).toEqual([]);
    expect(decision.message).toBeNull();
  });

  it('this is exactly the scenario from the first live run: findings.json changed, no article', () => {
    // Regression test for the incident this fix addresses: commit
    // 366841e ("content: publish EU Oversize Weekly 2026-W34") only
    // touched data/oversize/2026-W34/findings.json - no article was ever
    // written, because OPENAI_API_KEY was missing and the old script
    // silently exited 0. The commit message still said "publish".
    const decision = decidePublishCommit({ articleAdded: false, dataChanged: true, week: '2026-W34' });
    expect(decision.message).toBe('data: refresh oversize findings (no article published this run)');
  });

  // An OpenAI API failure (or any generate-step failure) never reaches this
  // commit step at all, because the workflow's `if:` condition is ANDed
  // with the previous step's success() - but if it somehow did, the data
  // refresh from earlier in the run must still never be labeled "publish".
  it('an OpenAI API failure scenario (data refreshed, no article) never produces a publish commit', () => {
    const decision = decidePublishCommit({ articleAdded: false, dataChanged: true, week: null });
    expect(decision.message).not.toMatch(/^content: publish/);
  });
});

describe('extractArticleWeekFromStatus', () => {
  it('extracts the week from a newly-added article filename', () => {
    const result = extractArticleWeekFromStatus('?? src/content/news/eu-oversize/eu-oversize-weekly-2026-w35.md\n');
    expect(result.ok).toBe(true);
    expect(result.week).toBe('2026-W35');
  });

  // Regression for the actual incident: findings.json is refreshed for the
  // CURRENT week (W34) but the article being published targets the
  // UPCOMING week (W35) - the commit message must reflect the article's
  // week, not the data-collection week.
  it('this is exactly the W35 incident: findings collected in W34, article targets W35', () => {
    const statusOutput = '?? src/content/news/eu-oversize/eu-oversize-weekly-2026-w35.md\n';
    const extraction = extractArticleWeekFromStatus(statusOutput);
    expect(extraction.week).toBe('2026-W35');
    const decision = decidePublishCommit({ articleAdded: true, dataChanged: true, week: extraction.week });
    expect(decision.message).toBe('content: publish EU Oversize Weekly 2026-W35');
  });

  it('fails on a status with no matching article filename', () => {
    const result = extractArticleWeekFromStatus('?? src/content/news/eu-oversize/example-template.md\n');
    expect(result.ok).toBe(false);
  });

  it('fails on an ambiguous status with two matching article filenames', () => {
    const statusOutput =
      '?? src/content/news/eu-oversize/eu-oversize-weekly-2026-w35.md\n' +
      '?? src/content/news/eu-oversize/eu-oversize-weekly-2026-w36.md\n';
    const result = extractArticleWeekFromStatus(statusOutput);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ambiguous/);
  });

  it('handles a staged (A) status, not just untracked (??)', () => {
    const result = extractArticleWeekFromStatus('A  src/content/news/eu-oversize/eu-oversize-weekly-2026-w40.md\n');
    expect(result.ok).toBe(true);
    expect(result.week).toBe('2026-W40');
  });
});
