import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalDrivingBans, getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { hostPolicyFor } from '../../../config/driving-ban-sources/monitor-policy.mjs';
import { toIcs } from './core.mjs';
import { assessEvidence } from './legal-changes.mjs';
import {
  buildReverificationQueue, isBotChallenge, isSoftBlockPage, monitorAllowedHosts, monitorSources, normalizeDocumentText, resolveMonitorTarget,
  verifiedTextBaseline, withinAllowedWindow, NORMALIZER_VERSION,
} from './source-monitor.mjs';
const LAW = ' Sonn- und Feiertagsfahrverbot fuer Lastkraftwagen ueber 7,5 t von 0 bis 22 Uhr. '.repeat(5);
// @ts-ignore - plain ESM script helper
import { formatDrivingBansAlert } from '../../../scripts/report-driving-bans-alert.mjs';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const ok = (body: string, contentType = 'text/html') => ({ ok: true, http_status: 200, content_type: contentType, bytes: Buffer.from(body) });
const noSleep = async () => {};
const WED_NOON_VIENNA = () => new Date('2026-11-18T11:00:00Z');
const WED_NIGHT_VIENNA = () => new Date('2026-11-18T21:30:00Z');

function dataset(sources: any[], rules: any[] = [], reviews: Record<string, any> = {}) {
  return { dataset_version: 'test', sources, rules, rule_profiles: {}, jurisdiction_reviews: reviews, window: { from: '2026-09-01', to: '2026-12-31' } };
}

