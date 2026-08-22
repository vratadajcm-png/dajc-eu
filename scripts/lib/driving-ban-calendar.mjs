// Resolves config/driving-ban-calendars entries into finding-shaped
// candidates for a given target week, and surfaces "annual-calendar" entries
// that have not been re-seeded for the requested year as explicit
// maintenance errors instead of silently reusing a previous year's dates
// (see config/driving-ban-calendars/index.mjs and
// docs/NEWS_AUTOMATION.md "Annual calendar maintenance").

import { drivingBanCalendars } from '../../config/driving-ban-calendars/index.mjs';

/**
 * @param {{ weekStart: Date, weekEnd: Date, year: number }} args
 * @returns {{ findings: object[], maintenanceErrors: string[] }}
 */
export function resolveDrivingBanFindings({ weekStart, weekEnd, year }) {
  const findings = [];
  const maintenanceErrors = [];

  for (const entry of drivingBanCalendars) {
    const result = entry.resolve(weekStart, weekEnd, year);
    if (result.maintenanceError) {
      maintenanceErrors.push(`[${entry.country}/${entry.id}] ${result.maintenanceError}`);
      continue;
    }
    for (const occurrence of result.occurrences || []) {
      findings.push({
        country: entry.countryName,
        region: null,
        location: occurrence.location || entry.routeScope,
        type: 'driving_ban',
        title: occurrence.title,
        summary: occurrence.whatChanged,
        validFrom: occurrence.validFrom || null,
        validTo: occurrence.validTo || null,
        impact: occurrence.impact || null,
        recommendedAction: occurrence.recommendedAction || null,
        vehicleScope: occurrence.vehicleScope || entry.vehicleScope,
        timeWindow: occurrence.timeWindow || null,
        exemptions: occurrence.exemptions || entry.exemptionNotes || null,
        routeScope: entry.routeScope,
        sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl,
        additionalSources: occurrence.additionalSources || entry.additionalSources || [],
        confidence: 'verified',
        status: 'active',
        isDrivingBan: true,
        isInfrastructure: false,
        isOfficialCalendar: true,
      });
    }
  }

  return { findings, maintenanceErrors };
}
