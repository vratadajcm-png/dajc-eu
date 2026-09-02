import type { APIRoute } from 'astro';
import { drivingBanCalendars } from '../../../config/driving-ban-calendars/runtime.mjs';

export const prerender = false;

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const icsDate = (value: string) => value.replaceAll('-', '');
const nextDate = (value: string) => iso(new Date(Date.parse(`${value}T00:00:00Z`) + DAY));
const esc = (value = '') => value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');

function mondayOnOrBefore(date: Date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const selected = new Set((url.searchParams.get('countries') || '').split(',').map((x) => x.trim()).filter(Boolean));
  const type = url.searchParams.get('type') || 'all';
  const rolling = url.searchParams.get('rolling') === '1';

  const now = new Date();
  const from = rolling
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    : new Date(`${url.searchParams.get('from') || '2026-09-01'}T00:00:00Z`);
  const to = rolling
    ? addMonths(from, 13)
    : new Date(`${url.searchParams.get('to') || '2026-10-31'}T23:59:59Z`);

  const events: any[] = [];
  const seen = new Set<string>();

  for (let week = mondayOnOrBefore(from); week <= to; week = new Date(week.getTime() + 7 * DAY)) {
    const weekEnd = new Date(week.getTime() + 6 * DAY);
    const year = week.getUTCFullYear();

    for (const rule of drivingBanCalendars as any[]) {
      if (selected.size && !selected.has(rule.country)) continue;
      const exceptional = /exceptional|special vehicle|oversize|abnormal|schwertransport|großraum/i.test(`${rule.id} ${rule.legalBasis || ''} ${rule.vehicleScope || ''}`);
      if (type === 'general' && exceptional) continue;
      if (type === 'exceptional' && !exceptional) continue;

      let resolved: any;
      try { resolved = rule.resolve(week, weekEnd, year); } catch { continue; }
      for (const occurrence of resolved?.occurrences || []) {
        if (!occurrence.validFrom || !occurrence.validTo) continue;
        if (occurrence.validTo < iso(from) || occurrence.validFrom > iso(to)) continue;
        const key = `${rule.id}|${occurrence.validFrom}|${occurrence.validTo}|${occurrence.timeWindow || occurrence.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({ rule, occurrence });
      }
    }
  }

  events.sort((a, b) => a.occurrence.validFrom.localeCompare(b.occurrence.validFrom) || a.rule.country.localeCompare(b.rule.country));

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DAJC//European HGV Driving Bans//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:DAJC European HGV Driving Bans',
    'X-WR-CALDESC:Planning information. Verify restrictions and permits before departure.',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'
  ];

  for (const { rule, occurrence } of events) {
    const description = [
      occurrence.timeWindow && `When: ${occurrence.timeWindow}`,
      rule.vehicleScope && `Affected: ${rule.vehicleScope}`,
      rule.routeScope && `Where: ${rule.routeScope}`,
      occurrence.impact && `Impact: ${occurrence.impact}`,
      rule.exemptionNotes && `Exceptions/conditions: ${rule.exemptionNotes}`,
      rule.sourceName && `Source: ${rule.sourceName}`,
      rule.sourceUrl && `Source URL: ${rule.sourceUrl}`,
      'DAJC planning information — verify before departure.'
    ].filter(Boolean).join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(`${rule.id}-${occurrence.validFrom}-${occurrence.validTo}@dajc.eu`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(occurrence.validFrom)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDate(occurrence.validTo))}`,
      `SUMMARY:${esc(`${rule.countryName} — ${occurrence.title}`)}`,
      `DESCRIPTION:${esc(description)}`,
      rule.sourceUrl ? `URL:${rule.sourceUrl}` : '',
      'STATUS:CONFIRMED',
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  const body = lines.filter(Boolean).join('\r\n') + '\r\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="dajc-european-hgv-driving-bans.ics"',
      'Cache-Control': 'public, max-age=900, s-maxage=900'
    }
  });
};
