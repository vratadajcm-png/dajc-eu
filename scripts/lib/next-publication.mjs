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
