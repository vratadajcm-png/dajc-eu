// Browser script for the DAJC AI account panel on /intelligence/ask. It
// talks only to DAJC's own /api/ask/* endpoints (same origin, HttpOnly
// session cookie) and renders with textContent only. Whether the user has
// paid access is decided by the server; this script only shows it.

type Strings = Record<string, string>;
type Json = Record<string, any>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

async function call(path: string, body?: unknown): Promise<{ status: number; data: Json }> {
  const res = await fetch(path, body === undefined
    ? { credentials: 'same-origin', cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  let data: Json = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

const PERMIT_LABELS: Record<string, string> = {
  lengthM: 'mem.length', widthM: 'mem.width', heightM: 'mem.height', massKg: 'mem.mass',
  maxAxleLoadKg: 'permit.axle', validity: 'permit.validity', jurisdiction: 'permit.country',
};

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(document.documentElement.lang || 'en', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export function feedbackControl(answer: unknown, s: (key: string, vars?: Record<string, string | number>) => string): HTMLElement {
  const box = el('details', undefined, 'ask-feedback');
  box.append(el('summary', s('fb.button')));
  const form = el('form');
  const label = el('label', s('fb.category'));
  const select = el('select');
  for (const category of ['WRONG_FACT', 'OUTDATED', 'MISSING_SOURCE', 'UNCLEAR', 'OTHER']) {
    const option = el('option', s(`fb.${category}`));
    option.value = category;
    select.append(option);
  }
  label.append(select);
  const commentLabel = el('label', s('fb.comment'));
  const comment = el('textarea');
  comment.maxLength = 1000;
  comment.rows = 3;
  commentLabel.append(comment);
  const send = el('button', s('fb.send'), 'button');
  send.type = 'submit';
  const status = el('p', undefined, 'ask-feedback-status');
  status.setAttribute('role', 'status');
  form.append(label, commentLabel, send, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    send.disabled = true;
    const { data } = await call('/api/ask/account/feedback', { category: select.value, comment: comment.value, answer });
    status.textContent = data.ok ? s('fb.thanks') : s('systemError');
    if (!data.ok) send.disabled = false;
  });
  box.append(form);
  return box;
}

export function renderRegistry(container: HTMLElement, registry: Json | null, notices: string[], s: (key: string, vars?: Record<string, string | number>) => string): void {
  for (const notice of notices) {
    const key = notice === 'AI_UNAVAILABLE' ? 'paid.aiUnavailable' : notice === 'ROUTING_NOT_AVAILABLE' ? 'paid.routing' : notice === 'REGISTRY_NEEDS_COUNTRY_AND_DATE' ? 'paid.needCountryDate' : null;
    if (key) container.append(el('p', s(key), 'ask-notice'));
  }
  const answer = registry?.answer;
  if (!answer) return;
  const section = el('section', undefined, 'ask-registry');
  section.setAttribute('aria-label', s('paid.registryTitle'));
  section.append(el('h3', s('paid.registryTitle')), el('p', s('paid.registryNote'), 'hint'));
  const list = el('ul');
  for (const row of answer.completeness ?? []) {
    const outcome = row.outcome ? s(`outcome.${row.outcome}`) : row.verification_state;
    const parts = [`${row.jurisdiction}: ${outcome}`];
    if (row.last_verified) parts.push(`${s('lastVerified')} ${String(row.last_verified).slice(0, 10)}`);
    list.append(el('li', parts.join(' · '), `ask-outcome ask-outcome--${String(row.outcome || '').toLowerCase()}`));
  }
  section.append(list);
  const facts = (answer.facts ?? []).slice(0, 30);
  if (facts.length > 0) {
    section.append(el('h4', s('paid.events')));
    const events = el('ul');
    for (const fact of facts) {
      const applicability = fact.vehicle?.status;
      const text = [fact.jurisdiction, fact.title, fact.local_time, fact.vehicle_scope, applicability ? `(${s(`applicability.${applicability}`)})` : '']
        .filter(Boolean).join(' · ');
      events.append(el('li', text || JSON.stringify(fact).slice(0, 200)));
    }
    section.append(events);
  }
  for (const warning of (answer.warnings ?? []).slice(0, 10)) section.append(el('p', String(warning), 'ask-notice'));
  if (answer.disclaimer) section.append(el('p', String(answer.disclaimer), 'ask-ai-notice'));
  container.append(section);
}

export function initAccountPanel(root: HTMLElement | null = document.querySelector('[data-ask-root]')): void {
  const panel = root?.querySelector<HTMLElement>('[data-account-panel]');
  if (!root || !panel) return;
  let strings: Strings = {};
  try {
    strings = JSON.parse(root.dataset.strings || '{}');
  } catch {
    strings = {};
  }
  const s = (key: string, vars: Record<string, string | number> = {}) => format(strings[key] || key, vars);
  const part = (name: string) => panel.querySelector<HTMLElement>(`[data-account="${name}"]`)!;
  const message = part('message');
  const say = (text: string) => { message.textContent = text; };

  const billing = new URL(location.href).searchParams.get('billing');
  if (billing === 'success' || billing === 'cancelled' || billing === 'failed') say(s(`acct.billing.${billing}`));

  async function refresh() {
    const { status, data } = await call('/api/ask/account/status');
    panel.hidden = status !== 200 || !data.ok;
    if (panel.hidden) {
      root!.dataset.paidActive = 'false';
      return;
    }
    const wasPaid = root!.dataset.paidActive === 'true';
    root!.dataset.paidActive = data.paidActive ? 'true' : 'false';
    if (wasPaid !== Boolean(data.paidActive)) root!.dispatchEvent(new CustomEvent('dajc:plan-changed'));
    renderSubscription(data);
    renderConsents(data);
    await Promise.all([renderMemory(data), renderHistory(data)]);
    for (const section of panel.querySelectorAll<HTMLElement>('[data-paid-only]')) section.hidden = !data.paidActive;
    const paidFields = root!.querySelector<HTMLElement>('[data-ask="paid-fields"]');
    if (paidFields) paidFields.hidden = !data.paidActive;
  }

  function button(text: string, onClick: () => void | Promise<void>, className = 'button'): HTMLButtonElement {
    const b = el('button', text, className);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await onClick();
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }

  function renderSubscription(data: Json) {
    const box = part('subscription');
    box.replaceChildren();
    if (!data.paidAvailable) {
      box.append(el('p', s('acct.free', { limit: 3 })));
      return;
    }
    const sub = data.subscription ?? {};
    const fair = data.fairUse ?? {};
    if (data.mode?.payments === 'sandbox') box.append(el('p', s('acct.testMode'), 'ask-test-mode'));
    box.append(el('p', s('acct.price', { daily: fair.dailyQuestions ?? '', monthly: fair.monthlyQuestions ?? '' })));
    if (sub.active) {
      box.append(el('p', sub.cancelAtPeriodEnd ? s('acct.paidCancelled', { date: day(sub.paidUntil) }) : s('acct.paidActive', { date: day(sub.paidUntil) }), 'ask-paid-status'));
      box.append(el('p', s('acct.usage', { day: fair.usedToday ?? 0, dailyLimit: fair.dailyQuestions ?? 0, month: fair.usedThisMonth ?? 0, monthlyLimit: fair.monthlyQuestions ?? 0 })));
      const actions = el('div', undefined, 'ask-actions');
      actions.append(button(s('acct.manage'), async () => {
        const { data: r } = await call('/api/ask/billing/manage', {});
        if (r.url) location.assign(r.url);
        else say(s('acct.unavailable'));
      }, 'link-button'));
      if (!sub.cancelAtPeriodEnd) {
        actions.append(button(s('acct.cancel'), async () => {
          if (!confirm(s('acct.cancelConfirm'))) return;
          const { data: r } = await call('/api/ask/billing/cancel', {});
          say(r.ok ? s('acct.cancelled') : s('acct.unavailable'));
          await refresh();
        }, 'link-button'));
      }
      actions.append(button(s('acct.refund'), async () => {
        if (!confirm(s('acct.refundConfirm'))) return;
        const { data: r } = await call('/api/ask/billing/refund', { reason: 'REQUESTED_BY_CUSTOMER' });
        say(strings[`acct.refund.${r.result}`] ? s(`acct.refund.${r.result}`) : s('acct.unavailable'));
        await refresh();
      }, 'link-button'));
      box.append(actions);
    } else {
      box.append(button(s('acct.subscribe'), async () => {
        const { data: r } = await call('/api/ask/billing/checkout', { lang: root!.dataset.lang });
        if (r.url) location.assign(r.url);
        else say(s('acct.unavailable'));
      }));
    }
    box.append(el('p', s('acct.terms'), 'hint'));
  }

  function renderConsents(data: Json) {
    const box = part('consents');
    box.replaceChildren();
    for (const consent of data.consents ?? []) {
      const label = el('label', undefined, 'ask-consent');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = Boolean(consent.granted);
      input.disabled = !consent.available && !consent.granted;
      input.addEventListener('change', async () => {
        const { data: r } = await call('/api/ask/account/consent', { purpose: consent.purpose, granted: input.checked });
        if (!r.ok) input.checked = !input.checked;
        await refresh();
      });
      label.append(input, el('span', s(`consent.${consent.purpose}`, { days: 90 })));
      if (!consent.available && consent.purpose !== 'SHARED_LEARNING') label.append(el('small', ` ${s('consent.paidOnly')}`));
      box.append(label);
    }
    box.append(el('p', s('consent.note'), 'hint'));
  }

  async function renderMemory(data: Json) {
    const list = part('memory-list');
    const select = root!.querySelector<HTMLSelectElement>('[data-ask="vehicle"]');
    list.replaceChildren();
    if (!data.paidActive) return;
    const { data: r } = await call('/api/ask/account/memory');
    const vehicles = (r.items ?? []).filter((item: Json) => item.kind === 'VEHICLE' && item.content);
    if (select) {
      select.replaceChildren(Object.assign(el('option', s('paid.none')), { value: '' }));
      for (const v of vehicles) select.append(Object.assign(el('option', v.content.name), { value: v.id }));
    }
    if (vehicles.length === 0) list.append(el('li', s('mem.none')));
    for (const v of vehicles) {
      const item = el('li', `${v.content.name} · ${s(`mem.cfg.${v.content.vehicle?.configuration}`)}`);
      item.append(' ', button(s('mem.delete'), async () => {
        await call('/api/ask/account/memory', { delete: v.id });
        await refresh();
      }, 'link-button'));
      list.append(item);
    }
  }

  async function renderHistory(data: Json) {
    const list = part('history-list');
    list.replaceChildren();
    if (!data.paidActive) return;
    const { data: r } = await call('/api/ask/account/history');
    const items = r.items ?? [];
    if (items.length === 0) list.append(el('li', s('hist.none')));
    for (const h of items) {
      const item = el('li', `${day(h.createdAt)} – ${h.question ?? '…'}`);
      item.append(' ', button(s('hist.delete'), async () => {
        await call('/api/ask/account/history', { id: h.id });
        await refresh();
      }, 'link-button'));
      list.append(item);
    }
  }

  panel.querySelector<HTMLFormElement>('[data-account="memory-form"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    const num = (name: string) => {
      const value = Number(String(f.get(name) || '').replace(',', '.'));
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const { data: r } = await call('/api/ask/account/memory', {
      kind: 'VEHICLE',
      content: {
        name: String(f.get('name') || '').trim(),
        vehicle: { configuration: String(f.get('configuration')), combinationMassKg: num('mass'), widthM: num('width'), heightM: num('height'), lengthM: num('length'), adr: f.get('adr') === 'on', exceptionalTransport: f.get('exceptional') === 'on' },
      },
    });
    say(r.ok ? '' : r.status === 'no_consent' ? s('mem.needConsent') : s('questionInvalid'));
    if (r.ok) form.reset();
    await refresh();
  });

  panel.querySelector<HTMLFormElement>('[data-account="permit-form"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget as HTMLFormElement);
    const num = (name: string) => {
      const value = Number(String(f.get(name) || '').replace(',', '.'));
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const validTo = String(f.get('validTo') || '') || undefined;
    const date = String(f.get('date') || '') || undefined;
    const { data: r } = await call('/api/ask/paid/permit-compare', {
      permit: { maxLengthM: num('maxLength'), maxWidthM: num('maxWidth'), maxHeightM: num('maxHeight'), maxMassKg: num('maxMass'), validTo },
      transport: { lengthM: num('length'), widthM: num('width'), heightM: num('height'), massKg: num('mass'), date },
    });
    const out = part('permit-result');
    out.replaceChildren();
    if (!r.ok) {
      out.append(el('p', s('questionInvalid')));
      return;
    }
    out.append(el('p', s(`permit.status.${r.comparison.status}`), `ask-permit ask-permit--${String(r.comparison.status).toLowerCase()}`));
    const label = (key: string) => s(PERMIT_LABELS[key] ?? key);
    const table = el('ul');
    for (const check of r.comparison.checks) table.append(el('li', `${label(check.key)}: ${check.transport ?? '–'} / ${check.permit ?? '–'} → ${s(`permit.${check.result}`)}`, `ask-check ask-check--${String(check.result).toLowerCase()}`));
    out.append(table);
    const notCompared = r.comparison.checks.filter((c: Json) => c.result === 'NOT_COMPARED').map((c: Json) => label(c.key));
    if (notCompared.length) out.append(el('p', `${s('permit.notCompared')}: ${notCompared.join('; ')}`, 'hint'));
    out.append(el('p', s('permit.disclaimer'), 'ask-ai-notice'));
  });

  panel.querySelector<HTMLButtonElement>('[data-account="history-delete-all"]')?.addEventListener('click', async () => {
    await call('/api/ask/account/history', { id: 'all' });
    await refresh();
  });

  panel.querySelector<HTMLButtonElement>('[data-account="delete"]')?.addEventListener('click', async () => {
    const typed = prompt(s('data.deleteConfirm'));
    if (typed !== 'DELETE') return;
    const { data: r } = await call('/api/ask/account/delete', { confirm: 'DELETE' });
    if (r.ok) {
      say(s('data.deleted'));
      panel.hidden = true;
      location.reload();
    } else say(s('acct.unavailable'));
  });

  root.addEventListener('dajc:signed-in', () => void refresh());
  void refresh();
}
