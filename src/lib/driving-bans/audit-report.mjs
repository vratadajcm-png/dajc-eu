/**
 * Per-jurisdiction audit overview and its offline HTML rendering. Pure functions over
 * the snapshot, the Source Registry, semantic findings and the review queue. A
 * technical check is reported separately from legal review and never implies it.
 */

export const TECHNICAL_CHECK_COMPLETE = 'TECHNICAL_CHECK_COMPLETE';
export const LEGAL_REVIEW_COMPLETE = 'LEGAL_REVIEW_COMPLETE';
export const LEGAL_REVIEW_INCOMPLETE = 'LEGAL_REVIEW_INCOMPLETE';

export function legalReviewStatus(view) {
  return view.complete ? LEGAL_REVIEW_COMPLETE : LEGAL_REVIEW_INCOMPLETE;
}

export function buildJurisdictionReport({ view, catalog, findings, evidence, proposals }) {
  return view.jurisdictions.map(row => {
    const sources = catalog.jurisdictions.find(item => item.jurisdiction === row.jurisdiction);
    const own = catalog.entries.filter(entry => entry.jurisdiction === row.jurisdiction);
    const mine = item => item.jurisdiction === row.jurisdiction || (item.ban_ids || []).some(id => id.startsWith(`${row.jurisdiction.toLowerCase()}-`));
    return {
      jurisdiction: row.jurisdiction, name: row.name,
      verification_state: row.verification_state, ban_state: row.ban_state, coverage_complete: row.coverage_complete,
      legal_review: row.coverage_complete ? LEGAL_REVIEW_COMPLETE : LEGAL_REVIEW_INCOMPLETE,
      last_legal_verification: row.last_verified, last_checked: row.last_checked, event_count: row.event_count,
      coverage_failures: row.coverage_failures,
      primary_legal_sources: sources.legal_evidence_source_ids.length,
      missing_primary_sources: sources.legal_evidence_source_ids.length === 0,
      source_categories_missing: sources.categories_missing,
      conflicts: findings.filter(item => mine(item) && item.blocking_state === 'CONFLICT').length,
      review_findings: findings.filter(item => mine(item) && item.severity !== 'INFO').length,
      expired_evidence: evidence.filter(item => item.jurisdiction === row.jurisdiction).length,
      open_proposals: proposals.filter(item => item.submission.jurisdiction === row.jurisdiction && !['READY_FOR_CANONICAL_UPDATE', 'REJECTED'].includes(item.state)).length,
      connector_readiness: Object.fromEntries(Object.entries(sources.integration_statuses).filter(([, count]) => count)),
      future_connectors: own.filter(entry => entry.evidence_use === 'FUTURE_CONNECTOR' || entry.evidence_use === 'MACHINE_INTERFACE').map(entry => `${entry.source_id}:${entry.integration_status}`),
    };
  });
}

const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function jurisdictionReportCsv(rows) {
  const headers = ['jurisdiction', 'name', 'verification_state', 'ban_state', 'legal_review', 'last_legal_verification', 'last_checked', 'event_count', 'primary_legal_sources', 'missing_primary_sources', 'conflicts', 'review_findings', 'expired_evidence', 'open_proposals', 'future_connectors', 'coverage_failures'];
  return '﻿' + [headers, ...rows.map(row => headers.map(key => Array.isArray(row[key]) ? row[key].join(' | ') : row[key]))].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function renderAuditHtml(summary, rows) {
  const tr = rows.map(row => `<tr><td>${escapeHtml(row.jurisdiction)}</td><td>${escapeHtml(row.verification_state)}</td><td>${escapeHtml(row.ban_state)}</td><td>${escapeHtml(row.last_legal_verification ?? '–')}</td><td>${row.primary_legal_sources}</td><td>${row.conflicts}</td><td>${row.expired_evidence}</td><td>${row.open_proposals}</td><td>${escapeHtml(row.future_connectors.join(', ') || '–')}</td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="robots" content="noindex"><title>DAJC Driving Bans audit</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.25rem .5rem;text-align:left}</style></head><body>
<h1>DAJC Driving Bans – audit ${escapeHtml(summary.generated_at)}</h1>
<p><strong>${escapeHtml(summary.technical_check)}</strong> · <strong>${escapeHtml(summary.legal_review)}</strong>. A green technical check is not evidence that legal information is current.</p>
<p>Dataset ${escapeHtml(summary.dataset_version)} · window ${escapeHtml(summary.window.from)}–${escapeHtml(summary.window.to)} · fully verified ${summary.fully_verified}/${summary.tracked} · last legal verification ${escapeHtml(summary.last_legal_verification ?? '–')} · last full-registry sweep ${escapeHtml(summary.last_full_registry_sweep ?? 'none recorded')}</p>
<table><thead><tr><th>Code</th><th>Verification</th><th>State</th><th>Last legal verification</th><th>Primary sources</th><th>Conflicts</th><th>Expired evidence</th><th>Open proposals</th><th>Future connectors</th></tr></thead><tbody>
${tr}
</tbody></table></body></html>\n`;
}