describe('Driving Bans official-source monitor', () => {
  it('classifies reviewed, chrome-only, changed and baseline-less sources without touching the registry', async () => {
    const reviewed = `<html><body><p>§ 30 ${LAW}</p></body></html>`;
    const chrome = `<html><head><script>track()</script><style>p{}</style></head><body><!-- build 42 --><p>§ 30 ${LAW}</p></body></html>`;
    const data = dataset([
      { source_id: 'same', url: 'https://law.example.gov/a', role: 'PRIMARY', content_sha256: sha(reviewed) },
      { source_id: 'chrome', url: 'https://law.example.gov/b', role: 'PRIMARY', content_sha256: sha(reviewed) },
      { source_id: 'changed', url: 'https://law.example.gov/c', role: 'PRIMARY', content_sha256: sha(reviewed) },
      { source_id: 'nobase', url: 'https://law.example.gov/d', role: 'PRIMARY' },
      { source_id: 'press', url: 'https://press.example.com/e', role: 'SECONDARY' },
    ]);
    const before = JSON.stringify(data);
    const pages: Record<string, string> = { a: reviewed, b: chrome, c: reviewed.replace('bis 22 Uhr', 'bis 24 Uhr'), d: reviewed };
    const fetched: string[] = [];
    const baseline = { chrome: { raw_sha256: sha(reviewed), text_sha256: sha(normalizeDocumentText(Buffer.from(reviewed)) as string), normalizer_version: NORMALIZER_VERSION } };
    const report = await monitorSources({ canonical: data, baseline, sleep: noSleep, fetcher: async (url: string) => { fetched.push(url); return ok(pages[url.slice(-1)]); } });
    const state = Object.fromEntries(report.results.map((r: any) => [r.source_id, r.state]));
    expect(state).toEqual({ same: 'UNCHANGED', chrome: 'UNCHANGED_TEXT', changed: 'CHANGED', nobase: 'NO_BASELINE' });
    expect(fetched).not.toContain('https://press.example.com/e'); // secondary sources are never machine-verified
    expect(JSON.stringify(data)).toBe(before);
    expect(report.note).toMatch(/Not a legal verification/);
  });

  it('a text baseline cannot vouch for bytes that were never reviewed', async () => {
    const data = dataset([{ source_id: 's', url: 'https://law.example.gov/s', role: 'PRIMARY', content_sha256: sha('reviewed') }]);
    const forged = { s: { raw_sha256: sha('something else'), text_sha256: sha('new text') } };
    const report = await monitorSources({ canonical: data, baseline: forged, sleep: noSleep, fetcher: async () => ok('new text', 'text/plain') });
    expect(report.results[0].state).toBe('CHANGED');
  });

  it('keeps the last reviewed data on network errors, HTTP errors and bot protection (never bypassed)', async () => {
    const data = dataset([
      { source_id: 'down', url: 'https://law.example.gov/down', role: 'PRIMARY', content_sha256: sha('x') },
      { source_id: 'bot', url: 'https://law.example.gov/bot', role: 'PRIMARY', content_sha256: sha('x') },
      { source_id: 'ris-web', url: 'https://www.ris.bka.gv.at/eli/bgbl/ii/2026/77/P1/NOR1', role: 'PRIMARY', content_sha256: sha('x') },
    ]);
    const calls: string[] = [];
    const report = await monitorSources({ canonical: data, sleep: noSleep, fetcher: async (url: string) => {
      calls.push(url);
      if (url.endsWith('down')) throw new Error('ECONNRESET');
      return { ok: false, http_status: 503, availability: 'SOURCE_UNAVAILABLE', bytes: Buffer.from('<title>Security Check</title>') };
    } });
    expect(report.results.map((r: any) => r.state)).toEqual(['SOURCE_UNAVAILABLE', 'ACCESS_BLOCKED', 'ACCESS_BLOCKED']);
    expect(calls).not.toContain('https://www.ris.bka.gv.at/eli/bgbl/ii/2026/77/P1/NOR1');
    expect(report.summary.success_rate).toBe(0);
    expect(isBotChallenge(503, 'Please complete the Security Check')).toBe(true);
    expect(isBotChallenge(200, 'Security Check')).toBe(false);
  });

  it('reads Austrian law only through the official RIS OGD mirror and only when its terms allow automation', async () => {
    const source = { source_id: 'at-stvo42', url: 'https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011336&Paragraf=42', role: 'PRIMARY',
      content_sha256: sha('stvo'), retrieval_method: 'official open-data/ELI retrieval: https://ogd.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40276972/NOR40276972.html' };
    expect(resolveMonitorTarget(source)).toMatchObject({ connector: 'ris-ogd-document', url: 'https://ogd.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40276972/NOR40276972.html', blocked: null });
    expect(hostPolicyFor('ogd.ris.bka.gv.at')?.licence).toMatch(/CC BY 4\.0/);
    expect(hostPolicyFor('www.ris.bka.gv.at')?.state).toBe('ACCESS_BLOCKED');
    const calls: string[] = [];
    const fetcher = async (url: string) => { calls.push(url); return ok('stvo'); };
    const office = await monitorSources({ canonical: dataset([source]), sleep: noSleep, now: WED_NOON_VIENNA, fetcher });
    expect(office.results[0].state).toBe('DEFERRED_PROVIDER_TERMS');
    expect(calls).toHaveLength(0);
    const night = await monitorSources({ canonical: dataset([source]), sleep: noSleep, now: WED_NIGHT_VIENNA, fetcher });
    expect(night.results[0]).toMatchObject({ state: 'UNCHANGED', connector: 'ris-ogd-document', licence: expect.stringMatching(/CC BY/) });
    expect(withinAllowedWindow({ timezone: 'Europe/Vienna', weekdayFrom: '20:00', weekdayTo: '05:00', weekends: true }, new Date('2026-11-21T10:00:00Z'))).toBe(true); // Saturday
  });

  it('paces requests per host serially', async () => {
    const data = dataset([1, 2, 3].map((n) => ({ source_id: `s${n}`, url: `https://ogd.ris.bka.gv.at/Dokumente/Bundesnormen/NOR${n}/NOR${n}.html`, role: 'PRIMARY' })));
    const waits: number[] = [];
    await monitorSources({ canonical: data, now: WED_NIGHT_VIENNA, sleep: async (ms: number) => { waits.push(ms); }, fetcher: async () => ok('x') });
    expect(waits.length).toBe(2);
    expect(Math.min(...waits)).toBeGreaterThan(1500);
  });

  it('detects official text changes between runs, even for dynamic pages', async () => {
    const data = dataset([{ source_id: 'boe', url: 'https://www.boe.es/x', role: 'PRIMARY', content_sha256: sha('old reviewed bytes') }],
      [{ ban_id: 'es-a', jurisdiction: 'ES', source_id: 'boe', evidence_ids: [], status: 'ACTIVE' }]);
    const page = (hours: string, chrome: string) => `<p>${'Restricción de circulación para vehículos de más de 7.500 kg. '.repeat(4)}Domingo ${hours}</p><script>${chrome}</script>`;
    const first = await monitorSources({ canonical: data, sleep: noSleep, fetcher: async () => ok(page('8:00-22:00', '1')) });
    expect(first.results[0].since_last_run).toBe('FIRST_RUN');
    const same = await monitorSources({ canonical: data, previous: first, sleep: noSleep, fetcher: async () => ok(page('8:00-22:00', '2')) });
    expect(same.results[0].since_last_run).toBe('STABLE');
    const amended = await monitorSources({ canonical: data, previous: same, sleep: noSleep, fetcher: async () => ok(page('8:00-24:00', '2')) });
    expect(amended.results[0].since_last_run).toBe('CHANGED_SINCE_LAST_RUN');
    expect(amended.summary.changed_since_last_run).toBe(1);
    const queue = buildReverificationQueue({ canonical: data, report: amended, now: new Date('2026-11-18T12:00:00Z') });
    expect(queue.items.some((q: any) => q.kind === 'SOURCE_CONTENT_CHANGED_SINCE_LAST_RUN')).toBe(true);
    expect(queue.items.some((q: any) => q.kind === 'SOURCE_CHANGED_LEGAL_REVIEW_REQUIRED' && q.ban_id === 'es-a')).toBe(true);
  });
});

