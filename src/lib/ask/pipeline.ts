// The question flow of §47.2 for one question:
//   (1) classification (country, topic, dimensions, date)
//   (2) DAJC's own verified data
//   (3) when own data are missing or stale: search restricted to official
//       domains (Perplexity, filtered by scripts/lib/source-policy.mjs)
//   (4) fetching and reading the sources
//   (5) a draft built only from those sources (OpenAI)
//   (6) checks: deterministic (guard.ts) and an independent model of another
//       provider (Anthropic) confirming each source contains its statement
//   (7) output VERIFIED / PARTIAL / UNKNOWN with sources and check dates
//   (8) new official URLs go to a human review queue, never into data/.
//
// Driving bans (Driving Bans 2.0): confirmed facts come only from the published
// registry through the shared contract (own-data.ts). The answer is VERIFIED
// only when every asked country is verified in full and decided on every asked
// day. Any country the registry does not fully decide makes the whole answer
// INSUFFICIENT_VERIFIED_DATA ("Nedostatek ověřených dat"); verified facts found
// for it are still shown as such. Official pages found for an undecided country
// are shown only as unverified leads, never raise the answer to VERIFIED, and
// go to the review queue, from which they enter the Driving Bans review layer
// (scripts/driving-bans-web-leads.mjs). Other topics keep their own trust
// rules for official websites.
//
// Strict rule (owner decision): if the independent check disagrees on ANY
// statement, the whole answer is UNKNOWN. Provider failures and timeouts
// are thrown as system errors; the service layer refunds the question.

import { isTrackedJurisdiction } from '../../../config/europe-coverage.mjs';
import { officialDomainsFor } from '../../../scripts/lib/source-policy.mjs';
import { isValidIsoDate } from '../../../scripts/lib/date-validation.mjs';
import type { AskConfig } from './config';
import type { CostMeter } from './cost';
import { renderDrivingBanFacts, type FactRow } from './facts';
import { checkClaims, normalizeForMatch, type DraftClaim, type GuardSource } from './guard';
import { t, type UiKey, type UiLang } from './i18n';
import { detectLanguage } from './language';
import { defaultFetchPage, fetchOfficialPage, isAllowedSourceUrl, normalizeSourceUrl, type FetchPage, type OfficialPage } from './official-sources';
import {
  findingLeads, isoDay, knownSourceUrls, lookupDrivingBans, publishedView,
  type DrivingBansView, type FindingLike, type JurisdictionVerification, type OwnRecord, type Topic,
} from './own-data';
import {
  CLASSIFICATION_SCHEMA, DRAFT_SCHEMA, MAX_STATEMENTS, TOPICS, VERIFY_SCHEMA,
  classificationPrompt, draftPrompt, verifyPrompt,
  type Classification, type DraftOutput, type PromptSource, type VerifyItem, type VerifyOutput,
} from './prompts';
import type { Providers } from './providers';
import { selectPassages } from './text';

export type Level = 'VERIFIED' | 'PARTIAL' | 'UNKNOWN' | 'INSUFFICIENT_VERIFIED_DATA';
/** dajc_verified: the published registry; official_web: other topics; unverified_official_lead: a driving-ban page outside the registry. */
export type StatementBasis = 'dajc_verified' | 'official_web' | 'unverified_official_lead';
export type UnknownReason = 'out_of_scope' | 'need_country' | 'no_sources' | 'no_claims' | 'not_supported';
export type AnswerPath = 'own' | 'web' | 'mixed' | 'none';

export interface AskAnswer {
  level: Level;
  language: string;
  reason: UnknownReason | null;
  statements: Array<{ text: string; sourceId: string; basis: StatementBasis }>;
  facts: Array<{ sourceId: string; rows: FactRow[] }>;
  sources: Array<{ id: string; kind: 'own' | 'web'; url: string; title: string; checkedAt: string; publishedAt: string | null; verification: 'DAJC_VERIFIED' | 'OFFICIAL_WEB' | 'UNVERIFIED_LEAD' }>;
  authorities: Array<{ url: string }>;
  notices: string[];
  /** Driving bans only: registry verification of every asked country (outcome, completeness, period, last verification). */
  verification: JurisdictionVerification[];
  ui: {
    levelLabel: string;
    levelHelp: string;
    reasonText: string | null;
    aiNotice: string;
    sourcesLabel: string;
    checkedOn: string;
    publishedOn: string;
    authoritiesLabel: string;
    supportText: string;
    supportLink: string;
    verificationLabel: string;
    outcomeLabels: Record<JurisdictionVerification['outcome'], string>;
    periodLabel: string;
    lastVerifiedLabel: string;
    unverifiedLabel: string;
    coverageIncompleteLabel: string;
    nextStepLabel: string;
    /** Driving bans only: the next check, from the contract's outcome; never an authorisation. */
    nextStep: string | null;
  };
}

