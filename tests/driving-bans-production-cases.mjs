import {readFileSync} from 'node:fs';
import {dajcEuropeCoverage} from '../config/europe-coverage.mjs';
import {drivingBanScope as coverage, drivingBanExcludedList, drivingBanExclusions} from '../config/driving-ban-calendars/scope.mjs';
import {canonicalDrivingBans as current, drivingBanCalendars, getDrivingBansSnapshot} from '../config/driving-ban-calendars/runtime.mjs';
import {snapshot, toIcs, validateCanonical, validWeight, publicationWindow, SCOPE_CHECKS} from '../src/lib/driving-bans/core.mjs';
// Regression cases against the maintained production dataset (2026-09-26 sweep).
const SWEEP = new Date('2026-09-26T15:30:00Z');
// snapshot() never mutates its input; memoize per clock to keep the suite fast.
const memo = new Map();
const at = (clock = SWEEP) => { const k = clock.toISOString(); if (!memo.has(k)) memo.set(k, snapshot(current, coverage, clock)); return memo.get(k); };
const ev = (v, id) => v.events.filter(e => e.ban_id === id);
const one = (v, id, date) => v.events.find(e => e.ban_id === id && e.date === date);
const hours = e => (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 3600000;
const uids = text => [...text.replace(/\r\n[ \t]/g, '').matchAll(/^UID:(.+)$/gm)].map(m => m[1].trim());
const TZ = {AT:'Europe/Vienna', LI:'Europe/Vaduz', LU:'Europe/Luxembourg', ME:'Europe/Podgorica', BG:'Europe/Sofia', ES:'Europe/Madrid', DE:'Europe/Berlin', FR:'Europe/Paris', IT:'Europe/Rome', CH:'Europe/Zurich', CZ:'Europe/Prague', SK:'Europe/Bratislava', PL:'Europe/Warsaw', HU:'Europe/Budapest', SI:'Europe/Ljubljana', HR:'Europe/Zagreb', PT:'Europe/Lisbon', GR:'Europe/Athens', CAT:'Europe/Madrid', BAS:'Europe/Madrid', GAL:'Europe/Madrid', CAN:'Atlantic/Canary', CEU:'Africa/Ceuta', MLL:'Africa/Ceuta'};

export function registerProductionDrivingBanTests(test, a) {
  test('scope: 104 Coverage identities = 76 Driving Bans jurisdictions + 28 documented exclusions, none published', () => {
    a.equal(dajcEuropeCoverage.length, 104);
    a.equal(coverage.length + drivingBanExcludedList.length, 104);
    a.equal(drivingBanExcludedList.length, 28);
    a.ok(drivingBanExcludedList.every(x => x.reason && !/no ban/i.test(x.reason)));
    for (const code of ['CZ', 'DE', 'AT', 'RO', 'NL', 'UK', 'CAT', 'BAS', 'AZO', 'CAN']) a.ok(coverage.some(([c]) => c === code), `${code} stays in scope`);
    const v = at();
    a.ok(v.jurisdictions.every(j => !(j.jurisdiction in drivingBanExclusions)));
    a.ok(!current.rules.some(r => r.jurisdiction in drivingBanExclusions));
    a.ok(!Object.keys(current.jurisdiction_reviews).some(c => c in drivingBanExclusions));
    a.throws(() => toIcs(v, {countries: ['CLIPPERTON']}), /Unknown jurisdiction/);
    const live = getDrivingBansSnapshot(SWEEP); a.equal(live.scope.tracked, 76); a.equal(live.scope.excluded.length, 28);
  });
  test('production: exactly one record per Driving Bans identity, each with a state for the active window', () => {
    const v = at();
    a.equal(v.jurisdictions.length, 76);
    a.equal(new Set(v.jurisdictions.map(j => j.jurisdiction)).size, 76);
    a.deepEqual(v.jurisdictions.map(j => [j.jurisdiction, j.name]), coverage);
    for (const j of v.jurisdictions) {
      a.deepEqual(j.period, {from: '2026-09-01', to: '2026-10-31'});
      a.ok(['HAS_BAN', 'NO_BAN', 'UNKNOWN'].includes(j.ban_state) && ['PRIMARY_VERIFIED', 'CROSSCHECKED', 'UNVERIFIED', 'SOURCE_UNAVAILABLE'].includes(j.verification_state), j.jurisdiction);
    }
    a.equal(validateCanonical(current, coverage), true);
  });
  test('production: NO_BAN only with complete PRIMARY_VERIFIED evidence; UNVERIFIED/UNKNOWN never NO_BAN', () => {
    for (const j of at().jurisdictions) {
      if (j.ban_state === 'NO_BAN') {
        a.equal(j.verification_state, 'PRIMARY_VERIFIED'); a.equal(j.coverage_complete, true); a.ok(j.no_ban_evidence.length);
        a.ok(SCOPE_CHECKS.every(k => j.scope_checks[k].state === 'PRIMARY_VERIFIED'));
      }
      if (j.verification_state !== 'PRIMARY_VERIFIED') a.notEqual(j.ban_state, 'NO_BAN', j.jurisdiction);
      if (j.coverage_complete) a.ok(SCOPE_CHECKS.every(k => j.scope_checks[k].state === 'PRIMARY_VERIFIED' && j.scope_checks[k].evidence_ids.length), j.jurisdiction);
      if (!j.coverage_complete) a.ok(j.coverage_failures.length, `incomplete ${j.jurisdiction} must state why`);
    }
  });
  test('production: every published event has https source, validity, exceptions, exceptional note and correct timezone', () => {
    const v = at();
    a.ok(v.events.length > 300);
    for (const e of v.events) {
      a.match(e.source_url, /^https:\/\//); a.ok(e.valid_from <= e.date && e.date <= e.valid_to, e.uid);
      a.ok(e.exceptions.length && e.exceptional_relevance && e.legal_basis && e.source_version, e.uid);
      a.equal(e.timezone, TZ[e.jurisdiction], e.uid);
      a.equal(e.verification_state, 'PRIMARY_VERIFIED');
    }
    for (const j of v.jurisdictions.filter(j => j.ban_state === 'HAS_BAN')) a.ok(v.events.some(e => e.jurisdiction === j.jurisdiction), j.jurisdiction);
  });
  test('production: exact weight thresholds are preserved, never rewritten to 7.5t', () => {
    const rule = id => current.rules.find(r => r.ban_id === id);
    a.deepEqual(rule('pl-holidays-2026-11').weight_threshold, {operator: '>', value: 12000, unit: 'kg', applies_to: 'MAM of vehicle or combination'});
    a.equal(rule('bg-holiday-2026-09-22').weight_threshold.value, 12000);
    a.equal(rule('gr-ohi-day-return-2026').weight_threshold.value, 3500);
    a.deepEqual(rule('pt-vci-porto').weight_threshold.all_of.map(w => [w.value, w.unit]), [[3500, 'kg'], [3, 'axles'], [1.1, 'm']]);
    a.ok(rule('ch-sunday').weight_threshold.any_of.some(w => w.operator === 'any'));
    a.ok(rule('li-sunday').weight_threshold.any_of.some(w => w.operator === 'any' && /tractors/.test(w.applies_to)));
    a.deepEqual(rule('li-sunday').weight_threshold.any_of.filter(w => w.value).map(w => w.value), [3500, 5000, 3500]);
    a.ok(current.rules.every(r => validWeight(r.weight_threshold)), 'all weights valid');
  });
  test('weight schema rejects invented or incomplete criteria', () => {
    a.equal(validWeight({operator: '>', unit: 'kg', applies_to: 'x'}), false);
    a.equal(validWeight({operator: 'any', value: 1, applies_to: 'x'}), false);
    a.equal(validWeight({operator: '>', value: 7.5, unit: 't', applies_to: 'x'}), false);
    a.equal(validWeight('>7.5t'), false);
    a.equal(validWeight({any_of: []}), false);
  });
  test('regression Sep 2026 — Austria: 26 October holiday and Tyrol A12 IG-L night ban incl. DST', () => {
    const v = at();
    const h = one(v, 'at-holiday-2026-10-26', '2026-10-26'); a.ok(h); a.equal(h.starts_at, '2026-10-25T23:00:00.000Z'); a.equal(h.ends_at, '2026-10-26T21:00:00.000Z');
    a.equal(hours(one(v, 'at-igl-a12-summer-weekday-2026', '2026-10-24')), 8);
    a.ok(!one(v, 'at-igl-a12-summer-weekday-2026', '2026-10-26'), 'holiday night uses the Sunday/holiday regime');
    a.equal(one(v, 'at-igl-a12-summer-holiday-2026', '2026-10-26').start_time, '23:00');
    a.ok(one(v, 'at-calendar-germany-oct03-2026', '2026-10-03'));
    const nov = at(new Date('2026-10-01T08:00:00Z'));
    a.equal(one(nov, 'at-igl-a12-winter-weekday-2026', '2026-11-02').start_time, '20:00');
  });
  test('regression Sep 2026 — Liechtenstein: 8 September (Maria Geburt) full-day ban', () => {
    const e = one(at(), 'li-holidays-2026', '2026-09-08'); a.ok(e); a.equal(hours(e), 24);
    a.equal(at().jurisdictions.find(j => j.jurisdiction === 'LI').coverage_complete, true);
  });
  test('regression Sep 2026 — Luxembourg: direction-specific holiday eves (DE 3 Oct, FR 11 Nov)', () => {
    const v = at(new Date('2026-10-01T08:00:00Z'));
    const fr = one(v, 'lu-france-armistice-2026', '2026-11-10'); a.equal(fr.start_time, '21:30'); a.equal(fr.end_date, '2026-11-11'); a.match(fr.direction, /France/);
    const de = one(at(), 'lu-germany-unity-2026', '2026-10-02'); a.equal(de.start_time, '23:30'); a.match(de.direction, /Germany/);
  });
  test('regression Sep 2026 — Montenegro: R1 ends 15 October, main-road rules end 15 September', () => {
    const v = at();
    a.equal(ev(v, 'me-r1-season-2026').at(-1).date, '2026-10-15');
    a.ok(ev(v, 'me-main-weekend-2026').every(e => e.date <= '2026-09-15'));
  });
  test('regression Sep 2026 — Spain: full Annex II tables, superseded legacy rows, GP Valencia moved to 27-29 Nov', () => {
    const v = at();
    const es = v.events.filter(e => e.jurisdiction === 'ES');
    a.ok(es.filter(e => e.date === '2026-10-30').length >= 16, 'Oct 30 Madrid exit table encoded');
    a.ok(es.some(e => e.date === '2026-09-06' && e.roads[0].startsWith('A-5') && e.end_time === '00:00'));
    a.ok(!es.some(e => e.ban_id.startsWith('es-annex2-oct-2026-')), 'legacy rows superseded');
    const nov = at(new Date('2026-10-01T08:00:00Z')).events.filter(e => e.jurisdiction === 'ES');
    a.ok(nov.some(e => e.date === '2026-11-28' && e.roads[0].startsWith('CV-383')));
    a.ok(!nov.some(e => ['2026-11-20', '2026-11-21', '2026-11-22'].includes(e.date)));
    a.equal(current.rules.filter(r => r.ban_id.startsWith('es-annex2-oct-2026-')).every(r => r.status === 'SUPERSEDED'), true);
  });
  test('regression Sep 2026 — Bulgaria: >12t Independence Day 18 Sep outbound and 22 Sep toward Sofia', () => {
    const v = at();
    a.equal(one(v, 'bg-holiday-2026-09-18', '2026-09-18').direction, 'Outbound from Sofia');
    const r = one(v, 'bg-holiday-2026-09-22', '2026-09-22'); a.equal(r.direction, 'Toward Sofia'); a.equal(r.starts_at, '2026-09-22T09:00:00.000Z');
  });
  test('Slovakia 2026: no bans on 1 Sep, 15 Sep, 28 Oct, 17 Nov (not days of rest in 2026)', () => {
    const v = at(new Date('2026-10-01T08:00:00Z'));
    const sk = [...at().events, ...v.events].filter(e => e.jurisdiction === 'SK');
    a.ok(sk.every(e => new Date(`${e.date}T12:00:00Z`).getUTCDay() === 0));
  });
  test('weekend, holiday and seasonal regimes expand exactly', () => {
    const v = at();
    a.equal(ev(v, 'de-sunday').length, 8); a.ok(one(v, 'de-holiday-2026-10-03', '2026-10-03'));
    a.deepEqual(one(v, 'de-holiday-2026-10-31', '2026-10-31').regions.length, 9);
    a.deepEqual(ev(v, 'cz-holidays-2026-autumn').map(e => e.date), ['2026-09-28', '2026-10-28']);
    const hu = one(v, 'hu-holiday-2026-10-23', '2026-10-22'); a.equal(hu.end_date, '2026-10-23'); a.equal(hours(hu), 24);
    a.equal(one(v, 'it-sundays-september-2026', '2026-09-06').start_time, '07:00'); a.equal(one(v, 'it-sundays-oct-nov-2026', '2026-10-04').start_time, '09:00');
    a.deepEqual(ev(v, 'hr-summer-sunday-2026').map(e => e.date), ['2026-09-06', '2026-09-13']);
    a.ok(one(v, 'si-season-saturday-coast-2026-09-05', '2026-09-05'));
    a.equal(hours(one(v, 'fr-weekend', '2026-10-24')), 25, 'DST weekend has 25 real hours');
    a.ok(!ev(v, 'pt-vci-porto').some(e => e.date === '2026-10-05' || e.date < '2026-09-15'));
    a.deepEqual(ev(v, 'gr-ohi-day-return-2026').map(e => e.date), ['2026-10-28']);
  });
  test('direction and corridor scopes survive into events', () => {
    const v = at();
    a.equal(one(v, 'fr-idf-in-monday', '2026-09-07').direction, 'Province to Paris');
    a.ok(one(v, 'fr-idf-out-friday', '2026-09-04').roads.some(r => r.startsWith('A13')));
    a.match(one(v, 'at-igl-a12-summer-sunday-2026', '2026-09-06').roads[0], /Langkampfen/);
  });
  test('ICS: expired events removed by default, UIDs unique and stable, no NO_BAN/UNKNOWN pseudo-events', () => {
    const v = at();
    const def = uids(toIcs(v)), hist = uids(toIcs(v, {upcoming: false}));
    a.ok(!def.includes('bg-holiday-2026-09-18-2026-09-18@dajc.eu')); a.ok(hist.includes('bg-holiday-2026-09-18-2026-09-18@dajc.eu'));
    a.equal(new Set(hist).size, hist.length); a.deepEqual(hist, uids(toIcs(at(), {upcoming: false})));
    a.equal(uids(toIcs(v, {countries: ['NL']})).length, 0);
  });
  test('web/config/ICS consistency for the production dataset', () => {
    const v = at();
    const projected = new Set();
    for (let d = Date.parse('2026-08-31T00:00:00Z'); d <= Date.parse('2026-10-31T00:00:00Z'); d += 7 * 86400000)
      for (const rule of drivingBanCalendars) for (const o of rule.resolve(new Date(d), new Date(d + 6 * 86400000)).occurrences) projected.add(o.uid);
    a.ok(v.events.every(e => projected.has(e.uid)), 'every published event is visible to the config projection');
    a.deepEqual(uids(toIcs(v, {upcoming: false})).sort(), v.events.map(e => e.uid).sort());
    const page = readFileSync(new URL('../src/pages/driving-bans.astro', import.meta.url), 'utf8');
    a.match(page, /Ověření probíhá/); a.match(page, /Bez zákazu/);
  });
  test('two-month window shifts automatically; reviewed span keeps verification only while it contains the window', () => {
    a.deepEqual(publicationWindow(new Date('2026-09-30T22:30:00Z')), {from: '2026-10-01', to: '2026-11-30', timezone: 'Europe/Prague'});
    const oct = at(new Date('2026-10-01T08:00:00Z'));
    a.ok(oct.jurisdictions.filter(j => j.coverage_complete).length >= 12);
    a.ok(oct.jurisdictions.every(j => !j.coverage_failures.includes('ACTIVE_WINDOW_NOT_REVERIFIED')));
    const nov = at(new Date('2026-11-01T08:00:00Z'));
    a.equal(nov.jurisdictions.filter(j => j.coverage_complete).length, 0);
    a.ok(nov.jurisdictions.every(j => j.ban_state !== 'NO_BAN' && j.coverage_failures.includes('ACTIVE_WINDOW_NOT_REVERIFIED')));
    a.ok(!nov.events.some(e => e.date > '2026-11-30'), 'no extrapolation beyond the reviewed span');
  });
}
