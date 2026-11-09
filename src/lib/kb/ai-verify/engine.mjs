// DAJC legal-library AI verification engine (protocol in ./protocol.mjs).
//
// verifyVersionWithAi() takes one stored version, the result of the
// deterministic layer, two provider adapters of DIFFERENT vendors
// (src/lib/ai/providers.mjs), a budget and the production search, and returns
// a run record for dajc_kb.verification_runs with its claims. It never writes;
// ./store.mjs records the run and lets the database decide.
//
// Fail closed: a missing provision, an unlocatable quote, an unsupported claim,
// a refusal or an unusable answer fails the run (FAIL); a material
// disagreement makes it a CONFLICT; an infrastructure problem (provider down,
// no credit, budget exhausted) is an ERROR that changes nothing. Only a run in
// which every layer passed is PASS.

import { applicability, ASK_TOPIC_TO_KB } from '../taxonomy.mjs';
import { actualCost, BudgetExceeded, estimateCost } from './budget.mjs';
import {
  BLIND_SCHEMA, BLIND_SYSTEM, CLAIM_KINDS, documentHeader, EXTRACTION_SCHEMA, EXTRACTION_SYSTEM, LAYERS, LIMITS, PROTOCOL, provisionBlocks,
  QUESTIONS_SCHEMA, QUESTIONS_SYSTEM, UNITS, VERDICTS, VERIFICATION_SCHEMA, VERIFICATION_SYSTEM,
} from './protocol.mjs';
import { locateQuote, quantitiesInQuote, sameQuantities } from './quotes.mjs';

const CITABLE = new Set(['ARTICLE', 'SECTION', 'ANNEX']);
const INFRASTRUCTURE = new Set(['CREDIT_OR_BILLING', 'AUTHENTICATION', 'PERMISSION_OR_TIER', 'MODEL_NOT_FOUND', 'QUOTA_EXHAUSTED', 'NOT_CONFIGURED',
  'RATE_LIMIT', 'OVERLOADED', 'SERVER_ERROR', 'TIMEOUT', 'NETWORK']);
const RETRYABLE = new Set(['RATE_LIMIT', 'OVERLOADED', 'SERVER_ERROR', 'TIMEOUT', 'NETWORK']);

/** Infrastructure trouble: the run says nothing about the document. */
export class RunError extends Error {}

