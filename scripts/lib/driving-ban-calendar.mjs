// Weekly-news compatibility boundary. Actual Driving Bans stay on the dedicated
// web/config/ICS surface; incomplete country coverage is not a news build error.
import { drivingBanCalendars } from '../../config/driving-ban-calendars/runtime.mjs';

export function resolveDrivingBanFindings({ weekStart, weekEnd, year, rules = drivingBanCalendars }) {
  const findings = [], maintenanceErrors = [], coverageWarnings = [];
  if (![weekStart, weekEnd].every(d => d instanceof Date && Number.isFinite(d.getTime())) || weekStart > weekEnd) throw new Error('Invalid weekly Driving Bans window');
  for (const entry of rules) {
    let result;
    try { result = entry.resolve(weekStart, weekEnd, year); }
    catch (error) { maintenanceErrors.push(`[${entry.country}/${entry.id}] ${error instanceof Error ? error.message : 'resolve failed'}`); continue; }
    if (result.maintenanceError) {
      // In the canonical compatibility contract this field explicitly means
      // incomplete jurisdiction review, not invalid individual rule evidence.
      if (entry.kind === 'canonical-rule') coverageWarnings.push(`[${entry.country}] ${result.maintenanceError}`);
      else { maintenanceErrors.push(`[${entry.country}/${entry.id}] ${result.maintenanceError}`); continue; }
    }
    // The dedicated HGV reference must not be republished as weekly news.
    // A newly sourced legal change can still enter the separate news monitor.
    if (entry.kind === 'canonical-rule' && weekEnd.toISOString().slice(0,10) >= '2026-09-01') continue;
    for (const occurrence of result.occurrences || []) {
      if (entry.suppressFromWeeklyAfter && occurrence.validFrom >= entry.suppressFromWeeklyAfter) continue;
      if (entry.suppressSundayOnlyFromWeeklyAfter && occurrence.validFrom === occurrence.validTo && occurrence.validFrom >= entry.suppressSundayOnlyFromWeeklyAfter && new Date(`${occurrence.validFrom}T12:00:00Z`).getUTCDay() === 0) continue;
      if (!occurrence.validFrom || !occurrence.validTo || occurrence.validFrom > weekEnd.toISOString().slice(0,10) || occurrence.validTo < weekStart.toISOString().slice(0,10)) continue;
      findings.push({
        country: entry.countryName, region: null, location: occurrence.location || entry.routeScope,
        type: 'driving_ban', title: occurrence.title, summary: occurrence.whatChanged,
        validFrom: occurrence.validFrom, validTo: occurrence.validTo,
        impact: occurrence.impact || null, recommendedAction: occurrence.recommendedAction || null,
        vehicleScope: occurrence.vehicleScope || entry.vehicleScope, timeWindow: occurrence.timeWindow || null,
        exemptions: occurrence.exemptions || entry.exemptionNotes || null, routeScope: entry.routeScope,
        sourceName: occurrence.sourceName || entry.sourceName, sourceUrl: occurrence.sourceUrl || entry.sourceUrl,
        additionalSources: occurrence.additionalSources || entry.additionalSources || [],
        confidence: 'verified', status: 'active', isDrivingBan: true, isInfrastructure: false, isOfficialCalendar: true,
      });
    }
  }
  const warnings = [...new Set(coverageWarnings)];
  if (warnings.length) console.warn(`Driving Bans country review incomplete (${warnings.length} reviewed-country warnings); this is NOT a NO_BAN decision. See the canonical 104-row coverage report.`);
  return { findings, maintenanceErrors, coverageWarnings: warnings, complete: !warnings.length && !maintenanceErrors.length };
}
