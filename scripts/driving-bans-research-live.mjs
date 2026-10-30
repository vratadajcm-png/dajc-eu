/**
 * Live checks of the Driving Bans research integration against the real provider APIs
 * and a real primary source. Small and capped: no repeat of the 286-request bake-off.
 * Every result says which steps used a real API and which were deterministic. Never
 * promotes, approves, merges or writes canonical.json (checked before and after).
 *
 *   node scripts/driving-bans-research-live.mjs plan                 (free: configuration and budget)
 *   node scripts/driving-bans-research-live.mjs smoke|scenario|fallback|e2e|all [--out DIR]
 *   node scripts/driving-bans-research-live.mjs smoke,fallback [--out DIR]   (several checks, one run)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { officialAuthorityDomains } from '../config/official-authority-domains.mjs';
import { getDrivingBansSnapshot, canonicalDrivingBans } from '../config/driving-ban-calendars/runtime.mjs';
import { publicationWindow } from '../src/lib/driving-bans/core.mjs';
import { createProviders, PROVIDER_CATALOG } from '../src/lib/ai/providers.mjs';
import { createLedger, createOrchestrator, limitsFromEnv, routesFromEnv } from '../src/lib/ai/orchestrator.mjs';
import { researchEnvironment, researchReadiness } from '../src/lib/driving-bans/research/config.mjs';
import { researchTarget } from '../src/lib/driving-bans/research/discovery.mjs';
import { documentText } from '../src/lib/driving-bans/research/documents.mjs';
import { checkExtractedRule, extractRules } from '../src/lib/driving-bans/research/extraction.mjs';
import { openResearchStore, runResearch } from '../src/lib/driving-bans/research/pipeline.mjs';
import { safeFetch } from '../src/lib/driving-bans/research/safe-fetch.mjs';

/** Targets of the live checks: the bake-off reference case cz-sun, and a real AT route order missing from the registry. */
export const LIVE_TARGETS = Object.freeze({
  scenario: { case_id: 'cz-sun', jurisdiction: 'CZ', url: 'https://www.zakonyprolidi.cz/cs/2000-361', section: { from: /§\s*43\s*\n\s*Omezení jízdy/, to: /\n§\s*44\b/ }, registry_rule: 'cz-sunday' },
  e2e: {
    jurisdiction: 'AT', title: 'B 179 Fernpass-Straße, Fahrverbot für Lastkraftfahrzeuge (LGBl. Nr. 95/2009, Tirol)',
    official_search: 'https://data.bka.gv.at/ris/api/v2.6/Landesrecht?Applikation=LrKons&Bundesland_SucheInTirol=true&Titel=Fernpass',
    leads: ['https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrT&Gesetzesnummer=20000096'],
    search_queries: ['B 179 Fernpass Fahrverbot Lastkraftfahrzeuge Verordnung Landesregierung Tirol'], search_domains: ['ris.bka.gv.at', 'tirol.gv.at'],
  },
});
/** Reference prices (USD) and token sizes used for the pre-approval estimate; real costs come from reported usage. */
// Output sizes match the request limits (adaptive thinking counts towards them on Claude).
export const ESTIMATE = Object.freeze({ smoke: { input: 400, output: 2_048 }, scenario: { input: 4_000, output: 12_000 }, fallback: { input: 400, output: 2_048 }, e2e_extraction: { input: 3_500, output: 12_000 }, e2e_check: { input: 5_000, output: 8_000 }, search_request: 0.005 });

const E2E_DOCUMENTS = 2;
const SMOKE_SCHEMA = { type: 'object', additionalProperties: false, required: ['ok', 'echo'], properties: { ok: { type: 'boolean' }, echo: { type: 'string' } } };
const sha = value => createHash('sha256').update(value).digest('hex');

/** The extractor and the independent checker the routes would pick (another vendor). */
function e2eProviders(env, json) {
  const routes = routesFromEnv(env);
  const extractor = routes.extract.map(id => json.find(p => p.id === id)).find(Boolean);
  const checker = extractor && routes.verify.map(id => json.find(p => p.id === id)).find(p => p && p.vendor !== extractor.vendor);
  return [extractor, checker].filter(Boolean);
}

