// Public free B2C release of DAJC AI (existing Ask, no second assistant):
// 3 free questions per verified e-mail per day, a voluntary /support link once
// they are used up (never a condition, never an unlock, never a redirect), the
// driver safety notice, and no confirmation of route passability, oversize
// authorisation or legal exceptions by the AI itself.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asksForConfirmation } from '../confirmation';
import { CostMeter } from '../cost';
import { forbiddenPhrase } from '../guard';
import { handleLogin, handleQuery, handleStatus, handleVerify, type RouteContext } from '../handlers';
import { dictionary, limitReachedText, t, UI_LANGUAGES } from '../i18n';
import { runPipeline, type PipelineDeps } from '../pipeline';
import type { JsonCallParams } from '../providers';
import type { AskRuntime } from '../runtime';
import { MemoryAskStore } from '../store/memory';
import { fakeFetchPage, fakeProviders, firstOwnSourceId, fixtureView, NOW, ownRecordQuote, testConfig } from './helpers';

const ROOT = join(__dirname, '..', '..', '..', '..');
const page = readFileSync(join(ROOT, 'src/pages/intelligence/ask.astro'), 'utf8');
const client = readFileSync(join(ROOT, 'src/lib/ask/client/ask-form.ts'), 'utf8');

const CS_LIMIT_TEXT = 'Dnes jste využili všechny 3 bezplatné dotazy. Další budete mít k dispozici zítra. Pokud vám DAJC AI pomáhá při práci, můžete dobrovolně podpořit její provoz a další vývoj.';
const CS_SAFETY = 'DAJC AI používejte pouze při bezpečném zastavení vozidla. Informace AI nenahrazují dopravní značení, úřední předpisy, povolení ani pokyny příslušných orgánů.';