describe('independent review findings (19 Nov 2026)', () => {
  const bigPage = (rule: string) => `<p>${LAW} ${rule}</p>`;
  it('keeps the last good fingerprint through unavailable/deferred runs, so a later amendment is still detected', async () => {
    const data = dataset([{ source_id: 'boe', url: 'https://www.boe.es/x', role: 'PRIMARY', content_sha256: sha('reviewed') }]);
    const week1 = await monitorSources({ canonical: data, sleep: noSleep, fetcher: async () => ok(bigPage('Domingo 8-22')) });
    const week2 = await monitorSources({ canonical: data, previous: week1, sleep: noSleep, fetcher: async () => { throw new Error('timeout'); } });
    expect(week2.results[0]).toMatchObject({ state: 'SOURCE_UNAVAILABLE', last_retrieved: { raw_sha256: week1.results[0].raw_sha256 } });
    const week3 = await monitorSources({ canonical: data, previous: week2, sleep: noSleep, fetcher: async () => ok(bigPage('Domingo 8-24')) });
    expect(week3.results[0].since_last_run).toBe('CHANGED_SINCE_LAST_RUN');
  });
  it('never deletes visible legal text inside forms, headers or around self-closing svg, and never throws on bad entities', () => {
    expect(normalizeDocumentText(Buffer.from(`<body><form id=aspnetForm><p>${LAW}</p></form></body>`))).toContain('Feiertagsfahrverbot');
    const svg = normalizeDocumentText(Buffer.from(`<svg class=i/><header><h2>Art 1</h2></header><p>${LAW}</p><svg><path/></svg><p>rest</p>`)) as string;
    expect(svg).toContain('Art 1'); expect(svg).toContain('Feiertagsfahrverbot');
    expect(() => normalizeDocumentText(Buffer.from(`<p>a &#99999999; &#x110000; b ${LAW}</p>`))).not.toThrow();
    expect(normalizeDocumentText(Buffer.from('<p>short</p>'))).toBeNull(); // too short to fingerprint: compared by bytes
  });
  it('a baseline from another normaliser version is ignored', async () => {
    const reviewed = bigPage('x');
    const data = dataset([{ source_id: 's', url: 'https://law.example.gov/s', role: 'PRIMARY', content_sha256: sha(reviewed) }]);
    const stale = { s: { raw_sha256: sha(reviewed), text_sha256: sha(normalizeDocumentText(Buffer.from(reviewed)) as string), normalizer_version: 1 } };
    const report = await monitorSources({ canonical: data, baseline: stale, sleep: noSleep, fetcher: async () => ok(`<script>a</script>${reviewed}`) });
    expect(report.results[0].state).toBe('CHANGED');
  });
  it('fetches only PRIMARY hosts; secondary press/aggregator hosts are not allowlisted', () => {
    const hosts = monitorAllowedHosts(canonicalDrivingBans, ['ogd.ris.bka.gv.at']);
    expect(hosts).toContain('www.gesetze-im-internet.de');
    expect(hosts).toContain('ogd.ris.bka.gv.at');
    for (const secondary of ['trafficban.com', 'www.trafficban.com', 'informace.cesmad.cz', 'www.saarnews.com', 'www.wko.at']) expect(hosts).not.toContain(secondary);
  });
  it('recognises a security-check page from the non-200 snippet and treats 429 as blocked', async () => {
    const data = dataset([{ source_id: 'a', url: 'https://law.example.gov/a', role: 'PRIMARY' }, { source_id: 'b', url: 'https://law.example.gov/b', role: 'PRIMARY' }]);
    const report = await monitorSources({ canonical: data, sleep: noSleep, fetcher: async (url: string) => url.endsWith('a')
      ? { ok: false, http_status: 503, code: 'HTTP_STATUS', snippet: '<title>Security Check</title>' }
      : { ok: false, http_status: 429, code: 'HTTP_STATUS', snippet: '' } });
    expect(report.results.map((r: any) => r.state)).toEqual(['ACCESS_BLOCKED', 'ACCESS_BLOCKED']);
  });
  it('a changed source URL starts a new comparison instead of a false change alert', async () => {
    const before = await monitorSources({ canonical: dataset([{ source_id: 'at-lueg', url: 'https://law.example.gov/old', role: 'PRIMARY' }]), sleep: noSleep, fetcher: async () => ok(bigPage('A')) });
    const after = await monitorSources({ canonical: dataset([{ source_id: 'at-lueg', url: 'https://law.example.gov/new', role: 'PRIMARY' }]), previous: before, sleep: noSleep, fetcher: async () => ok(bigPage('B')) });
    expect(after.results[0].since_last_run).toBe('FIRST_RUN');
  });
});