/** Cost estimate per check from configured prices; null where a provider has no price. */
export function estimateBudget(env) {
  const providers = createProviders({ env, fetchFn: async () => { throw new Error('offline'); } });
  const json = Object.values(providers).filter(p => p.configured && p.id !== 'perplexity');
  const cost = (p, size, task = null, complex = false) => { const price = p.priceFor(task, complex); return price ? (size.input * price.input + size.output * price.output) / 1e6 : null; };
  const rows = {
    smoke: json.map(p => ({ provider: p.id, model: p.modelFor(null), usd: cost(p, ESTIMATE.smoke) })),
    scenario: json.map(p => ({ provider: p.id, model: p.modelFor('extract'), usd: cost(p, ESTIMATE.scenario, 'extract') })),
    fallback: json.slice(1, 2).map(p => ({ provider: p.id, model: p.modelFor('extract'), usd: cost(p, ESTIMATE.fallback, 'extract') })),
    // Up to two documents (consolidated page, the order assembled from its RIS parts), each extracted, extracted again by another vendor and checked.
    e2e: e2eProviders(env, json).map((p, index) => ({ provider: p.id, model: p.modelFor(index ? 'verify' : 'extract'), usd: E2E_DOCUMENTS * (index ? cost(p, ESTIMATE.e2e_check, 'verify') + cost(p, ESTIMATE.e2e_extraction, 'extract') : cost(p, ESTIMATE.e2e_extraction, 'extract')) })),
    search: providers.perplexity.configured ? [{ provider: 'perplexity', usd: 3 * (providers.perplexity.priceFor()?.request ?? ESTIMATE.search_request) }] : [],
  };
  const total = Object.values(rows).flat().reduce((sum, row) => sum + (row.usd ?? 0), 0);
  return { rows, total_usd_estimate: Math.round(total * 10_000) / 10_000, note: 'Estimate from list prices and generous token sizes (thinking tokens included in output); actual cost is booked from reported usage and capped by DAJC_RESEARCH_RUN_BUDGET_USD.' };
}

function orchestratorFor(env, { routes, ledger, budget, blocked = {} }) {
  const limits = { ...limitsFromEnv(env), runBudgetUsd: budget };
  return createOrchestrator({ providers: createProviders({ env }), routes: { ...routesFromEnv(env), ...routes }, limits, ledger, blocked });
}

// Refusals tied to one model or one request; any other block (credit, key, tier, quota,
// persistent rate limit) holds for the whole run, so later checks never resend to that provider.
const REQUEST_SPECIFIC = new Set(['MODEL_NOT_FOUND', 'INVALID_REQUEST']);
function carryBlocks(context, orchestrator) {
  for (const [id, entry] of Object.entries(orchestrator.breakerState())) if (entry.blocked && !REQUEST_SPECIFIC.has(entry.blocked) && !context.blocked[id]) context.blocked[id] = entry.blocked;
}
const skipped = (provider, context) => ({ provider: provider.id, live_api: false, outcome: 'SKIPPED', blocked_for_run: context.blocked[provider.id], audit: [] });

/** Cut one provision out of a long official text (deterministic); the full document hash stays the evidence. */
export function sectionOf(text, section) {
  const start = text.search(section.from);
  if (start < 0) return null;
  const rest = text.slice(start + 1);
  const end = rest.search(section.to);
  return text.slice(start, end < 0 ? start + 8_000 : start + 1 + end).trim();
}

/** Field-level comparison of an extraction with the verified registry rule of the reference case. */
export function compareWithRegistry(extraction, rule) {
  const candidate = extraction.rules.find(item => item.schedule.kind === rule.schedule.kind && (rule.schedule.weekdays ?? []).every(day => item.schedule.weekdays.includes(day)));
  if (!candidate) return { matched: false, differences: ['no rule with the registry days'] };
  const leaves = weight => weight.any_of || weight.all_of || [weight];
  const expected = leaves(rule.weight_threshold).map(leaf => `${leaf.operator}${leaf.value}${leaf.unit}`).sort();
  const actual = candidate.weight_conditions.map(leaf => `${leaf.operator}${leaf.value}${leaf.unit}`).sort();
  const differences = [];
  if (candidate.schedule.start_time !== rule.schedule.start_time) differences.push(`start ${candidate.schedule.start_time} vs ${rule.schedule.start_time}`);
  if (candidate.schedule.end_time !== rule.schedule.end_time) differences.push(`end ${candidate.schedule.end_time} vs ${rule.schedule.end_time}`);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) differences.push(`weight ${actual.join(',')} vs ${expected.join(',')}`);
  return { matched: differences.length === 0, differences };
}

