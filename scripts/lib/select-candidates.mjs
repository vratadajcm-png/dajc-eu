// Pre-selection pass, run BEFORE the (network-cost) verification step and
// BEFORE the (token-cost) OpenAI call - keeps both cheap by narrowing ~150+
// raw findings down to a bounded set of genuinely promising candidates.
// This is the "diff/dedupe before sending to AI" step from the cost-control
// requirement; it never decides what's TRUE, only what's worth checking.

const SPECIFIC_TYPES = new Set([
  'permit_change', 'permit_system', 'driving_ban', 'escort_requirement',
  'police_escort', 'border_restriction', 'bridge_restriction',
  'tunnel_restriction', 'route_restriction', 'road_closure', 'roadworks',
]);

const MAX_PER_SOURCE = 6;
const MAX_TOTAL = 60;

export function selectCandidates(findings) {
  const active = findings.filter((f) => f.status !== 'expired' && f.status !== 'superseded');

  const scored = active.map((f) => {
    let score = 0;
    if (f.status === 'new') score += 3;
    else if (f.status === 'updated') score += 2;
    else score += 1;
    if (SPECIFIC_TYPES.has(f.type)) score += 3;
    if (f.summary && f.summary.length > 40) score += 1;
    return { finding: f, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const perSourceCount = new Map();
  const selected = [];
  for (const { finding } of scored) {
    const sourceKey = finding.sourceName;
    const count = perSourceCount.get(sourceKey) || 0;
    if (count >= MAX_PER_SOURCE) continue;
    perSourceCount.set(sourceKey, count + 1);
    selected.push(finding);
    if (selected.length >= MAX_TOTAL) break;
  }

  return selected;
}
