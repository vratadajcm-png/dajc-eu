import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseCalendarForm, parseCorridor, parseSubscriptionForm, webcalUrl } from './account-forms';

const form = (entries: Array<[string, string]>) => { const data = new FormData(); for (const [key, value] of entries) data.append(key, value); return data; };

describe('DAJC Intelligence account forms', () => {
  it('builds a strict calendar filter from the issue form', () => {
    const filter = parseCalendarForm(form([
      ['label', ' Fleet CZ-AT '], ['jurisdictions', 'cz, at'], ['type', 'general'],
      ['vehicle_configuration', 'TRUCK_TRAILER'], ['motor_vehicle_mass_kg', '18000'], ['trailer_mass_kg', '12 000'.replace(' ', '')], ['adr', 'on'],
      ['corridor', 'AT: A12, A13\nDE\nIT/Trentino-Alto Adige: A22'],
    ]));
    expect(filter).toEqual({
      label: 'Fleet CZ-AT', jurisdictions: ['CZ', 'AT'], type: 'general',
      vehicle: { configuration: 'TRUCK_TRAILER', motorVehicleMassKg: 18000, trailerMassKg: 12000, adr: true, exceptionalTransport: false },
      corridor: [{ jurisdiction: 'AT', roads: ['A12', 'A13'] }, { jurisdiction: 'DE', roads: [] }, { jurisdiction: 'IT', region: 'Trentino-Alto Adige', roads: ['A22'] }],
    });
    expect(parseCalendarForm(form([['label', 'All']]))).toEqual({ label: 'All', jurisdictions: [], type: 'all' });
    expect(parseCorridor('  \n ')).toBeUndefined();
  });

  it('refuses anything the calendar does not know, including a smuggled organisation', () => {
    expect(() => parseCalendarForm(form([['label', '']]))).toThrow(ZodError);
    expect(() => parseCalendarForm(form([['label', 'x'], ['jurisdictions', 'XX']]))).toThrow(ZodError);
    expect(() => parseCalendarForm(form([['label', 'x'], ['vehicle_configuration', 'SOLO'], ['motor_vehicle_mass_kg', 'heavy']]))).toThrow(ZodError);
    const smuggled = parseCalendarForm(form([['label', 'x'], ['organizationId', 'org-b'], ['userId', 'u']]));
    expect(Object.keys(smuggled).sort()).toEqual(['jurisdictions', 'label', 'type']);
  });

  it('always asks for the calendar and only for subscribable features', () => {
    expect(parseSubscriptionForm(form([['features', 'route-aware'], ['features', 'alerts'], ['period', 'YEAR'], ['note', 'PO 4711']]))).toEqual({ features: ['personal-calendar', 'route-aware'], period: 'YEAR', note: 'PO 4711' });
    expect(parseSubscriptionForm(form([])).period).toBe('MONTH');
    expect(webcalUrl('https://www.dajc.eu/api/intelligence/calendar/dcal_x.ics')).toBe('webcal://www.dajc.eu/api/intelligence/calendar/dcal_x.ics');
  });
});
