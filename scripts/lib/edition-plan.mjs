// One ISO-week/publication plan shared by generation, review and watchdog.
import { isoWeekLabel, isoWeekStart } from './week.mjs';
import { publicationSlotFor, pragueNoon, targetWeekDateFor } from './next-publication.mjs';

export function isoWeekDate(label) {
  if (!/^\d{4}-W\d{2}$/.test(String(label))) throw new Error('Invalid target ISO week; expected YYYY-Www');
  const year = Number(label.slice(0, 4));
  const week = Number(label.slice(6));
  if (year < 2000 || year > 9999 || week < 1 || week > 53) throw new Error('Invalid target ISO week');
  const monday = isoWeekStart(new Date(Date.UTC(year, 0, 4)));
  monday.setUTCDate(monday.getUTCDate() + (week - 1) * 7);
  if (isoWeekLabel(monday) !== label) throw new Error('Target ISO week does not exist: ' + label);
  return monday;
}

export function editionPlan({ now = new Date(), targetWeek = '' } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid preparation time');
  const targetDate = targetWeek ? isoWeekDate(targetWeek) : isoWeekStart(targetWeekDateFor(publicationSlotFor(now)));
  const friday = new Date(targetDate.getTime() - 3 * 86400000);
  const publicationSlot = pragueNoon(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate());
  const late = now > publicationSlot;
  return {
    targetWeek: isoWeekLabel(targetDate), targetDate, publicationSlot, late,
    // Never backdate a delayed edition to its missed release slot.
    publishedAt: (late ? now : publicationSlot).toISOString(), preparedAt: now.toISOString(),
    findingsWeeks: [...new Set([isoWeekLabel(publicationSlot), isoWeekLabel(now)])],
  };
}
