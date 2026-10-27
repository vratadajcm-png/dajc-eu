import { z } from 'zod';
/**
 * Driving Bans Source Registry: metadata about where evidence comes from and how
 * a future connector could obtain it. Pure functions, no network.
 *
 * It never holds rules, never creates a ban and never upgrades verification.
 * canonical.json stays the only rule registry and config/europe-coverage.mjs the
 * only list of jurisdictions. Integration status is derived from recorded facts,
 * so a record cannot claim ACTIVE without an implemented connector.
 */

export const SOURCE_CATEGORIES = Object.freeze([
  'STATUTORY_WEEKEND_HOLIDAY', 'NIGHT_SEASONAL', 'REGIONAL_DIRECTIONAL', 'TEMPORARY_RESTRICTIONS_CLOSURES',
  'WEIGHT_DIMENSION', 'ADR_SPECIAL_TRANSPORT', 'EXCEPTIONS_PERMITS_DECISIONS', 'AUXILIARY_TRAFFIC_INFRASTRUCTURE',
]);
export const RESTRICTION_CLASSES = Object.freeze(['LEGAL_DRIVING_BAN', 'TEMPORARY_TRAFFIC_RESTRICTION', 'INFRASTRUCTURE_CONSTRAINT', 'PERMIT_CONDITION']);
export const INTEGRATION_STATUSES = Object.freeze(['SOURCE_IDENTIFIED', 'TECHNICALLY_DOCUMENTED', 'ACCESS_PENDING', 'LICENCE_PENDING', 'INTEGRATION_READY', 'ACTIVE']);
export const ACQUISITION_METHODS = Object.freeze(['MANUAL_EVIDENCE', 'DATEX_II', 'TN_ITS', 'OGC_API', 'WFS', 'WMS', 'RSS_ATOM', 'JSON_API', 'XML_API', 'HTML_PDF', 'UNKNOWN']);
export const ORIGINS = Object.freeze(['CANONICAL', 'TARGETED_REVIEW', 'OVERSIZE_MONITORING', 'PROVIDER_CANDIDATE', 'MACHINE_INTERFACE']);
export const EVIDENCE_USES = Object.freeze(['LEGAL_EVIDENCE', 'CROSS_CHECK_ONLY', 'DISCOVERY_LEAD', 'FUTURE_CONNECTOR', 'MACHINE_INTERFACE']);
/** Connectors that actually fetch data in production. None exist in this phase. */
export const IMPLEMENTED_CONNECTORS = Object.freeze([]);

// Scope checks of a jurisdiction review are the evidence-backed link between a source and a category.
const SCOPE_CATEGORY = Object.freeze({
  weekend: 'STATUTORY_WEEKEND_HOLIDAY', holidays: 'STATUTORY_WEEKEND_HOLIDAY', holiday_eves: 'STATUTORY_WEEKEND_HOLIDAY', special_calendar: 'STATUTORY_WEEKEND_HOLIDAY',
  night: 'NIGHT_SEASONAL', seasonal: 'NIGHT_SEASONAL', summer_winter: 'NIGHT_SEASONAL',
  regional: 'REGIONAL_DIRECTIONAL', corridors: 'REGIONAL_DIRECTIONAL', directional: 'REGIONAL_DIRECTIONAL',
  weight_specific: 'WEIGHT_DIMENSION', exceptional: 'ADR_SPECIAL_TRANSPORT',
});

