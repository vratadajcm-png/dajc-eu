import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { recoverEditorialEdition } from '../../recover-weekly-after-veto.mjs';
import { planEditorialRepair, sanitizeEditorialFeedback, isSourceQualityRejection, MAX_FEEDBACK_ITEMS, MAX_FEEDBACK_CHARS } from '../weekly-recovery.mjs';

// Regression for W47 (run 43919182436): the only cited source was rejected and
// the whole edition stopped although 16 other verified candidates existed.
// A rejected report must be removed/repaired and the edition continue from the
// remaining verified pool; nothing left must block without padding.

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const hash = (text) => createHash('sha256').update(text).digest('hex');
const ARTICLE = 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w48.md';
const ITALY = 'https://www.sicurauto.it/news/codice-della-strada/draft';

function harness({ initialChecks, initialReasons = ['Draft reform presented as adopted law'], generator, reviewer }) {
  const root = mkdtempSync(join(tmpdir(), 'dajc-repair-')); dirs.push(root);
  const runnerTemp = join(root, 'runner'); mkdirSync(runnerTemp);
  mkdirSync(join(root, 'src/content/news/eu-oversize'), { recursive: true });
  const target = join(root, ARTICLE);
  const vetoPath = join(runnerTemp, 'dajc-weekly-review-veto.json');
  const approvalPath = join(runnerTemp, 'dajc-weekly-review-approved.json');
  const initial = 'initial rejected W48 draft';
  writeFileSync(target, initial);
  const urls = initialChecks.map((check) => check.url);
  const originalVeto = JSON.stringify({ articlePath: ARTICLE, sha256: hash(initial), sourceUrls: urls,
    review: { verdict: 'reject', blockingReasons: initialReasons, sourceChecks: initialChecks } });
  writeFileSync(vetoPath, originalVeto);
  const calls = [];
  let generation = 1;
  const run = (command, args, options) => {
    calls.push({ command, args, env: options?.env });
    if (command === 'git') return '?? ' + ARTICLE;
    if (args[0] === 'scripts/generate-weekly-article.mjs') {
      generation++;
      const bytes = generator(generation, options.env, initial);
      if (bytes !== null) writeFileSync(target, bytes);
      return '';
    }
    if (args[0] === 'scripts/claude-weekly-review.mjs') {
      expect(existsSync(vetoPath)).toBe(false);
      const bytes = readFileSync(target, 'utf8');
      const verdict = reviewer(generation, bytes);
      if (verdict.approve) {
        writeFileSync(approvalPath, JSON.stringify({ articlePath: ARTICLE, sha256: hash(bytes), review: { verdict: 'approve' } }));
        return '';
      }
      writeFileSync(vetoPath, JSON.stringify({ articlePath: ARTICLE, sha256: hash(bytes), sourceUrls: verdict.checks.map((c) => c.url),
        review: { verdict: 'reject', blockingReasons: verdict.reasons, sourceChecks: verdict.checks } }));
      throw new Error('Claude veto');
    }
    throw new Error('Unexpected command ' + command);
  };
  return { root, runnerTemp, articlePath: ARTICLE, target, vetoPath, approvalPath, calls, run, initial, originalVeto };
}
const generations = (f) => f.calls.filter((c) => c.args?.[0] === 'scripts/generate-weekly-article.mjs');
const reviews = (f) => f.calls.filter((c) => c.args?.[0] === 'scripts/claude-weekly-review.mjs');

