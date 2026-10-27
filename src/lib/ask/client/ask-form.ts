// Browser script for /intelligence/ask. It talks only to DAJC's own
// /api/ask/* endpoints and holds no keys or provider addresses - every
// provider call happens on the server (scripts/check-ask-bundle.mjs and
// the vitest suite check that nothing secret reaches client bundles).
// Answers are rendered with textContent only, never as HTML.

type Strings = Record<string, string>;

type Outcome = 'BAN_FOUND' | 'NO_CONFIRMED_BAN' | 'INSUFFICIENT_VERIFIED_DATA';

interface AnswerPayload {
  level: 'VERIFIED' | 'PARTIAL' | 'UNKNOWN' | 'INSUFFICIENT_VERIFIED_DATA';
  statements: Array<{ text: string; sourceId: string; basis: 'dajc_verified' | 'official_web' | 'unverified_official_lead' }>;
  facts: Array<{ sourceId: string; rows: Array<{ label: string; value: string; href?: string }> }>;
  sources: Array<{ id: string; url: string; title: string; checkedAt: string; publishedAt: string | null; verification: 'DAJC_VERIFIED' | 'OFFICIAL_WEB' | 'UNVERIFIED_LEAD' }>;
  authorities: Array<{ url: string }>;
  notices: string[];
  verification: Array<{ jurisdiction: string; outcome: Outcome; coverageComplete: boolean; lastVerified: string | null; period: { from: string; to: string } }>;
  ui: {
    levelLabel: string; levelHelp: string; reasonText: string | null; aiNotice: string;
    sourcesLabel: string; checkedOn: string; publishedOn: string; authoritiesLabel: string;
    supportText: string; supportLink: string;
    verificationLabel: string; outcomeLabels: Record<Outcome, string>; periodLabel: string; lastVerifiedLabel: string; unverifiedLabel: string;
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function safeLink(url: string, text: string): HTMLElement {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      const a = el('a', text);
      a.href = parsed.toString();
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      return a;
    }
  } catch {
    // fall through to plain text
  }
  return el('span', text);
}

function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, any> }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  let data: Record<string, any> = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

export function renderAnswer(container: HTMLElement, answer: AnswerPayload): void {
  container.replaceChildren();
  const level = el('p', answer.ui.levelLabel, `ask-level ask-level--${answer.level.toLowerCase()}`);
  container.append(level, el('p', answer.ui.levelHelp, 'ask-level-help'));
  if (answer.ui.reasonText) container.append(el('p', answer.ui.reasonText, 'ask-reason'));
  for (const notice of answer.notices) container.append(el('p', notice, 'ask-notice'));

  if (answer.verification.length > 0) {
    container.append(el('h3', answer.ui.verificationLabel));
    const list = el('ul', undefined, 'ask-verification');
    for (const row of answer.verification) {
      const parts = [`${row.jurisdiction}: ${answer.ui.outcomeLabels[row.outcome]}`, `${answer.ui.periodLabel} ${row.period.from} – ${row.period.to}`];
      if (row.lastVerified) parts.push(`${answer.ui.lastVerifiedLabel} ${row.lastVerified.slice(0, 10)}`);
      list.append(el('li', parts.join(' · '), `ask-outcome ask-outcome--${row.outcome.toLowerCase()}`));
    }
    container.append(list);
  }

  const sourceIndex = new Map(answer.sources.map((s, i) => [s.id, i + 1]));
  const factsShown = new Set<string>();
  if (answer.statements.length > 0) {
    const list = el('ul', undefined, 'ask-statements');
    for (const statement of answer.statements) {
      const item = el('li');
      item.append(el('span', statement.text));
      if (statement.basis === 'unverified_official_lead') item.append(el('span', ` (${answer.ui.unverifiedLabel})`, 'ask-unverified'));
      const n = sourceIndex.get(statement.sourceId);
      if (n) item.append(el('sup', `[${n}]`));
      const facts = answer.facts.find((f) => f.sourceId === statement.sourceId);
      if (facts && !factsShown.has(statement.sourceId)) {
        factsShown.add(statement.sourceId);
        const table = el('dl', undefined, 'ask-facts');
        for (const row of facts.rows) {
          table.append(el('dt', row.label));
          const dd = el('dd');
          dd.append(row.href ? safeLink(row.href, row.value) : el('span', row.value));
          table.append(dd);
        }
        item.append(table);
      }
      list.append(item);
    }
    container.append(list);
  }

  if (answer.sources.length > 0) {
    container.append(el('h3', answer.ui.sourcesLabel));
    const list = el('ol', undefined, 'ask-sources');
    for (const source of answer.sources) {
      const item = el('li');
      item.append(safeLink(source.url, source.title || source.url));
      const dates = [`${answer.ui.checkedOn} ${source.checkedAt}`];
      if (source.publishedAt) dates.push(`${answer.ui.publishedOn} ${source.publishedAt}`);
      if (source.verification === 'UNVERIFIED_LEAD') dates.unshift(answer.ui.unverifiedLabel);
      item.append(el('span', ` (${dates.join(', ')})`, 'ask-source-date'));
      list.append(item);
    }
    container.append(list);
  }

  if ((answer.level === 'UNKNOWN' || answer.level === 'INSUFFICIENT_VERIFIED_DATA') && answer.authorities.length > 0) {
    container.append(el('h3', answer.ui.authoritiesLabel));
    const list = el('ul', undefined, 'ask-authorities');
    for (const authority of answer.authorities) {
      const item = el('li');
      item.append(safeLink(authority.url, authority.url));
      list.append(item);
    }
    container.append(list);
  }

  container.append(el('p', answer.ui.aiNotice, 'ask-ai-notice'));
  const support = el('p', `${answer.ui.supportText} `, 'ask-support');
  const link = el('a', answer.ui.supportLink);
  link.href = '/support';
  support.append(link);
  container.append(support);
}

