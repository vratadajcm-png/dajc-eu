// Coverage of the DAJC legal library: the 50 jurisdictions of
// config/europe-coverage.mjs (the only list) x the legal sub-areas of
// legal-areas.mjs, with official sources and stored documents.
//
// Statuses per cell (never optimistic):
//   COVERED            - only from an explicit audit in
//                        config/legal-library/coverage-evidence.json that names
//                        the official evidence and documents, all stored, in
//                        force and verified (AI_VERIFIED or HUMAN_VERIFIED);
//   PARTIAL            - at least one stored official document that applies
//                        there (national, or EU law where it applies), with
//                        the reasons why it is not complete;
//   CONFLICTED         - an applicable stored version is CONFLICTED, or an
//                        audit recorded a conflict;
//   NOT_APPLICABLE     - only from an audit with official legal evidence
//                        (never "nothing was found");
//   SOURCE_UNAVAILABLE - nothing stored and every national legislation source
//                        refuses automated access (robots.txt, blocked) or its
//                        reuse terms are restricted;
//   NOT_YET_RESEARCHED - everything else.
// A jurisdiction is complete only when every cell is COVERED or NOT_APPLICABLE.

import { corridorOnlyJurisdictions, dajcEuropeCoverage, geographicScopePolicy } from '../../../config/europe-coverage.mjs';
import { LEGAL_AREA_GROUPS, LEGAL_AREA_LIST } from './legal-areas.mjs';
import { legalSourceForUrl, legalSources } from './legal-sources.mjs';
import { applicability } from './taxonomy.mjs';

export const COVERAGE_STATUSES = Object.freeze(['COVERED', 'PARTIAL', 'CONFLICTED', 'NOT_APPLICABLE', 'SOURCE_UNAVAILABLE', 'NOT_YET_RESEARCHED']);
const VERIFIED = new Set(['AI_VERIFIED', 'HUMAN_VERIFIED']);
const USABLE = new Set(['AUTO_CHECKED', 'AI_VERIFIED', 'HUMAN_VERIFIED']);
const day = (v) => (v == null ? null : typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));

function inForce(version, onDate) {
  return ['IN_FORCE', 'NOT_YET_IN_FORCE'].includes(version.validity)
    && (!version.effective_from || day(version.effective_from) <= onDate) && (!version.effective_to || day(version.effective_to) > onDate);
}

/** How a document applies in a jurisdiction, or null. */
export function documentApplies(doc, jurisdiction) {
  if (doc.jurisdiction === jurisdiction) return 'DIRECT';
  if (doc.jurisdiction === 'INT') return null; // contracting parties are not recorded yet
  const a = applicability(jurisdiction, doc.jurisdiction, doc.legalCategory);
  return a === 'NOT_APPLICABLE' ? null : a;
}

