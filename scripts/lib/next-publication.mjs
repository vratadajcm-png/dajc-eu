// Formats when the next EU Oversize Weekly is expected, for the closing
// section of each published article (see renderArticleMarkdown in
// render-article.mjs). The pipeline runs every Friday, so "next" is always
// 7 days after the run that is publishing the current article. Mirrors the
// display format of formatEuOversizeLaunchDate in src/config/news.ts, kept
// as its own small helper here since scripts/ is plain Node and doesn't
// import from src/.
export function formatNextPublicationLabel(from = new Date()) {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + 7);

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
