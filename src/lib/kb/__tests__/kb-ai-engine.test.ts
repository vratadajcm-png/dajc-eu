// Unit tests of the AI verification engine with SCRIPTED test providers.
// These prove the decision logic (fail closed, conflicts, budget); they are not
// an AI verification of any real document.

import { describe, expect, it } from 'vitest';
import { Budget } from '../ai-verify/budget.mjs';
import { chunkProvisions, foreignJurisdiction, verifyVersionWithAi } from '../ai-verify/engine.mjs';
import { locateQuote, numbersIn, quantitiesInQuote, sameQuantities } from '../ai-verify/quotes.mjs';

const ART7 = 'After a driving period of four and a half hours a driver shall take an uninterrupted break of not less than 45 minutes, unless he takes a rest period.';
const ART8 = 'A driver shall take daily and weekly rest periods. Within each period of 24 hours after the end of the previous daily rest period a driver shall have taken a new daily rest period of at least 11 hours.';

const version = {
  id: 'v1', sha256: 'a'.repeat(64), language: 'en', version_label: 'Regulation (EC) No 561/2006, consolidated text of 31.12.2024',
  official_url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:02006R0561-20241231', effective_from: '2024-12-31', effective_to: null,
  validity: 'IN_FORCE', provenance: 'AUTO_CHECKED', authenticity: 'CONSOLIDATED_DOCUMENTATION', jurisdiction: 'EU', official_number: 'Regulation (EC) No 561/2006',
  legal_category: 'EU_REGULATION',
};
const provisions = [
  { id: 101, ordinal: 1, anchor_type: 'PREAMBLE', anchor_label: 'Preamble', page_from: 1, page_to: 1, text: 'Whereas the Council adopted this.' },
  { id: 107, ordinal: 8, anchor_type: 'ARTICLE', anchor_label: 'Article 7', page_from: 7, page_to: 7, text: ART7 },
  { id: 108, ordinal: 9, anchor_type: 'ARTICLE', anchor_label: 'Article 8', page_from: 7, page_to: 8, text: ART8 },
];
const firstPagesText = '02006R0561 — EN — 31.12.2024 — 010.001 — 1 REGULATION (EC) No 561/2006 OF THE EUROPEAN PARLIAMENT AND OF THE COUNCIL of 15 March 2006 on the harmonisation of certain social legislation relating to road transport';
const passing = { passed: true, problems: {}, facts: { sourceCheckedUrl: 'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32006R0561' } };

const extractionAnswer = {
  provisions: [
    { ordinal: 8, no_normative_content: false, claims: [{ kind: 'LIMIT', statement: 'After 4.5 hours of driving a break of at least 45 minutes is required.', values: [{ quantity: 4.5, unit: 'h' }, { quantity: 45, unit: 'min' }], quote: 'a driver shall take an uninterrupted break of not less than 45 minutes' }] },
    { ordinal: 9, no_normative_content: false, claims: [{ kind: 'LIMIT', statement: 'A daily rest period of at least 11 hours is required.', values: [{ quantity: 11, unit: 'h' }], quote: 'a new daily rest period of at least 11 hours' }] },
  ],
};
const verificationAnswer = {
  verdicts: [
    { claim_id: 1, verdict: 'SUPPORTED', quote: 'After a driving period of four and a half hours a driver shall take an uninterrupted break of not less than 45 minutes', values: [{ quantity: 4.5, unit: 'h' }, { quantity: 45, unit: 'min' }], reason: 'stated' },
    { claim_id: 2, verdict: 'SUPPORTED', quote: 'a new daily rest period of at least 11 hours', values: [{ quantity: 11, unit: 'h' }], reason: 'stated' },
  ],
};
const blindAnswer = { act_type: 'EU_REGULATION', territory: 'EU_MEMBER_STATES', consolidation_date: '2024-12-31', quote: 'REGULATION (EC) No 561/2006 OF THE EUROPEAN PARLIAMENT' };
const questionsAnswer = {
  questions: [
    { claim_id: 1, question: 'When must I take a break while driving?', terms: ['break', 'four and a half hours'], ask_topic: 'other' },
    { claim_id: 2, question: 'How long must my daily rest be?', terms: ['daily rest period'], ask_topic: 'other' },
  ],
};

type Script = Partial<Record<'dajc_kb_extraction' | 'dajc_kb_verification' | 'dajc_kb_blind' | 'dajc_kb_questions', any>>;
function provider(id: string, vendor: string, script: Script, calls: string[] = []) {
  return {
    id, vendor, configured: true, priceFor: () => ({ input: 1, output: 1 }),
    async json(request: any) {
      calls.push(`${id}:${request.schemaName}`);
      const answer = script[request.schemaName as keyof Script];
      if (answer instanceof Error) throw answer;
      return { json: typeof answer === 'function' ? answer(request) : answer, usage: { inputTokens: 1000, outputTokens: 200 }, model: `${id}-served`, requestedModel: `${id}-model` };
    },
  };
}
const A = (over: Script = {}, calls?: string[]) => provider('openai', 'OpenAI', { dajc_kb_extraction: extractionAnswer, dajc_kb_blind: blindAnswer, dajc_kb_questions: questionsAnswer, ...over }, calls);
const B = (over: Script = {}, calls?: string[]) => provider('anthropic', 'Anthropic', { dajc_kb_verification: verificationAnswer, dajc_kb_blind: blindAnswer, ...over }, calls);

