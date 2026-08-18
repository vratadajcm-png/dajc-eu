// ISO-8601 week helpers ("2026-W33" style) used to name data/oversize/*
// directories and to label the Friday article.

export function isoWeekLabel(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function isoWeekStart(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 1);
  return d;
}

/** Human-readable "24-30 August 2026" style range for the ISO week of `date`. */
export function isoWeekRangeLabel(date = new Date()) {
  const start = isoWeekStart(date);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  const startMonth = start.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const endMonth = end.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const year = end.getUTCFullYear();

  if (startMonth === endMonth) {
    return `${start.getUTCDate()}-${end.getUTCDate()} ${endMonth} ${year}`;
  }
  return `${start.getUTCDate()} ${startMonth} - ${end.getUTCDate()} ${endMonth} ${year}`;
}
