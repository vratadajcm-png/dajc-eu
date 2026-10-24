import { describe, expect, it } from 'vitest';
import { nonOfficialSources, classifyEditionPulls, decidePublishCommit, extractArticleWeekFromStatus, isArticleReplacement, publicationBranchFor } from '../publish-gate.mjs';
import { sourceTier } from '../source-policy.mjs';

describe('reviewed publication branches', () => {
  it('keeps final editions, previews and explicit corrections in distinct PRs', () => {
    expect(publicationBranchFor('2026-W43')).toBe('automation/weekly-2026-w43');
    expect(publicationBranchFor('2026-W43', { preview: true })).toBe('automation/weekly-2026-w43-preview');
    expect(publicationBranchFor('2026-W43', { correction: true })).toBe('automation/weekly-2026-w43-correction');
    expect(() => publicationBranchFor('main')).toThrow('Invalid');
    expect(extractArticleWeekFromStatus('?? src/content/news/eu-oversize/eu-oversize-weekly-preview-2026-w43.md\n').week).toBe('2026-W43');
  });
});

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

  // A Claude API failure (or any generate-step failure) never reaches this
  // commit step at all, because the workflow's `if:` condition is ANDed
  // with the previous step's success() - but if it somehow did, the data
  // refresh from earlier in the run must still never be labeled "publish".
  it('a Claude API failure scenario (data refreshed, no article) never produces a publish commit', () => {
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

describe('corrected edition replacing a published article', () => {
  it('detects a modified (replaced) article file', () => {
    expect(isArticleReplacement(' M src/content/news/eu-oversize/eu-oversize-weekly-2026-w41.md\n')).toBe(true);
    expect(isArticleReplacement('?? src/content/news/eu-oversize/eu-oversize-weekly-2026-w42.md\n')).toBe(false);
  });

  it('labels the commit as a replacement with the article week', () => {
    const status = ' M src/content/news/eu-oversize/eu-oversize-weekly-2026-w41.md\n';
    const extraction = extractArticleWeekFromStatus(status);
    expect(extraction.week).toBe('2026-W41');
    const decision = decidePublishCommit({ articleAdded: true, articleReplaced: isArticleReplacement(status), dataChanged: true, week: extraction.week });
    expect(decision.message).toBe('content: replace EU Oversize Weekly 2026-W41 with corrected edition');
  });
});

describe('nonOfficialSources', () => {
  const article = (urls) => `---\ntitle: "T"\nsources:\n${urls.map((u) => `  - name: "S"\n    url: "${u}"`).join('\n')}\n---\n\nBody`;

  it('lists the cited sources that are not official authorities', () => {
    const relay = 'https://24tv.ua/auto/ru/amp/vdvoe_bolshe_dorog_dlya_35_metrovyh_avtopoezdov_n76844';
    expect(nonOfficialSources(article(['https://www.rijkswaterstaat.nl/nieuws/archief/2026/09/n307']), sourceTier)).toEqual([]);
    expect(nonOfficialSources(article(['https://www.rijkswaterstaat.nl/nieuws/x', relay]), sourceTier)).toEqual([relay]);
  });
});

describe('classifyEditionPulls', () => {
  const pulls = [
    { url: 'https://example/pull/39', headRefName: 'automation/weekly-2026-w43' },
    { url: 'https://example/pull/63', headRefName: 'automation/weekly-2026-w44-retry-40074547124' },
    { url: 'https://example/pull/50', headRefName: 'fix/english-demo-hosting-redirects-20261023' },
  ];

  it('finds the target edition PR including regenerated retry branches', () => {
    expect(classifyEditionPulls(pulls, { branch: 'automation/weekly-2026-w44', targetWeek: '2026-W44' }).pending.url).toBe('https://example/pull/63');
  });

  it('lists open edition PRs for weeks that have already passed', () => {
    expect(classifyEditionPulls(pulls, { branch: 'automation/weekly-2026-w44', targetWeek: '2026-W44' }).stale.map((p) => p.url)).toEqual(['https://example/pull/39']);
  });

  it('does not treat a different week as pending', () => {
    expect(classifyEditionPulls(pulls, { branch: 'automation/weekly-2026-w45', targetWeek: '2026-W45' }).pending).toBeNull();
  });
});
