import { drivingBanCalendars as baseDrivingBanCalendars } from './index.mjs';
import { currentDrivingBanExceptions } from './current-exceptions.mjs';

export const drivingBanCalendars = [
  ...baseDrivingBanCalendars,
  ...currentDrivingBanExceptions,
];

export function getCalendarById(id) {
  return drivingBanCalendars.find((entry) => entry.id === id);
}
