import { describe, expect, it } from 'vitest';
import { crossValidateDevelopments } from '../cross-validate.mjs';

describe('crossValidateDevelopments', () => {
  const verifiedCandidates = [
    { sourceUrl: 'https://example.test/a' },
    { sourceUrl: 'https://example.test/b' },
  ];

  it('keeps a development whose sourceUrl matches a verified candidate exactly', () => {
    const { kept, droppedCount } = crossValidateDevelopments(
      [{ title: 'A', sourceUrl: 'https://example.test/a' }],
      verifiedCandidates
    );
    expect(kept).toHaveLength(1);
    expect(droppedCount).toBe(0);
  });

  // Every development's sourceUrl the model returns must match one of the
  // candidates it was actually given - anything else is dropped, defending
  // against the model inventing or slightly altering a source URL.
  it('drops a development whose sourceUrl does not match any verified candidate', () => {
    const { kept, droppedCount } = crossValidateDevelopments(
      [
        { title: 'A', sourceUrl: 'https://example.test/a' },
        { title: 'Invented', sourceUrl: 'https://example.test/invented-by-model' },
      ],
      verifiedCandidates
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe('A');
    expect(droppedCount).toBe(1);
  });

  it('drops everything when nothing matches', () => {
    const { kept, droppedCount } = crossValidateDevelopments([{ sourceUrl: 'https://example.test/z' }], verifiedCandidates);
    expect(kept).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });
});
