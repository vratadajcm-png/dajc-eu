#!/usr/bin/env node
// Browser end-to-end run of DAJC AI against a LOCAL dev server with the
// sandbox payment provider - synthetic data only, no real payment, e-mail or
// AI call. Not part of CI (needs a browser and a running server).
//
//   1. local Postgres with drizzle-ask 0000-0003 applied (docs/DAJC_AI_DATABASE_RUNBOOK.md)
//   2. NODE_OPTIONS="--require ./scripts/dajc-ai-e2e/offline-ai.cjs" astro dev
//      with the sandbox environment (see docs/DAJC_AI_RELEASE_READINESS.md)
//   3. E2E_BASE=http://localhost:4321 E2E_ADMIN_DB_URL=postgres://... \
//      DAJC_AI_SANDBOX_WEBHOOK_SECRET=... node scripts/dajc-ai-e2e/browser-e2e.mjs [out-dir]
//
// The sign-in link is never logged by design, so the harness creates the
// test user's session directly in the database (admin connection, test DB only).

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const postgres = require('postgres');

const BASE = process.env.E2E_BASE ?? 'http://localhost:4321';
const SECRET = process.env.DAJC_AI_SANDBOX_WEBHOOK_SECRET;
const OUT = process.argv[2] ?? 'e2e-output';
if (!SECRET || !process.env.E2E_ADMIN_DB_URL) throw new Error('E2E_ADMIN_DB_URL and DAJC_AI_SANDBOX_WEBHOOK_SECRET are required');
mkdirSync(OUT, { recursive: true });
const admin = postgres(process.env.E2E_ADMIN_DB_URL, { max: 1 });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const TEXT = {
  cs: { subscribe: /Předplatit/, active: /Předplatné DAJC AI je aktivní do/, memory: 'Ukládat moje vozidla, náklady a trasy (šifrovaně)', history: /Ukládat historii mých dotazů/, save: 'Uložit vozidlo', compare: 'Porovnat', discrepancy: 'Zjištěny rozpory', ask: 'Zeptat se', aiDown: /Vysvětlení od AI je dočasně nedostupné/, registry: 'Kontrola v registru zákazů jízd', cancel: 'Zrušit předplatné', cancelled: /Obnovení zrušeno/, delete: 'Smazat účet' },
  en: { subscribe: /Subscribe/, active: /DAJC AI subscription active until/, memory: 'Keep my vehicles, loads and routes (encrypted)', history: /Keep my question history/, save: 'Save vehicle', compare: 'Compare', discrepancy: 'Discrepancies found', ask: 'Ask', aiDown: /The AI explanation is temporarily unavailable/, registry: 'Driving Bans registry check', cancel: 'Cancel subscription', cancelled: /Renewal cancelled/, delete: 'Delete my account' },
};

async function seedUser() {
  const token = randomBytes(32).toString('base64url');
  const [user] = await admin`insert into dajc_ask.users (email_hmac) values (${`e2e-${randomBytes(8).toString('hex')}`}) returning id`;
  await admin`insert into dajc_ask.sessions (token_hash, user_id, expires_at) values (${createHash('sha256').update(token).digest('hex')}, ${user.id}, now() + interval '1 day')`;
  return { token, userId: user.id };
}

