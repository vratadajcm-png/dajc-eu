// Public, config and Intelligence consumers share ONE canonical source.
// Retired curated files are not runtime inputs and must never be concatenated here.
export { canonicalDrivingBans, drivingBanCalendars, getDrivingBansSnapshot, getCalendarById, restrictionTypesOf, matchesRestrictionType } from './canonical.mjs';
