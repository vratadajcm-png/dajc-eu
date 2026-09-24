// Formats the next scheduled Friday EU Oversize Weekly publication.
// A catch-up/manual run may happen on Saturday (or another day), so "next"
// must be the next Friday in Europe/Prague rather than blindly +7 days.
export function formatNextPublicationLabel(from = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    weekday: 'short',
  }).format(from);

  const weekdayIndex = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }[weekday];

  let daysUntilFriday = (5 - weekdayIndex + 7) % 7;
  if (daysUntilFriday === 0) daysUntilFriday = 7;

  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + daysUntilFriday);

  const datePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(next);

  const timeZoneName =
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Prague',
      timeZoneName: 'short',
    })
      .formatToParts(next)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';

  return `${datePart} at 12:00${timeZoneName ? ` ${timeZoneName}` : ''}`;
}

const PRAGUE_WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function pragueParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    weekday: PRAGUE_WEEKDAY_INDEX[get('weekday')],
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** The UTC instant of 12:00 Europe/Prague on the given calendar date (CET or CEST). */
export function pragueNoon(year, month, day) {
  // 10:00 UTC is 12:00 CEST; if Prague is on CET that day, shift by the difference.
  const guess = new Date(Date.UTC(year, month - 1, day, 10, 0, 0));
  const { hour, minute } = pragueParts(guess);
  return new Date(guess.getTime() - ((hour - 12) * 60 + minute) * 60_000);
}

/**
 * The Friday 12:00 Europe/Prague slot a publication run at `now` belongs to.
 *
 * The weekly article is prepared ahead of time (Thursday) and becomes public
 * at this instant, so a run on Monday-Friday targets that week's Friday and a
 * Saturday/Sunday catch-up targets the Friday just gone (already in the past,
 * so the article is visible as soon as it is deployed).
 */
export function publicationSlotFor(now = new Date()) {
  const { weekday, year, month, day } = pragueParts(now);
  const offsetDays = 5 - weekday; // Mon +4 ... Thu +1, Fri 0, Sat -1, Sun -2
  const friday = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return pragueNoon(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate());
}

/**
 * The ISO week a publication slot covers: the Monday-Sunday week after the
 * publication Friday. Returns a date inside that week for the week.mjs helpers.
 */
export function targetWeekDateFor(publicationSlot) {
  const d = new Date(publicationSlot);
  d.setUTCDate(d.getUTCDate() + 7);
  return d;
}