describe('re-verification queue on the real registry', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const expired = assessEvidence(canonicalDrivingBans, { now });

  it('never reduces expired evidence by itself, whatever the monitor found', () => {
    const allUnchanged = { results: canonicalDrivingBans.sources.map((s: any) => ({ source_id: s.source_id, state: 'UNCHANGED', jurisdictions: [] })) };
    const queue = buildReverificationQueue({ canonical: canonicalDrivingBans, report: allUnchanged, now });
    expect(queue.expired_evidence).toBe(expired.length);
    expect(assessEvidence(canonicalDrivingBans, { now })).toHaveLength(expired.length);
    expect(queue.items.find((q: any) => q.kind === 'DATASET_WINDOW_EXPIRED')).toBeTruthy();
    const ready = queue.items.filter((q: any) => q.kind === 'EVIDENCE_UNCHANGED_READY_FOR_LEGAL_REVIEW');
    expect(ready.length).toBe(expired.filter((e: any) => e.ban_id).length);
    for (const item of ready) expect(item.action).toMatch(/legal reviewer must still confirm/);
  });

  it('routes changed or unavailable evidence to manual legal review', () => {
    const hu = expired.find((e: any) => e.jurisdiction === 'HU')!;
    const report = { results: [{ source_id: hu.sources[0], state: 'CHANGED', jurisdictions: ['HU'] }, { source_id: hu.sources[1], state: 'SOURCE_UNAVAILABLE', jurisdictions: ['HU'] }] };
    const queue = buildReverificationQueue({ canonical: canonicalDrivingBans, report, now });
    expect(queue.items.find((q: any) => q.ban_id === hu.ban_id).kind).toBe('SOURCE_CHANGED_LEGAL_REVIEW_REQUIRED');
    // Any other expired rule: its sources are not in this report, so nothing can be refreshed.
    // (Not tied to one country - registry reviews extend individual review windows.)
    const other = expired.find((e: any) => e.ban_id && e.jurisdiction !== 'HU')!;
    expect(other).toBeTruthy();
    expect(queue.items.find((q: any) => q.ban_id === other.ban_id).kind).toBe('EVIDENCE_NOT_REFRESHABLE');
  });

  it('a failed monitor run never turns an unverified jurisdiction into NO_BAN in JSON, ICS or web data', async () => {
    const view = getDrivingBansSnapshot(now);
    const before = JSON.stringify(view.jurisdictions.map((j: any) => [j.jurisdiction, j.ban_state, j.verification_state]));
    const raw = JSON.stringify(canonicalDrivingBans);
    const report = await monitorSources({ canonical: canonicalDrivingBans, sleep: noSleep, now: () => now, fetcher: async () => { throw new Error('offline'); } });
    expect(report.summary.retrieved).toBe(0);
    expect(JSON.stringify(canonicalDrivingBans)).toBe(raw);
    const after = getDrivingBansSnapshot(now);
    expect(JSON.stringify(after.jurisdictions.map((j: any) => [j.jurisdiction, j.ban_state, j.verification_state]))).toBe(before);
    for (const j of after.jurisdictions.filter((x: any) => !x.coverage_complete)) expect(j.ban_state).not.toBe('NO_BAN');
  });

  it('only verified-identical sources may enter the text baseline', () => {
    const baseline = verifiedTextBaseline({ results: [
      { source_id: 'a', state: 'UNCHANGED', raw_sha256: 'r1', reviewed_sha256: 'r1', text_sha256: 't1', checked_at: 'x', url: 'https://a' },
      { source_id: 'b', state: 'CHANGED', raw_sha256: 'r2', reviewed_sha256: 'r0', text_sha256: 't2' },
      { source_id: 'c', state: 'NO_BASELINE', raw_sha256: 'r3', reviewed_sha256: null, text_sha256: 't3' },
    ] });
    expect(Object.keys(baseline)).toEqual(['a']);
  });
});