export function initAskForm(root: HTMLElement | null = document.querySelector('[data-ask-root]')): void {
  if (!root) return;
  const lang = root.dataset.lang || 'en';
  let strings: Strings = {};
  try {
    strings = JSON.parse(root.dataset.strings || '{}');
  } catch {
    strings = {};
  }
  const s = (key: string, vars: Record<string, string | number> = {}) => format(strings[key] || key, vars);
  const part = (name: string) => root.querySelector<HTMLElement>(`[data-ask="${name}"]`)!;

  const signIn = part('sign-in');
  const confirm = part('confirm');
  const askSection = part('ask');
  const message = part('message');
  const remaining = part('remaining');
  const answerBox = part('answer');
  const show = (section: HTMLElement, visible: boolean) => { section.hidden = !visible; };
  const say = (text: string) => { message.textContent = text; };

  const loginToken = location.hash.startsWith('#login=') ? location.hash.slice('#login='.length) : null;
  if (loginToken) history.replaceState(null, '', location.pathname + location.search);

  async function refresh() {
    try {
      const res = await fetch('/api/ask/status', { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.ok) throw new Error('status');
      if (!data.available) say(s('budgetReached'));
      show(signIn, !data.signedIn && !loginToken);
      show(askSection, Boolean(data.signedIn));
      askSection.querySelector('button[type="submit"]')?.toggleAttribute('disabled', !data.available || data.remaining === 0);
      if (data.signedIn) remaining.textContent = data.remaining === 0 ? s('limitReached', { limit: data.limit }) : s('remaining', { n: data.remaining, limit: data.limit });
    } catch {
      say(s('systemError'));
    }
  }

  if (loginToken) {
    show(confirm, true);
    confirm.querySelector('button')?.addEventListener('click', async () => {
      const { data } = await post('/api/ask/verify', { token: loginToken, lang });
      show(confirm, false);
      say(data.ok ? s('signedIn') : (data.error || s('invalidLink')));
      await refresh();
    }, { once: true });
  }

  signIn.querySelector('form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = (signIn.querySelector('input[type="email"]') as HTMLInputElement).value;
    const { data } = await post('/api/ask/login', { email, lang });
    say(data.ok ? data.message : (data.error || s('systemError')));
  });

  askSection.querySelector('form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = askSection.querySelector('textarea') as HTMLTextAreaElement;
    const button = askSection.querySelector('button[type="submit"]') as HTMLButtonElement;
    button.disabled = true;
    answerBox.replaceChildren(el('p', s('working'), 'ask-working'));
    say('');
    try {
      const { status, data } = await post('/api/ask/query', { question: field.value, lang });
      if (data.ok && data.answer) {
        renderAnswer(answerBox, data.answer as AnswerPayload);
      } else {
        answerBox.replaceChildren();
        say(data.error || s('systemError'));
        if (status === 401) show(signIn, true);
      }
    } catch {
      answerBox.replaceChildren();
      say(s('systemError'));
    }
    await refresh();
  });

  part('sign-out')?.addEventListener('click', async () => {
    await post('/api/ask/logout', {});
    answerBox.replaceChildren();
    await refresh();
  });

  void refresh();
}
