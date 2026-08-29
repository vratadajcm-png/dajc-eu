// Pre-selection pass before verification and OpenAI synthesis.
// The weekly edition now targets a much broader Europe-wide intelligence
// surface, so the candidate pool must be large enough to support 20-30 leads
// plus Around Europe without favouring a handful of high-volume sources.

const SPECIFIC_TYPES = new Set([
  'permit_change', 'permit_system', 'driving_ban', 'escort_requirement',
  'police_escort', 'border_restriction', 'bridge_restriction',
  'tunnel_restriction', 'route_restriction', 'road_closure', 'roadworks',
  'weight_restriction', 'axle_load_restriction', 'height_restriction',
  'width_restriction', 'toll_change', 'port_restriction', 'ferry_restriction',
  'weather_restriction', 'enforcement', 'legislation', 'digitalisation',
  'equipment', 'market', 'project_cargo', 'industry_project',
]);

const MAX_PER_SOURCE = 6;
const MAX_TOTAL = 80;

export function selectCandidates(findings) {
  const active = findings.filter((f) => f.status !== 'expired' && f.status !== 'superseded');

  const scored = active.map((f) => {
    let score = 0;
    if (f.status === 'new') score += 4;
    else if (f.status === 'updated') score += 3;
    else score += 1;
    if (SPECIFIC_TYPES.has(f.type)) score += 3;
    if (f.summary && f.summary.length > 40) score += 1;
    if (f.impact) score += 1;
    if (f.recommendedAction) score += 1;
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