describe('committed text baseline', () => {
  it('vouches only for sources whose reviewed canonical hash it repeats', () => {
    const file = JSON.parse(readFileSync(new URL('../../../data/driving-bans/source-monitor/text-baseline.json', import.meta.url), 'utf8'));
    const reviewed = new Map(canonicalDrivingBans.sources.map((s: any) => [s.source_id, s.content_sha256]));
    expect(Object.keys(file.sources).length).toBeGreaterThan(0);
    for (const [id, entry] of Object.entries<any>(file.sources)) {
      expect(reviewed.get(id), id).toBe(entry.raw_sha256);
      expect(entry.text_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.normalizer_version, id).toBe(NORMALIZER_VERSION);
    }
  });
});

describe('one snapshot feeds JSON, ICS and the web page', () => {
  it('the API JSON, ICS feed and page all read getDrivingBansSnapshot and nothing else', () => {
    for (const file of ['../../pages/api/driving-bans.json.ts', '../../pages/api/driving-bans.ics.ts', '../../pages/driving-bans.astro']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).toMatch(/getDrivingBansSnapshot\(\)/);
      expect(source, file).not.toMatch(/canonical\.json|driving-bans-legacy|tests\/fixtures/);
    }
  });

  it('every published JSON event has exactly one ICS VEVENT with the same UID and UTC times', () => {
    const view = getDrivingBansSnapshot(new Date('2026-11-18T12:00:00Z'));
    const ics = toIcs(view, { upcoming: true }).replace(/\r\n[ \t]/g, '');
    const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim());
    expect(new Set(uids).size).toBe(uids.length);
    expect(uids.length).toBe(view.upcoming_events.length);
    const blocks = ics.split('BEGIN:VEVENT').slice(1);
    for (const event of view.upcoming_events.slice(0, 400)) {
      const block = blocks.find((b) => b.includes(`UID:${event.uid}`));
      expect(block, event.uid).toBeTruthy();
      const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      expect(block).toContain(`DTSTART:${utc(event.starts_at)}`);
      expect(block).toContain(`DTEND:${utc(event.ends_at)}`);
    }
  });
});

