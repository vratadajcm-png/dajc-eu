// Template rendering of DAJC verified facts. Dates, local times, weights,
// countries and sources reach the user only through this function, never
// as model-written text. Labels are fixed interface strings (i18n.ts);
// values keep the verified dataset's wording.

import { t, type UiKey, type UiLang } from './i18n';
import type { DrivingBanFacts } from './own-data';

export interface FactRow {
  label: string;
  value: string;
  href?: string;
}

const ROWS: Array<[UiKey, keyof DrivingBanFacts]> = [
  ['fact.country', 'country'],
  ['fact.restriction', 'restriction'],
  ['fact.localTime', 'localTime'],
  ['fact.vehicles', 'vehicles'],
  ['fact.weight', 'weight'],
  ['fact.roads', 'roads'],
  ['fact.regions', 'regions'],
  ['fact.direction', 'direction'],
  ['fact.exceptions', 'exceptions'],
  ['fact.legalBasis', 'legalBasis'],
  ['fact.source', 'authority'],
  ['fact.verified', 'verified'],
];

export function renderDrivingBanFacts(facts: DrivingBanFacts, lang: UiLang): FactRow[] {
  return ROWS.filter(([, key]) => facts[key]).map(([label, key]) => ({
    label: t(lang, label),
    value: facts[key],
    ...(key === 'authority' ? { href: facts.sourceUrl } : {}),
  }));
}
