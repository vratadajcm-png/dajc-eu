// Access, licence and pacing policy for the automated Driving Bans source monitor
// (src/lib/driving-bans/source-monitor.mjs). Provider-neutral: a host entry only
// describes how DAJC may retrieve a public official document; it never grants a
// legal verification, never bypasses bot protection and never enables a paid or
// licence-restricted source. Unknown hosts use the conservative defaults.
//
// Evidence for every entry is recorded in docs/DRIVING_BANS_SOURCE_MONITOR.md.

export const MONITOR_DEFAULTS = Object.freeze({
  // Minimum pause between two requests to the same host; requests are serial.
  hostIntervalMs: 1500,
  // Only official PRIMARY sources are fetched. Secondary sources (associations,
  // press, aggregators) stay discovery leads and are never machine-verified.
  roles: Object.freeze(['PRIMARY']),
  // A run where fewer retrievable sources succeed is reported as degraded.
  minSuccessRate: 0.6,
});

export const HOST_POLICIES = Object.freeze({
  // Austrian RIS web interface answers automated clients with a "Security Check"
  // page (HTTP 503). It is never bypassed; the official OGD document mirror
  // ogd.ris.bka.gv.at is used instead (same document bytes).
  'ris.bka.gv.at': Object.freeze({
    state: 'ACCESS_BLOCKED',
    reason: 'RIS web interface serves a bot "Security Check" (HTTP 503) to automated clients; use the RIS OGD document recorded in retrieval_method.',
  }),
  // RIS OGD terms (data.bka.gv.at/ris/api/v2.6, retrieved 18 Nov 2026): CC BY 4.0
  // attribution; at most 0.5 requests/s; no parallel connections; automated
  // queries outside Austrian office hours (20:00-05:00 local) or on weekends and
  // Austrian public holidays.
  'ogd.ris.bka.gv.at': Object.freeze({
    licence: 'CC BY 4.0 - Rechtsinformationssystem des Bundes (RIS), data.bka.gv.at',
    hostIntervalMs: 2000,
    allowedWindow: Object.freeze({ timezone: 'Europe/Vienna', weekdayFrom: '20:00', weekdayTo: '05:00', weekends: true }),
  }),
  // saarland.de returns HTTP 403 to automated clients; never bypassed.
  'saarland.de': Object.freeze({
    state: 'ACCESS_BLOCKED',
    reason: 'saarland.de answers automated clients with HTTP 403; record SOURCE_UNAVAILABLE and review manually.',
  }),
});

// The most specific (longest) matching domain wins, so ogd.ris.bka.gv.at is
// never treated as the blocked ris.bka.gv.at web interface.
export function hostPolicyFor(hostname, policies = HOST_POLICIES) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const match = Object.keys(policies)
    .filter((domain) => host === domain || host.endsWith(`.${domain}`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? policies[match] : null;
}
