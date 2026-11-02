import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { buildDrivingBanSourceCatalog } from '../../../config/driving-ban-sources/index.mjs';
import { buildJurisdictionReport, jurisdictionReportCsv, renderAuditHtml, legalReviewStatus, LEGAL_REVIEW_COMPLETE, LEGAL_REVIEW_INCOMPLETE } from './audit-report.mjs';

const CANONICAL = 'data/driving-bans/canonical.json';
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('extended Driving Bans audit', () => {
  it('reports the technical check separately from legal review and never touches canonical data', () => {
    const before = sha(CANONICAL);
    const root = mkdtempSync(join(tmpdir(), 'dajc-audit-'));
    try {
      const summary = JSON.parse(execFileSync(process.execPath, ['scripts/audit-driving-bans.mjs', '--clock', '2026-11-10T10:00:00Z', '--store', join(root, 'no-store'), '--output', root], { encoding: 'utf8' }));
      expect(summary.technical_check).toBe('TECHNICAL_CHECK_COMPLETE');
      expect(summary.legal_review).toBe('LEGAL_REVIEW_INCOMPLETE');
      expect(summary.external_source_review_performed).toBe(false);
      expect(summary.verified_jurisdictions + summary.unverified_jurisdictions).toBe(summary.tracked);
      expect(summary.last_full_registry_sweep).toBeNull();
      expect(summary.review_queue).toEqual({ store: null, proposals: {}, audit_log: null });
      expect(summary.connector_readiness.ACTIVE ?? 0).toBe(0);
      for (const file of ['source-catalog.json', 'source-catalog.csv', 'rule-checks.json', 'evidence-findings.json', 'review-queue.json', 'jurisdiction-report.json', 'jurisdiction-report.csv', 'audit-report.html', 'summary.json', 'coverage.csv', 'driving-bans.ics']) expect(existsSync(join(root, file)), file).toBe(true);
      expect(existsSync(join(root, 'classified-changes.json'))).toBe(false);
      const report = JSON.parse(readFileSync(join(root, 'jurisdiction-report.json'), 'utf8'));
      expect(report).toHaveLength(summary.tracked);
      expect(report.filter((row: any) => row.legal_review === LEGAL_REVIEW_COMPLETE)).toHaveLength(summary.fully_verified);
      expect(readFileSync(join(root, 'audit-report.html'), 'utf8')).toContain('A green technical check is not evidence that legal information is current.');
    } finally { rmSync(root, { recursive: true, force: true }); }
    expect(sha(CANONICAL)).toBe(before);
  });

  it('marks missing primary sources and escapes HTML and CSV output', () => {
    const view = getDrivingBansSnapshot(new Date('2026-11-10T10:00:00Z'));
    const catalog = buildDrivingBanSourceCatalog('2026-11-10T10:00:00Z');
    const rows = buildJurisdictionReport({ view, catalog, findings: [], evidence: [], proposals: [] });
    expect(legalReviewStatus({ complete: false })).toBe(LEGAL_REVIEW_INCOMPLETE);
    expect(rows.filter((row: any) => row.missing_primary_sources).map((row: any) => row.jurisdiction)).toEqual(catalog.summary.without_legal_evidence);
    const hostile = [{ ...rows[0], jurisdiction: '<script>x</script>', name: 'a"b', future_connectors: [] }];
    const html = renderAuditHtml({ generated_at: 'now', technical_check: 'TECHNICAL_CHECK_COMPLETE', legal_review: 'LEGAL_REVIEW_INCOMPLETE', dataset_version: 'v', window: { from: 'a', to: 'b' }, fully_verified: 0, tracked: 1 }, hostile);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(jurisdictionReportCsv(hostile)).toContain('"a""b"');
  });
});
