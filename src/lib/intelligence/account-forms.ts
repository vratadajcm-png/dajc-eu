import { calendarFilterSchema, type CalendarFilter } from './driving-bans-calendar';
import { SUBSCRIBABLE_FEATURES, type BillingPeriod } from './accounts';

/**
 * Form parsing for the DAJC Intelligence customer pages, kept apart from the pages so
 * it is tested. Every value ends in calendarFilterSchema (strict), so a form can never
 * carry an organisation, a user or any field the calendar does not know.
 */

const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const number = (form: FormData, name: string) => { const value = text(form, name).replace(',', '.'); return value ? Number(value) : undefined; };
const codes = (value: string) => value.split(/[\s,;]+/).map(code => code.trim().toUpperCase()).filter(Boolean);

/**
 * Corridor lines, one jurisdiction per line: "AT: A12, A13", "DE" (whole network) or
 * "IT/Trentino-Alto Adige: A22".
 */
export function parseCorridor(value: string): CalendarFilter['corridor'] {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return undefined;
  return lines.map(line => {
    const [head, roads = ''] = line.split(':');
    const [jurisdiction, region] = head.split('/').map(part => part.trim());
    return { jurisdiction: jurisdiction.toUpperCase(), ...(region ? { region } : {}), roads: roads.split(',').map(road => road.trim()).filter(Boolean) };
  });
}

/** The calendar filter from the issue form; throws ZodError on anything invalid. */
export function parseCalendarForm(form: FormData): CalendarFilter {
  const configuration = text(form, 'vehicle_configuration');
  const vehicle = configuration ? {
    configuration,
    motorVehicleMassKg: number(form, 'motor_vehicle_mass_kg'),
    trailerMassKg: number(form, 'trailer_mass_kg'),
    combinationMassKg: number(form, 'combination_mass_kg'),
    actualMassKg: number(form, 'actual_mass_kg'),
    axleCount: number(form, 'axle_count'),
    heightM: number(form, 'height_m'),
    lengthM: number(form, 'length_m'),
    widthM: number(form, 'width_m'),
    adr: form.get('adr') === 'on',
    exceptionalTransport: form.get('exceptional_transport') === 'on',
  } : undefined;
  const raw = {
    label: text(form, 'label'),
    jurisdictions: codes(text(form, 'jurisdictions')),
    type: text(form, 'type') || 'all',
    ...(vehicle ? { vehicle: Object.fromEntries(Object.entries(vehicle).filter(([, value]) => value !== undefined)) } : {}),
    ...(parseCorridor(text(form, 'corridor')) ? { corridor: parseCorridor(text(form, 'corridor')) } : {}),
  };
  return calendarFilterSchema.parse(raw);
}

/** Features and period from the subscription request form. */
export function parseSubscriptionForm(form: FormData): { features: string[]; period: BillingPeriod; note: string } {
  const features = form.getAll('features').map(String).filter(feature => (SUBSCRIBABLE_FEATURES as readonly string[]).includes(feature));
  const period = text(form, 'period') === 'YEAR' ? 'YEAR' : 'MONTH';
  return { features: [...new Set(['personal-calendar', ...features])], period, note: text(form, 'note').slice(0, 500) };
}

/** The calendar URL in the webcal scheme that calendar apps open as a subscription. */
export const webcalUrl = (url: string) => url.replace(/^https:/, 'webcal:');