export interface ReviewUrl {
  url: string;
  jurisdiction: string | null;
  topic: Topic;
}

export interface PipelineResult {
  answer: AskAnswer;
  path: AnswerPath;
  reviewUrls: ReviewUrl[];
}

export interface PipelineDeps {
  config: Pick<AskConfig, 'classifierModel' | 'answerModel' | 'verifierModel'>;
  providers: Providers;
  meter: CostMeter;
  fetchPage?: FetchPage;
  now?: Date;
  /** Published Driving Bans snapshot; defaults to getDrivingBansSnapshot(now). */
  view?: DrivingBansView;
  findings?: FindingLike[];
  deadlineMs?: number;
}

export class AskTimeoutError extends Error {
  constructor() {
    super('question deadline exceeded');
    this.name = 'AskTimeoutError';
  }
}

export const LIMITS = {
  questionChars: 1000,
  jurisdictions: 3,
  dates: 5,
  searchTerms: 4,
  searchResults: 8,
  fetchedPages: 4,
  sourceChars: 9000,
  ownRecords: 12,
  verifyExcerptChars: 1600,
  ownRecordChars: 3000,
  classifierOutputTokens: 2000,
  answerOutputTokens: 6000,
  verifierOutputTokens: 8000,
  deadlineMs: 50_000,
};

// Upper bounds of prompt sizes, for the up-front cost reservation.
export const WORST_CASE_PROMPT_CHARS = {
  classifier: 8_000,
  answer: 8_000 + LIMITS.fetchedPages * (LIMITS.sourceChars + 600) + LIMITS.ownRecords * (LIMITS.ownRecordChars + 300),
  verifier: 4_000 + MAX_STATEMENTS * (1_400 + Math.max(LIMITS.verifyExcerptChars, LIMITS.ownRecordChars) + 200),
};

const TOPIC_TERMS: Record<Topic, string> = {
  driving_ban: 'HGV driving ban',
  oversize_permit: 'abnormal load permit',
  dimensions_weights: 'maximum vehicle weight dimensions',
  escort: 'abnormal load escort',
  road_restriction: 'HGV road restriction',
  toll: 'HGV toll',
  other: 'road freight rules',
};

