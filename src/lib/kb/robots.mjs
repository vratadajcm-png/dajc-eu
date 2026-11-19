// robots.txt compliance for every download from an official source
// (RFC 9309). The importer, the verifiers and the monitor fetch only what a
// publisher's robots.txt allows for our user agent, and never faster than its
// Crawl-delay (EUR-Lex: 10 seconds). Fail closed: a robots.txt that cannot be
// read because of a server or network error blocks the host for the run; a
// missing robots.txt (4xx) allows access, as the RFC says.

const MIN_DELAY_MS = 1_000;

/** Groups of a robots.txt: user agents, rules and crawl delay. */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySec: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (value !== '' || key === 'allow') current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySec = n;
    }
  }
  return groups;
}

function ruleMatches(rulePath, path) {
  if (rulePath === '') return false;
  const anchored = rulePath.endsWith('$');
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath).split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}

/**
 * Whether `path` (path + query) may be fetched by `userAgent`: the most
 * specific group wins (our product token, else "*"), then the longest matching
 * rule; Allow wins a tie.
 */
export function robotsDecision(groups, userAgent, path) {
  const agent = String(userAgent).toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== '*' && a !== '' && agent.includes(a)))
    ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return { allowed: true, crawlDelaySec: null };
  let best = null;
  for (const rule of group.rules) {
    if (!ruleMatches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return { allowed: best ? best.allow : true, crawlDelaySec: group.crawlDelaySec };
}

export class RobotsRefusal extends Error {
  constructor(url, reason) {
    super(`robots.txt of ${new URL(url).host} does not allow this download (${reason})`);
    this.name = 'RobotsRefusal';
  }
}

/** Per-run robots.txt cache and per-host pacing. */
export class RobotsPolicy {
  /**
   * @param {{ userAgent: string, fetchImpl?: (url: string, init?: any) => Promise<any>, now?: () => number,
   *           sleep?: (ms: number) => Promise<unknown>, minDelayMs?: number }} options
   */
  constructor({ userAgent, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), minDelayMs = MIN_DELAY_MS }) {
    if (!userAgent) throw new Error('RobotsPolicy needs the user agent');
    Object.assign(this, { userAgent, fetchImpl, now, sleep, minDelayMs });
    this.hosts = new Map();
  }

  async host(origin) {
    if (!this.hosts.has(origin)) {
      this.hosts.set(origin, (async () => {
        try {
          const res = await this.fetchImpl(`${origin}/robots.txt`, { redirect: 'follow', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': this.userAgent } });
          if (res.status >= 500) return { blocked: `HTTP ${res.status} for robots.txt`, groups: [], last: null };
          if (res.status >= 400) return { blocked: null, groups: [], last: null };
          return { blocked: null, groups: parseRobots((await res.text()).slice(0, 500_000)), last: null };
        } catch (error) {
          return { blocked: `robots.txt not readable (${error?.name || 'network error'})`, groups: [], last: null };
        }
      })());
    }
    return this.hosts.get(origin);
  }

  /**
   * Stops all further requests to a host for this run: a bot challenge or a rate
   * limit is the publisher saying "not now". It is never circumvented.
   */
  async block(url, reason) {
    const state = await this.host(new URL(url).origin);
    state.blocked = reason;
  }

  /** Waits for the host's turn, or throws RobotsRefusal. */
  async admit(url) {
    const u = new URL(url);
    const state = await this.host(u.origin);
    if (state.blocked) throw new RobotsRefusal(url, state.blocked);
    const decision = robotsDecision(state.groups, this.userAgent, `${u.pathname}${u.search}`);
    if (!decision.allowed) throw new RobotsRefusal(url, 'disallowed');
    const delay = Math.max(this.minDelayMs, (decision.crawlDelaySec ?? 0) * 1000);
    const wait = state.last === null ? 0 : state.last + delay - this.now();
    if (wait > 0) await this.sleep(wait);
    state.last = this.now();
    return decision;
  }
}