async function smoke(env, context) {
  const results = [];
  for (const provider of Object.values(createProviders({ env })).filter(p => p.configured)) {
    if (context.blocked[provider.id]) { results.push(skipped(provider, context)); continue; }
    const orchestrator = orchestratorFor(env, { routes: provider.id === 'perplexity' ? { discover: ['perplexity'] } : { extract: [provider.id] }, ledger: context.ledger, budget: context.remaining(), blocked: context.blocked });
    try {
      const result = provider.id === 'perplexity'
        ? await orchestrator.run('discover', { queries: ['Fahrverbot Lastkraftfahrzeuge Verordnung'], domains: ['ris.bka.gv.at'], maxResults: 3 }, { purpose: 'smoke test' })
        : await orchestrator.run('extract', { system: 'Return JSON only, matching the schema.', user: 'Return {"ok": true, "echo": "DAJC"} exactly.', schema: SMOKE_SCHEMA, schemaName: 'dajc_smoke', maxOutputTokens: ESTIMATE.smoke.output }, { purpose: 'smoke test' });
      const parsed = provider.id === 'perplexity' ? Array.isArray(result.results) : result.json?.ok === true && result.json?.echo === 'DAJC';
      results.push({ provider: provider.id, live_api: true, outcome: parsed ? 'OK' : 'UNEXPECTED_OUTPUT', requested_model: result.requested_model ?? null, served_model: result.model ?? null, cost_usd: result.cost_usd, audit: orchestrator.calls() });
    } catch (error) {
      results.push({ provider: provider.id, live_api: true, outcome: 'FAILED', error: error.name, audit: orchestrator.calls() });
    }
    context.spend(orchestrator.spentThisRun());
    carryBlocks(context, orchestrator);
  }
  return { check: 'smoke', results };
}

async function scenario(env, context) {
  const target = LIVE_TARGETS.scenario;
  const hosts = researchTarget(target.jurisdiction, { rawCanonical: context.rawCanonical, authorityDomains: officialAuthorityDomains }).allowedHosts;
  const fetched = await safeFetch(target.url, { allowedHosts: hosts });
  if (!fetched.ok) return { check: 'scenario', case_id: target.case_id, retrieval: { live: true, ok: false, code: fetched.code, http_status: fetched.http_status ?? null }, results: [], blocked: 'Primary source unavailable; no substitute text is used.' };
  const section = sectionOf(documentText(fetched).text, target.section);
  const rule = canonicalDrivingBans.rules.find(item => item.ban_id === target.registry_rule);
  const document = { ...fetched, final_url: fetched.final_url, language: 'cs' };
  const window = { from: context.window.from, to: context.window.to };
  const results = [];
  for (const provider of Object.values(createProviders({ env })).filter(p => p.configured && p.id !== 'perplexity')) {
    if (context.blocked[provider.id]) { results.push(skipped(provider, context)); continue; }
    const orchestrator = orchestratorFor(env, { routes: { extract: [provider.id], extract_complex: [provider.id] }, ledger: context.ledger, budget: context.remaining(), blocked: context.blocked });
    try {
      const extracted = await extractRules({ orchestrator, jurisdiction: target.jurisdiction, window, document, text: section });
      const findings = extracted.ok ? extracted.extraction.rules.flatMap((r, index) => checkExtractedRule(r, { text: section, jurisdiction: target.jurisdiction, window }).map(f => ({ rule_index: index, code: f.code, field: f.field ?? null, blocking_state: f.blocking_state, message: f.message }))) : extracted.issues.map(message => ({ code: 'EXTRACTION_OUTPUT_INVALID', message }));
      // The extracted rules with their quotes stay in the artifact, so a person can see why a check failed.
      results.push({ provider: provider.id, live_api: true, requested_model: orchestrator.calls().at(-1)?.requested_model ?? null, served_model: extracted.model, schema_valid: extracted.ok, rules: extracted.ok ? extracted.extraction.rules.length : 0, registry_comparison: extracted.ok ? compareWithRegistry(extracted.extraction, rule) : null, deterministic_findings: [...new Set(findings.map(f => f.code))], findings, extraction: extracted.ok ? extracted.extraction.rules : null, cost_usd: extracted.cost_usd, audit: orchestrator.calls() });
    } catch (error) {
      results.push({ provider: provider.id, live_api: true, outcome: 'FAILED', error: error.name, audit: orchestrator.calls() });
    }
    context.spend(orchestrator.spentThisRun());
    carryBlocks(context, orchestrator);
  }
  return { check: 'scenario', case_id: target.case_id, retrieval: { live: true, ok: true, url: fetched.final_url, sha256: fetched.sha256, bytes: fetched.byte_length, section_sha256: sha(section), section_chars: section.length }, expected: { registry_rule: rule.ban_id, schedule: rule.schedule, weight_threshold: rule.weight_threshold }, results };
}

