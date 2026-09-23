import { drivingBanCalendars as baseDrivingBanCalendars } from './index.mjs';
import { currentDrivingBanExceptions } from './current-exceptions.mjs';
import { sloveniaCurrentDrivingBanExceptions } from './slovenia-current-exceptions.mjs';
import { publicHolidayDrivingBans } from './public-holidays.mjs';

export const drivingBanCalendars = [
  ...baseDrivingBanCalendars,
  ...publicHolidayDrivingBans,
  ...currentDrivingBanExceptions,
  ...sloveniaCurrentDrivingBanExceptions,
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

/** True when the rule should be listed under the given filter ('all', 'general' or 'exceptional'). */
export function matchesRestrictionType(rule, type) {
  return type === 'all' || restrictionTypesOf(rule).includes(type);
}