describe('operational alert', () => {
  it('links the run evidence and rejects malformed run identity or kind', () => {
    const body = formatDrivingBansAlert({ repo: 'o/r', runId: '1', kind: 'monitor', monitorMarkdown: '| CHANGED | 2 |' });
    expect(body).toContain('https://github.com/o/r/actions/runs/1');
    expect(body).toContain('last reviewed data stays in force');
    expect(() => formatDrivingBansAlert({ repo: 'o/r', runId: 'x', kind: 'monitor' })).toThrow();
    expect(() => formatDrivingBansAlert({ repo: 'o/r', runId: '1', kind: 'publish' })).toThrow();
  });
});

describe('outage never overwrites the last known good state (20 Nov 2026)', () => {
  const page = (rule: string) => `<html><head><title>Verordnung</title></head><body><p>${LAW} ${rule}</p></body></html>`;
  it('an HTTP 200 bot challenge is an outage: the last good fingerprint is carried and the real page stays STABLE', async () => {
    const data = dataset([{ source_id: 'law', url: 'https://law.example.gov/law', role: 'PRIMARY', content_sha256: sha('reviewed') }]);
    const week1 = await monitorSources({ canonical: data, sleep: noSleep, fetcher: async () => ok(page('A')) });
    const challenge = '<html><head><title>Just a moment...</title></head><body><noscript>Enable JavaScript and cookies to continue</noscript></body></html>';
    const week2 = await monitorSources({ canonical: data, previous: week1, sleep: noSleep, fetcher: async () => ok(challenge) });
    expect(week2.results[0]).toMatchObject({ state: 'ACCESS_BLOCKED', last_retrieved: { raw_sha256: week1.results[0].raw_sha256 } });
    expect(week2.results[0].raw_sha256).toBeUndefined();
    expect(week2.summary.changed_since_last_run).toBe(0);
    const week3 = await monitorSources({ canonical: data, previous: week2, sleep: noSleep, fetcher: async () => ok(page('A')) });
    expect(week3.results[0].since_last_run).toBe('STABLE');
  });
  it('legal text that merely mentions such words, and reviewed bytes, are never treated as a block page', async () => {
    expect(isSoftBlockPage(Buffer.from(page('Online-Antrag mit Captcha und Security Check im Portal'.repeat(20))))).toBe(false);
    expect(isSoftBlockPage(Buffer.from('<title>Attention Required! | Cloudflare</title>'), 'text/html')).toBe(true);
    expect(isSoftBlockPage(Buffer.from('%PDF-1.7 captcha'), 'application/pdf')).toBe(false);
    const reviewed = '<title>Access denied</title>';
    const data = dataset([{ source_id: 'r', url: 'https://law.example.gov/r', role: 'PRIMARY', content_sha256: sha(reviewed) }]);
    const report = await monitorSources({ canonical: data, sleep: noSleep, fetcher: async () => ok(reviewed) });
    expect(report.results[0].state).toBe('UNCHANGED');
  });
  it('texts too short to normalise are compared by their bytes between runs', async () => {
    const data = dataset([{ source_id: 'short', url: 'https://law.example.gov/short', role: 'PRIMARY', content_sha256: sha('reviewed') }]);
    const run1 = await monitorSources({ canonical: data, sleep: noSleep, fetcher: async () => ok('<p>Fahrverbot ueber 7,5 t</p>') });
    expect(run1.results[0].text_sha256).toBeNull();
    const run2 = await monitorSources({ canonical: data, previous: run1, sleep: noSleep, fetcher: async () => ok('<p>Fahrverbot ueber 7,5 t</p>') });
    expect(run2.results[0].since_last_run).toBe('STABLE');
    const run3 = await monitorSources({ canonical: data, previous: run2, sleep: noSleep, fetcher: async () => ok('<p>Fahrverbot ueber 3,5 t</p>') });
    expect(run3.results[0].since_last_run).toBe('CHANGED_SINCE_LAST_RUN');
  });
  it('a partial run is refused before any network access when it would replace the persisted state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dajc-monitor-state-'));
    try {
      for (const partial of [['--only', 'AT'], ['--max-sources', '2'], ['--max-sources', 'all'], ['--min-success-rate', '0,6']]) {
        const result = spawnSync(process.execPath, ['scripts/driving-bans-source-monitor.mjs', ...partial, '--state-dir', dir, '--output', join(dir, 'out')], { encoding: 'utf8', timeout: 20000 });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/--state-dir requires a full run|--max-sources must be a positive integer|--min-success-rate must be a number/);
      }
      expect(existsSync(join(dir, 'latest.json'))).toBe(false);
      expect(existsSync(join(dir, 'out'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('the workflow alerts on any monitor-job failure and persists history only after a needed alert succeeded', () => {
    const yml = readFileSync('.github/workflows/driving-bans-thursday.yml', 'utf8');
    const step = (name: string) => {
      const start = yml.indexOf(`- name: ${name}`);
      expect(start, name).toBeGreaterThan(-1);
      const next = yml.indexOf('\n      - name:', start + 1);
      return { start, text: yml.slice(start, next < 0 ? undefined : next) };
    };
    const monitor = step('Retrieve and compare official sources');
    const alert = step('Alert on changed sources, degraded retrieval or a failed monitor job (main only)');
    const persist = step('Persist monitor history (main only)');
    expect(monitor.text).toMatch(/continue-on-error: true/);
    expect(alert.text).toMatch(/failure\(\) \|\| steps\.monitor\.outcome == 'failure'/);
    expect(alert.start).toBeLessThan(persist.start);
    const condition = persist.text.match(/if: \$\{\{(.*)\}\}/)?.[1] ?? '';
    expect(condition).toMatch(/!cancelled\(\)/);
    expect(condition).not.toMatch(/always\(\)/);
    expect(condition).toMatch(/steps\.alert\.outcome == 'success' \|\| \(steps\.alert\.outcome == 'skipped' && steps\.monitor\.outcome == 'success'\)/);
    expect(condition).not.toMatch(/steps\.alert\.outcome != 'failure'/);
    expect(condition).toMatch(/refs\/heads\/main/);
  });
});

describe('independent review findings on the outage guard (20 Nov 2026)', () => {
  it('a short official page that mentions a captcha, or has an inline svg title, is a retrieval, not a block page', async () => {
    const notice = '<html><head><title>Bekanntmachung Fahrverbot</title></head><body><svg><title>Access denied icon</title></svg><p>Fahrverbot 7,5 t am 24.12.</p><form><label>Captcha</label></form></body></html>';
    expect(isSoftBlockPage(Buffer.from(notice), 'text/html')).toBe(false);
    const report = await monitorSources({ canonical: dataset([{ source_id: 'n', url: 'https://law.example.gov/n', role: 'PRIMARY' }]), sleep: noSleep, fetcher: async () => ok(notice) });
    expect(report.results[0].state).toBe('NO_BASELINE');
  });
  it('recognises noscript, entity-encoded, vendor and content-type-less interstitials', () => {
    expect(isSoftBlockPage(Buffer.from('<html><head><title>Un instant…</title></head><body><noscript>Enable JavaScript and cookies to continue</noscript></body></html>'), 'text/html')).toBe(true);
    expect(isSoftBlockPage(Buffer.from('<html><head><title>Access&nbsp;denied</title></head><body></body></html>'), 'text/html')).toBe(true);
    expect(isSoftBlockPage(Buffer.from('<html><head><title>x</title></head><body>Request unsuccessful. Incapsula incident ID: 1</body></html>'), 'text/html')).toBe(true);
    expect(isSoftBlockPage(Buffer.from('<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>'), null)).toBe(true);
    expect(isSoftBlockPage(Buffer.from('%PDF-1.7 Just a moment'), null)).toBe(false);
  });
  it('integration finding: an ordinary page carrying the Cloudflare challenge-platform beacon or an Incapsula resource script is the document', async () => {
    const law = '<html><head><title>245/2000 Sb. Zákon o státních svátcích</title></head><body><p>' + LAW.repeat(4) + '</p>'
      + '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></body></html>';
    expect(isSoftBlockPage(Buffer.from(law), 'text/html')).toBe(false);
    const report = await monitorSources({ canonical: dataset([{ source_id: 'cz-245', url: 'https://law.example.gov/cz', role: 'PRIMARY', content_sha256: sha('older reviewed bytes') }]), sleep: noSleep, fetcher: async () => ok(law) });
    expect(report.results[0].state).toBe('CHANGED');
    expect(isSoftBlockPage(Buffer.from('<html><head><title>x</title></head><body><noscript>Enable JavaScript and cookies to continue</noscript><script>window._cf_chl_opt={}</script></body></html>'), 'text/html')).toBe(true);
  });
  it('second review: long pages with a generic title still report changes; footers and odd encodings are handled', async () => {
    const titled = (rule: string) => '<html><head><title>Security check of abnormal loads</title></head><body><p>' + LAW.repeat(8) + rule + '</p></body></html>';
    const data = dataset([{ source_id: 't', url: 'https://law.example.gov/t', role: 'PRIMARY', content_sha256: sha('reviewed') }]);
    const w1 = await monitorSources({ canonical: data, sleep: noSleep, fetcher: async () => ok(titled('A')) });
    const w2 = await monitorSources({ canonical: data, previous: w1, sleep: noSleep, fetcher: async () => ok(titled('B')) });
    expect(w2.results[0]).toMatchObject({ state: 'CHANGED', since_last_run: 'CHANGED_SINCE_LAST_RUN' });
    expect(isSoftBlockPage(Buffer.from('<html><head><title>Bekanntmachung</title></head><body><p>Fahrverbot am 24.12.</p><footer>DDoS protection by Cloudflare</footer></body></html>'), 'text/html')).toBe(false);
    expect(isSoftBlockPage(Buffer.from('<html><head><title>Access&#x20;denied</title></head><body></body></html>'), 'text/html')).toBe(true);
    expect(isSoftBlockPage(Buffer.from('<?xml version="1.0"?><!-- x --><html><head><title>Just a moment...</title></head></html>'), null)).toBe(true);
    const waf = '<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Please consult with your administrator.</body></html>';
    const previous = { schema_version: 1, results: [{ source_id: 't', url: 'https://law.example.gov/t', state: 'NO_BASELINE', raw_sha256: sha(waf), text_sha256: null, normalizer_version: NORMALIZER_VERSION, checked_at: '2026-11-19T00:37:00Z' }] };
    const w3 = await monitorSources({ canonical: data, previous, sleep: noSleep, fetcher: async () => ok(waf) });
    expect(w3.results[0].state).toBe('ACCESS_BLOCKED'); // an interstitial stored by an earlier run is not trusted as the document
  });
  it('a document with substantial text is the document, whatever its title says, and stays STABLE', async () => {
    const page = '<html><head><title>Security check of abnormal loads</title></head><body><p>' + LAW.repeat(8) + '</p></body></html>';
    const data = dataset([{ source_id: 's', url: 'https://law.example.gov/s', role: 'PRIMARY' }]);
    const previous = { schema_version: 1, results: [{ source_id: 's', url: 'https://law.example.gov/s', state: 'NO_BASELINE', raw_sha256: sha(page), text_sha256: null, normalizer_version: NORMALIZER_VERSION, checked_at: '2026-11-19T00:37:00Z' }] };
    const report = await monitorSources({ canonical: data, previous, sleep: noSleep, fetcher: async () => ok(page) });
    expect(report.results[0]).toMatchObject({ state: 'NO_BASELINE', since_last_run: 'STABLE' });
  });
  it('the CLI writes persistable state only after the report and the alert markdown exist', () => {
    const cli = readFileSync('scripts/driving-bans-source-monitor.mjs', 'utf8');
    expect(cli.indexOf("join(dir, 'latest.json')")).toBeGreaterThan(cli.indexOf("join(out, 'source-monitor.md')"));
    expect(cli.indexOf("join(dir, 'latest.json')")).toBeGreaterThan(cli.indexOf('console.log(markdown)'));
  });
});
