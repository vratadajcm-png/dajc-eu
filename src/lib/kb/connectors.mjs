// Connector plan of the legal library for the 50 jurisdictions of
// config/europe-coverage.mjs (the only list) plus EU. Honest by construction:
// a connector is IMPLEMENTED only when an adapter exists and has downloaded a
// document; everything else is PLANNED with its declared (unverified) format.

import { readFileSync } from 'node:fs';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';

const dajcCoverageCodes = dajcEuropeCoverage.map(([c]) => c);

export const CONNECTOR_FORMATS = Object.freeze(['REST_API', 'XML', 'HTML', 'PDF', 'RSS', 'AUTHORIZED']);
export const CONNECTOR_STATUSES = Object.freeze(['IMPLEMENTED', 'PLANNED', 'BLOCKED', 'PERMISSION_PENDING']);
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

export const loadConnectors = () => read('../../../config/legal-library/connectors.json').connectors;
export const loadAccessRegister = () => read('../../../config/legal-library/internal-access-register.json');

/** Problems of the connector plan (empty = consistent). */
export function connectorProblems(connectors = loadConnectors()) {
  const problems = [];
  const ids = new Set();
  for (const c of connectors) {
    if (ids.has(c.id)) problems.push(`duplicate connector ${c.id}`);
    ids.add(c.id);
    if (!CONNECTOR_FORMATS.includes(c.format)) problems.push(`${c.id}: unknown format ${c.format}`);
    if (!CONNECTOR_STATUSES.includes(c.status)) problems.push(`${c.id}: unknown status ${c.status}`);
    if (c.status === 'IMPLEMENTED' && (!c.adapter || c.basis !== 'VERIFIED_LIVE')) problems.push(`${c.id}: IMPLEMENTED needs an adapter and a live-verified basis`);
    if (!['EU', 'INT'].includes(c.jurisdiction) && !dajcCoverageCodes.includes(c.jurisdiction)) problems.push(`${c.id}: ${c.jurisdiction} is not a DAJC jurisdiction`);
  }
  for (const code of dajcCoverageCodes) if (!connectors.some((c) => c.jurisdiction === code)) problems.push(`${code}: no connector planned`);
  return problems;
}

/** Per jurisdiction: connectors by status (never claims more than IMPLEMENTED). */
export function connectorMatrix(connectors = loadConnectors()) {
  return [...dajcCoverageCodes, 'EU'].map((code) => {
    const own = connectors.filter((c) => c.jurisdiction === code);
    return { jurisdiction: code, connectors: own.length, implemented: own.filter((c) => c.status === 'IMPLEMENTED').length, formats: [...new Set(own.map((c) => c.format))] };
  });
}

/** Problems of the internal access register (metadata only, no private text). */
export function accessRegisterProblems(register = loadAccessRegister()) {
  const problems = [];
  const allowed = new Set(['jurisdiction', 'institution', 'officialSource', 'format', 'availability', 'accessConditions', 'registrationRequired', 'permissionStatus', 'confirmedOn', 'evidenceRef']);
  for (const [i, e] of (register.entries || []).entries()) {
    for (const k of Object.keys(e)) if (!allowed.has(k)) problems.push(`entry ${i}: field ${k} is not allowed (metadata only)`);
    if (!dajcCoverageCodes.includes(e.jurisdiction) && e.jurisdiction !== 'EU') problems.push(`entry ${i}: unknown jurisdiction`);
    if (e.permissionStatus === 'GRANTED' && !(e.confirmedOn && e.evidenceRef)) problems.push(`entry ${i}: GRANTED needs confirmedOn and evidenceRef; a promise is not permission`);
  }
  return problems;
}