/** Production-like search: finds the asked provision in force, in an applicable country. */
function search({ answerForeign = false, find = true } = {}) {
  return async (input: any) => {
    if (!find) return [];
    if (input.onDate < '2024-12-31') return [];
    if (input.countries.includes('UK') && !answerForeign) return [];
    const text = input.question.toLowerCase();
    const p = text.includes('break') ? provisions[1] : provisions[2];
    return [{ id: String(p.id), url: `${version.official_url}#page=${p.page_from}`, citation: `${version.version_label} · ${p.anchor_label} · p. ${p.page_from}` }];
  };
}

const run = (over: Record<string, any> = {}) => verifyVersionWithAi({
  version, provisions, firstPagesText, deterministic: passing, extractor: A(), verifier: B(), budget: new Budget(5), search: search(),
  onDate: '2026-11-09', modelSources: 4, contentDigest: 'c'.repeat(64), sleep: async () => undefined, ...over,
});

describe('evidence helpers', () => {
  it('locates quotes despite spacing, hyphenation, case and amendment markers, and returns the exact stored passage', () => {
    const body = 'Within each period of 24 hours a driver shall have taken a new daily ▼M1 rest period of at least 11 hours. The elec tronic record';
    expect(locateQuote(body, 'A NEW DAILY rest  period of at least 11 hours')).toBe('a new daily ▼M1 rest period of at least 11 hours');
    expect(locateQuote(body, 'the electronic record')).toBe('The elec tronic record');
    expect(locateQuote(body, 'a weekly rest period of 45 hours')).toBeNull();
    expect(locateQuote(body, 'short')).toBeNull();
  });

  it('reads printed quantities and compares readings', () => {
    expect(numbersIn('4,5 hours and 45 minutes, 40 000 kg or 3.5 t')).toEqual(expect.arrayContaining([4.5, 45, 40000, 3.5]));
    expect(quantitiesInQuote([{ quantity: 45, unit: 'min' }], 'a break of not less than 45 minutes')).toEqual({ checked: true, missing: [] });
    expect(quantitiesInQuote([{ quantity: 30, unit: 'min' }], 'a break of not less than 45 minutes')).toEqual({ checked: true, missing: [30] });
    expect(quantitiesInQuote([{ quantity: 4.5, unit: 'h' }], 'Po čtyřech a půl hodinách řízení').checked).toBe(false);
    expect(sameQuantities([{ quantity: 45, unit: 'min' }, { quantity: 4.5, unit: 'h' }], [{ quantity: 4.5, unit: 'h' }, { quantity: 45, unit: 'min' }])).toBe(true);
    expect(sameQuantities([{ quantity: 45, unit: 'min' }], [{ quantity: 30, unit: 'min' }])).toBe(false);
  });

  it('never splits a provision and picks a jurisdiction where EU law does not apply', () => {
    const big = Array.from({ length: 5 }, (_, i) => ({ ...provisions[1], ordinal: i, text: 'x'.repeat(20_000) }));
    const chunks = chunkProvisions(big, 36_000);
    expect(chunks.flat()).toHaveLength(5);
    expect(chunks.every((c) => c.length >= 1)).toBe(true);
    expect(foreignJurisdiction('EU', 'EU_REGULATION')).toBe('UK');
    expect(foreignJurisdiction('CZ', 'NATIONAL_ACT')).toBe('UK');
  });
});

