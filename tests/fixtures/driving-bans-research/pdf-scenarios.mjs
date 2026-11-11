// SYNTHETIC TEST FIXTURE: an invented Czech ministry notice as a real PDF with a text layer.
// It is NOT a legal act and must never be used as evidence.
import { makePdf, makeScannedPdf } from './pdf.mjs';
import { extraction } from './cz-scenarios.mjs';

export const PDF_URLS = {
  holiday: 'https://www.mdcr.gov.cz/synteticke-sdeleni/svatky-2027.pdf',
  scanned: 'https://www.mdcr.gov.cz/synteticke-sdeleni/sken-2027.pdf',
  newPattern: 'https://www.mdcr.gov.cz/synteticke-sdeleni/novy-zakaz-2027.pdf',
};

const PAGE_ONE = [
  'SYNTETICKÝ TESTOVACÍ DOKUMENT – není právním předpisem. FIXTURE-KEY: cz-pdf-holiday',
  'Ministerstvo dopravy – Sdělení č. TEST-PDF-1/2026',
  'o dnech zákazu jízdy podle zákona č. 361/2000 Sb., § 43 odst. 1 písm. a)',
  'Na dálnicích a silnicích I. třídy je zakázána jízda nákladních automobilů,',
  'speciálních automobilů a jejich jízdních souprav o největší povolené',
  'hmotnosti převyšující 7 500 kg a nákladních automobilů o největší povolené',
  'hmotnosti převyšující 3 500 kg s přípojným vozidlem.',
];
const PAGE_TWO = [
  'Zákaz platí ve státní svátek dne 1. 1. 2027 od 13:00 do 22:00 hodin.',
  'Toto sdělení nabývá účinnosti dne 1. 1. 2027 a pozbývá platnosti dne 1. 1. 2027.',
  'Zákaz se nevztahuje na vozidla uvedená v § 43 odst. 3 zákona č. 361/2000 Sb.',
  'Výjimku mohou povolit krajský úřad nebo ministerstvo podle § 43 odst. 5 a 6.',
];

export const PDF_DOCUMENTS = {
  holiday: makePdf([PAGE_ONE, PAGE_TWO]),
  scanned: makeScannedPdf(2),
  newPattern: makePdf([[PAGE_ONE[0].replace('cz-pdf-holiday', 'cz-pdf-new-pattern'), ...PAGE_ONE.slice(1)], PAGE_TWO.map(line => line.replace('od 13:00 do 22:00', 'od 06:00 do 22:00'))]),
};

const ev = (field, quote, page) => ({ field, quote, provision: null, page });

/** The extraction of the synthetic notice: a new date of the human-verified cz-standing holiday ban. */
export function holidayRule(overrides = {}) {
  return {
    title: 'Zákaz jízdy ve státní svátek 1. 1. 2027', restriction_class: 'LEGAL_DRIVING_BAN', restriction_types: ['general', 'exceptional'],
    regions: [], roads: ['Motorways', 'Class I roads'], direction: 'Both directions',
    vehicle_scope: 'Nákladní a speciální automobily nad 7 500 kg; nákladní automobily nad 3 500 kg s přípojným vozidlem.',
    weight_combinator: 'any_of', weight_conditions: [{ operator: '>', value: 7500, unit: 'kg', applies_to: 'MAM of lorry / special vehicle' }, { operator: '>', value: 3500, unit: 'kg', applies_to: 'MAM of lorry / special vehicle towing a trailer' }],
    schedule: { kind: 'dates', weekdays: [], dates: ['2027-01-01'], start_time: '13:00', end_time: '22:00', end_day_offset: 0 },
    valid_from: '2027-01-01', valid_to: '2027-01-01', open_ended: false, timezone: 'Europe/Prague',
    exceptions: [{ text: 'Vozidla uvedená v § 43 odst. 3 zákona č. 361/2000 Sb.', conditions: null }, { text: 'Výjimku mohou povolit krajský úřad nebo ministerstvo.', conditions: 'podle § 43 odst. 5 a 6' }],
    adr: null, exceptional_transport: null, legal_basis: 'Zákon č. 361/2000 Sb., § 43 odst. 1 písm. a)',
    relation: { type: 'NONE', reference: null },
    evidence: [
      ev('vehicle_scope', 'je zakázána jízda nákladních automobilů, speciálních automobilů a jejich jízdních souprav', 1),
      ev('weight', 'hmotnosti převyšující 7 500 kg a nákladních automobilů o největší povolené hmotnosti převyšující 3 500 kg s přípojným vozidlem', 1),
      ev('schedule_dates', 'Zákaz platí ve státní svátek dne 1. 1. 2027', 2),
      ev('start_time', 'od 13:00 do 22:00 hodin', 2), ev('end_time', 'od 13:00 do 22:00 hodin', 2),
      ev('roads', 'Na dálnicích a silnicích I. třídy', 1),
      ev('validity', 'nabývá účinnosti dne 1. 1. 2027 a pozbývá platnosti dne 1. 1. 2027', 2),
      ev('exceptions', 'Zákaz se nevztahuje na vozidla uvedená v § 43 odst. 3 zákona č. 361/2000 Sb.', 2),
      ev('legal_basis', 'podle zákona č. 361/2000 Sb., § 43 odst. 1 písm. a)', 1),
    ],
    ...overrides,
  };
}

export const holidayExtraction = (rule = holidayRule()) => extraction([rule], { issuing_authority: 'Ministerstvo dopravy (synthetic)', document_date: '2026-12-01' });