const rights = z.enum(['allowed', 'denied', 'unknown']);
const reachability = z.object({ checked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/), http_status: z.number().int() }).strict().nullable();
export const sourceEntrySchema = z.object({
  source_id: z.string().regex(/^[a-z0-9][a-z0-9:_.-]{1,159}$/),
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  region: z.string().min(1).nullable(),
  authority: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url().startsWith('https://').nullable(),
  url_reachability: reachability,
  role: z.enum(['PRIMARY', 'SECONDARY']),
  origin: z.array(z.enum(ORIGINS)).min(1),
  evidence_use: z.enum(EVIDENCE_USES),
  categories: z.array(z.enum(SOURCE_CATEGORIES)),
  restriction_classes: z.array(z.enum(RESTRICTION_CLASSES)),
  legal_scope: z.string().min(1),
  geographic_scope: z.string().min(1),
  document_version: z.string().nullable(),
  acquisition: z.object({ method: z.enum(ACQUISITION_METHODS), formats: z.array(z.string().min(1)), access_requirements: z.array(z.string().min(1)) }).strict(),
  gates: z.object({
    technical_documentation: z.object({ state: z.enum(['DOCUMENTED', 'NOT_DOCUMENTED', 'MANUAL_ONLY']), basis: z.enum(['VERIFIED_RESPONSE', 'PUBLIC_DOCUMENTATION', 'PROVIDER_DOCUMENTATION', 'PRODUCTION_USE', 'NONE']) }).strict(),
    access: z.object({ state: z.enum(['OPEN', 'GRANTED', 'REGISTRATION_REQUIRED', 'REQUESTED', 'NOT_REQUESTED', 'UNKNOWN']), basis: z.enum(['VERIFIED_RESPONSE', 'PUBLIC_DOCUMENTATION', 'PROVIDER_DOCUMENTATION', 'PRODUCTION_USE', 'NONE']) }).strict(),
  }).strict(),
  licence: z.object({ name: z.string().min(1), basis: z.enum(['PUBLISHED_TERMS_VERIFIED', 'PROVIDER_STATEMENT', 'NONE']), attribution: z.string().min(1) }).strict(),
  rights: z.object({ storage: rights, history: rights, derived_intelligence: rights, redistribution: rights, commercial_use: rights, attribution_required: z.boolean().nullable() }).strict(),
  commercial_use_note: z.string().min(1),
  update_frequency: z.string().min(1),
  last_verified_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable(),
  availability: z.enum(['REACHABLE_AT_LAST_CHECK', 'SOURCE_UNAVAILABLE', 'UNKNOWN']),
  retrieval_method: z.string().nullable(),
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  machine_interface_id: z.string().nullable(),
  other_dajc_uses: z.array(z.string()),
  blockers: z.array(z.string().min(1)),
  provenance_refs: z.array(z.string().min(1)).min(1),
  connector_id: z.string().nullable(),
  integration_status: z.enum(INTEGRATION_STATUSES),
}).strict();

