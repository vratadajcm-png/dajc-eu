import { dajcEuropeCoverage } from '../europe-coverage.mjs';

// Driving Bans scope = DAJC Coverage minus the territories below (owner decision, 26 Sep 2026).
// Exclusion is NOT a NO_BAN finding: no verifiable primary source on HGV driving bans was
// established for these territories, so DAJC does not publish any Driving Bans status for them.
// The shared 104-row Coverage list itself stays unchanged for the other DAJC products.
const OVERSEAS_FR = 'French overseas territory outside the European road network; no primary source on HGV driving bans established.';
const OVERSEAS_NL = 'Dutch Caribbean territory outside the European road network; no primary source on HGV driving bans established.';
const REMOTE = 'Remote or uninhabited territory without a relevant HGV road network; no primary source on HGV driving bans established.';
const DISPUTED = 'Disputed or de-facto administered territory; no verifiable official primary source on HGV driving bans.';

export const drivingBanExclusions = Object.freeze({
  GP: OVERSEAS_FR, MQ: OVERSEAS_FR, GF: OVERSEAS_FR, RE: OVERSEAS_FR, YT: OVERSEAS_FR, MF: OVERSEAS_FR, BL: OVERSEAS_FR,
  PM: OVERSEAS_FR, NC: OVERSEAS_FR, PF: OVERSEAS_FR, WF: OVERSEAS_FR, CLIPPERTON: REMOTE, TF: REMOTE,
  AW: OVERSEAS_NL, CW: OVERSEAS_NL, SX: OVERSEAS_NL, 'BQ-BO': OVERSEAS_NL, 'BQ-SA': OVERSEAS_NL, 'BQ-SE': OVERSEAS_NL,
  SVALBARD: REMOTE, JANMAYEN: REMOTE, GL: REMOTE,
  SBA: DISPUTED.replace('Disputed or de-facto administered territory', 'UK Sovereign Base Areas (military administration)'),
  NCY: DISPUTED, AB: DISPUTED, SO: DISPUTED, TRN: DISPUTED, GAG: 'Autonomous region within Moldova; no separate primary source on HGV driving bans established (Moldova is reviewed separately).',
});

const coverageCodes = new Set(dajcEuropeCoverage.map(([code]) => code));
for (const code of Object.keys(drivingBanExclusions)) if (!coverageCodes.has(code)) throw new Error(`Driving Bans exclusion for untracked identity ${code}`);

export const drivingBanScope = dajcEuropeCoverage.filter(([code]) => !(code in drivingBanExclusions));
export const drivingBanExcludedList = dajcEuropeCoverage.filter(([code]) => code in drivingBanExclusions).map(([code, name]) => ({ jurisdiction: code, name, reason: drivingBanExclusions[code] }));
