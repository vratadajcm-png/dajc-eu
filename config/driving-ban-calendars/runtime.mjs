import { drivingBanCalendars as baseDrivingBanCalendars } from './index.mjs';
import { currentDrivingBanExceptions } from './current-exceptions.mjs';
import { sloveniaCurrentDrivingBanExceptions } from './slovenia-current-exceptions.mjs';
import { publicHolidayDrivingBans } from './public-holidays.mjs';
import { verifiedSepOct2026DrivingBans } from './verified-sep-oct-2026.mjs';

export const drivingBanCalendars = [
  ...baseDrivingBanCalendars,
  ...publicHolidayDrivingBans,
  ...currentDrivingBanExceptions,
  ...sloveniaCurrentDrivingBanExceptions,
  ...verifiedSepOct2026DrivingBans,
];

export function getCalendarById(id) {
  return drivingBanCalendars.find((entry) => entry.id === id);
}

const EXCEPTIONAL_PATTERN = /exceptional|special vehicle|oversize|abnormal|schwertransport|großraum/i;

/**
 * Restriction types ('general' / 'exceptional') a rule belongs to for the
 * calendar filters. An explicit `restrictionTypes` wins (e.g. Italy's decree
 * binds both ordinary HGVs and authorised exceptional transports); otherwise
 * the rule's id, legal basis and vehicle scope decide.
 * @returns {string[]}
 */
export function restrictionTypesOf(rule) {
  if (Array.isArray(rule.restrictionTypes) && rule.restrictionTypes.length) return rule.restrictionTypes;
  return EXCEPTIONAL_PATTERN.test(`${rule.id} ${rule.legalBasis || ''} ${rule.vehicleScope || ''}`)
    ? ['exceptional']
    : ['general'];
}

/**
 * True when the rule should be listed under the given filter.
 * - 'all': every maintained restriction (general HGV bans plus
 *   oversize/exceptional-transport-specific rules).
 * - 'general': rules that bind ordinary HGVs; oversize-only rules are left out.
 * - 'exceptional' (kept for existing feed URLs): same as 'all'. An oversize
 *   or exceptional transport is still a heavy goods vehicle, so the general
 *   HGV bans apply to it in addition to the oversize-specific rules.
 */
export function matchesRestrictionType(rule, type) {
  if (type === 'all' || type === 'exceptional') return true;
  return restrictionTypesOf(rule).includes(type);
}