describe('AI verification decisions', () => {
  it('passes only when every layer passes, with exact evidence, models and cost recorded', async () => {
    const result = await run();
    expect(result.outcome).toBe('PASS');
    expect(Object.values(result.layers).map((l: any) => l.status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
    expect(result.claims).toHaveLength(2);
    for (const c of result.claims) {
      const text = provisions.find((p) => p.id === c.provisionId)!.text;
      expect(text.includes(c.quote)).toBe(true);
      expect(text.includes(c.verifierQuote)).toBe(true);
      expect(c.verdict).toBe('SUPPORTED');
    }
    expect(result).toMatchObject({ extractionProvider: 'openai', extractionModel: 'openai-served', verificationProvider: 'anthropic', verificationModel: 'anthropic-served' });
    expect(result.usage.length).toBeGreaterThanOrEqual(5);
    expect(result.costUsd).toBeGreaterThan(0);
    expect((result.layers.applicability as any).tests.map((t: any) => t.position)).toEqual([1, 1]);
  });

  it('makes no AI call when the deterministic layer fails, or when both models are from one vendor', async () => {
    const calls: string[] = [];
    const failed = await run({ deterministic: { passed: false, problems: { validity: ['EUR-Lex lists a newer consolidation'] }, facts: {} }, extractor: A({}, calls), verifier: B({}, calls) });
    expect(failed.outcome).toBe('FAIL');
    const sameVendor = await run({ extractor: A({}, calls), verifier: provider('openai', 'OpenAI', { dajc_kb_verification: verificationAnswer }, calls) });
    expect(sameVendor.outcome).toBe('ERROR');
    expect(calls).toEqual([]);
  });

  it('treats a contradiction or different quantities as a conflict, never as a vote', async () => {
    const contradicted = await run({ verifier: B({ dajc_kb_verification: { verdicts: [{ ...verificationAnswer.verdicts[0], verdict: 'CONTRADICTED' }, verificationAnswer.verdicts[1]] } }) });
    expect(contradicted.outcome).toBe('CONFLICT');
    const otherNumber = await run({ verifier: B({ dajc_kb_verification: { verdicts: [{ ...verificationAnswer.verdicts[0], values: [{ quantity: 4.5, unit: 'h' }, { quantity: 30, unit: 'min' }] }, verificationAnswer.verdicts[1]] } }) });
    expect(otherNumber.outcome).toBe('CONFLICT');
    expect(otherNumber.layers.conflicts.problems[0]).toMatch(/quantities differ/);
    const wrongType = await run({ verifier: B({ dajc_kb_blind: { ...blindAnswer, act_type: 'EU_DIRECTIVE' } }) });
    expect(wrongType.outcome).toBe('CONFLICT');
    const wrongDate = await run({ extractor: A({ dajc_kb_blind: { ...blindAnswer, consolidation_date: '2020-08-20' } }) });
    expect(wrongDate.outcome).toBe('CONFLICT');
  });

  it('fails on invented quotes, missing provisions, unsupported claims and verdicts without evidence', async () => {
    const invented = await run({ extractor: A({ dajc_kb_extraction: { provisions: [{ ...extractionAnswer.provisions[0], claims: [{ ...extractionAnswer.provisions[0].claims[0], quote: 'a driver may drive for ten hours without a break' }] }, extractionAnswer.provisions[1]] } }) });
    expect(invented.outcome).toBe('FAIL');
    expect(invented.layers.extraction.problems.join(' ')).toMatch(/not found verbatim/);
    const missing = await run({ extractor: A({ dajc_kb_extraction: { provisions: [extractionAnswer.provisions[0]] } }) });
    expect(missing.outcome).toBe('FAIL');
    const unsupported = await run({ verifier: B({ dajc_kb_verification: { verdicts: [verificationAnswer.verdicts[0], { ...verificationAnswer.verdicts[1], verdict: 'NOT_SUPPORTED' }] } }) });
    expect(unsupported.outcome).toBe('FAIL');
    const noEvidence = await run({ verifier: B({ dajc_kb_verification: { verdicts: [verificationAnswer.verdicts[0], { ...verificationAnswer.verdicts[1], quote: 'a weekly rest period of 45 hours' }] } }) });
    expect(noEvidence.outcome).toBe('FAIL');
    expect(noEvidence.claims.find((c: any) => c.provisionId === 108).verdict).toBe('NOT_SUPPORTED');
    // A wrong number from the extraction meets the verifier's own reading: a conflict, kept out.
    const wrongNumber = await run({ extractor: A({ dajc_kb_extraction: { provisions: [{ ...extractionAnswer.provisions[0], claims: [{ ...extractionAnswer.provisions[0].claims[0], values: [{ quantity: 30, unit: 'min' }] }] }, extractionAnswer.provisions[1]] } }) });
    expect(wrongNumber.outcome).toBe('CONFLICT');
  });

  it('fails when the production search cannot use the version correctly', async () => {
    expect((await run({ search: search({ find: false }) })).outcome).toBe('FAIL');
    const foreign = await run({ search: search({ answerForeign: true }) });
    expect(foreign.outcome).toBe('FAIL');
    expect(foreign.layers.applicability.problems[0]).toMatch(/answered for UK/);
  });

  it('records infrastructure trouble as ERROR (no decision) and unusable answers as FAIL', async () => {
    const { ProviderError } = await import('../../ai/providers.mjs');
    expect((await run({ budget: new Budget(0.0001) })).outcome).toBe('ERROR');
    expect((await run({ verifier: B({ dajc_kb_verification: new ProviderError('anthropic', 'CREDIT_OR_BILLING') }) })).outcome).toBe('ERROR');
    expect((await run({ verifier: B({ dajc_kb_verification: new ProviderError('anthropic', 'REFUSAL') }) })).outcome).toBe('FAIL');
    const unconfigured = await run({ verifier: { ...B(), configured: false } });
    expect(unconfigured.outcome).toBe('ERROR');
  });
});