async function fallback(env, context) {
  const json = Object.values(createProviders({ env })).filter(p => p.configured && p.id !== 'perplexity' && !context.blocked[p.id]);
  if (json.length < 2) return { check: 'fallback', blocked: 'Needs two configured providers that are not blocked in this run' };
  const [first, second] = json;
  // A real request with a model ID that does not exist: the provider's own refusal drives the failover.
  const invalid = 'dajc-nonexistent-model-check';
  const pricing = JSON.parse(env.DAJC_RESEARCH_PRICING_USD || '{}');
  const testEnv = { ...env, [`${PROVIDER_CATALOG[first.id].modelEnv}_EXTRACT`]: invalid, DAJC_RESEARCH_PRICING_USD: JSON.stringify({ ...pricing, [first.id]: { ...(pricing[first.id] ?? {}), models: { ...(pricing[first.id]?.models ?? {}), [invalid]: { input: 0, output: 0 } } } }) };
  const orchestrator = orchestratorFor(testEnv, { routes: { extract: [first.id, second.id] }, ledger: context.ledger, budget: context.remaining(), blocked: context.blocked });
  const request = { system: 'Return JSON only, matching the schema.', user: 'Return {"ok": true, "echo": "DAJC"} exactly.', schema: SMOKE_SCHEMA, schemaName: 'dajc_smoke', maxOutputTokens: ESTIMATE.fallback.output };
  const outcomes = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const result = await orchestrator.run('extract', request, { purpose: 'fallback check' }); outcomes.push({ served_by: result.provider, model: result.model }); }
    catch (error) { outcomes.push({ error: error.name }); }
  }
  context.spend(orchestrator.spentThisRun());
  carryBlocks(context, orchestrator);
  const calls = orchestrator.calls();
  return { check: 'fallback', live_api: true, first: first.id, second: second.id, outcomes, first_provider_requests: calls.filter(call => call.provider === first.id).length, first_provider_state: orchestrator.breakerState()[first.id], audit: calls };
}