const unknownRights = () => ({ storage: 'unknown', history: 'unknown', derived_intelligence: 'unknown', redistribution: 'unknown', commercial_use: 'unknown', attribution_required: null });
const formatOf = url => /\.pdf(?:$|[?#])/i.test(url) || /\/pdf\//i.test(url) ? 'PDF' : 'HTML';
const unique = values => [...new Set(values.filter(Boolean))];

/** A published, verified licence with explicit reuse decisions is the only resolved licence. */
export function licenceResolved(entry) {
  return entry.licence.basis === 'PUBLISHED_TERMS_VERIFIED' && ['derived_intelligence', 'redistribution', 'commercial_use'].every(key => entry.rights[key] !== 'unknown');
}

/** Status is the first unmet gate; ACTIVE needs an implemented connector. */
export function deriveIntegrationStatus(entry, implementedConnectors = IMPLEMENTED_CONNECTORS) {
  if (entry.gates.technical_documentation.state !== 'DOCUMENTED') return 'SOURCE_IDENTIFIED';
  const access = entry.gates.access.state;
  if (access === 'UNKNOWN' || access === 'NOT_REQUESTED') return 'TECHNICALLY_DOCUMENTED';
  if (access === 'REGISTRATION_REQUIRED' || access === 'REQUESTED') return 'ACCESS_PENDING';
  if (!licenceResolved(entry)) return 'LICENCE_PENDING';
  if (!entry.connector_id || !implementedConnectors.includes(entry.connector_id)) return 'INTEGRATION_READY';
  return 'ACTIVE';
}

function interfaceFor(url, interfaces) {
  if (!url) return null;
  const host = new URL(url).hostname;
  return interfaces.find(item => item.hosts.includes(host))?.source_id || null;
}

function fromCanonical(canonical, interfaces) {
  const usage = new Map();
  const use = (id, jurisdiction) => { if (!usage.has(id)) usage.set(id, { jurisdictions: new Set(), rules: [], categories: new Set() }); usage.get(id).jurisdictions.add(jurisdiction); return usage.get(id); };
  for (const rule of canonical.rules) for (const id of unique([rule.source_id, ...(rule.evidence_ids || [])])) use(id, rule.jurisdiction).rules.push(rule);
  for (const row of canonical.jurisdictions) {
    for (const id of row.source_ids || []) use(id, row.jurisdiction);
    for (const [key, check] of Object.entries(row.scope_checks || {})) for (const id of check.evidence_ids || []) use(id, row.jurisdiction).categories.add(SCOPE_CATEGORY[key]);
  }
  return canonical.sources.map(source => {
    const used = usage.get(source.source_id) || { jurisdictions: new Set(), rules: [], categories: new Set() };
    if (used.jurisdictions.size !== 1) throw new Error(`Source ${source.source_id} must belong to exactly one tracked jurisdiction`);
    const [jurisdiction] = used.jurisdictions;
    const regions = unique(used.rules.flatMap(rule => rule.regions || []));
    const categories = new Set(used.categories);
    for (const rule of used.rules) {
      if (rule.schedule?.kind === 'daily') categories.add('NIGHT_SEASONAL');
      if ((rule.regions || []).length || (rule.direction && !/^Both directions/.test(rule.direction))) categories.add('REGIONAL_DIRECTIONAL');
    }
    return {
      source_id: source.source_id, jurisdiction, region: null,
      authority: source.authority, name: `${source.authority} – ${source.version}`,
      url: source.url, url_reachability: null, role: source.role, origin: ['CANONICAL'],
      evidence_use: source.role === 'PRIMARY' ? 'LEGAL_EVIDENCE' : 'CROSS_CHECK_ONLY',
      categories: SOURCE_CATEGORIES.filter(category => categories.has(category)),
      restriction_classes: used.rules.length ? ['LEGAL_DRIVING_BAN'] : [],
      legal_scope: unique(used.rules.map(rule => rule.legal_basis)).join('; ') || 'Supports the jurisdiction review; no rule cites it as its legal basis.',
      geographic_scope: regions.length ? regions.join('; ') : used.rules.length ? 'As stated per rule (roads, regions, direction)' : 'UNKNOWN',
      document_version: source.version || null,
      acquisition: { method: 'MANUAL_EVIDENCE', formats: [formatOf(source.url)], access_requirements: source.access_notes ? [source.access_notes] : [] },
      gates: { technical_documentation: { state: 'MANUAL_ONLY', basis: 'NONE' }, access: { state: source.checked_at ? 'OPEN' : 'UNKNOWN', basis: source.checked_at ? 'VERIFIED_RESPONSE' : 'NONE' } },
      licence: { name: 'UNKNOWN', basis: 'NONE', attribution: 'Cite authority, document and version.' },
      rights: unknownRights(),
      commercial_use_note: source.role === 'PRIMARY' ? 'Official publication; reuse conditions not reviewed.' : 'Third-party publication: cross-check only; reusing or redistributing its content needs separate permission.',
      update_frequency: 'UNKNOWN',
      last_verified_at: source.checked_at || null,
      availability: source.availability === 'SOURCE_UNAVAILABLE' ? 'SOURCE_UNAVAILABLE' : source.checked_at ? 'REACHABLE_AT_LAST_CHECK' : 'UNKNOWN',
      retrieval_method: source.retrieval_method || source.access_method || null,
      content_sha256: source.content_sha256 || null,
      machine_interface_id: interfaceFor(source.url, interfaces),
      other_dajc_uses: [], blockers: [],
      provenance_refs: [`data/driving-bans/canonical.json#sources/${source.source_id}`],
      connector_id: null,
    };
  });
}

function fromTargetedReview(review, interfaces) {
  return review.jurisdictions.flatMap(row => row.sources.map(source => ({
    source_id: source.source_id, jurisdiction: row.jurisdiction, region: null,
    authority: source.authority, name: `${source.authority} – ${source.version}`,
    url: source.url, url_reachability: null, role: source.role, origin: ['TARGETED_REVIEW'],
    evidence_use: 'LEGAL_EVIDENCE', categories: [], restriction_classes: [],
    legal_scope: 'Read in a targeted official-web check; not yet encoded as calendar rules.',
    geographic_scope: source.scope, document_version: source.version || null,
    acquisition: { method: 'MANUAL_EVIDENCE', formats: [formatOf(source.url)], access_requirements: [] },
    gates: { technical_documentation: { state: 'MANUAL_ONLY', basis: 'NONE' }, access: { state: 'OPEN', basis: 'VERIFIED_RESPONSE' } },
    licence: { name: 'UNKNOWN', basis: 'NONE', attribution: 'Cite authority, document and version.' },
    rights: unknownRights(), commercial_use_note: 'Official publication; reuse conditions not reviewed.',
    update_frequency: 'UNKNOWN', last_verified_at: review.reviewed_on, availability: 'REACHABLE_AT_LAST_CHECK',
    retrieval_method: source.retrieval || null, content_sha256: null,
    machine_interface_id: interfaceFor(source.url, interfaces),
    other_dajc_uses: [], blockers: ['Not encoded as calendar rules; see the review remaining items'],
    provenance_refs: [`data/driving-bans/source-reviews/${review.reviewed_on}.json#${source.source_id}`],
    connector_id: null,
  })));
}

function fromOversize(sources, interfaces) {
  return sources.map(source => {
    const feed = Boolean(source.feedUrl);
    return {
      source_id: `oversize:${source.id}`, jurisdiction: source.country, region: source.region || null,
      authority: source.authority, name: source.name, url: source.url, url_reachability: null,
      role: 'PRIMARY', origin: ['OVERSIZE_MONITORING'], evidence_use: 'DISCOVERY_LEAD',
      categories: ['TEMPORARY_RESTRICTIONS_CLOSURES', 'AUXILIARY_TRAFFIC_INFRASTRUCTURE'],
      restriction_classes: ['TEMPORARY_TRAFFIC_RESTRICTION'],
      legal_scope: 'Official news and notices; discovery leads, never legal evidence on their own.',
      geographic_scope: source.region || 'UNKNOWN', document_version: null,
      acquisition: { method: feed ? 'RSS_ATOM' : 'HTML_PDF', formats: feed ? ['RSS/Atom'] : ['HTML'], access_requirements: [] },
      gates: { technical_documentation: { state: feed ? 'DOCUMENTED' : 'NOT_DOCUMENTED', basis: feed ? 'PRODUCTION_USE' : 'NONE' }, access: { state: feed ? 'OPEN' : 'UNKNOWN', basis: feed ? 'PRODUCTION_USE' : 'NONE' } },
      licence: { name: 'UNKNOWN', basis: 'NONE', attribution: 'Cite the publishing authority.' },
      rights: unknownRights(), commercial_use_note: 'Official publication; reuse of full text not reviewed.',
      update_frequency: 'UNKNOWN', last_verified_at: null, availability: 'UNKNOWN', retrieval_method: null, content_sha256: null,
      machine_interface_id: interfaceFor(source.url, interfaces),
      other_dajc_uses: ['EU_OVERSIZE_WEEKLY_MONITOR'], blockers: feed ? ['Reuse terms for Driving Bans not reviewed'] : ['No machine-readable feed recorded'],
      provenance_refs: [`config/oversize-sources/index.mjs#${source.id}`],
      connector_id: null,
    };
  });
}

function fromCurated(records, origin, evidenceUse) {
  return records.map(record => {
    const { hosts, ...rest } = record;
    return {
      ...rest, origin: [origin], evidence_use: evidenceUse, document_version: null,
      commercial_use_note: record.rights.commercial_use === 'unknown' ? 'Commercial use not yet confirmed; do not offer derived data commercially.' : 'See licence.',
      last_verified_at: null, availability: record.url_reachability?.http_status === 200 ? 'REACHABLE_AT_LAST_CHECK' : 'UNKNOWN',
      retrieval_method: null, content_sha256: null, machine_interface_id: null, other_dajc_uses: [],
      provenance_refs: ['config/driving-ban-sources/provider-candidates.mjs'], connector_id: null,
    };
  });
}

/**
 * A targeted-review record that points at a document already in the catalog becomes an alias of it.
 * Canonical identities are never merged (rules cite them), and a provider or news record at the same
 * homepage is a different resource, so those stay separate.
 */
function mergeByUrl(entries) {
  const byUrl = new Map(), out = [];
  for (const entry of entries) {
    const key = entry.url && new URL(entry.url).href;
    const existing = key && byUrl.get(key);
    if (existing && existing.jurisdiction === entry.jurisdiction && entry.origin.includes('TARGETED_REVIEW')) {
      existing.origin = unique([...existing.origin, ...entry.origin]);
      existing.provenance_refs = unique([...existing.provenance_refs, ...entry.provenance_refs]);
      existing.other_dajc_uses = unique([...existing.other_dajc_uses, ...entry.other_dajc_uses]);
      existing.aliases = unique([...(existing.aliases || []), entry.source_id]);
      continue;
    }
    if (key && !byUrl.has(key)) byUrl.set(key, entry);
    out.push(entry);
  }
  return out;
}

export function buildSourceCatalog({ canonical, identities, authorityDomains = {}, oversizeSources = [], targetedReview = null, providerCandidates = [], machineInterfaces = [], interoperabilityReferences = [], implementedConnectors = IMPLEMENTED_CONNECTORS, generatedAt = null }) {
  const merged = mergeByUrl([
    ...fromCanonical(canonical, machineInterfaces),
    ...(targetedReview ? fromTargetedReview(targetedReview, machineInterfaces) : []),
    ...fromOversize(oversizeSources, machineInterfaces),
    ...fromCurated(machineInterfaces, 'MACHINE_INTERFACE', 'MACHINE_INTERFACE'),
    ...fromCurated(providerCandidates, 'PROVIDER_CANDIDATE', 'FUTURE_CONNECTOR'),
  ]);
  const entries = merged.map(({ aliases, ...entry }) => ({ ...entry, provenance_refs: aliases ? unique([...entry.provenance_refs, ...aliases.map(id => `alias:${id}`)]) : entry.provenance_refs, integration_status: deriveIntegrationStatus(entry, implementedConnectors) }));
  const jurisdictions = identities.map(([code, name]) => {
    const own = entries.filter(entry => entry.jurisdiction === code);
    const covered = new Set(own.flatMap(entry => entry.categories));
    const domains = authorityDomains[code] || [];
    return {
      jurisdiction: code, name, official_domains: domains,
      mapping_status: own.some(entry => entry.url) ? 'MAPPED' : domains.length ? 'DOMAINS_ONLY' : 'UNMAPPED',
      source_ids: own.map(entry => entry.source_id),
      legal_evidence_source_ids: own.filter(entry => entry.evidence_use === 'LEGAL_EVIDENCE').map(entry => entry.source_id),
      categories_covered: SOURCE_CATEGORIES.filter(category => covered.has(category)),
      categories_missing: SOURCE_CATEGORIES.filter(category => !covered.has(category)),
      integration_statuses: Object.fromEntries(INTEGRATION_STATUSES.map(status => [status, own.filter(entry => entry.integration_status === status).length])),
    };
  });
  const count = key => Object.fromEntries([...new Set(entries.map(entry => entry[key]))].sort().map(value => [value, entries.filter(entry => entry[key] === value).length]));
  return {
    catalog_version: 1, generated_at: generatedAt, coverage_count: identities.length,
    rule_registry: 'data/driving-bans/canonical.json', coverage_authority: 'config/europe-coverage.mjs',
    note: 'Metadata only. This catalog never contains or creates driving-ban rules; legal verification lives in canonical.json.',
    implemented_connectors: [...implementedConnectors],
    entries, jurisdictions, interoperability_references: interoperabilityReferences,
    summary: {
      entries: entries.length, integration_status: count('integration_status'), evidence_use: count('evidence_use'),
      mapped: jurisdictions.filter(row => row.mapping_status === 'MAPPED').length,
      domains_only: jurisdictions.filter(row => row.mapping_status === 'DOMAINS_ONLY').map(row => row.jurisdiction),
      unmapped: jurisdictions.filter(row => row.mapping_status === 'UNMAPPED').map(row => row.jurisdiction),
      without_legal_evidence: jurisdictions.filter(row => !row.legal_evidence_source_ids.length).map(row => row.jurisdiction),
    },
  };
}

// E-mail addresses and phone numbers (international or spaced national format); ISO dates do not match.
const PERSONAL_DATA = [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, /\+\d[\d ()-]{7,}\d/, /\b\d{3} \d{3} \d{3}\b/];
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, out);
  return out;
}

