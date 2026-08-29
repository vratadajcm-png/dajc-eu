// Pre-selection pass, run BEFORE the (network-cost) verification step and
// BEFORE the (token-cost) OpenAI call - keeps both cheap by narrowing ~150+
// raw findings down to a bounded set of genuinely promising candidates. The official calendar layer is added separately and is never counted against this cap.
// This is the "diff/dedupe before sending to AI" step from the cost-control
// requirement; it never decides what's TRUE, only what's worth checking.

import { checkOperationalRelevance } from './relevance-filter.mjs';
import { checkLongRoadClosure } from './closure-duration.mjs';
import { isCriticalWeeklyCandidate } from './critical-floor.mjs';

const SPECIFIC_TYPES = new Set([
  'permit_change', 'permit_system', 'driving_ban', 'escort_requirement',
  'police_escort', 'border_restriction', 'bridge_restriction',
  'tunnel_restriction', 'route_restriction', 'road_closure', 'roadworks',
]);

const MAX_PER_SOURCE = 4;
const MAX_TOTAL = 32;

export function selectCandidates(findings, { discoveryWindowStart } = {}) {
  const active = findings.filter((f) => {
    if (f.status === 'expired' || f.status === 'superseded') return false;
    const text = `${f.title || ''} ${f.summary || ''}`;
    if (!checkOperationalRelevance(text).ok) return false;
    return checkLongRoadClosure(f).ok;
  });

  const critical = active.filter((finding) =>
    isCriticalWeeklyCandidate(finding, { discoveryWindowStart })
  );
  const criticalUrls = new Set(critical.map((finding) => finding.sourceUrl).filter(Boolean));
  const ordinary = active.filter((finding) => !criticalUrls.has(finding.sourceUrl));

  const scored = ordinary.map((f) => {
    let score = 0;
    if (f.status === 'new') score += 3;
    else if (f.status === 'updated') score += 2;
    else score += 1;
    if (SPECIFIC_TYPES.has(f.type)) score += 3;
    const text = `${f.title || ''} ${f.summary || ''}`;
    if (/exceptional transport|oversize|abnormal load|ausnahmetransport|schwertransport|convoi exceptionnel|izvanredni prijevoz/i.test(text)) score += 6;
    if (/escort|begleitung|pilot vehicle|doprovod|accompagnement/i.test(text)) score += 5;
    if (/toll|vignette|road user charge|via toll/i.test(text)) score += 3;
    if (f.summary && f.summary.length > 40) score += 1;
    return { finding: f, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const perSourceCount = new Map();
  const selected = [...critical];
  for (const { finding } of scored) {
    const sourceKey = finding.sourceName;
    const count = perSourceCount.get(sourceKey) || 0;
    if (count >= MAX_PER_SOURCE) continue;
    perSourceCount.set(sourceKey, count + 1);
    selected.push(finding);
    if (selected.length >= MAX_TOTAL + critical.length) break;
  }

  return selected;
}
