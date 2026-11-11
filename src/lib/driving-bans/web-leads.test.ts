import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drivingBanSourceCatalog } from '../../../config/driving-ban-sources/index.mjs';
import { importWebLeads, webLeadToSubmission, WEB_LEAD_SUBMITTER } from './web-leads.mjs';
import { verifyAuditLog } from './evidence-store.mjs';

const lead = { url: 'https://www.asfinag.at/verkehr/fahrverbote', jurisdiction: 'AT', topic: 'driving_ban', first_seen: '2026-10-27' };

describe('web leads enter the review layer as unverified proposals', () => {
  it('turns only https driving-ban leads of tracked jurisdictions into submissions', () => {
    const submission = webLeadToSubmission(lead)!;
    expect(submission).toMatchObject({ submitted_by: WEB_LEAD_SUBMITTER, jurisdiction: 'AT', documents: [], legal_verified_at: null, synthetic: false });
    expect(submission.operations).toEqual([{ op: 'ADD_SOURCE', source: expect.objectContaining({ url: lead.url, role: 'SECONDARY', authority: 'asfinag.at' }) }]);
    expect(webLeadToSubmission(lead)).toEqual(submission);
    expect(webLeadToSubmission({ ...lead, topic: 'toll' })).toBeNull();
    expect(webLeadToSubmission({ ...lead, jurisdiction: 'XX' })).toBeNull();
    expect(webLeadToSubmission({ ...lead, jurisdiction: null })).toBeNull();
    expect(webLeadToSubmission({ ...lead, url: 'http://www.asfinag.at/x' })).toBeNull();
    expect(webLeadToSubmission({ ...lead, url: 'not a url' })).toBeNull();
  });

  it('lands as INSUFFICIENT_EVIDENCE, deduplicates and never changes canonical data', () => {
    const before = readFileSync('data/driving-bans/canonical.json', 'utf8');
    const store = mkdtempSync(join(tmpdir(), 'dajc-web-leads-'));
    try {
      const args = { store, rawCanonical: JSON.parse(before), catalogSources: drivingBanSourceCatalog.entries, now: new Date('2026-10-27T12:00:00Z') };
      const [first, again, other] = importWebLeads({ ...args, leads: [lead, lead, { ...lead, topic: 'escort' }] });
      expect(first).toMatchObject({ status: 'INSUFFICIENT_EVIDENCE', findings: expect.arrayContaining(['NO_PRIMARY_DOCUMENT']) });
      expect(again).toMatchObject({ status: 'DUPLICATE', proposal_id: first.proposal_id });
      expect(other.status).toBe('SKIPPED');
      expect(verifyAuditLog(store).ok).toBe(true);
    } finally { rmSync(store, { recursive: true, force: true }); }
    expect(readFileSync('data/driving-bans/canonical.json', 'utf8')).toBe(before);
  });
});