describe('daily limit message and voluntary support', () => {
  it('uses the owner-approved Czech text for 3 questions and correct plural forms', () => {
    expect(limitReachedText('cs', 3)).toBe(CS_LIMIT_TEXT);
    expect(limitReachedText('cs', 2)).toMatch(/^Dnes jste využili všechny 2 bezplatné dotazy\./);
    expect(limitReachedText('cs', 5)).toMatch(/^Dnes jste využili všech 5 bezplatných dotazů\./);
    expect(limitReachedText('cs', 1)).toMatch(/^Dnes jste využili svůj bezplatný dotaz\./);
    expect(limitReachedText('en', 3)).toBe('You have used all 3 free questions for today. More will be available tomorrow. If DAJC AI helps you in your work, you can voluntarily support its operation and further development.');
    expect(t('cs', 'supportAiButton')).toBe('Dobrovolně podpořit DAJC AI');
    expect(t('en', 'supportAiButton')).toBe('Support DAJC AI voluntarily');
  });

  it('never promises anything for a contribution', () => {
    for (const lang of UI_LANGUAGES) {
      const dict = dictionary(lang);
      const texts = [dict.supportAiNote, dict.support, limitReachedText(lang, 3)].join(' ');
      // No positive promise ("you get more questions", "premium", "bonus").
      expect(texts).not.toMatch(/(?:získáte|dostanete|obdržíte)\s+(?:další|více)|(?:get|receive)\s+(?:more|extra)\s+questions|premium|bonus|subscribe to/i);
    }
    expect(t('cs', 'supportAiNote')).toMatch(/Neodemyká další dotazy, nevytváří předplatné a není podmínkou používání/);
    expect(t('en', 'supportAiNote')).toMatch(/does not unlock extra questions, does not create a subscription and is not a condition of use/);
  });

  it('shows the limit panel with a plain /support link and never redirects', () => {
    expect(page).toMatch(/<section class="limit" data-ask="limit" hidden/);
    expect(page).toMatch(/<a class="button support-button" href="\/support">\{t\(lang, 'supportAiButton'\)\}<\/a>/);
    // The link opens only on the user's own click: no script navigation anywhere.
    expect(client).not.toMatch(/location\.(?:assign|replace|href\s*=)|window\.open|\/support['"]\s*\)/);
    expect(client).toMatch(/show\(limitSection, limitReached\)/);
    expect(client).toMatch(/status === 429 && data\.limitReached/);
  });
});

describe('driver safety notice', () => {
  it('carries the exact Czech wording and an English translation', () => {
    expect(t('cs', 'safetyNotice')).toBe(CS_SAFETY);
    expect(t('en', 'safetyNotice')).toBe('Use DAJC AI only when the vehicle is safely stopped. AI information does not replace road signs, official regulations, permits or instructions from the competent authorities.');
  });

  it('is shown on the page and under every answer', () => {
    expect(page).toMatch(/<p class="safety" role="note">[\s\S]*\{t\(lang, 'safetyNotice'\)\}<\/p>/);
    expect(client).toMatch(/answerBox\.append\(el\('p', s\('safetyNotice'\), 'ask-safety'\)\)/);
  });
});

describe('no confirmation of passability, oversize authorisation or exceptions', () => {
  it.each([
    'Je trasa přes most v Jihlavě průjezdná pro nadrozměr 4 m?',
    'Můžu tam projet s nákladem 45 t v neděli?',
    'Vztahuje se na mě výjimka ze zákazu jízdy?',
    'Je moja trasa prejazdná pre nadrozmernú prepravu?',
    'Czy mogę przejechać tą trasą w niedzielę?',
    'Ist die Strecke für meinen Schwertransport befahrbar?',
    'Brauche ich eine Genehmigung für 3,2 m Breite?',
    'Is the A2 route passable for a 4.5 m high load?',
    'Can I drive through Austria on Saturday night with 40 t?',
    'Do I need a permit for a 3 m wide load in Poland?',
    'Does the exception apply to me if I carry livestock?',
  ])('recognises a confirmation request: %s', (question) => {
    expect(asksForConfirmation(question)).toBe(true);
  });

  it.each([
    'Is there a truck driving ban in Czechia on Sunday?',
    'Jaká je maximální povolená šířka vozidla v Německu?',
    'Which exceptions exist from the Austrian weekend ban?',
  ])('does not flag a general rule question: %s', (question) => {
    expect(asksForConfirmation(question)).toBe(false);
  });

  it.each([
    'Trasa je průjezdná pro nadrozměrnou přepravu.',
    'Úsek bude průjezdný bez omezení.',
    'The route is passable for oversize transport.',
    'This journey is authorised under the general permit.',
    'The exemption applies here because livestock is carried.',
    'Trasa je prejazdná pre nadrozmernú prepravu.',
    'Trasa jest przejezdna dla transportu ponadgabarytowego.',
    'Die Strecke ist befahrbar.',
  ])('drops an affirmative confirmation: %s', (statement) => {
    expect(forbiddenPhrase(statement)).not.toBeNull();
  });

  it.each([
    'Vehicles wider than 3 m require a special permit (Sondergenehmigung).',
    'The exemption applies to vehicles carrying livestock.',
    'Výjimka se vztahuje na vozidla přepravující živá zvířata.',
    'Most není průjezdný pro vozidla nad 40 t.',
    'The bridge is not passable for vehicles over 40 t.',
  ])('keeps a general rule or a negative restriction: %s', (statement) => {
    expect(forbiddenPhrase(statement)).toBeNull();
  });

  it('adds the fixed notice whatever the classifier says, and tells both models the rule', async () => {
    const config = testConfig();
    const providers = fakeProviders({
      classification: { case_assessment: false },
      draft: (params: JsonCallParams) => ({ claims: [{ text: 'V Česku platí v uvedený den zákaz jízdy nákladních vozidel (Sunday and public holiday driving ban).', source_id: firstOwnSourceId(params), quote: ownRecordQuote(params) }], covers_question: true }),
    });
    const deps = { config, providers, meter: new CostMeter(config), now: NOW, view: fixtureView(), findings: [], fetchPage: fakeFetchPage({}) } as PipelineDeps;
    const { answer } = await runPipeline('Můžu tam projet v neděli 1. 11. 2026 v Česku s kamionem 40 t?', 'cs', deps);
    expect(answer.notices).toContain(t('cs', 'noConfirmationNotice'));
    expect(t('cs', 'noConfirmationNotice')).toMatch(/^DAJC AI nepotvrzuje průjezdnost trasy, oprávnění k nadrozměrné přepravě ani uplatnění právní výjimky\./);
    const draft = providers.calls.openai.find((c) => c.schemaName === 'dajc_answer')!;
    expect(draft.system).toMatch(/Never confirm that a route, road, bridge or tunnel is passable/);
    expect(providers.calls.anthropic[0].system).toMatch(/confirms that a route, road, bridge or tunnel is passable for a transport/);
    expect(page).toMatch(/\{t\(lang, 'noConfirmationNotice'\)\}/);
  });
});

// --- Free again every day ----------------------------------------------------

class Jar {
  values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }
  set(name: string, value: string) { this.values.set(name, value); }
  delete(name: string) { this.values.delete(name); }
}

function ctx(path: string, body: unknown, jar: Jar, method = 'POST'): RouteContext {
  const url = new URL(`https://www.dajc.eu${path}`);
  return {
    request: new Request(url, { method, headers: { 'content-type': 'application/json', origin: 'https://www.dajc.eu' }, body: method === 'GET' ? undefined : JSON.stringify(body) }),
    url,
    cookies: jar,
    clientAddress: '203.0.113.9',
  };
}

describe('free every day, contributions change nothing', () => {
  it('refuses a fourth question whatever the request claims, then answers again the next Prague day', async () => {
    let now = new Date('2026-10-25T10:00:00Z');
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const rt: AskRuntime = {
      config: testConfig(),
      store: new MemoryAskStore(),
      providers: fakeProviders({
        draft: (params: JsonCallParams) => ({ claims: [{ text: 'In Czechia the Sunday and public holiday driving ban applies on that day.', source_id: firstOwnSourceId(params), quote: ownRecordQuote(params) }], covers_question: true }),
      }),
      mailer: { async send(message) { sent.push(message); } },
      now: () => now,
      pipeline: { view: fixtureView(), findings: [] },
    };
    const jar = new Jar();
    await handleLogin(ctx('/api/ask/login', { email: 'driver@example.com', lang: 'cs' }, jar), rt);
    const token = sent.at(-1)!.text.match(/#login=(\S+)/)![1];
    expect((await handleVerify(ctx('/api/ask/verify', { token }, jar), rt)).status).toBe(200);

    const ask = (extra: Record<string, unknown> = {}) => handleQuery(ctx('/api/ask/query', { question: 'Is there a truck driving ban in Czechia on 1 November 2026?', lang: 'cs', ...extra }, jar), rt);
    for (let i = 0; i < 3; i++) expect((await ask()).status).toBe(200);

    // A contribution is never checked, so no request field can unlock a question.
    for (const extra of [{ supported: true }, { donation: 'revolut' }, { paid: true, plan: 'premium' }]) {
      const res = await ask(extra);
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe(CS_LIMIT_TEXT);
    }
    const status = await (await handleStatus(ctx('/api/ask/status', null, jar, 'GET'), rt)).json();
    expect(status).toMatchObject({ signedIn: true, remaining: 0, limit: 3 });

    // Midnight in Prague (CET, UTC+1 after 25 October 2026): free questions again.
    now = new Date('2026-10-25T23:30:00Z');
    const nextDay = await (await handleStatus(ctx('/api/ask/status', null, jar, 'GET'), rt)).json();
    expect(nextDay).toMatchObject({ signedIn: true, remaining: 3, limit: 3 });
    expect((await ask()).status).toBe(200);
  });
});

// --- Public links only after activation ---------------------------------------

describe('DAJC AI in the main navigation and the FAQ appears only after activation', () => {
  const header = readFileSync(join(ROOT, 'src/components/Header.astro'), 'utf8');

  it('needs both the complete Ask gate and the separate publication switch', async () => {
    const { isAskPublicEntryEnabled } = await import('../public-entry');
    const { isGuideAiAvailable } = await import('../guide-entry');
    const { FULL_ENV } = await import('./helpers');
    const { DAJC_ASK_PUBLIC_ENTRY: _published, ...activatedOnly } = FULL_ENV;
    expect(isAskPublicEntryEnabled({})).toBe(false);
    expect(isAskPublicEntryEnabled(activatedOnly)).toBe(false);
    for (const value of ['TRUE', '1', 'yes', ' true', '']) expect(isAskPublicEntryEnabled({ ...activatedOnly, DAJC_ASK_PUBLIC_ENTRY: value })).toBe(false);
    expect(isAskPublicEntryEnabled({ DAJC_ASK_PUBLIC_ENTRY: 'true' })).toBe(false);
    expect(isAskPublicEntryEnabled({ ...FULL_ENV, DAJC_ASK_ENABLED: 'false' })).toBe(false);
    expect(isAskPublicEntryEnabled(FULL_ENV)).toBe(true);
    // The FAQ panel follows the same rule.
    expect(isGuideAiAvailable(activatedOnly)).toBe(false);
    expect(isGuideAiAvailable(FULL_ENV)).toBe(true);
  });

  it('renders the link server-side only, in desktop and mobile navigation', () => {
    expect(header).toMatch(/const showAsk = isAskPublicEntryEnabled\(\);/);
    expect(header.match(/\{showAsk && <a class="ask-link" href=\{ASK_PUBLIC_PATH\}/g)).toHaveLength(2);
    expect(header).not.toMatch(/import\.meta\.env|PUBLIC_DAJC|DAJC_ASK_|<script/);
    expect(header).toContain("'DAJC AI · bezplatné dotazy pro řidiče'");
    expect(header).toContain("'DAJC AI · free questions for drivers'");
  });

  it('is off in .env.example', () => {
    expect(readFileSync(join(ROOT, '.env.example'), 'utf8')).toMatch(/^DAJC_ASK_PUBLIC_ENTRY=false$/m);
  });
});
