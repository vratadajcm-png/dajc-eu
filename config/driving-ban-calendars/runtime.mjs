import { drivingBanCalendars as baseDrivingBanCalendars } from './index.mjs';
import { currentDrivingBanExceptions } from './current-exceptions.mjs';
import { sloveniaCurrentDrivingBanExceptions } from './slovenia-current-exceptions.mjs';

export const drivingBanCalendars = [
  ...baseDrivingBanCalendars,
  ...currentDrivingBanExceptions,
  ...sloveniaCurrentDrivingBanExceptions,
];

export function getCalendarById(id) {
  return drivingBanCalendars.find((entry) => entry.id === id);
}
