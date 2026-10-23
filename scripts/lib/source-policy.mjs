// One canonical provenance and expansion policy for DAJC European freight news.
// Search is OPEN-WEB (not a fixed site allowlist); this register only identifies
// known primary authorities for priority and attribution.
import { oversizeSources } from '../../config/oversize-sources/index.mjs';

export const MIN_PRIMARY_ITEMS_BEFORE_FALLBACK = 3;
export const PRIMARY_TIER = 'official';
export const SECONDARY_TIER = 'industry';

const knownAuthorities = new Set();
for (const source of oversizeSources) {
  for (const url of [source.url, source.feedUrl, ...(source.htmlUrls || [])].filter(Boolean)) {
    try { knownAuthorities.add(new URL(url).hostname.toLowerCase().replace(/^www\./, '')); }
    catch { /* An invalid legacy endpoint cannot make an unknown site official. */ }
  }
}

export function isOfficialPublisher(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (knownAuthorities.has(host) || [...knownAuthorities].some(d => host.endsWith('.' + d))) return true;
    // Common European government domains are recognized; an arbitrary
    // .eu/.com transport blog does not become a public authority.
    return /(?:^|\.)(?:gov|gouv|gv|government|bund|admin)\.[a-z.]+$/.test(host) ||
      /(?:^|\.)(?:gov\.uk|gov\.cz|gov\.pl|gov\.sk|gov\.hu|gov\.ro|gov\.si|gov\.hr|gov\.ie|gov\.gr|gov\.al|gov\.mt|gov\.cy|gov\.ua)$/.test(host);
  } catch { return false; }
}

export function sourceTier(url) {
  return isOfficialPublisher(url) ? PRIMARY_TIER : SECONDARY_TIER;
}

export function needsSecondaryDiscovery(primaryCount, threshold = MIN_PRIMARY_ITEMS_BEFORE_FALLBACK) {
  // "few" is a DISCOVERY expansion trigger, not a publication minimum or
  // a licence to relax editorial/critical-news/Driving Bans safety gates.
  return Number.isFinite(primaryCount) && primaryCount < threshold;
}

// High-consequence changes cannot be presented as binding law on a media
// citation alone. An industry report may still be cited as a report, with
// transparent attribution, without demanding independent corroboration for
// routine operator/technology/market intelligence.
export const REGULATORY_TYPES = new Set([
  'permit_change', 'permit_system', 'escort_requirement', 'police_escort',
  'border_restriction', 'bridge_restriction', 'tunnel_restriction',
  'route_restriction', 'road_closure', 'roadworks',
]);

export function secondaryAttribution(finding) {
  if (finding?.sourceTier !== SECONDARY_TIER) return null;
  return REGULATORY_TYPES.has(finding.type)
    ? 'Industry report — regulatory/route conditions require confirmation with the competent authority'
    : 'Industry report — not an official authority notice';
}