/** Fail closed on any schema, scope, status or personal-data violation. */
export function validateSourceCatalog(catalog, identities, implementedConnectors = IMPLEMENTED_CONNECTORS) {
  const codes = new Set(identities.map(([code]) => code));
  const ids = new Set();
  for (const entry of catalog.entries) {
    sourceEntrySchema.parse(entry);
    if (ids.has(entry.source_id)) throw new Error(`Duplicate source identity ${entry.source_id}`);
    ids.add(entry.source_id);
    if (!codes.has(entry.jurisdiction)) throw new Error(`Untracked jurisdiction ${entry.jurisdiction} in ${entry.source_id}`);
    if (entry.integration_status !== deriveIntegrationStatus(entry, implementedConnectors)) throw new Error(`Integration status of ${entry.source_id} is not derived from its gates`);
    if (entry.licence.basis !== 'PUBLISHED_TERMS_VERIFIED' && ['storage', 'history', 'derived_intelligence', 'redistribution', 'commercial_use'].some(key => entry.rights[key] !== 'unknown')) throw new Error(`Rights of ${entry.source_id} need verified published terms`);
    if (entry.origin.includes('PROVIDER_CANDIDATE') || entry.origin.includes('MACHINE_INTERFACE')) {
      const hit = strings(entry).find(text => PERSONAL_DATA.some(pattern => pattern.test(text)));
      if (hit) throw new Error(`Possible personal data in ${entry.source_id}`);
    }
  }
  for (const entry of catalog.entries) if (entry.machine_interface_id && !ids.has(entry.machine_interface_id)) throw new Error(`Unknown machine interface for ${entry.source_id}`);
  if (catalog.jurisdictions.length !== codes.size || !catalog.jurisdictions.every((row, index) => row.jurisdiction === identities[index][0])) throw new Error('Catalog jurisdictions must match the central registry');
  return true;
}

const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function catalogToCsv(catalog) {
  const headers = ['source_id', 'jurisdiction', 'region', 'authority', 'url', 'role', 'origin', 'evidence_use', 'categories', 'restriction_classes', 'acquisition_method', 'formats', 'access_requirements', 'licence', 'licence_basis', 'commercial_use', 'derived_intelligence', 'update_frequency', 'last_verified_at', 'availability', 'integration_status', 'blockers'];
  const rows = catalog.entries.map(e => [e.source_id, e.jurisdiction, e.region, e.authority, e.url, e.role, e.origin.join(' | '), e.evidence_use, e.categories.join(' | '), e.restriction_classes.join(' | '), e.acquisition.method, e.acquisition.formats.join(' | '), e.acquisition.access_requirements.join(' | '), e.licence.name, e.licence.basis, e.rights.commercial_use, e.rights.derived_intelligence, e.update_frequency, e.last_verified_at, e.availability, e.integration_status, e.blockers.join(' | ')]);
  return '﻿' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
