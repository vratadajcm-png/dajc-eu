// Hash chain for the append-only audit trail. Each record's hash covers the
// previous hash and the record itself, so deleting, reordering or editing
// any record (even by someone with direct database access) breaks the chain
// and verifyAuditChain() reports where. Records never contain e-mail,
// card, bank data or question/answer content - only references.

import { createHash } from 'node:crypto';
import type { AuditInput, AuditRow } from './store/paid-types';

export const AUDIT_GENESIS = '0'.repeat(64);

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function auditHash(prevHash: string, entry: Required<AuditInput>, at: Date): string {
  return createHash('sha256')
    .update(`${prevHash}|${at.toISOString()}|${entry.actor}|${entry.action}|${entry.subject}|${canonical(entry.details)}`, 'utf8')
    .digest('hex');
}

/** Rows in id order. Returns the id of the first broken record, or null. */
export function verifyAuditChain(rows: AuditRow[]): number | null {
  let prev = AUDIT_GENESIS;
  for (const row of rows) {
    if (row.prevHash !== prev || auditHash(prev, row, row.at) !== row.hash) return row.id;
    prev = row.hash;
  }
  return null;
}

/** Keeps identifiers only; drops anything that looks like an e-mail address. */
export function auditDetails(details: Record<string, unknown> = {}): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string' && /@/.test(value)) continue;
    if (value === undefined) continue;
    clean[key] = value;
  }
  return clean;
}
