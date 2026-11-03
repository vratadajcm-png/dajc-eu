/**
 * Hand-off of unverified official web findings into the Driving Bans review layer
 * (PR 2: evidence-store.mjs). The free "Ask DAJC AI" queues official pages it read
 * for a driving-ban question the registry could not decide (dajc_ask.review_queue).
 * Each such lead becomes a link-only submission with one ADD_SOURCE operation
 * (role SECONDARY, "not reviewed"). Without an imported primary document it
 * validates to INSUFFICIENT_EVIDENCE: a lead can never reach the published registry
 * unless a reviewer adds the document, proposes the rule change and it is approved.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isTrackedJurisdiction } from '../../../config/europe-coverage.mjs';
import { importSubmission, validateStoredProposal } from './evidence-store.mjs';

export const WEB_LEAD_SUBMITTER = 'Ask DAJC AI review queue (automated lead, not verified)';

/** A review-queue row ({ url, jurisdiction, topic, first_seen }) as a submission, or null when it is not a driving-ban lead. */
export function webLeadToSubmission(lead) {
  if (lead?.topic !== 'driving_ban' || !lead.jurisdiction || !isTrackedJurisdiction(lead.jurisdiction)) return null;
  let url;
  try { url = new URL(lead.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.replace(/^www\./, '');
  const sourceId = `web-lead-${createHash('sha256').update(url.href).digest('hex').slice(0, 16)}`;
  const seen = /^\d{4}-\d{2}-\d{2}$/.test(String(lead.first_seen ?? '')) ? ` first seen ${lead.first_seen}` : '';
  return {
    submission_version: 1,
    synthetic: false,
    submitted_by: WEB_LEAD_SUBMITTER,
    jurisdiction: lead.jurisdiction,
    summary: `Official page found by Ask DAJC AI for a question on HGV driving bans in ${lead.jurisdiction}${seen}. Unverified lead: retrieve the document, check it against the registry and propose any rule change in a separate submission.`,
    documents: [],
    links: [{ url: url.href, source_id: sourceId, title: `Official page on ${host} (unverified lead)` }],
    legal_verified_at: null,
    operations: [{
      op: 'ADD_SOURCE',
      source: { source_id: sourceId, url: url.href, authority: host, role: 'SECONDARY', version: `Ask DAJC AI lead${seen}; not reviewed`, findings: 'Unverified official web finding. Not reviewed by DAJC; contents and legal effect are unknown.' },
    }],
  };
}

/** Imports and validates every driving-ban lead; never approves, prepares or touches canonical.json. */
export function importWebLeads({ leads, store, rawCanonical, catalogSources = [], now = new Date() }) {
  const root = mkdtempSync(join(tmpdir(), 'dajc-web-leads-'));
  try {
    return leads.map((lead) => {
      const submission = webLeadToSubmission(lead);
      if (!submission) return { url: String(lead?.url ?? ''), status: 'SKIPPED' };
      const file = join(root, `${submission.links[0].source_id}.json`);
      writeFileSync(file, JSON.stringify(submission, null, 2));
      const imported = importSubmission({ submissionFile: file, root, store, now, actor: 'web-lead-handoff' });
      if (imported.status === 'DUPLICATE') return { url: submission.links[0].url, status: 'DUPLICATE', proposal_id: imported.proposal_id };
      const proposal = validateStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical, now, catalogSources });
      return { url: submission.links[0].url, status: proposal.state, proposal_id: proposal.proposal_id, findings: proposal.findings.map((f) => f.code) };
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