/** Provisions in request-sized groups, never splitting a provision. */
export function chunkProvisions(provisions, maxChars = LIMITS.chunkChars) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const p of provisions) {
    const length = p.text.length + 120;
    if (current.length > 0 && size + length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** The act type implied by the catalogue's legal category. */
function expectedActType(category) {
  return ['EU_REGULATION', 'EU_DIRECTIVE', 'EU_DECISION', 'INTERNATIONAL_AGREEMENT', 'NATIONAL_ACT', 'NATIONAL_REGULATION'].includes(category) ? category : 'OTHER';
}

function territoryFits(territory, jurisdiction) {
  if (jurisdiction === 'EU') return territory === 'EU_MEMBER_STATES' || territory === 'EEA';
  if (jurisdiction === 'INT') return territory === 'INTERNATIONAL_PARTIES';
  return territory === 'ONE_STATE' || territory === 'REGION';
}

const toDay = (value) => (value == null ? null : typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10));

/** A jurisdiction where the version must never answer (for the refusal test). */
export function foreignJurisdiction(jurisdiction, category) {
  const candidates = ['UK', 'CH', 'RS', 'TR', 'CZ', 'DE'];
  return candidates.find((c) => c !== jurisdiction && applicability(c, jurisdiction, category) === 'NOT_APPLICABLE') ?? null;
}

/** A country where the version applies (for the retrieval tests). */
export function applicableCountry(jurisdiction) {
  return jurisdiction === 'EU' ? 'CZ' : jurisdiction;
}

/**
 * @param {{ version: any, provisions: any[], firstPagesText: string, deterministic: { passed: boolean, problems: Record<string, string[]>, facts: any },
 *           extractor: any, verifier: any, budget: import('./budget.mjs').Budget, search: (input: any) => Promise<any[]>,
 *           onDate: string, modelSources: number, startedAt?: Date, sleep?: (ms: number) => Promise<void>, contentDigest: string }} input
 */
export async function verifyVersionWithAi(input) {
  const { version, provisions, deterministic, extractor, verifier, budget, onDate, modelSources } = input;
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const layers = Object.fromEntries(LAYERS.map((l) => [l, { status: 'SKIPPED', problems: [] }]));
  const run = {
    protocol: PROTOCOL, versionId: version.id, versionSha256: version.sha256, contentDigest: input.contentDigest, provisionCount: provisions.length,
    layers, claims: [], usage: [], costUsd: 0, startedAt: (input.startedAt ?? new Date()).toISOString(), sourceCheckedUrl: deterministic.facts?.sourceCheckedUrl ?? null,
    extractionProvider: extractor?.id ?? null, extractionModel: null, verificationProvider: verifier?.id ?? null, verificationModel: null, outcome: 'ERROR', notes: [],
  };
  const finish = (outcome, note) => {
    run.outcome = outcome;
    if (note) run.notes.push(note);
    run.costUsd = Number(run.usage.reduce((sum, u) => sum + u.costUsd, 0).toFixed(6));
    run.notes = run.notes.join('; ').slice(0, 2000) || null;
    return run;
  };

  // Layer 1 - deterministic.
  layers.deterministic = { status: deterministic.passed ? 'PASS' : 'FAIL', problems: Object.entries(deterministic.problems).flatMap(([k, list]) => list.map((p) => `${k}: ${p}`)) };
  if (!deterministic.passed) return finish('FAIL', 'deterministic checks failed; no AI call made');

  // Two configured providers of different vendors, or nothing is decided.
  if (!extractor?.configured || !verifier?.configured) return finish('ERROR', 'extraction or verification provider not configured');
  if (extractor.vendor === verifier.vendor) return finish('ERROR', 'extraction and independent verification must use different vendors');

  const ask = async (provider, layer, task, request) => {
    const price = provider.priceFor(task);
    const estimate = estimateCost(price, { promptChars: request.system.length + request.user.length, maxOutputTokens: request.maxOutputTokens });
    if (estimate == null) throw new RunError(`${provider.id}: no price configured for the ${task} model`);
    for (let attempt = 0; ; attempt++) {
      try {
        budget.admit(estimate);
        const result = await provider.json({ ...request, task });
        const costUsd = actualCost(price, result.usage);
        budget.record({ costUsd });
        run.usage.push({ layer, provider: provider.id, vendor: provider.vendor, model: result.model, requestedModel: result.requestedModel, inputTokens: result.usage?.inputTokens ?? 0, outputTokens: result.usage?.outputTokens ?? 0, costUsd: Number(costUsd.toFixed(6)) });
        return result;
      } catch (error) {
        if (error?.usage) {
          const costUsd = actualCost(price, error.usage);
          budget.record({ costUsd });
          run.usage.push({ layer, provider: provider.id, vendor: provider.vendor, model: request.model ?? null, inputTokens: error.usage.inputTokens ?? 0, outputTokens: error.usage.outputTokens ?? 0, costUsd: Number(costUsd.toFixed(6)), error: error.category });
        }
        if (RETRYABLE.has(error?.category) && attempt < 2) {
          await sleep(error.retryAfterMs ?? (attempt === 0 ? 5_000 : 20_000));
          continue;
        }
        if (error instanceof BudgetExceeded || INFRASTRUCTURE.has(error?.category)) throw new RunError(`${provider.id}: ${error.category ?? error.message}`);
        throw error;
      }
    }
  };

  try {
    const citable = provisions.filter((p) => CITABLE.has(p.anchor_type));
    const byOrdinal = new Map(citable.map((p) => [p.ordinal, p]));
    if (citable.length === 0) return finish('FAIL', 'no citable provision');

    // Layer 2 - extraction by model A, every quote located in the stored text.
    const extraction = { status: 'PASS', problems: [], provisions: citable.length, claims: 0, unlocated: 0, noNormative: 0 };
    layers.extraction = extraction;
    let nextId = 1;
    const claims = [];
    for (const chunk of chunkProvisions(citable)) {
      const user = `${documentHeader(version)}\nProvisions:\n${provisionBlocks(chunk)}`;
      const result = await ask(extractor, 'extraction', 'extract', { system: EXTRACTION_SYSTEM, user, schema: EXTRACTION_SCHEMA, schemaName: 'dajc_kb_extraction', maxOutputTokens: LIMITS.extractionOutputTokens });
      run.extractionModel = result.model || result.requestedModel;
      const returned = new Map((result.json?.provisions || []).map((p) => [p.ordinal, p]));
      for (const p of chunk) {
        const answer = returned.get(p.ordinal);
        if (!answer) {
          extraction.problems.push(`${p.anchor_label}: not returned by the extraction`);
          continue;
        }
        if (answer.no_normative_content && (answer.claims || []).length === 0) extraction.noNormative++;
        for (const c of (answer.claims || []).slice(0, LIMITS.claimsPerProvision)) {
          const exact = locateQuote(p.text, c.quote);
          if (!CLAIM_KINDS.includes(c.kind) || !(c.values || []).every((x) => UNITS.includes(x.unit) && Number.isFinite(Number(x.quantity)))) {
            extraction.problems.push(`${p.anchor_label}: malformed claim`);
            continue;
          }
          if (!exact || exact.length > LIMITS.quoteMax) {
            extraction.unlocated++;
            extraction.problems.push(`${p.anchor_label}: quote not found verbatim in the provision`);
            continue;
          }
          // Quantities may be written in words ("four and a half hours"): one not printed with digits is
          // only noted here; the independent verifier's own reading must match it (layer 4).
          const printed = quantitiesInQuote(c.values, exact);
          if (printed.checked && printed.missing.length > 0) extraction.notPrinted = (extraction.notPrinted || 0) + printed.missing.length;
          claims.push({ id: nextId++, provision: p, kind: c.kind, statement: String(c.statement).slice(0, 1000), values: c.values || [], quote: exact });
        }
      }
      // Anything returned for provisions that were not asked about is ignored but reported.
      for (const ordinal of returned.keys()) if (!chunk.some((p) => p.ordinal === ordinal)) extraction.problems.push(`ordinal ${ordinal} was not requested`);
    }
    extraction.claims = claims.length;
    if (claims.length === 0) extraction.problems.push('no verifiable claim extracted');
    if (extraction.problems.length > 0) extraction.status = 'FAIL';

    // Layer 3 - independent verification by model B, claim by claim, plus blind readings.
    const independent = { status: 'PASS', problems: [], supported: 0, notSupported: 0, contradicted: 0 };
    layers.independent = independent;
    for (const chunk of chunkProvisions(citable)) {
      const chunkClaims = claims.filter((c) => chunk.includes(c.provision));
      if (chunkClaims.length === 0) continue;
      const claimList = chunkClaims.map((c) => JSON.stringify({ claim_id: c.id, provision_ordinal: c.provision.ordinal, kind: c.kind, statement: c.statement, values: c.values, quote: c.quote })).join('\n');
      const user = `${documentHeader(version)}\nProvisions:\n${provisionBlocks(chunk)}\nClaims to verify (one JSON object per line):\n${claimList}`;
      const result = await ask(verifier, 'independent', 'verify', { system: VERIFICATION_SYSTEM, user, schema: VERIFICATION_SCHEMA, schemaName: 'dajc_kb_verification', maxOutputTokens: LIMITS.verificationOutputTokens });
      run.verificationModel = result.model || result.requestedModel;
      const verdicts = new Map();
      for (const v of result.json?.verdicts || []) {
        if (verdicts.has(v.claim_id)) independent.problems.push(`claim ${v.claim_id}: more than one verdict`);
        verdicts.set(v.claim_id, v);
      }
      for (const c of chunkClaims) {
        const v = verdicts.get(c.id);
        let verdict = VERDICTS.includes(v?.verdict) ? v.verdict : 'NOT_SUPPORTED';
        const own = v ? locateQuote(c.provision.text, v.quote) : null;
        if (!v) c.conflict = 'no verdict returned';
        else if (!own) {
          // A verdict without its own evidence in the text proves nothing.
          if (verdict === 'SUPPORTED') verdict = 'NOT_SUPPORTED';
          c.conflict = 'verifier quote not found verbatim';
        }
        c.verdict = verdict;
        c.verifierQuote = own && own.length <= LIMITS.quoteMax ? own : null;
        c.verifierValues = v?.values ?? null;
        c.reason = v?.reason ? String(v.reason).slice(0, 300) : null;
      }
    }
    for (const c of claims) {
      if (!c.verdict) {
        c.verdict = 'NOT_SUPPORTED';
        c.conflict = 'not verified';
      }
      if (c.verdict === 'SUPPORTED') independent.supported++;
      else if (c.verdict === 'CONTRADICTED') independent.contradicted++;
      else independent.notSupported++;
    }
    if (independent.notSupported > 0) independent.problems.push(`${independent.notSupported} claim(s) not supported by the provision text`);
    if (independent.contradicted > 0) independent.problems.push(`${independent.contradicted} claim(s) contradicted by the provision text`);

    const blindUser = `${documentHeader(version)}\nBeginning of the document:\n${input.firstPagesText.slice(0, 8_000)}`;
    const blindA = await ask(extractor, 'extraction', 'extract', { system: BLIND_SYSTEM, user: blindUser, schema: BLIND_SCHEMA, schemaName: 'dajc_kb_blind', maxOutputTokens: LIMITS.blindOutputTokens });
    const blindB = await ask(verifier, 'independent', 'verify', { system: BLIND_SYSTEM, user: blindUser, schema: BLIND_SCHEMA, schemaName: 'dajc_kb_blind', maxOutputTokens: LIMITS.blindOutputTokens });
    const readings = { A: blindA.json, B: blindB.json };
    for (const [who, reading] of Object.entries(readings)) {
      if (!locateQuote(input.firstPagesText, reading?.quote || '')) (who === 'A' ? extraction : independent).problems.push(`blind reading ${who}: quote not found in the document`);
    }
    if (independent.problems.length > 0) independent.status = 'FAIL';
    if (extraction.problems.length > 0) extraction.status = 'FAIL';

    // Layer 4 - conflicts, decided deterministically.
    const conflicts = { status: 'PASS', problems: [] };
    layers.conflicts = conflicts;
    for (const c of claims) {
      if (c.verdict === 'CONTRADICTED') conflicts.problems.push(`${c.provision.anchor_label}: the independent check contradicts "${c.statement.slice(0, 120)}"`);
      if (c.verdict === 'SUPPORTED' && c.verifierValues && !sameQuantities(c.values, c.verifierValues)) {
        c.conflict = 'quantities differ between extraction and verification';
        c.verdict = 'CONTRADICTED';
        independent.supported--;
        independent.contradicted++;
        conflicts.problems.push(`${c.provision.anchor_label}: quantities differ (${JSON.stringify(c.values)} vs ${JSON.stringify(c.verifierValues)})`);
      }
      // A reviewed mass band of the provision must be named by a supported threshold.
      const band = c.provision.mass_min_t ?? c.provision.mass_max_t;
      if (band != null && c.kind === 'THRESHOLD' && c.verdict === 'SUPPORTED' && !c.values.some((x) => x.unit === 't' && Number(x.quantity) === Number(band))) {
        conflicts.problems.push(`${c.provision.anchor_label}: threshold differs from the stored mass band ${band} t`);
      }
    }
    const expectedType = expectedActType(version.legal_category);
    for (const [who, reading] of Object.entries(readings)) {
      if (reading?.act_type !== expectedType) conflicts.problems.push(`blind reading ${who}: act type ${reading?.act_type}, catalogue ${expectedType}`);
      if (!territoryFits(reading?.territory, version.jurisdiction)) conflicts.problems.push(`blind reading ${who}: territory ${reading?.territory} does not fit jurisdiction ${version.jurisdiction}`);
      if (version.authenticity === 'CONSOLIDATED_DOCUMENTATION' && reading?.consolidation_date !== toDay(version.effective_from)) {
        conflicts.problems.push(`blind reading ${who}: consolidation date ${reading?.consolidation_date || 'none'}, catalogue ${toDay(version.effective_from)}`);
      }
    }
    if (conflicts.problems.length > 0) conflicts.status = 'FAIL';
    if (independent.problems.length > 0 || independent.contradicted > 0) independent.status = 'FAIL';

    // Layer 5 - applicability through the production search.
    const applicable = { status: 'PASS', problems: [], tests: [] };
    layers.applicability = applicable;
    const supported = claims.filter((c) => c.verdict === 'SUPPORTED');
    const picked = [];
    for (const c of [...supported].sort((a, b) => (b.values.length > 0) - (a.values.length > 0))) {
      if (picked.length >= LIMITS.generatedQuestions) break;
      if (!picked.some((p) => p.provision === c.provision)) picked.push(c);
    }
    if (picked.length === 0) applicable.problems.push('no supported claim to test');
    else {
      const user = `Language of the questions: ${version.language}.\nClaims:\n${picked.map((c) => JSON.stringify({ claim_id: c.id, statement: c.statement, quote: c.quote })).join('\n')}`;
      const result = await ask(extractor, 'applicability', 'extract', { system: QUESTIONS_SYSTEM, user, schema: QUESTIONS_SCHEMA, schemaName: 'dajc_kb_questions', maxOutputTokens: LIMITS.questionsOutputTokens });
      const country = applicableCountry(version.jurisdiction);
      const anyChecked = ['AUTO_CHECKED', 'AI_VERIFIED', 'HUMAN_VERIFIED'];
      const ownHits = (hits) => hits.filter((h) => h.url.startsWith(`${version.official_url}#`));
      for (const c of picked) {
        const q = (result.json?.questions || []).find((x) => x.claim_id === c.id);
        if (!q || !ASK_TOPIC_TO_KB[q.ask_topic] || !(q.terms || []).length || String(q.question).length < 8) {
          applicable.problems.push(`${c.provision.anchor_label}: no usable test question generated`);
          continue;
        }
        const base = { terms: [...q.terms, q.question], question: q.question, languages: [version.language], topics: ASK_TOPIC_TO_KB[q.ask_topic], allowedProvenance: anyChecked, limit: modelSources * 2 };
        const hits = await input.search({ ...base, countries: [country], onDate });
        const position = hits.findIndex((h) => String(h.id) === String(c.provision.id));
        const test = { claimId: c.id, question: q.question, provision: c.provision.anchor_label, position: position < 0 ? null : position + 1 };
        if (position < 0 || position >= modelSources) applicable.problems.push(`${c.provision.anchor_label}: question "${q.question.slice(0, 80)}" ${position < 0 ? 'did not find' : `found only at position ${position + 1} of`} its provision`);
        else {
          const hit = hits[position];
          if (hit.url !== `${version.official_url}#page=${c.provision.page_from}` || !hit.citation.includes(c.provision.anchor_label)) applicable.problems.push(`${c.provision.anchor_label}: incomplete citation`);
        }
        // Never for a day before the version applied, never where it does not apply.
        const from = toDay(version.effective_from);
        if (from) {
          const before = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
          if (ownHits(await input.search({ ...base, countries: [country], onDate: before })).length > 0) applicable.problems.push(`${c.provision.anchor_label}: answered for ${before}, before the version applied`);
        }
        const foreign = foreignJurisdiction(version.jurisdiction, version.legal_category);
        if (foreign && ownHits(await input.search({ ...base, countries: [foreign], onDate })).length > 0) applicable.problems.push(`${c.provision.anchor_label}: answered for ${foreign}, where it does not apply`);
        applicable.tests.push(test);
      }
    }
    if (applicable.problems.length > 0) applicable.status = 'FAIL';

    run.claims = claims.map((c) => ({
      provisionId: c.provision.id, kind: c.kind, statement: c.statement, values: c.values, quote: c.quote, verdict: c.verdict,
      verifierQuote: c.verdict === 'SUPPORTED' ? c.verifierQuote : c.verifierQuote ?? null, verifierValues: c.verifierValues, conflict: c.conflict ?? c.reason ?? null,
    }));
    for (const l of LAYERS) layers[l].problems = layers[l].problems.slice(0, 50);
    if (conflicts.status === 'FAIL') return finish('CONFLICT', 'material disagreement; kept out of the verified set');
    if (LAYERS.every((l) => layers[l].status === 'PASS')) return finish('PASS');
    return finish('FAIL', 'at least one layer failed');
  } catch (error) {
    if (error instanceof RunError) return finish('ERROR', error.message);
    // An unusable model answer (refusal, invalid or incomplete JSON) fails the run.
    return finish('FAIL', `${error?.category ?? 'error'}: ${String(error?.message || error).slice(0, 200)}`);
  }
}
