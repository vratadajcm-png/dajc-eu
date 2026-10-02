// Shared model for EU Oversize "findings" - one structured record per
// permit/ban/escort/border/infrastructure/market change tracked across the
// week. See docs/NEWS_AUTOMATION.md for the full data model description.

import { createHash } from 'node:crypto';

export const FINDING_TYPES = [
  'permit_change',
  'permit_system',
  'driving_ban',
  'escort_requirement',
  'police_escort',
  'border_restriction',
  'bridge_restriction',
  'tunnel_restriction',
  'route_restriction',
  'road_closure',
  'roadworks',
  'infrastructure',
  'operational_change',
  'equipment',
  'market',
];

export const FINDING_STATUSES = ['new', 'updated', 'active', 'expired', 'superseded'];

/**
 * Stable dedup key for a finding: same underlying real-world change should
 * always hash to the same key across daily runs, regardless of wording
 * drift in the title/summary. Based on country + location/system + type +
 * source, per the brief's recommended combination.
 */
export function findingKey(finding) {
  const parts = [
    finding.country,
    finding.region || '',
    normalizeForKey(finding.location),
    finding.type,
    normalizeForKey(finding.sourceUrl || finding.sourceName),
  ];
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function normalizeForKey(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function contentChanged(previous, candidate) {
  return (
    previous.title !== candidate.title ||
    previous.summary !== candidate.summary ||
    previous.validTo !== candidate.validTo ||
    previous.impact !== candidate.impact
  );
}

/**
 * Merge a freshly-scraped candidate finding into the existing week's
 * findings map (keyed by findingKey). Mutates nothing - returns a new map.
 *
 * - Never seen before (this week or in `history`) -> status "new",
 *   firstSeenAt = now.
 * - Seen before, content materially changed (title/summary/validTo) ->
 *   status "updated", firstSeenAt preserved.
 * - Seen before, content unchanged -> status stays "active" (or whatever it
 *   already was, unless it was "new"/"updated" from a previous run, which
 *   ages into "active").
 *
 * `history` maps sourceUrl -> the finding as recorded in earlier ISO weeks.
 * Each week has its own findings file, so without it every page would be
 * "new" again every Monday - discovery would masquerade as freshness. The
 * source URL is the identity across weeks (the dedup key also hashes the
 * classified type, which can change when classification rules improve).
 *
 * Findings not present in `candidates` at all this run are handled
 * separately by `markExpired` - this function only touches things the
 * monitor actually saw today.
 */
export function mergeFindings(existingByKey, candidates, now = new Date().toISOString(), { history = new Map() } = {}) {
  const merged = new Map();
  const keyByUrl = new Map();

  // Entries already in this week's file keep their record, but inherit the
  // real first-discovery time from earlier weeks.
  for (const [key, finding] of existingByKey) {
    const earlier = finding.sourceUrl ? history.get(finding.sourceUrl) : null;
    if (earlier?.firstSeenAt && (!finding.firstSeenAt || earlier.firstSeenAt < finding.firstSeenAt)) {
      merged.set(key, {
        ...finding,
        firstSeenAt: earlier.firstSeenAt,
        status: finding.status === 'new' ? (contentChanged(earlier, finding) ? 'updated' : 'active') : finding.status,
      });
    } else {
      merged.set(key, finding);
    }
    if (finding.sourceUrl) keyByUrl.set(finding.sourceUrl, key);
  }

  for (const candidate of candidates) {
    const key = findingKey(candidate);
    const existingKey = merged.has(key) ? key : keyByUrl.get(candidate.sourceUrl);
    const previous = existingKey ? merged.get(existingKey) : (candidate.sourceUrl ? history.get(candidate.sourceUrl) : null);

    if (existingKey && existingKey !== key) merged.delete(existingKey);
    if (candidate.sourceUrl) keyByUrl.set(candidate.sourceUrl, key);

    if (!previous) {
      merged.set(key, {
        ...candidate,
        status: 'new',
        firstSeenAt: now,
        lastCheckedAt: now,
      });
      continue;
    }

    merged.set(key, {
      ...candidate,
      publishedAt: candidate.publishedAt ?? previous.publishedAt ?? null,
      publishedAtSource: candidate.publishedAt ? (candidate.publishedAtSource ?? null) : (previous.publishedAtSource ?? null),
      status: contentChanged(previous, candidate) ? 'updated' : previous.status === 'expired' || previous.status === 'superseded'
        ? 'new'
        : 'active',
      firstSeenAt: previous.firstSeenAt || now,
      lastCheckedAt: now,
    });
  }

  return merged;
}

/**
 * sourceUrl -> earliest recorded sighting across earlier weeks' findings
 * (most recent record for content/publication fields, earliest firstSeenAt).
 * @param {Iterable<object>[]} weeksNewestFirst
 */
export function buildFindingHistory(weeksNewestFirst = []) {
  const history = new Map();
  for (const findings of weeksNewestFirst) {
    for (const finding of findings) {
      if (!finding?.sourceUrl) continue;
      const known = history.get(finding.sourceUrl);
      if (!known) {
        history.set(finding.sourceUrl, { ...finding });
        continue;
      }
      if (finding.firstSeenAt && (!known.firstSeenAt || finding.firstSeenAt < known.firstSeenAt)) {
        known.firstSeenAt = finding.firstSeenAt;
      }
      if (!known.publishedAt && finding.publishedAt) {
        known.publishedAt = finding.publishedAt;
        known.publishedAtSource = finding.publishedAtSource ?? null;
      }
    }
  }
  return history;
}

/**
 * Findings that existed before this run but were not re-confirmed by any
 * source today, and whose validTo (if any) has passed, are marked expired.
 * Findings without a validTo are left as-is (still "active") since absence
 * from one day's crawl isn't proof the restriction ended - only an explicit
 * validTo passing, or a source no longer listing it for N consecutive days,
 * should expire it. This function only handles the explicit-validTo case;
 * the N-consecutive-days case is intentionally left as a future refinement
 * (see docs/NEWS_AUTOMATION.md troubleshooting section).
 */
export function markExpired(existingByKey, now = new Date()) {
  const updated = new Map(existingByKey);
  for (const [key, finding] of updated) {
    if (finding.status === 'expired' || finding.status === 'superseded') continue;
    if (finding.validTo && new Date(finding.validTo) < now) {
      updated.set(key, { ...finding, status: 'expired' });
    }
  }
  return updated;
}

export function isValidFindingType(type) {
  return FINDING_TYPES.includes(type);
}