/** E-mail addresses and phone numbers never leave DAJC (GDPR minimisation). */
export function redactPersonalData(text: string): string {
  return text
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '[e-mail]')
    .replace(/\+\d[\d\s/-]{7,}\d/g, '[phone]');
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function normalizeClassification(raw: Partial<Classification> | null | undefined, question: string, today: string): Classification {
  const detected = detectLanguage(question);
  const claimed = typeof raw?.language === 'string' && /^[a-z]{2}$/.test(raw.language.trim().toLowerCase()) ? raw.language.trim().toLowerCase() : null;
  const jurisdictions = [...new Set((Array.isArray(raw?.jurisdictions) ? raw!.jurisdictions : []).map((c) => String(c).trim().toUpperCase()))]
    .filter((code) => isTrackedJurisdiction(code))
    .slice(0, LIMITS.jurisdictions);
  const dates = [...new Set((Array.isArray(raw?.dates) ? raw!.dates : []).map(String))]
    .filter((d) => isValidIsoDate(d) && d >= shiftDay(today, -370) && d <= shiftDay(today, 370))
    .slice(0, LIMITS.dates);
  const searchTerms = (Array.isArray(raw?.search_terms) ? raw!.search_terms : [])
    .map((term) => redactPersonalData(String(term)).replace(/[<>"]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((term) => term.length >= 2 && term.length <= 100)
    .slice(0, LIMITS.searchTerms);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1000 ? v : null);
  return {
    language: detected || claimed || 'en',
    in_scope: raw?.in_scope === true,
    case_assessment: raw?.case_assessment === true,
    jurisdictions,
    topic: TOPICS.includes(raw?.topic as Topic) ? (raw!.topic as Topic) : 'other',
    dates,
    vehicle: {
      weight_t: num(raw?.vehicle?.weight_t),
      width_m: num(raw?.vehicle?.width_m),
      height_m: num(raw?.vehicle?.height_m),
      length_m: num(raw?.vehicle?.length_m),
    },
    search_terms: searchTerms,
  };
}

function remaining(deadline: number): number {
  const ms = deadline - Date.now();
  if (ms <= 0) throw new AskTimeoutError();
  return ms;
}

async function withDeadline<T>(promise: Promise<T>, deadline: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The asked jurisdiction whose official domains host this URL, if exactly determinable. */
function jurisdictionOfUrl(url: string, jurisdictions: string[]): string | null {
  const host = hostOf(url);
  const matches = jurisdictions.filter((code) => (officialDomainsFor([code], 40) as string[]).some((d) => host === d || host.endsWith(`.${d}`)));
  if (matches.length === 1) return matches[0];
  return jurisdictions.length === 1 ? jurisdictions[0] : null;
}

/** Source excerpt around the quote, for the independent check. */
export function excerptAround(text: string, quote: string, maxChars = LIMITS.verifyExcerptChars): string {
  const collapsed = text.replace(/\s+/g, ' ');
  const index = collapsed.toLowerCase().indexOf(quote.replace(/\s+/g, ' ').trim().toLowerCase());
  if (index < 0) return selectPassages(collapsed, [quote], maxChars, Math.floor(maxChars / 2));
  const pad = Math.max(0, Math.floor((maxChars - quote.length) / 2));
  return collapsed.slice(Math.max(0, index - pad), index + quote.length + pad);
}

function emptyAnswer(language: string, uiLang: UiLang, reason: UnknownReason, authorities: string[], notices: string[], level: Level = 'UNKNOWN', verification: JurisdictionVerification[] = []): AskAnswer {
  return buildAnswer({ level, language, uiLang, reason, statements: [], facts: [], sources: [], authorities, notices, verification });
}

/** The recommended next check for a driving-ban answer, following the shared contract's next_step. */
function nextStepKey(level: Level, verification: JurisdictionVerification[]): UiKey | null {
  if (verification.length === 0) return null;
  if (level !== 'VERIFIED' && level !== 'PARTIAL') return 'nextStep.CHECK_AUTHORITY';
  return verification.some((v) => v.authorityCheckRequired) ? 'nextStep.CONFIRM_SOURCE' : 'nextStep.RECHECK';
}

function buildAnswer({ level, language, uiLang, reason, statements, facts, sources, authorities, notices, verification = [] }: {
  level: Level; language: string; uiLang: UiLang; reason: UnknownReason | null;
  statements: AskAnswer['statements']; facts: AskAnswer['facts']; sources: AskAnswer['sources'];
  authorities: string[]; notices: string[]; verification?: JurisdictionVerification[];
}): AskAnswer {
  const unverified = statements.some((statement) => statement.basis === 'unverified_official_lead');
  const nextStep = nextStepKey(level, verification);
  return {
    level,
    language,
    reason,
    statements,
    facts,
    sources,
    authorities: [...new Set(authorities)].slice(0, 6).map((url) => ({ url })),
    notices,
    verification,
    ui: {
      levelLabel: t(uiLang, `level.${level}` as UiKey),
      levelHelp: t(uiLang, `levelHelp.${level}` as UiKey),
      reasonText: reason ? t(uiLang, `reason.${reason}` as UiKey) : null,
      aiNotice: t(uiLang, unverified ? 'aiNoticeUnverified' : 'aiNotice'),
      sourcesLabel: t(uiLang, 'sources'),
      checkedOn: t(uiLang, 'checkedOn'),
      publishedOn: t(uiLang, 'publishedOn'),
      authoritiesLabel: t(uiLang, 'authorities'),
      supportText: t(uiLang, 'support'),
      supportLink: t(uiLang, 'supportLink'),
      verificationLabel: t(uiLang, 'verificationLabel'),
      outcomeLabels: {
        BAN_FOUND: t(uiLang, 'outcome.BAN_FOUND'),
        NO_CONFIRMED_BAN: t(uiLang, 'outcome.NO_CONFIRMED_BAN'),
        INSUFFICIENT_VERIFIED_DATA: t(uiLang, 'outcome.INSUFFICIENT_VERIFIED_DATA'),
      },
      periodLabel: t(uiLang, 'verificationPeriod'),
      lastVerifiedLabel: t(uiLang, 'lastVerified'),
      unverifiedLabel: t(uiLang, 'unverifiedLead'),
      coverageIncompleteLabel: t(uiLang, 'coverageIncomplete'),
      nextStepLabel: t(uiLang, 'nextStepLabel'),
      nextStep: nextStep ? t(uiLang, nextStep) : null,
    },
  };
}

export async function runPipeline(rawQuestion: string, uiLang: UiLang, deps: PipelineDeps): Promise<PipelineResult> {
  const now = deps.now ?? new Date();
  const today = isoDay(now);
  const deadline = Date.now() + (deps.deadlineMs ?? LIMITS.deadlineMs);
  const fetchPage = deps.fetchPage ?? defaultFetchPage;
  const { providers, meter, config } = deps;
  const question = redactPersonalData(rawQuestion.slice(0, LIMITS.questionChars));

  // (1) Classification.
  const cPrompt = classificationPrompt(question, today);
  const classified = await meter.track('classifier', cPrompt.chars, LIMITS.classifierOutputTokens, () =>
    providers.openaiJson<Classification>({
      model: config.classifierModel, system: cPrompt.system, user: cPrompt.user,
      schemaName: 'dajc_question', schema: CLASSIFICATION_SCHEMA, maxOutputTokens: LIMITS.classifierOutputTokens,
      signal: AbortSignal.timeout(remaining(deadline)),
    }));
  const c = normalizeClassification(classified.json, question, today);
  const notices = c.case_assessment ? [t(uiLang, 'caseNotice')] : [];
  if (!c.in_scope) return { answer: emptyAnswer(c.language, uiLang, 'out_of_scope', [], notices), path: 'none', reviewUrls: [] };
  if (c.jurisdictions.length === 0) return { answer: emptyAnswer(c.language, uiLang, 'need_country', [], notices), path: 'none', reviewUrls: [] };

  // (2) Own verified data: the published Driving Bans registry via the shared contract.
  const drivingBan = c.topic === 'driving_ban';
  const view = deps.view ?? publishedView(now);
  let records: OwnRecord[] = [];
  let verification: Record<string, JurisdictionVerification> = {};
  let ownLeads: string[] = [];
  if (drivingBan) {
    const own = lookupDrivingBans({ jurisdictions: c.jurisdictions, dates: c.dates }, { now, view });
    records = own.records.slice(0, LIMITS.ownRecords);
    verification = own.verification;
    ownLeads = own.leads;
  }
  const verificationList = c.jurisdictions.map((code) => verification[code]).filter(Boolean);
  const undecided = verificationList.filter((v) => v.outcome === 'INSUFFICIENT_VERIFIED_DATA').map((v) => v.jurisdiction);
  // The registry decides the question only for countries verified in full and decided on every asked day.
  const registryDecides = verificationList.every((v) => v.outcome !== 'INSUFFICIENT_VERIFIED_DATA' && v.coverageComplete);
  if (verificationList.some((v) => v.outcome === 'BAN_FOUND' && !v.coverageComplete)) notices.push(t(uiLang, 'coverageNotice'));
  if (undecided.length > 0) notices.push(t(uiLang, 'insufficientNotice', { countries: undecided.join(', ') }));
  // A driving-ban answer the registry cannot fully decide is never a plain "don't know".
  const fallbackLevel: Level = registryDecides ? 'UNKNOWN' : 'INSUFFICIENT_VERIFIED_DATA';
  const empty = (reason: UnknownReason, authorities: string[]) => emptyAnswer(c.language, uiLang, reason, authorities, notices, fallbackLevel, verificationList);

  // (3) Official domains, only where own data cannot answer.
  const webJurisdictions = drivingBan ? undecided : c.jurisdictions;
  const pages: OfficialPage[] = [];
  const consulted: string[] = [];
  if (webJurisdictions.length > 0) {
    const candidates: string[] = [];
    const domains = (officialDomainsFor(webJurisdictions, 20) as string[]);
    if (domains.length > 0) {
      const queries = c.search_terms.length > 0
        ? c.search_terms
        : webJurisdictions.map((code) => `${TOPIC_TERMS[c.topic]} ${code}`);
      // Perplexity bills the request whether or not it succeeds.
      meter.addSearch(1);
      const results = await providers.search({ queries, domains, maxResults: LIMITS.searchResults, signal: AbortSignal.timeout(remaining(deadline)) });
      // Only the asked countries' official domains, even if the engine strays.
      const inDomains = (url: string) => domains.some((d) => hostOf(url) === d || hostOf(url).endsWith(`.${d}`));
      candidates.push(...results.map((r) => r.url).filter(inDomains));
    }
    candidates.push(...ownLeads, ...findingLeads({ jurisdictions: webJurisdictions, topic: c.topic }, deps.findings ? { findings: deps.findings } : {}));
    const urls = [...new Set(candidates.map((u) => normalizeSourceUrl(u)).filter((u): u is string => Boolean(u && isAllowedSourceUrl(u))))]
      .slice(0, LIMITS.fetchedPages);
    consulted.push(...urls);

    // (4) Fetch and read.
    remaining(deadline);
    const fetched = await Promise.all(urls.map((url) => withDeadline(
      fetchOfficialPage(url, { fetchPage, jurisdiction: jurisdictionOfUrl(url, webJurisdictions), now }),
      deadline,
      { ok: false as const, reason: 'deadline' },
    )));
    for (const result of fetched) if (result.ok) pages.push(result.page);
  }

  const sourceById = new Map<string, PromptSource & { page?: OfficialPage; record?: OwnRecord; unverified?: boolean }>();
  for (const record of records) {
    sourceById.set(record.id, { id: record.id, kind: 'own', url: record.facts.sourceUrl, title: record.facts.restriction, text: record.text, record });
  }
  const passageTerms = [...c.search_terms, TOPIC_TERMS[c.topic]];
  pages.forEach((page, index) => {
    const id = `S${index + 1}`;
    sourceById.set(id, { id, kind: 'web', url: page.url, title: page.title || page.host, text: selectPassages(page.text, passageTerms, LIMITS.sourceChars), page, unverified: drivingBan });
  });
  const known = knownSourceUrls(view, deps.findings, c.topic);
  const reviewUrls: ReviewUrl[] = pages
    .filter((page) => !known.has(page.url))
    .map((page) => ({ url: page.url, jurisdiction: jurisdictionOfUrl(page.url, webJurisdictions), topic: c.topic }));
  const authorities = [...pages.map((p) => p.url), ...consulted, ...ownLeads, ...records.map((r) => r.facts.sourceUrl).filter(isAllowedSourceUrl)];

  if (sourceById.size === 0) return { answer: empty('no_sources', authorities), path: 'none', reviewUrls };

  // (5) Draft from the sources only.
  const sources = [...sourceById.values()];
  const dPrompt = draftPrompt(question, c.language, today, sources);
  const draft = await meter.track('answer', dPrompt.chars, LIMITS.answerOutputTokens, () =>
    providers.openaiJson<DraftOutput>({
      model: config.answerModel, system: dPrompt.system, user: dPrompt.user,
      schemaName: 'dajc_answer', schema: DRAFT_SCHEMA, maxOutputTokens: LIMITS.answerOutputTokens,
      signal: AbortSignal.timeout(remaining(deadline)),
    }));
  const claims: DraftClaim[] = Array.isArray(draft.json?.claims) ? draft.json.claims : [];
  const pathOf = (ids: string[]): AnswerPath => {
    const kinds = new Set(ids.map((id) => sourceById.get(id)?.kind));
    return kinds.has('own') && kinds.has('web') ? 'mixed' : kinds.has('own') ? 'own' : kinds.has('web') ? 'web' : 'none';
  };
  const consultedPath = pathOf([...sourceById.keys()]);

  // (6a) Deterministic checks.
  const guardSources: GuardSource[] = sources.map((s) => ({ id: s.id, kind: s.kind, text: s.text }));
  const guard = checkClaims(claims.slice(0, MAX_STATEMENTS), guardSources, { language: c.language });
  const droppedCount = guard.dropped.length + Math.max(0, claims.length - MAX_STATEMENTS);
  if (guard.kept.length === 0) return { answer: empty('no_claims', authorities), path: consultedPath, reviewUrls };

  // (6b) Independent check by a model of another provider.
  const items: VerifyItem[] = guard.kept.map((claim, index) => {
    const source = sourceById.get(claim.source_id)!;
    return {
      id: `C${index + 1}`,
      statement: claim.text,
      quote: claim.quote,
      // A DAJC record is short and checked whole; a web page around the quote.
      excerpt: source.kind === 'own' ? source.text.slice(0, LIMITS.ownRecordChars) : excerptAround(source.text, claim.quote),
    };
  });
  const vPrompt = verifyPrompt(items);
  const verified = await meter.track('verifier', vPrompt.chars, LIMITS.verifierOutputTokens, () =>
    providers.anthropicJson<VerifyOutput>({
      model: config.verifierModel, system: vPrompt.system, user: vPrompt.user,
      schemaName: 'dajc_check', schema: VERIFY_SCHEMA, maxOutputTokens: LIMITS.verifierOutputTokens,
      signal: AbortSignal.timeout(remaining(deadline)),
    }));
  const results = new Map((Array.isArray(verified.json?.results) ? verified.json.results : []).map((r) => [String(r?.id), r]));
  const allSupported = items.every((item) => {
    const r = results.get(item.id);
    return r?.verdict === 'SUPPORTED' && r.personal_advice === false;
  });
  if (!allSupported) return { answer: empty('not_supported', authorities), path: consultedPath, reviewUrls };

  // (7) Level and output. Facts from own data are rendered by template.
  const citedIds = [...new Set(guard.kept.map((claim) => claim.source_id))];
  const answeredJurisdictions = new Set(citedIds.map((id) => {
    const source = sourceById.get(id)!;
    return source.record ? source.record.jurisdiction : jurisdictionOfUrl(source.url, c.jurisdictions);
  }));
  const everyCountryAnswered = c.jurisdictions.every((code) => answeredJurisdictions.has(code));
  const complete = droppedCount === 0 && draft.json?.covers_question === true && everyCountryAnswered;
  let level: Level = complete ? 'VERIFIED' : 'PARTIAL';
  if (drivingBan) {
    // VERIFIED only from the registry, for countries verified in full and decided on every asked day;
    // anything the registry does not fully decide is INSUFFICIENT_VERIFIED_DATA, whatever the web says.
    const registryCountries = new Set(guard.kept.map((claim) => sourceById.get(claim.source_id)?.record?.jurisdiction).filter(Boolean));
    const everyCountryFromRegistry = verificationList.every((v) => registryCountries.has(v.jurisdiction));
    level = !registryDecides ? 'INSUFFICIENT_VERIFIED_DATA' : complete && everyCountryFromRegistry ? 'VERIFIED' : 'PARTIAL';
  }
  const basisOf = (id: string): StatementBasis => {
    const source = sourceById.get(id)!;
    return source.kind === 'own' ? 'dajc_verified' : source.unverified ? 'unverified_official_lead' : 'official_web';
  };
  const citedRecords = citedIds.map((id) => sourceById.get(id)?.record).filter((r): r is OwnRecord => Boolean(r));
  if (citedRecords.some((record) => record.facts.exceptions)) notices.push(t(uiLang, 'exceptionsNotice'));
  if (guard.kept.some((claim) => basisOf(claim.source_id) === 'unverified_official_lead')) notices.push(t(uiLang, 'unverifiedLeadNotice'));

  const answer = buildAnswer({
    level,
    language: c.language,
    uiLang,
    reason: null,
    statements: guard.kept.map((claim) => ({ text: claim.text, sourceId: claim.source_id, basis: basisOf(claim.source_id) })),
    facts: citedIds.flatMap((id) => {
      const record = sourceById.get(id)?.record;
      return record ? [{ sourceId: id, rows: renderDrivingBanFacts(record.facts, uiLang) }] : [];
    }),
    sources: citedIds.map((id) => {
      const s = sourceById.get(id)!;
      return {
        id,
        kind: s.kind,
        url: s.url,
        title: s.title,
        checkedAt: s.record ? s.record.facts.verified : today,
        publishedAt: s.page?.publishedAt ?? null,
        verification: s.kind === 'own' ? 'DAJC_VERIFIED' as const : s.unverified ? 'UNVERIFIED_LEAD' as const : 'OFFICIAL_WEB' as const,
      };
    }),
    authorities: level === 'INSUFFICIENT_VERIFIED_DATA' ? authorities : [],
    notices,
    verification: verificationList,
  });
  return { answer, path: pathOf(citedIds), reviewUrls };
}

/** Exposed for tests: the quote check uses the same normalization as the guard. */
export const _internal = { normalizeForMatch, jurisdictionOfUrl };
