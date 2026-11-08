// DAJC legal library as a source for DAJC AI (the existing Ask pipeline).
//
// Off unless DAJC_KB_ENABLED is exactly "true". Reads only the view
// dajc_kb.answerable_provisions (grant in drizzle-kb/0000) with the Ask
// database role. Library passages are official documents archived by DAJC:
// they enter the pipeline like official web pages (verbatim quote, numbers in
// the quote, independent check), with a complete citation - document version,
// article/section/annex and PDF page - in the source title and URL (#page=N).
//
// A passage can support a VERIFIED answer only when a named person verified
// the document version, the law applies directly to the asked country (national
// law or an EU regulation in a member state) and the provision's mass band was
// reviewed and matches the vehicle (or the provision has none). Otherwise the
// answer is at most PARTIAL and says why. Driving bans keep the Driving Bans
// registry as their only authority; the library is not consulted for them.

import { legalSources } from '../kb/legal-sources.mjs';
import { postgresQuery, searchLibrary } from '../kb/search.mjs';
import { ASK_TOPIC_TO_KB, applicability, inForceOn } from '../kb/taxonomy.mjs';
import type { AskEnv } from './config';
import type { Topic } from './own-data';

export interface LibraryHit {
  id: string;
  jurisdiction: string;
  title: string;
  officialNumber: string;
  legalCategory: string;
  anchorType: string;
  anchorLabel: string;
  pageFrom: number;
  pageTo: number;
  text: string;
  language: string;
  url: string;
  sha256: string;
  versionLabel: string;
  authenticity: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  validity: string;
  validityCheckedOn: string | null;
  provenance: string;
  lastVerifiedAt: string | null;
  applicability: string;
  massCheck: string;
  citation: string;
}

export interface LibraryQuery {
  countries: string[];
  topic: Topic;
  language: string;
  searchTerms: string[];
  question: string;
  date: string;
  massT: number | null;
}

export type LibraryLookup = (query: LibraryQuery) => Promise<LibraryHit[]>;

export const LIBRARY_MAX_SOURCES = 4;

/** Languages to search: the question's, each country's official ones, English. */
export function libraryLanguages(language: string, countries: string[]): string[] {
  const official = legalSources.filter((s) => countries.includes(s.jurisdiction)).flatMap((s) => s.languages);
  return [...new Set([language, ...official, 'en'])].filter((l) => /^[a-z]{2}$/.test(l)).slice(0, 6);
}

/** A passage is usable only with a complete citation and a version in force on the day. */
export function citable(hit: LibraryHit, day: string): boolean {
  return Boolean(
    hit.anchorLabel && ['ARTICLE', 'SECTION', 'ANNEX'].includes(hit.anchorType) && hit.pageFrom >= 1 && hit.pageTo >= hit.pageFrom
      && /^https:\/\//.test(hit.url) && /#page=\d+$/.test(hit.url) && /^[0-9a-f]{64}$/.test(hit.sha256) && hit.versionLabel
      && inForceOn({ validity: hit.validity, effectiveFrom: hit.effectiveFrom, effectiveTo: hit.effectiveTo }, day)
      && hit.massCheck !== 'MISMATCH' && hit.applicability !== 'NOT_APPLICABLE',
  );
}

/** Countries this passage answers directly (used to skip a paid web search for them). */
export function countriesCovered(hit: LibraryHit, countries: string[]): string[] {
  return countries.filter((code) => ['DIRECT', 'EU_DIRECT'].includes(applicability(code, hit.jurisdiction, hit.legalCategory))
    && ['NO_THRESHOLD', 'MATCH'].includes(hit.massCheck));
}

/** Why a cited passage cannot make the answer VERIFIED (empty = it can). */
export function libraryLimits(hit: LibraryHit): Array<'unreviewed' | 'applicability' | 'mass'> {
  const limits: Array<'unreviewed' | 'applicability' | 'mass'> = [];
  if (hit.provenance !== 'HUMAN_VERIFIED') limits.push('unreviewed');
  if (!['DIRECT', 'EU_DIRECT'].includes(hit.applicability)) limits.push('applicability');
  if (!['NO_THRESHOLD', 'MATCH'].includes(hit.massCheck)) limits.push('mass');
  return limits;
}

/** What the drafting model and the checks see for a library source. */
export function librarySourceText(hit: LibraryHit): string {
  return `${hit.citation}\n${hit.text}`;
}

export interface LibraryConfig {
  allowedProvenance: string[];
}

/**
 * Library settings from the environment, or null while off. AUTO_CHECKED
 * (machine-checked, not yet confirmed by a person) is accepted only outside
 * Vercel production and only with an explicit switch - for internal tests.
 */
export function readLibraryConfig(env: AskEnv = process.env): LibraryConfig | null {
  if (env.DAJC_KB_ENABLED !== 'true') return null;
  const allowAuto = env.DAJC_KB_ALLOW_AUTO_CHECKED === 'true' && env.VERCEL_ENV !== 'production';
  return { allowedProvenance: allowAuto ? ['HUMAN_VERIFIED', 'AUTO_CHECKED'] : ['HUMAN_VERIFIED'] };
}

const clients = new Map<string, unknown>();

/** Lookup over the Ask database (role dajc_ask_app), created lazily. */
export function libraryLookupFor(dbUrl: string, config: LibraryConfig): LibraryLookup {
  return async (query) => {
    let sql = clients.get(dbUrl) as any;
    if (!sql) {
      const { default: postgres } = await import('postgres');
      sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 20, onnotice: () => undefined });
      clients.set(dbUrl, sql);
    }
    const hits = await searchLibrary(postgresQuery(sql), {
      terms: [...query.searchTerms, query.question],
      question: query.question,
      languages: libraryLanguages(query.language, query.countries),
      countries: query.countries,
      onDate: query.date,
      topics: ASK_TOPIC_TO_KB[query.topic] ?? null,
      massT: query.massT,
      allowedProvenance: config.allowedProvenance,
      limit: LIBRARY_MAX_SOURCES * 2,
    });
    return hits as unknown as LibraryHit[];
  };
}
