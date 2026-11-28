import {readFileSync} from 'node:fs';
import {dajcEuropeCoverage as coverage} from '../config/europe-coverage.mjs';
import {canonicalDrivingBans as current, drivingBanCalendars} from '../config/driving-ban-calendars/runtime.mjs';
import {snapshot, toIcs, validateCanonical, validWeight, publicationWindow, SCOPE_CHECKS} from '../src/lib/driving-bans/core.mjs';
// Regression cases against the maintained production dataset (2026-09-26 sweep).
const SWEEP = new Date('2026-09-01T08:00:00Z');
// Sources re-retrieved by the 19 Nov 2026 corrections must match that later evidence log instead of the earlier one.
const LATER_LOG = JSON.parse(readFileSync(new URL('../data/driving-bans/source-reviews/2026-11-19-thursday/r6-registry-corrections.json', import.meta.url), 'utf8'));
const LATEST_SHA = new Map(LATER_LOG.retrievals.map(r => [r.source_id, r.sha256]));
const at = (clock = SWEEP) => snapshot(structuredClone(current), coverage, clock);
const ev = (v, id) => v.events.filter(e => e.ban_id === id);
const one = (v, id, date) => v.events.find(e => e.ban_id === id && e.date === date);
const hours = e => (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 3600000;
const uids = text => [...text.replace(/\r\n[ \t]/g, '').matchAll(/^UID:(.+)$/gm)].map(m => m[1].trim());
const TZ = {AT:'Europe/Vienna', LI:'Europe/Vaduz', LU:'Europe/Luxembourg', ME:'Europe/Podgorica', BG:'Europe/Sofia', ES:'Europe/Madrid', DE:'Europe/Berlin', FR:'Europe/Paris', IT:'Europe/Rome', CH:'Europe/Zurich', CZ:'Europe/Prague', SK:'Europe/Bratislava', PL:'Europe/Warsaw', HU:'Europe/Budapest', SI:'Europe/Ljubljana', HR:'Europe/Zagreb', PT:'Europe/Lisbon', GR:'Europe/Athens'};

export function registerProductionDrivingBanTests(test, a) {
  test('production: exactly unique central Coverage identities, each with a state for the active window', () => {
    const v = at();
    a.equal(v.jurisdictions.length, coverage.length);
    a.equal(new Set(v.jurisdictions.map(j => j.jurisdiction)).size, coverage.length);
    a.deepEqual(v.jurisdictions.map(j => [j.jurisdiction, j.name]), coverage);
    for (const j of v.jurisdictions) {
      a.deepEqual(j.period, {from: '2026-09-01', to: '2027-09-01'});
      a.ok(['HAS_BAN', 'NO_BAN', 'UNKNOWN'].includes(j.ban_state) && ['PRIMARY_VERIFIED', 'CROSSCHECKED', 'UNVERIFIED', 'SOURCE_UNAVAILABLE'].includes(j.verification_state), j.jurisdiction);
    }
    a.equal(validateCanonical(current, coverage), true);
  });
  test('rolling year exposes verified near-term month portions without pretending future laws are known', () => {
    const v = at(new Date('2026-11-02T12:00:00Z'));
    a.deepEqual(v.window, {from: '2026-11-02', to: '2027-11-02', timezone: 'Europe/Prague'});
    const cz = v.jurisdictions.find(j => j.jurisdiction === 'CZ');
    a.equal(cz.coverage_complete, false, 'full 12-month legal coverage has not been verified');
    a.deepEqual(cz.monthly_coverage.slice(0, 3).map(m => [m.from, m.to, m.coverage_complete]), [
      ['2026-11-02', '2026-11-30', true],
      ['2026-12-01', '2026-12-31', true],
      ['2027-01-01', '2027-01-31', false],
    ]);
    a.ok(v.events.every(e => e.date <= '2026-12-31'), 'unknown future law must not create extrapolated events');
    a.equal(v.jurisdictions.filter(j => j.ban_state === 'NO_BAN').length, 0);
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
    a.equal(at().jurisdictions.find(j => j.jurisdiction === 'LI').coverage_complete, false, '12-month horizon extends beyond legally reviewed dates');
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
    a.ok(!nov.some(e => e.ban_id.startsWith('es-a2-') && ['2026-11-20', '2026-11-21', '2026-11-22'].includes(e.date)), 'no Annex II row on the original GP dates');
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
    a.equal(ev(v, 'de-sunday').filter(e => e.date <= '2026-10-31').length, 8); a.ok(one(v, 'de-holiday-2026-10-03', '2026-10-03'));
    a.deepEqual(one(v, 'de-holiday-2026-10-31', '2026-10-31').regions.length, 9);
    a.deepEqual(ev(v, 'cz-holidays-2026-autumn').map(e => e.date), ['2026-09-28', '2026-10-28', '2026-11-17']);
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
    a.ok(def.every(uid => hist.includes(uid)), 'the whole-window feed must include every upcoming UID');
    a.equal(new Set(hist).size, hist.length); a.deepEqual(hist, uids(toIcs(at(), {upcoming: false})));
    a.equal(uids(toIcs(v, {countries: ['NL']})).length, 0);
  });
  test('web/config/ICS consistency for the production dataset', () => {
    const v = at();
    const projected = new Set();
    for (let d = Date.parse('2026-08-31T00:00:00Z'); d <= Date.parse(v.window.to + 'T00:00:00Z'); d += 7 * 86400000)
      for (const rule of drivingBanCalendars) for (const o of rule.resolve(new Date(d), new Date(d + 6 * 86400000)).occurrences) projected.add(o.uid);
    a.ok(v.events.every(e => projected.has(e.uid)), 'every published event is visible to the config projection');
    a.deepEqual(uids(toIcs(v, {upcoming: false})).sort(), v.events.map(e => e.uid).sort());
    const page = readFileSync(new URL('../src/pages/driving-bans.astro', import.meta.url), 'utf8');
    a.match(page, /Ověření probíhá/); a.match(page, /Bez zákazu/); a.match(page, /officialDrivingBansView\(canonical\)/);
  });
  test('rolling 12-month horizon shifts automatically; unreviewed future months remain fail-closed', () => {
    a.deepEqual(publicationWindow(new Date('2026-09-30T22:30:00Z')), {from: '2026-10-01', to: '2027-10-01', timezone: 'Europe/Prague'});
    const oct = at(new Date('2026-10-01T08:00:00Z'));
    a.equal(oct.jurisdictions.filter(j => j.coverage_complete).length, 0, 'full future year not yet legally verified');
    a.ok(oct.jurisdictions.every(j => j.coverage_failures.includes('ACTIVE_WINDOW_NOT_REVERIFIED')));
    // The 27 Oct 2026 priority review extended the reviewed span to 31 Dec 2026.
    const nov = at(new Date('2026-11-01T08:00:00Z'));
    a.equal(nov.jurisdictions.filter(j => j.coverage_complete).length, 0);
    a.ok(nov.jurisdictions.every(j => j.coverage_failures.includes('ACTIVE_WINDOW_NOT_REVERIFIED')));
    const dec = at(new Date('2026-12-01T08:00:00Z'));
    a.equal(dec.jurisdictions.filter(j => j.coverage_complete).length, 0);
    a.ok(dec.jurisdictions.every(j => j.ban_state !== 'NO_BAN' && j.coverage_failures.includes('ACTIVE_WINDOW_NOT_REVERIFIED')));
    a.ok(!dec.events.some(e => e.date > '2026-12-31'), 'no extrapolation beyond the reviewed span');
  });
  test('1 Oct 2026 rollover: year horizon keeps known bans but no unverified-year NO_BAN', () => {
    const v = at(new Date('2026-10-01T08:30:00Z'));
    a.deepEqual(v.window, {from: '2026-10-01', to: '2027-10-01', timezone: 'Europe/Prague'});
    a.equal(v.jurisdictions.length, coverage.length);
    a.equal(v.jurisdictions.filter(j => j.verification_state === 'PRIMARY_VERIFIED').length, 0);
    a.equal(v.jurisdictions.filter(j => j.ban_state === 'NO_BAN').length, 0);
    a.ok(v.jurisdictions.every(j => j.coverage_failures.includes('ACTIVE_WINDOW_NOT_REVERIFIED')));
  });
  test('1 Oct 2026 — France: hydrocarbon derogation (NOR TRAT2625304A) is an exception, not a removed ban', () => {
    const v = at(new Date('2026-10-01T08:30:00Z'));
    const we = one(v, 'fr-weekend', '2026-10-03'); a.ok(we, 'weekend ban still published');
    a.ok(we.exceptions.some(x => /TRAT2625304A/.test(x) && /12 October 2026 10:00/.test(x)));
    a.ok(one(v, 'fr-idf-in-monday', '2026-10-05').exceptions.some(x => /TRAT2625304A/.test(x)));
    a.ok(current.sources.some(s => s.source_id === 'fr-arrete-hydrocarbures-20260924' && s.role === 'PRIMARY'));
    a.equal(v.jurisdictions.find(j => j.jurisdiction === 'FR').coverage_complete, false);
  });
  test('1 Oct 2026 — Germany: federal ban kept, Laender low-water scope keeps DE fail-closed (not fully verified)', () => {
    const v = at(new Date('2026-10-01T08:30:00Z'));
    const de = v.jurisdictions.find(j => j.jurisdiction === 'DE');
    a.equal(de.ban_state, 'HAS_BAN'); a.equal(de.verification_state, 'UNVERIFIED'); a.equal(de.coverage_complete, false);
    a.ok(de.coverage_failures.includes('SAARLAND_LOW_WATER_EXTENSION_STATUS_NOT_PRIMARY_VERIFIED'));
    a.ok(one(v, 'de-sunday', '2026-10-04') && one(v, 'de-holiday-2026-10-03', '2026-10-03'));
    a.ok(one(v, 'de-sunday', '2026-10-04').exceptions.some(x => /North Rhine-Westphalia/.test(x)));
  });
  // 27 Oct 2026 priority review of November-December 2026 (data/driving-bans/source-reviews/2026-10-27-nov-dec.json).
  const NOVDEC = new Date('2026-11-01T08:00:00Z');
  test('27 Oct 2026 — Christmas edge cases follow the exact legal text', () => {
    const v = at(NOVDEC);
    a.ok(one(v, 'ch-holidays-2026-12', '2026-12-25'));
    a.ok(!v.events.some(e => e.jurisdiction === 'CH' && e.date === '2026-12-26' && e.start_time === '00:00'), 'CH: 26 Dec is no ban day when Christmas is a Friday');
    a.deepEqual(ev(v, 'pl-holidays-2026-12').map(e => [e.date, e.start_time, e.end_time]), [['2026-12-25', '08:00', '22:00'], ['2026-12-26', '08:00', '22:00']]);
    a.ok(!v.events.some(e => e.jurisdiction === 'PL' && e.date === '2026-12-24'), 'PL: 24 Dec is a day off but not a ban day, and has no eve ban');
    a.deepEqual(v.events.filter(e => e.jurisdiction === 'SK' && e.date >= '2026-12-24').map(e => e.date), ['2026-12-27'], 'SK: the Christmas rest block ends on Sunday');
    a.deepEqual(ev(v, 'hr-holiday-eve-2026-12-24').map(e => [e.start_time, e.end_time]), [['15:00', '23:00']]);
    a.deepEqual(ev(v, 'hr-holiday-last-day-sunday-2026-12-27').map(e => [e.date, e.start_time]), [['2026-12-27', '12:00']]);
    a.deepEqual(ev(v, 'it-sundays-holidays-dec-2026').map(e => e.date), ['2026-12-06', '2026-12-08', '2026-12-13', '2026-12-20', '2026-12-25', '2026-12-26', '2026-12-27']);
    a.deepEqual(ev(v, 'cz-holidays-2026-christmas').map(e => e.date), ['2026-12-24', '2026-12-25', '2026-12-26']);
    a.deepEqual(ev(v, 'lu-germany-christmas-2026').map(e => e.date), ['2026-12-24', '2026-12-25']);
    a.deepEqual(ev(v, 'lu-france-christmas-2026').map(e => e.date), ['2026-12-24']);
  });
  test('19 Nov 2026 — Hungary: 24 Dec is a public holiday (Act LXXII of 2026), continuous ban 23 Dec 22:00 to 27 Dec 22:00', () => {
    const v = at(NOVDEC);
    const hu = v.events.filter(e => e.jurisdiction === 'HU' && e.ends_at > '2026-12-23T00:00:00Z' && e.starts_at < '2026-12-28T00:00:00Z').sort((x, y) => x.starts_at.localeCompare(y.starts_at));
    a.equal(hu[0].starts_at, '2026-12-23T21:00:00.000Z');
    const block = ev(v, 'hu-holiday-2026-12-25-26');
    a.equal(block.length, 1);
    a.equal(block[0].uid, 'hu-holiday-2026-12-25-26-2026-12-24@dajc.eu', 'occurrence identity stays stable across the correction');
    a.equal(block[0].sequence, 1, 'correction increments the revision sequence');
    a.ok(block[0].evidence_ids.includes('hu-act-2026-72'));
    a.equal(hu.at(-1).ends_at, '2026-12-27T21:00:00.000Z');
    for (let i = 1; i < hu.length; i++) a.ok(hu[i].starts_at <= hu[i - 1].ends_at, 'no gap in the holiday block');
  });
  test('27 Oct 2026 — LI, LU and AT standing rules no longer stop at the 31 Oct published window', () => {
    const v = at(NOVDEC);
    for (const [id, date] of [['li-night', '2026-12-15'], ['li-sunday', '2026-11-08'], ['lu-france-weekend', '2026-12-05'], ['lu-germany-weekend', '2026-11-14'], ['at-saturday', '2026-11-07'], ['at-sunday', '2026-12-27'], ['at-night', '2026-12-31']]) a.ok(one(v, id, date), `${id} ${date}`);
    a.ok(one(v, 'li-holidays-2026-12', '2026-12-08') && one(v, 'at-holidays-2026-12', '2026-12-08'));
    const holidayNight = one(v, 'at-igl-a12-winter-holiday-2026-12', '2026-12-08');
    a.equal(holidayNight.start_time, '23:00');
    a.ok(!one(v, 'at-igl-a12-winter-weekday-2026', '2026-12-08'), 'A12 holiday nights start at 23:00, not 20:00');
    a.ok(one(v, 'at-saturday', '2026-12-12').exceptions.some(x => /last two Saturdays before 24 December/.test(x)));
  });
  test('27 Oct 2026 — Germany: 25-26 Dec published, jurisdiction stays fail-closed on low-water exemptions', () => {
    const v = at(NOVDEC);
    a.deepEqual(ev(v, 'de-holiday-2026-12-25-26').map(e => e.date), ['2026-12-25', '2026-12-26']);
    const de = v.jurisdictions.find(j => j.jurisdiction === 'DE');
    a.equal(de.coverage_complete, false);
    a.ok(de.coverage_failures.includes('LOW_WATER_EXEMPTIONS_AFTER_2026_10_31_NOT_PRIMARY_CONFIRMED'));
  });
  test('27 Oct 2026 — unreviewed jurisdictions publish nothing in December and say why', () => {
    const v = at(NOVDEC);
    const reviewed = new Set(['CH', 'CZ', 'FR', 'HR', 'HU', 'IT', 'LI', 'LU', 'PL', 'SI', 'SK', 'AT', 'DE']);
    // 19 Nov 2026: only the three GR B8 rules re-read from ΦΕΚ Β΄ 912/2026 may publish December events for an otherwise unreviewed jurisdiction.
    const grB8 = new Set(['gr-christmas-eve-outbound-2026', 'gr-christmas-return-2026', 'gr-new-year-eve-outbound-2026']);
    // 20 Nov 2026: Spanish December rules re-read row by row (review 2026-11-20.r7-es-dec-cat-bas) carry their own December review window.
    const esDec = new Set(JSON.parse(readFileSync(new URL('../data/driving-bans/source-reviews/2026-11-20-es-december.json', import.meta.url), 'utf8')).december_rules);
    // 28 Nov 2026: Porto VCI December re-read (review 2026-11-28.r8-new-year-eves-pt).
    const ptDec = new Set(['pt-vci-porto']);
    a.ok(!v.events.some(e => !reviewed.has(e.jurisdiction) && e.date >= '2026-12-01' && !grB8.has(e.ban_id) && !esDec.has(e.ban_id) && !ptDec.has(e.ban_id)));
    for (const j of v.jurisdictions.filter(row => !reviewed.has(row.jurisdiction))) a.ok(j.coverage_failures.includes('NOV_DEC_2026_PRIORITY_REVIEW_NOT_PERFORMED'), j.jurisdiction);
    const log = JSON.parse(readFileSync(new URL('../data/driving-bans/source-reviews/2026-10-27-nov-dec.json', import.meta.url), 'utf8'));
    a.equal(log.full_registry_sweep, false);
    a.deepEqual(log.coverage_matrix.map(row => row.jurisdiction), coverage.map(([code]) => code));
    const sources = new Map(current.sources.map(s => [s.source_id, s]));
    for (const r of log.retrievals.filter(row => row.source_id)) a.equal(sources.get(r.source_id)?.content_sha256, LATEST_SHA.get(r.source_id) ?? r.sha256, r.source_id);
  });
  // 19 Nov 2026 Thursday sweep corrections (data/driving-bans/source-reviews/2026-11-19-thursday/).
  test('19 Nov 2026 — France: New Year ban 31 Dec 22:00 to 1 Jan 22:00 and Île-de-France eve restriction', () => {
    const v = at(NOVDEC);
    const ny = ev(v, 'fr-holiday-2027-01-01');
    a.equal(ny.length, 1);
    a.equal(ny[0].starts_at, '2026-12-31T21:00:00.000Z');
    a.equal(ny[0].ends_at, '2027-01-01T21:00:00.000Z', 'carry-out past the reviewed span is kept as the real interval');
    a.deepEqual(ny[0].weight_threshold, {operator: '>', value: 7500, unit: 'kg', applies_to: 'GVW (PTAC) of goods vehicle or combination'});
    a.deepEqual(ev(v, 'fr-idf-out-eve-2026-12-31').map(e => [e.date, e.start_time, e.end_time, e.direction]), [['2026-12-31', '16:00', '22:00', 'Paris to province']]);
    a.ok(!v.events.some(e => e.jurisdiction === 'FR' && e.date > '2026-12-31'), 'nothing after the reviewed span is published');
  });
  test('19 Nov 2026 — Greece: B8 December dates only, >3.5 t, A1/A2 direction lists, jurisdiction stays incomplete', () => {
    const v = at(NOVDEC);
    a.deepEqual(['gr-christmas-eve-outbound-2026', 'gr-christmas-return-2026', 'gr-new-year-eve-outbound-2026'].map(id => ev(v, id).map(e => [e.date, e.start_time, e.end_time])),
      [[['2026-12-24', '16:00', '22:00']], [['2026-12-27', '15:00', '22:00']], [['2026-12-31', '15:00', '21:00']]]);
    a.ok(ev(v, 'gr-christmas-return-2026')[0].roads.every(r => /\(to /.test(r)) && /^Return/.test(ev(v, 'gr-christmas-return-2026')[0].direction));
    a.equal(ev(v, 'gr-christmas-eve-outbound-2026')[0].weight_threshold.value, 3500);
    a.ok(!v.events.some(e => e.jurisdiction === 'GR' && e.date > '2026-12-31'), '1, 3 and 6 Jan 2027 stay unpublished until the span is reviewed');
    const gr = v.jurisdictions.find(j => j.jurisdiction === 'GR');
    a.equal(gr.coverage_complete, false);
    a.notEqual(gr.ban_state, 'NO_BAN');
    a.ok(gr.coverage_failures.includes('GR_PERMANENT_2017_DECISION_B3769_NETWORK_NOT_REVIEWED'));
  });
  test('19 Nov 2026 — every re-retrieved source carries the SHA-256 of its evidence log', () => {
    const sources = new Map(current.sources.map(s => [s.source_id, s]));
    a.equal(LATER_LOG.full_registry_sweep, false);
    for (const [id, sha] of LATEST_SHA) a.equal(sources.get(id)?.content_sha256, sha, id);
  });
  test('19 Nov 2026 — targeted corrections do not move the reviewed window or refresh jurisdiction verification', () => {
    a.deepEqual(current.window, {from: '2026-09-01', to: '2026-12-31'});
    const last = current.review_log.at(-1);
    a.equal(last.full_registry_sweep, false);
    a.equal(current.jurisdiction_reviews.HU.last_verified, '2026-10-27T11:20:00.000Z');
    a.equal(current.jurisdiction_reviews.FR.last_verified, '2026-10-27T11:20:00.000Z');
    a.equal(current.jurisdiction_reviews.GR.last_verified, null);
  });
  // 2 Nov 2026 targeted review of ES and DE (data/driving-bans/source-reviews/2026-11-02-es-de.json).
  test('2 Nov 2026 — Spain: Annex VII, Catalonia and Basque Country November rows; ES stays fail-closed', () => {
    const v = at(NOVDEC);
    const basque = ev(v, 'es-bas-a2-2026-11-11-cross-border');
    a.equal(basque.length, 1);
    a.equal(basque[0].starts_at, '2026-11-10T21:00:00.000Z');
    a.equal(basque[0].ends_at, '2026-11-11T21:00:00.000Z');
    a.ok(/cross-border transport only/.test(basque[0].vehicle_scope));
    const nov = (id) => ev(v, id).filter(e => e.date < '2026-12-01');
    a.deepEqual(nov('es-cat-n-ii-630-682-saturdays').map(e => e.date), ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
    a.deepEqual(nov('es-cat-n-ii-630-682-sundays').map(e => [e.date, e.start_time, e.end_time]), ['01', '08', '15', '22', '29'].map(d => [`2026-11-${d}`, '17:00', '22:00']));
    a.deepEqual(nov('es-cat-pyrenees-winter-saturdays-2026-11-12').map(e => e.date), ['2026-11-28']);
    a.equal(nov('es-a7-n-340-957-997-mma-7500').length, 30);
    a.deepEqual(one(v, 'es-a7-n-232-446-330-axles-4', '2026-11-15').weight_threshold, {operator: '>=', value: 4, unit: 'axles', applies_to: 'number of axles of the goods vehicle / combination'});
    a.equal(one(v, 'es-cat-gt26t-n-ii-n-240-n-340-permanent', '2026-11-15').weight_threshold.value, 26000);
    const es = v.jurisdictions.find(j => j.jurisdiction === 'ES');
    a.equal(es.coverage_complete, false);
    a.equal(es.scope_checks.corridors.state, 'UNVERIFIED');
    const de = v.jurisdictions.find(j => j.jurisdiction === 'DE');
    a.equal(de.coverage_complete, false);
    a.ok(de.coverage_failures.includes('LOW_WATER_EXEMPTIONS_AFTER_2026_10_31_NOT_PRIMARY_CONFIRMED'));
    const log = JSON.parse(readFileSync(new URL('../data/driving-bans/source-reviews/2026-11-02-es-de.json', import.meta.url), 'utf8'));
    a.equal(log.full_registry_sweep, false);
    const sources = new Map(current.sources.map(s => [s.source_id, s]));
    for (const r of log.retrievals.filter(row => row.source_id)) a.equal(sources.get(r.source_id)?.content_sha256, LATEST_SHA.get(r.source_id) ?? r.sha256, r.source_id);
  });
  // 20 Nov 2026 targeted December review of ES (data/driving-bans/source-reviews/2026-11-20-es-december.json).
  test('20 Nov 2026 — Spain December: DGT Annex II, Catalonia (Annex A, Aran) and Basque rows; ES stays fail-closed and not "fresh"', () => {
    const v = at(new Date('2026-11-20T12:00:00Z'));
    const esDecRules = new Set(JSON.parse(readFileSync(new URL('../data/driving-bans/source-reviews/2026-11-20-es-december.json', import.meta.url), 'utf8')).december_rules);
    const dgt = v.events.filter(e => e.ban_id.startsWith('es-a2-2026-12-'));
    a.equal(dgt.length, 72, 'every December Annex II row-date of BOE-A-2026-1255 is published once');
    a.ok(dgt.every(e => e.date >= '2026-12-01' && e.date <= '2026-12-31'));
    const a1 = one(v, 'es-a2-2026-12-a-1-11-8-50-16002200-salida-madrid', '2026-12-04');
    a.equal(a1.starts_at, '2026-12-04T15:00:00.000Z'); a.equal(a1.ends_at, '2026-12-04T21:00:00.000Z'); a.equal(a1.direction, 'Salida Madrid');
    a.deepEqual(a1.weight_threshold, {operator: '>', value: 7500, unit: 'kg', applies_to: 'maximum authorised mass of goods vehicle / combination'});
    const n230Fri = ev(v, 'es-a2-2026-12-n-230-64-1-116-1-17002400-frontera-francia-fridays');
    a.deepEqual(n230Fri.map(e => e.date), ['2026-12-04', '2026-12-11', '2026-12-18']);
    a.ok(n230Fri[0].exceptions.some(x => /habitual residence/.test(x)), 'generic Friday table exception');
    const n230Xmas = ev(v, 'es-a2-2026-12-n-230-64-1-116-1-17002400-frontera-francia-24-31-dec');
    a.deepEqual(n230Xmas.map(e => e.date), ['2026-12-24', '2026-12-31']);
    a.ok(!n230Xmas[0].exceptions.some(x => /habitual residence/.test(x)), 'no residence exception is printed for 24/31 Dec');
    a.ok(ev(v, 'es-cat-aran-2026-12-france-fridays')[0].exceptions.some(x => /7\.2 b\)/.test(x)));
    for (const id of ['es-cat-aran-2026-12-france-24-31-dec', 'es-cat-aran-2026-12-lleida']) a.ok(!ev(v, id)[0].exceptions.some(x => /7\.2 b\)/.test(x)), id);
    a.ok(ev(v, 'es-cat-aran-2026-12-lleida')[0].exceptions.some(x => /at least half of the vehicle's load capacity/.test(x)), '7.2 c) half-load condition');
    a.ok(v.events.filter(e => e.jurisdiction === 'ES' && e.date >= '2026-12-01').every(e => esDecRules.has(e.ban_id)), 'only the explicitly reviewed rules publish December events');
    for (const id of esDecRules) {
      const rule = current.rules.find(r => r.ban_id === id);
      a.ok(rule && rule.review_window.to >= '2026-12-31' && rule.verified_at === '2026-11-20T12:30:00.000Z', `${id} carries its own December re-read`);
      a.ok(v.events.some(e => e.ban_id === id && e.date >= '2026-12-01'), `${id} is listed only if it publishes December events`);
    }
    a.deepEqual(ev(v, 'es-a2-2026-12-a-4-323-230-09002200-sentido-madrid').map(e => [e.date, e.start_time, e.end_time]), [['2026-12-08', '09:00', '22:00']]);
    a.deepEqual(['es-cat-aran-2026-12-france-fridays', 'es-cat-aran-2026-12-france-24-31-dec'].flatMap(id => ev(v, id)).map(e => [e.date, e.start_time, hours(e)]), ['04', '11', '18', '24', '31'].map(d => [`2026-12-${d}`, '17:00', 7]), '17:00-24:00');
    a.deepEqual(ev(v, 'es-cat-aran-2026-12-lleida').map(e => e.date), ['2026-12-06', '2026-12-08', '2026-12-13', '2026-12-20', '2026-12-27']);
    a.ok(ev(v, 'es-cat-pyrenees-winter-sundays-holidays-2026-12').some(e => e.date === '2026-12-26'), 'Sant Esteve is a 2026 Catalan holiday outside Aran');
    a.deepEqual(['es-cat-inmaculada-2026-12-a2-lleida-t', 'es-cat-inmaculada-2026-12-a2-barcelona-t'].map(id => ev(v, id).map(e => [e.date, e.direction])),
      [[['2026-12-04', 'Hacia Lleida (L)']], [['2026-12-08', 'Hacia Barcelona (B)']]]);
    a.deepEqual(ev(v, 'es-bas-a2-2026-12-06-08-bilbao').map(e => [e.date, e.start_time, e.end_time, e.direction]), [['2026-12-06', '16:00', '21:00', 'Bilbao'], ['2026-12-08', '16:00', '21:00', 'Bilbao']]);
    a.deepEqual(ev(v, 'es-cat-pyrenees-winter-saturdays-2026-11-12').map(e => e.date), ['2026-11-28', '2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26']);
    a.ok(!v.events.some(e => e.jurisdiction === 'ES' && e.date > '2026-12-31'), 'January 2027 rows stay unpublished');
    const es = v.jurisdictions.find(j => j.jurisdiction === 'ES');
    a.equal(es.coverage_complete, false); a.notEqual(es.ban_state, 'NO_BAN'); a.equal(es.verification_state, 'UNVERIFIED');
    a.ok(!es.coverage_failures.includes('ES_DECEMBER_2026_ANNEX_II_AND_REGIONAL_ROWS_NOT_ENCODED'));
    for (const gap of ['ES_ANNEX_V_EXCEPTIONAL_ADR_RESTRICTIONS_NOT_EVENT_ENCODED', 'ES_BASQUE_ADR_AND_SPECIAL_TRANSPORT_RESTRICTIONS_NOT_ENCODED', 'ES_CATALONIA_EUROMODULAR_SPECIAL_AND_ADR_RESTRICTIONS_NOT_ENCODED']) a.ok(es.coverage_failures.includes(gap), gap);
    a.equal(one(v, 'es-a7-n-340-957-997-mma-7500', '2026-12-15').verified_at, '2026-11-20T12:30:00.000Z', 'December events of extended profiles carry the 20 Nov evidence');
    a.equal(current.jurisdiction_reviews.ES.last_checked, '2026-11-02T15:20:00.000Z', 'a targeted review must not make the full-sweep age look fresh');
    a.deepEqual(current.window, {from: '2026-09-01', to: '2026-12-31'});
    const log = JSON.parse(readFileSync(new URL('../data/driving-bans/source-reviews/2026-11-20-es-december.json', import.meta.url), 'utf8'));
    a.equal(log.full_registry_sweep, false);
    const sources = new Map(current.sources.map(s => [s.source_id, s]));
    for (const id of ['es-boe-2026-11-20', 'es-cat-isp-300-2026-11-20', 'cat-labour-holidays-2026', 'es-bas-2026-11-20', 'es-cat-isp-1933-2026']) a.equal(sources.get(id)?.content_sha256, log.retrievals.find(r => r.source_id === id).sha256, id);
    for (const r of log.retrievals.filter(row => row.same_as_19_nov)) a.equal(sources.get(r.source_id)?.content_sha256, r.sha256, `${r.source_id}: PR #144 evidence re-read byte-identical`);
  });
  // 28 Nov 2026 audit: New Year eve bans that start on 31 Dec inside the reviewed span (data/driving-bans/source-reviews/2026-11-28-new-year-eves-pt.json).
  test('28 Nov 2026 — New Year eve bans starting 31 Dec (HU, HR, LU) and Porto VCI December holidays', () => {
    const v = at(new Date('2026-11-28T12:00:00Z'));
    const hu = ev(v, 'hu-holiday-2027-01-01');
    a.deepEqual(hu.map(e => [e.starts_at, e.ends_at]), [['2026-12-31T21:00:00.000Z', '2027-01-01T21:00:00.000Z']]);
    a.deepEqual(ev(v, 'hr-holiday-eve-2026-12-31').map(e => [e.starts_at, e.ends_at]), [['2026-12-31T14:00:00.000Z', '2026-12-31T22:00:00.000Z']]);
    a.deepEqual(ev(v, 'lu-france-new-year-2027').map(e => [e.starts_at, e.ends_at, e.direction]), [['2026-12-31T20:30:00.000Z', '2027-01-01T20:45:00.000Z', 'Transit toward France']]);
    a.deepEqual(ev(v, 'lu-germany-new-year-2027').map(e => [e.starts_at, e.ends_at, e.direction]), [['2026-12-31T22:30:00.000Z', '2027-01-01T20:45:00.000Z', 'Transit toward Germany']]);
    const vci = ev(v, 'pt-vci-porto').map(e => e.date).filter(d => d >= '2026-12-01');
    a.ok(vci.length > 0, 'Porto VCI publishes December working days');
    for (const holiday of ['2026-12-01', '2026-12-08', '2026-12-25']) a.ok(!vci.includes(holiday), holiday);
    a.ok(!vci.some(d => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())), 'working days only');
    a.ok(!v.events.some(e => e.date > '2026-12-31'), 'nothing is published after the reviewed span');
    for (const j of ['HU', 'HR', 'LU', 'PT']) a.notEqual(v.jurisdictions.find(x => x.jurisdiction === j)?.ban_state, 'NO_BAN');
    a.equal(current.jurisdiction_reviews.HU.last_checked, '2026-10-27T11:20:00.000Z', 'targeted reviews never refresh the full-sweep date');
    const log = JSON.parse(readFileSync(new URL('../data/driving-bans/source-reviews/2026-11-28-new-year-eves-pt.json', import.meta.url), 'utf8'));
    const sources = new Map(current.sources.map(s => [s.source_id, s]));
    for (const r of log.retrievals) a.equal(sources.get(r.source_id)?.content_sha256, r.sha256, r.source_id);
  });
}
