import { describe, expect, it } from 'vitest';
import { decidePublishCommit } from '../publish-gate.mjs';

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
});
