// Single source of truth for the EU Oversize Weekly pre-launch placeholder
// (src/components/EuOversizeLaunchNotice.astro, used from the homepage News
// section and /news). Update this one value when the actual launch date
// changes - nothing else should hardcode it.
export const EU_OVERSIZE_FIRST_PUBLICATION = '2026-08-21T12:00:00+02:00';

export const EU_OVERSIZE_LAUNCH_DESCRIPTION =
  'Weekly updates on permits, driving bans, escorts, route restrictions and infrastructure changes affecting heavy and oversized transport across Europe.';

export type EuOversizeLaunchPhase = 'upcoming' | 'awaiting-first-article';

/**
 * Whether the launch date is still ahead of `now`, or has already passed
 * without a first article having gone out. Callers only need this when no
 * published `eu-oversize` entry exists yet - once one does, the placeholder
 * is skipped entirely regardless of this phase.
 */
export function getEuOversizeLaunchPhase(now: Date = new Date()): EuOversizeLaunchPhase {
  const launch = new Date(EU_OVERSIZE_FIRST_PUBLICATION);
  return now.getTime() < launch.getTime() ? 'upcoming' : 'awaiting-first-article';
}

/**
 * Formats the launch date/time in Europe/Prague as, e.g.,
 * "Friday, 21 August 2026 at 12:00 CEST" - the abbreviation reflects
 * whichever of CET/CEST actually applies to that date.
 */
export function formatEuOversizeLaunchDate(): string {
  const launch = new Date(EU_OVERSIZE_FIRST_PUBLICATION);

  const datePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(launch);

  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(launch);

  const timeZoneName =
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Prague',
      timeZoneName: 'short',
    })
      .formatToParts(launch)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';

  return `${datePart} at ${timePart}${timeZoneName ? ` ${timeZoneName}` : ''}`;
}