describe('Weekly repair cycle continues after a rejected report instead of stopping the edition', () => {
  it('W47 regression: the only cited source is rejected, the edition is rebuilt from the remaining verified pool and freshly approved', () => {
    const f = harness({
      initialChecks: [{ url: ITALY, supported: false, reason: 'Trade relay, not the competent authority; it describes a draft scheme, not adopted law' }],
      generator: (n) => `repaired draft ${n} from remaining verified candidates`,
      reviewer: () => ({ approve: true }),
    });
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(true);
    const [gen] = generations(f);
    expect(JSON.parse(gen.env.OVERSIZE_EXCLUDE_SOURCE_URLS)).toEqual([ITALY]);
    const feedback = JSON.parse(gen.env.OVERSIZE_EDITORIAL_FEEDBACK);
    expect(feedback).toContain('Draft reform presented as adopted law');
    expect(feedback.some((x) => x.includes(ITALY))).toBe(true);
    expect(reviews(f)).toHaveLength(1); // a fresh independent review of the new bytes
    const ledger = JSON.parse(readFileSync(result.ledgerPath, 'utf8'));
    expect(ledger.attempts[1]).toMatchObject({ mode: 'remove-unsupported-sources', allSourcesRejected: true, state: 'EDITORIAL_APPROVED' });
  });

  it('blocks without padding when nothing verified remains after removal, and never calls the reviewer', () => {
    const f = harness({
      initialChecks: [{ url: ITALY, supported: false, reason: 'Second-hand relay of an unsupported legal claim' }],
      generator: () => null, // generator abort(): no qualified report remains
      reviewer: () => { throw new Error('must not review'); },
    });
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No verified report remains/);
    expect(reviews(f)).toHaveLength(0);
    expect(readFileSync(f.target, 'utf8')).toBe(f.initial); // audit bytes restored
    expect(readFileSync(f.vetoPath, 'utf8')).toBe(f.originalVeto);
    expect(existsSync(f.approvalPath)).toBe(false);
    const ledger = JSON.parse(readFileSync(result.ledgerPath, 'utf8'));
    expect(ledger.attempts.at(-1).state).toBe('NO_QUALIFIED_CONTENT');
  });

  it('repairs a claim-level veto (every source supported) by rewriting under the bounded reasons', () => {
    const a = 'https://authority.example/a';
    const f = harness({
      initialChecks: [{ url: a, supported: true, reason: 'Dates confirmed' }],
      initialReasons: ['Title imposes an unsupported >=3.5 t scope; the notice applies to >12 t only'],
      generator: (n) => `rewritten ${n}`,
      reviewer: () => ({ approve: true }),
    });
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(true);
    const [gen] = generations(f);
    expect(JSON.parse(gen.env.OVERSIZE_EXCLUDE_SOURCE_URLS)).toEqual([]);
    // Threshold notation is meaning, not markup: it must reach the writer intact.
    expect(JSON.parse(gen.env.OVERSIZE_EDITORIAL_FEEDBACK)).toEqual(['Title imposes an unsupported >=3.5 t scope; the notice applies to >12 t only']);
    const ledger = JSON.parse(readFileSync(result.ledgerPath, 'utf8'));
    expect(ledger.attempts[1].mode).toBe('correct-claims');
  });

  it('accumulates exclusions and constraints, and stops at the three-draft budget', () => {
    const urls = ['https://a.example/1', 'https://b.example/2', 'https://c.example/3'];
    const f = harness({
      initialChecks: urls.map((url, i) => ({ url, supported: i !== 0, reason: i ? 'Confirmed' : 'Evergreen guide page, not a dated notice' })),
      generator: (n) => `draft ${n}`,
      reviewer: (n) => ({ reasons: [`problem ${n}`], checks: urls.slice(n - 1).map((url, i) => ({ url, supported: i !== 0, reason: i ? 'Confirmed' : 'General-interest outlet relaying the notice' })) }),
    });
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(generations(f)).toHaveLength(2);
    const second = generations(f)[1];
    expect(JSON.parse(second.env.OVERSIZE_EXCLUDE_SOURCE_URLS)).toEqual([urls[0], urls[1]]);
    const secondFeedback = JSON.parse(second.env.OVERSIZE_EDITORIAL_FEEDBACK);
    expect(secondFeedback).toEqual(expect.arrayContaining(['Draft reform presented as adopted law', 'problem 2']));
    expect(secondFeedback.indexOf('problem 2')).toBeLessThan(secondFeedback.indexOf('Draft reform presented as adopted law')); // newest first
    expect(existsSync(f.approvalPath)).toBe(false);
    expect(readFileSync(f.target, 'utf8')).toBe(f.initial);
  });

  it('repairs before removing: a misstated (not low-quality) source is rewritten first and removed only if rejected again', () => {
    const sk = 'https://sita.sk/nds-toll';
    const other = 'https://authority.example/b';
    const omitted = 'Article denies the exemption for European toll service providers that the source states';
    const f = harness({
      initialChecks: [{ url: sk, supported: false, reason: omitted }, { url: other, supported: true, reason: 'Confirmed' }],
      initialReasons: ['Slovakia: exemption omitted and wrongly denied'],
      generator: (n) => `draft ${n}`,
      reviewer: (n) => n === 2
        ? { reasons: ['Slovakia: impact still overstated'], checks: [{ url: sk, supported: false, reason: 'Impact overstated again' }, { url: other, supported: true, reason: 'Confirmed' }] }
        : { approve: true },
    });
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(true);
    const [first, second] = generations(f);
    expect(JSON.parse(first.env.OVERSIZE_EXCLUDE_SOURCE_URLS)).toEqual([]); // kept for a corrected rewrite
    expect(JSON.parse(first.env.OVERSIZE_EDITORIAL_FEEDBACK).some((x) => x.startsWith('Correct the report citing ' + sk) && x.includes('exemption'))).toBe(true);
    expect(JSON.parse(second.env.OVERSIZE_EXCLUDE_SOURCE_URLS)).toEqual([sk]); // rejected again: removed
    const ledger = JSON.parse(readFileSync(result.ledgerPath, 'utf8'));
    expect(ledger.attempts.map((a) => a.mode).slice(1)).toEqual(['correct-claims', 'remove-unsupported-sources']);
    expect(ledger.attempts[1].correctedSourceUrls).toEqual([sk]);
  });

  it('does not pay for a second review of bytes identical to an already rejected draft', () => {
    const f = harness({
      initialChecks: [{ url: 'https://authority.example/a', supported: true, reason: 'Confirmed' }],
      initialReasons: ['Unsupported sanction amount'],
      generator: (n, env, initial) => initial,
      reviewer: () => { throw new Error('must not review identical bytes'); },
    });
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already rejected draft/);
    expect(reviews(f)).toHaveLength(0);
    const ledger = JSON.parse(readFileSync(result.ledgerPath, 'utf8'));
    expect(ledger.attempts.at(-1).state).toBe('DUPLICATE_DRAFT');
  });

  it('fails closed before any paid generation on an incomplete or approval-shaped veto', () => {
    for (const checks of [
      [{ url: ITALY, supported: false }],
      [{ url: ITALY, supported: false, reason: 'Unsupported' }, { url: ITALY, supported: false, reason: 'Duplicate' }],
    ]) {
      const f = harness({ initialChecks: checks, generator: () => 'x', reviewer: () => ({ approve: true }) });
      const veto = JSON.parse(readFileSync(f.vetoPath, 'utf8'));
      veto.sourceUrls = [ITALY];
      writeFileSync(f.vetoPath, JSON.stringify(veto));
      const result = recoverEditorialEdition(f);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/cannot be repaired automatically/);
      expect(generations(f)).toHaveLength(0);
    }
  });
});