/** Problems of an audit entry (empty = usable). */
export function auditProblems(entry) {
  const problems = [];
  if (!dajcEuropeCoverage.some(([c]) => c === entry.jurisdiction)) problems.push(`${entry.jurisdiction} is not a DAJC jurisdiction`);
  if (!LEGAL_AREA_LIST.some((a) => a.id === entry.area)) problems.push(`unknown legal area ${entry.area}`);
  if (!['COVERED', 'NOT_APPLICABLE', 'CONFLICTED'].includes(entry.status)) problems.push(`status ${entry.status} cannot be set by an audit`);
  const official = (entry.evidence || []).filter((e) => legalSourceForUrl(e.url) && String(e.explanation || '').length >= 20);
  if (official.length === 0) problems.push('needs official legal evidence (URL on a registered official source and an explanation)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.assessedOn || '')) problems.push('assessedOn is required');
  return problems;
}

/**
 * @param {{ manifest: { entries: any[] }, inventory?: any[], sourceChecks?: any, audits?: any[], onDate: string }} input
 *   inventory: rows of dajc_kb.library_inventory (jurisdiction, official_number, validity, provenance, effective_from/to, ai_verified_at, ...)
 */
export function buildCoverage({ manifest, inventory = [], sourceChecks = null, audits = [], onDate }) {
  // Documents of the manifest (the plan) with their stored versions (the fact).
  const docs = new Map();
  for (const e of manifest.entries) {
    const key = `${e.jurisdiction}|${e.officialNumber}`;
    if (!docs.has(key)) docs.set(key, { jurisdiction: e.jurisdiction, officialNumber: e.officialNumber, title: e.title, legalCategory: e.legalCategory, legalAreas: new Set(), sourceId: e.sourceId, planned: 0, versions: [] });
    const d = docs.get(key);
    for (const a of e.legalAreas || []) d.legalAreas.add(a);
    d.planned++;
  }
  const unmapped = [];
  for (const row of inventory) {
    const d = docs.get(`${row.jurisdiction}|${row.official_number}`);
    if (d) d.versions.push(row);
    else unmapped.push(`${row.jurisdiction} ${row.official_number} [${row.language}]`);
  }
  const outcomeOf = new Map((sourceChecks?.results || []).map((r) => [r.domain, r.outcome]));
  // robots.txt is the publisher's own policy wherever it is read; a refusal or no
  // answer counts only when it was seen from the GitHub runner, because the
  // development sandbox's own network policy can refuse too.
  const fromRunner = sourceChecks?.environment === 'GitHub Actions runner';
  const unavailable = (outcome) => outcome === 'ROBOTS_RESTRICTED' || (fromRunner && ['BLOCKED_FROM_DEV', 'UNREACHABLE'].includes(outcome));
  const refusedHere = (outcome) => ['BLOCKED_FROM_DEV', 'UNREACHABLE'].includes(outcome);
  const auditOf = new Map();
  const auditIssues = [];
  for (const a of audits) {
    const problems = auditProblems(a);
    if (problems.length) auditIssues.push({ jurisdiction: a.jurisdiction, area: a.area, problems });
    else auditOf.set(`${a.jurisdiction}|${a.area}`, a);
  }

  const jurisdictions = dajcEuropeCoverage.map(([code, name]) => {
    const national = legalSources.filter((s) => s.jurisdiction === code && !s.region && s.kind !== 'ROAD_AUTHORITY' && s.categories.some((c) => ['NATIONAL_ACT', 'NATIONAL_REGULATION'].includes(c)));
    const regional = legalSources.filter((s) => s.jurisdiction === code && s.region);
    const nationalUnavailable = national.length > 0 && national.every((s) => s.reuse.status === 'RESTRICTED' || s.domains.every((d) => unavailable(outcomeOf.get(d))));
    const nationalRefusedHere = !fromRunner && national.length > 0 && national.every((s) => s.domains.every((d) => refusedHere(outcomeOf.get(d)) || unavailable(outcomeOf.get(d))));
    const cells = LEGAL_AREA_LIST.map((area) => {
      const audit = auditOf.get(`${code}|${area.id}`);
      const applicable = [...docs.values()].filter((d) => d.legalAreas.has(area.id)).map((d) => ({ doc: d, how: documentApplies(d, code) })).filter((x) => x.how);
      const current = applicable.flatMap(({ doc, how }) => doc.versions.filter((v) => inForce(v, onDate)).map((v) => ({ doc, how, v })));
      const usable = current.filter((x) => USABLE.has(x.v.provenance));
      const conflicted = current.filter((x) => x.v.provenance === 'CONFLICTED');
      const verified = usable.filter((x) => VERIFIED.has(x.v.provenance));
      const documents = [...new Set(usable.map((x) => x.doc.officialNumber))];
      const reasons = [];
      let status;
      if (audit?.status === 'NOT_APPLICABLE') status = 'NOT_APPLICABLE';
      else if (conflicted.length > 0 || audit?.status === 'CONFLICTED') status = 'CONFLICTED';
      else if (audit?.status === 'COVERED') {
        const named = audit.documents || [];
        const ok = named.length > 0 && named.every((n) => verified.some((x) => x.doc.officialNumber === n));
        status = ok ? 'COVERED' : usable.length > 0 ? 'PARTIAL' : 'NOT_YET_RESEARCHED';
        if (!ok) reasons.push('audit names documents that are not all stored, in force and verified');
      } else if (usable.length > 0) status = 'PARTIAL';
      else status = nationalUnavailable ? 'SOURCE_UNAVAILABLE' : 'NOT_YET_RESEARCHED';
      if (status === 'NOT_YET_RESEARCHED' && nationalRefusedHere) reasons.push('the official legislation source refused the development environment; re-check from the GitHub runner');
      if (status === 'SOURCE_UNAVAILABLE') reasons.push('automated access to the official legislation source is not allowed (robots.txt) or not possible; only metadata may be recorded');
      if (status === 'PARTIAL') {
        if (usable.some((x) => x.how === 'TRANSPOSITION_CHECK_REQUIRED')) reasons.push('EU directive: the national transposition is not in the library');
        if (usable.some((x) => x.how === 'EEA_CHECK_REQUIRED')) reasons.push('EU act: incorporation into the EEA Agreement to be checked');
        if (!usable.some((x) => x.how === 'DIRECT')) reasons.push('no national act of this jurisdiction stored (implementing rules, sanctions, authorities)');
        if (verified.length < usable.length) reasons.push(`${usable.length - verified.length} of ${usable.length} applicable versions not yet AI- or person-verified`);
        if (regional.length > 0) reasons.push(`regional legislation (${regional.map((s) => s.region).join(', ')}) not yet researched`);
      }
      const plannedOnly = applicable.filter(({ doc }) => doc.versions.length === 0).map(({ doc }) => doc.officialNumber);
      const lastVerified = verified.map((x) => day(x.v.ai_verified_at || x.v.last_verified_at)).filter(Boolean).sort().pop() ?? null;
      return {
        area: area.id, status, documents, versions: usable.length, verifiedVersions: verified.length, conflictedVersions: conflicted.length,
        lastVerifiedOn: lastVerified, reasons, plannedNotImported: [...new Set(plannedOnly)], audit: audit ? { assessedOn: audit.assessedOn, evidence: audit.evidence } : null,
      };
    });
    const counts = Object.fromEntries(COVERAGE_STATUSES.map((s) => [s, cells.filter((c) => c.status === s).length]));
    const versionIds = new Set(cells.flatMap((c) => c.documents));
    return {
      code, name, corridorOnly: corridorOnlyJurisdictions.includes(code), regions: regional.map((s) => ({ region: s.region, source: s.id })),
      sources: national.concat(regional).map((s) => ({ id: s.id, region: s.region ?? null, domains: s.domains, reuse: s.reuse.status, access: s.domains.map((d) => outcomeOf.get(d) ?? 'NOT_CHECKED') })),
      complete: cells.every((c) => ['COVERED', 'NOT_APPLICABLE'].includes(c.status)), counts, documents: versionIds.size, cells,
    };
  });

  const totals = Object.fromEntries(COVERAGE_STATUSES.map((s) => [s, jurisdictions.reduce((n, j) => n + j.counts[s], 0)]));
  return {
    onDate, jurisdictionCount: jurisdictions.length, areaCount: LEGAL_AREA_LIST.length, cellCount: jurisdictions.length * LEGAL_AREA_LIST.length,
    groups: LEGAL_AREA_GROUPS, areas: LEGAL_AREA_LIST.map((a) => ({ id: a.id, en: a.en, cs: a.cs })), corridorScope: geographicScopePolicy.corridor_scope,
    totals, completeJurisdictions: jurisdictions.filter((j) => j.complete).map((j) => j.code),
    library: {
      documents: [...docs.values()].filter((d) => d.versions.length > 0).length, plannedDocuments: docs.size,
      versions: inventory.length, verifiedVersions: inventory.filter((v) => VERIFIED.has(v.provenance)).length,
      conflictedVersions: inventory.filter((v) => v.provenance === 'CONFLICTED').length, unmapped,
    },
    auditIssues, jurisdictions,
  };
}