async function e2e(env, context) {
  const target = LIVE_TARGETS.e2e;
  const hosts = researchTarget(target.jurisdiction, { rawCanonical: context.rawCanonical, authorityDomains: officialAuthorityDomains }).allowedHosts;
  // Step 1: discovery through the official RIS OGD search (live, free) and Perplexity Search (live, paid) if configured.
  const official = await safeFetch(target.official_search, { allowedHosts: hosts });
  let officialHits = [];
  if (official.ok) {
    const parsed = JSON.parse(official.bytes.toString('utf8'));
    officialHits = [].concat(parsed?.OgdSearchResult?.OgdDocumentResults?.OgdDocumentReference ?? []).map(ref => ({ id: ref.Data.Metadaten.Technisch.ID, act: ref.Data.Metadaten.Landesrecht?.LrKons?.Gesetzesnummer ?? null, paragraph: ref.Data.Metadaten.Landesrecht?.LrKons?.ArtikelParagraphAnlage, html: [].concat(ref.Data.Dokumentliste.ContentReference).flatMap(c => [].concat(c.Urls.ContentUrl)).find(u => u.DataType === 'Html')?.Url })).filter(hit => hit.html);
  }
  const orchestrator = createOrchestrator({ providers: createProviders({ env }), routes: routesFromEnv(env), limits: { ...limitsFromEnv(env), runBudgetUsd: context.remaining() }, ledger: context.ledger, blocked: context.blocked });
  let searchHits = [];
  try { searchHits = (await orchestrator.run('discover', { queries: target.search_queries, domains: target.search_domains, maxResults: 10 }, { purpose: 'E2E discovery', subject: target.jurisdiction })).results.map(hit => hit.url); }
  catch (error) { searchHits = [`search not run: ${error.name}`]; }
  // RIS publishes the preamble and every paragraph of the order as separate documents (§ 1 the ban, § 2 its
  // exceptions, § 3 its entry into force); they are read as one act, in the published order. The consolidated
  // page is tried first.
  const acts = new Map();
  for (const hit of officialHits) acts.set(hit.act ?? hit.id, [...(acts.get(hit.act ?? hit.id) ?? []), hit.html]);
  const leads = [...target.leads, ...[...acts.values()].map(parts => ({ url: parts[0], parts, title: target.title }))];
  const store = openResearchStore(join(context.out, 'research-store'));
  const report = await runResearch({ jurisdictions: [target.jurisdiction], mode: 'urgent', window: { from: context.window.from, to: context.window.to }, now: new Date(), rawCanonical: context.rawCanonical, snapshot: getDrivingBansSnapshot(new Date()), catalogEntries: [], authorityDomains: officialAuthorityDomains, orchestrator, store, fetchDocument: (url, allowed) => safeFetch(url, { allowedHosts: allowed }), leadUrls: leads, maxDocuments: leads.length, useSearch: false });
  context.spend(orchestrator.spentThisRun());
  carryBlocks(context, orchestrator);
  return {
    check: 'e2e', jurisdiction: target.jurisdiction, document: target.title,
    steps: { discovery: { official_ris_ogd: { live: true, ok: official.ok, hits: officialHits.length, acts: [...acts.entries()].map(([act, parts]) => ({ act, parts })) }, perplexity: { live: !String(searchHits[0] ?? '').startsWith('search not run'), hits: searchHits } }, retrieval: report.source_retrieval, extraction_and_check: report.ai_analysis, independent_check: report.independent_check, deterministic_validation: 'existing review workflow as a dry run (no API)', legal_verification: report.legal_verification },
    drafts: report.drafts, statement: report.statement, report_file: join('research-store', 'runs', `${report.run_id}.json`), audit: orchestrator.calls(),
  };
}

const CHECKS = { smoke, scenario, fallback, e2e };

export async function main(argv = process.argv.slice(2), rawEnv = process.env) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string', default: 'artifacts/driving-bans/research-live' } } });
  const [command] = positionals;
  const env = researchEnvironment(rawEnv);
  const readiness = researchReadiness(rawEnv);
  if (command === 'plan') return { readiness: { enabled: readiness.enabled, blockers: readiness.blockers, providers: readiness.providers.map(({ id, configured, missing }) => ({ id, configured, missing })), routes: readiness.routes, model_profile: readiness.model_profile.selected }, budget: estimateBudget(env), targets: LIVE_TARGETS };
  const names = command === 'all' ? Object.keys(CHECKS) : String(command ?? '').split(',');
  if (!names.length || !names.every(name => Object.hasOwn(CHECKS, name)) || new Set(names).size !== names.length) throw new Error('Usage: driving-bans-research-live.mjs plan|smoke|scenario|fallback|e2e|all|<check,check> [--out DIR]');
  if (!readiness.enabled) return { status: 'DISABLED', blockers: readiness.blockers };
  const canonicalPath = resolve('data/driving-bans/canonical.json');
  const before = readFileSync(canonicalPath, 'utf8');
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  const limits = limitsFromEnv(env);
  let spent = 0;
  const context = { out, rawCanonical: JSON.parse(before), window: publicationWindow(new Date()), ledger: createLedger({ file: join(out, 'ledger.json') }), remaining: () => Math.max(0, limits.runBudgetUsd - spent), spend: usd => { spent += usd; }, blocked: {} };
  const results = [];
  for (const name of names) {
    const result = await CHECKS[name](env, context);
    results.push(result);
    writeFileSync(join(out, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
  }
  const unchanged = readFileSync(canonicalPath, 'utf8') === before;
  const summary = { generated_at: new Date().toISOString(), checks: results.map(r => r.check), total_cost_usd: Math.round(spent * 1e6) / 1e6, run_budget_usd: limits.runBudgetUsd, providers_blocked_for_run: context.blocked, canonical_unchanged: unchanged, promoted: false, note: 'live_api marks calls that reached a provider; retrieval, validation, change detection and proposals are deterministic code.' };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (!unchanged) throw new Error('canonical.json changed during a live check');
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await main(), null, 2));