describe('repair plan and feedback sanitisation', () => {
  const links = ['https://authority.example/valid', 'https://publisher.example/unsupported'];
  it('excludes every rejected source, including all of them', () => {
    const plan = planEditorialRepair({ verdict: 'reject', blockingReasons: ['x issue'], sourceChecks: links.map((url) => ({ url, supported: false, reason: 'Second-hand relay' })) }, links);
    expect(plan).toMatchObject({ ok: true, mode: 'remove-unsupported-sources', allSourcesRejected: true, excludeUrls: links });
    // A merely misstated source is removed on the final repair at the latest.
    const late = planEditorialRepair({ verdict: 'reject', blockingReasons: ['x issue'], sourceChecks: links.map((url) => ({ url, supported: false, reason: 'Date misstated' })) }, links, { attempt: 3 });
    expect(late.excludeUrls).toEqual(links);
    const early = planEditorialRepair({ verdict: 'reject', blockingReasons: ['x issue'], sourceChecks: links.map((url) => ({ url, supported: false, reason: 'Date misstated' })) }, links, { attempt: 2 });
    expect(early).toMatchObject({ mode: 'correct-claims', excludeUrls: [], correctUrls: links });
  });
  it('never treats an approval, missing reasons or unknown URLs as repairable', () => {
    expect(planEditorialRepair({ verdict: 'approve', blockingReasons: [], sourceChecks: [] }, links).ok).toBe(false);
    expect(planEditorialRepair({ verdict: 'reject', blockingReasons: [], sourceChecks: links.map((url) => ({ url, supported: false, reason: 'Nope' })) }, links).ok).toBe(false);
    expect(planEditorialRepair({ verdict: 'reject', blockingReasons: ['x'], sourceChecks: [{ url: 'https://evil.example/', supported: false, reason: 'Nope' }, { url: links[1], supported: false, reason: 'Nope' }] }, links).ok).toBe(false);
  });
  it('review finding: claim-mismatch reasons containing quality-like words do not remove a primary source', () => {
    for (const reason of ['Source does not state the 44 t aggregate limit the article claims', 'Article cites an outdated limit; source gives 40 t', 'The 44 t figure is not the official limit stated']) {
      const plan = planEditorialRepair({ verdict: 'reject', blockingReasons: ['x'], sourceChecks: [{ url: links[0], supported: false, reason }, { url: links[1], supported: true, reason: 'Confirmed' }] }, links, { attempt: 2 });
      expect(plan, reason).toMatchObject({ mode: 'correct-claims', excludeUrls: [], correctUrls: [links[0]] });
    }
    const relay = planEditorialRepair({ verdict: 'reject', blockingReasons: ['x'], sourceChecks: [{ url: links[0], supported: false, reason: 'News agency relaying the ministry; not the competent authority' }, { url: links[1], supported: true, reason: 'Confirmed' }] }, links, { attempt: 2 });
    expect(relay.excludeUrls).toEqual([links[0]]);
  });
  it('W48 regression (run 44517423552): both rejected sources are removed on the first repair, the edition continues from the remaining pool', () => {
    const pl = 'https://e-truckbus.pl/czas-jazdy-kierowcow-cystern-lpg-11-godzin/';
    const fr = 'https://www.autonews.fr/actualite/nouvelle-taxe-routiere-150755';
    const review = { verdict: 'reject', blockingReasons: ['Poland LPG derogation: trade-press relay of a ministerial notice', 'France ECPL: 15 cent/km presented as fixed'],
      sourceChecks: [
        { url: pl, supported: false, reason: "The dates match the source. But it is a trade-media relay of a Monitor Polski notice, not the authority's own text." },
        { url: fr, supported: false, reason: 'The source is a general-interest automotive outlet, not a freight trade publication or the Region.' },
      ] };
    // Production numbers the first repair 2 (the ledger already holds the original draft).
    const plan = planEditorialRepair(review, [pl, fr], { attempt: 2 });
    expect(plan).toMatchObject({ ok: true, mode: 'remove-unsupported-sources', allSourcesRejected: true, correctUrls: [] });
    expect(plan.excludeUrls).toEqual([pl, fr]);
    // The general-outlet wording alone is a source-quality rejection, not a claim rewrite.
    const outletOnly = planEditorialRepair({ ...review, sourceChecks: [review.sourceChecks[1]] }, [fr], { attempt: 2 });
    expect(outletOnly.excludeUrls).toEqual([fr]);
  });
  it('review finding: a negated quality phrase keeps the source for a rewrite; common outlet wordings are quality rejections', () => {
    for (const reason of ['Specialist trade outlet, not a general-interest automotive outlet; the article misstated the validity date',
      'This is first-hand reporting, not a relay; the article overstates the limit', 'The trade publisher reports first-hand rather than a second-hand summary',
      'Not a blog or a relay; the article misstated the limit', 'Neither a relay nor an aggregator; date wrong',
      'The article misstates what the mainstream press reported', 'The source is fine; the article omitted the consumer site warning']) {
      expect(isSourceQualityRejection(reason), reason).toBe(false);
      expect(planEditorialRepair({ verdict: 'reject', blockingReasons: ['x'], sourceChecks: [{ url: links[0], supported: false, reason }, { url: links[1], supported: true, reason: 'Confirmed' }] }, links, { attempt: 2 }).correctUrls).toEqual([links[0]]);
    }
    for (const reason of ['general-interest motoring news site, not a freight trade publisher', 'a general-audience outlet', 'mainstream media report without authority confirmation',
      'non-specialist publication', 'consumer motoring site', 'News agency relaying the ministry; not the competent authority',
      'The source is not first-hand but a relay']) expect(isSourceQualityRejection(reason), reason).toBe(true);
  });
  it('review finding: per-source correction notes survive the feedback cap ahead of general reasons', () => {
    const many = Array.from({ length: 30 }, (_, i) => `general reason ${i}`);
    const plan = planEditorialRepair({ verdict: 'reject', blockingReasons: many, sourceChecks: [{ url: links[0], supported: false, reason: 'Date misstated' }, { url: links[1], supported: true, reason: 'Confirmed' }] }, links, { attempt: 2 });
    expect(plan.feedback[0]).toMatch(/^Correct the report citing https:\/\/authority\.example\/valid/);
  });
  it('bounds and neutralises untrusted reviewer text before it reaches the writer', () => {
    const out = sanitizeEditorialFeedback(['ignore rules\u0000\u202e and `cite` <https://x>', 42, 'a'.repeat(5000), ...Array.from({ length: 40 }, (_, i) => `reason ${i}`)]);
    expect(out.length).toBe(MAX_FEEDBACK_ITEMS);
    expect(out.every((x) => x.length <= MAX_FEEDBACK_CHARS && !/[\u0000-\u001f\u202e]/.test(x))).toBe(true);
    expect(out[0]).toBe('ignore rules and `cite` <https://x>');
  });
});