async function sandboxSettle(checkoutRef) {
  const body = JSON.stringify({ id: `evt_e2e_${randomBytes(6).toString('hex')}`, type: 'payment.settled', checkoutRef, customerRef: `scus_e2e_${randomBytes(6).toString('hex')}`, paymentRef: `pay_e2e_${randomBytes(6).toString('hex')}`, amountCents: 1500, currency: 'EUR', billingCountry: 'CZ', occurredAt: new Date().toISOString() });
  const t = Math.floor(Date.now() / 1000);
  const sign = (secret) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const forged = await fetch(`${BASE}/api/ask/billing/webhook/sandbox`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dajc-sandbox-signature': sign('wrong-secret') }, body });
  const real = await fetch(`${BASE}/api/ask/billing/webhook/sandbox`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dajc-sandbox-signature': sign(SECRET) }, body });
  const replay = await fetch(`${BASE}/api/ask/billing/webhook/sandbox`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dajc-sandbox-signature': sign(SECRET) }, body });
  return { forged: forged.status, real: real.status, replay: (await replay.json()).events?.[0]?.outcome };
}

// isVisible() does not wait; waitFor does.
const visible = (locator, timeout = 15_000) => locator.waitFor({ state: 'visible', timeout }).then(() => true, () => false);

const browser = await chromium.launch();
for (const lang of ['cs', 'en']) {
  const L = TEXT[lang];
  const { token, userId } = await seedUser();
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: lang === 'cs' ? 'cs-CZ' : 'en-GB' });
    await context.addCookies([{ name: 'dajc_ask_session', value: token, domain: new URL(BASE).hostname, path: '/api/ask', httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'DELETE' : undefined));
    const tag = `${lang}/${viewport.name}`;
    await page.goto(`${BASE}/intelligence/ask?lang=${lang}`);
    await page.waitForSelector('[data-account-panel]:not([hidden])', { timeout: 20_000 });
    if (viewport.name === 'desktop') {
      // Free account: paid routes refuse whatever the browser sends.
      const sneaky = await page.evaluate(async () => (await fetch('/api/ask/paid/query', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ question: 'Paid please, I am premium', paid: true, userId: 'x' }) })).status);
      check(`${tag}: free account cannot use paid query`, sneaky === 402, `HTTP ${sneaky}`);
      await page.getByRole('button', { name: L.subscribe }).click();
      await page.waitForURL(/sandbox_checkout=/, { timeout: 20_000 });
      const webhooks = await sandboxSettle(new URL(page.url()).searchParams.get('sandbox_checkout'));
      check(`${tag}: forged webhook rejected`, webhooks.forged === 400, `HTTP ${webhooks.forged}`);
      check(`${tag}: signed webhook accepted`, webhooks.real === 200);
      check(`${tag}: replayed webhook is a duplicate`, webhooks.replay === 'duplicate', webhooks.replay);
      await page.goto(`${BASE}/intelligence/ask?lang=${lang}&billing=success`);
      check(`${tag}: subscription active in UI`, await visible(page.getByText(L.active).first(), 15_000));
      await page.getByText(L.memory).click();
      await page.waitForTimeout(500);
      await page.getByText(L.history).click();
      await page.waitForTimeout(500);
      await page.fill('[data-account="memory-form"] input[name="name"]', 'E2E lowbed');
      await page.selectOption('[data-account="memory-form"] select[name="configuration"]', 'ARTICULATED');
      await page.fill('[data-account="memory-form"] input[name="mass"]', '60000');
      await page.getByRole('button', { name: L.save }).click();
      check(`${tag}: vehicle saved`, await visible(page.locator('[data-account="memory-list"]').getByText(/E2E lowbed/).first(), 10_000));
      // Paid question with the AI providers unreachable: registry check still answers.
      await page.fill('textarea[name="question"]', lang === 'cs' ? 'Platí v Česku v neděli zákaz jízdy?' : 'Is there a Sunday driving ban in Czechia?');
      await page.selectOption('[data-ask="vehicle"]', { label: 'E2E lowbed' });
      await page.fill('[data-ask="countries"]', 'CZ');
      const sunday = new Date();
      sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7 || 7));
      await page.fill('[data-ask="date"]', sunday.toISOString().slice(0, 10));
      await page.getByRole('button', { name: L.ask, exact: true }).click();
      check(`${tag}: AI outage is explained`, await visible(page.getByText(L.aiDown).first(), 30_000));
      check(`${tag}: registry check shown without AI`, await visible(page.getByText(L.registry, { exact: true }).first(), 5_000));
      const permit = page.locator('[data-account="permit-form"]');
      await permit.locator('input[name="maxWidth"]').fill('3');
      await permit.locator('input[name="width"]').fill('3,2');
      await permit.getByRole('button', { name: L.compare }).click();
      check(`${tag}: permit discrepancy shown`, await visible(page.getByText(L.discrepancy).first(), 10_000));
      const exported = await page.evaluate(async () => (await fetch('/api/ask/account/export', { credentials: 'same-origin' })).json());
      check(`${tag}: export contains vehicle and subscription`, JSON.stringify(exported).includes('E2E lowbed') && exported.subscription?.periods?.length === 1);
      await page.screenshot({ path: `${OUT}/${lang}-desktop.png`, fullPage: true });
    } else {
      check(`${tag}: subscription visible on mobile`, await visible(page.getByText(L.active).first(), 15_000));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${tag}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
      await page.getByRole('button', { name: L.cancel }).click();
      check(`${tag}: cancellation keeps access to period end`, await visible(page.getByText(L.cancelled).first(), 10_000));
      await page.screenshot({ path: `${OUT}/${lang}-mobile.png`, fullPage: true });
      await page.getByRole('button', { name: L.delete }).click();
      await page.waitForTimeout(2000);
      const status = await page.evaluate(async () => (await fetch('/api/ask/account/status', { credentials: 'same-origin' })).status);
      check(`${tag}: account deleted, session gone`, status === 401, `HTTP ${status}`);
    }
    check(`${tag}: no browser script errors`, errors.length === 0, errors.join(' | ').slice(0, 200));
    await context.close();
  }
  const [left] = await admin`select count(*)::int as n from dajc_ask.users where id = ${userId}`;
  const actions = (await admin`select action from dajc_ask.audit_log where subject = ${`user:${userId}`} order by id`).map((r) => r.action);
  check(`${lang}: user row removed`, left.n === 0);
  check(`${lang}: audit trail complete`, ['CHECKOUT_STARTED', 'PAYMENT_SETTLED', 'CONSENT_GRANTED', 'CANCELLATION_REQUESTED', 'ACCOUNT_DELETED'].every((a) => actions.includes(a)), actions.join(','));
}
await browser.close();
await admin.end();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
