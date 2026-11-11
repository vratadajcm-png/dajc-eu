import { describe, expect, it } from 'vitest';
import { USER_AGENT } from '../importer.mjs';
import { parseRobots, robotsDecision, RobotsPolicy } from '../robots.mjs';

// Shortened from https://eur-lex.europa.eu/robots.txt as served on 2026-11-09.
const EURLEX = `User-agent: *
Crawl-delay: 10
Disallow: /autocomplete
Disallow: /legal-content/EN/TXT/DOC/
Disallow: /legal-content/CS/TXT/SIG/
Disallow: /print-pdf
Disallow: /TodayOJ

User-agent: Sogou web spider
Disallow: /`;

describe('robots.txt rules (RFC 9309)', () => {
  const groups = parseRobots(EURLEX);

  it('allows the consolidated PDFs and status pages the library uses, at the publisher crawl delay', () => {
    expect(robotsDecision(groups, USER_AGENT, '/legal-content/EN/TXT/PDF/?uri=CELEX:02006R0561-20241231')).toEqual({ allowed: true, crawlDelaySec: 10 });
    expect(robotsDecision(groups, USER_AGENT, '/legal-content/EN/ALL/?uri=CELEX:32006R0561').allowed).toBe(true);
  });

  it('refuses what the publisher disallows, and applies a specific group to its agent only', () => {
    expect(robotsDecision(groups, USER_AGENT, '/legal-content/EN/TXT/DOC/?uri=CELEX:32006R0561').allowed).toBe(false);
    expect(robotsDecision(groups, USER_AGENT, '/print-pdf/x').allowed).toBe(false);
    expect(robotsDecision(groups, 'Sogou web spider/4.0', '/legal-content/EN/TXT/PDF/').allowed).toBe(false);
  });

  it('takes the longest match, Allow on a tie, and understands wildcards', () => {
    const g = parseRobots('User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\nDisallow: /*.doc$');
    expect(robotsDecision(g, USER_AGENT, '/docs/secret.pdf').allowed).toBe(false);
    expect(robotsDecision(g, USER_AGENT, '/docs/public/law.pdf').allowed).toBe(true);
    expect(robotsDecision(g, USER_AGENT, '/law.doc').allowed).toBe(false);
    expect(robotsDecision(g, USER_AGENT, '/law.docx').allowed).toBe(true);
    expect(robotsDecision(parseRobots(''), USER_AGENT, '/anything').allowed).toBe(true);
  });
});

describe('robots policy per host', () => {
  const respond = (status: number, body = '') => async () => new Response(body, { status });

  it('paces requests to one host by its crawl delay', async () => {
    let clock = 0;
    const waits: number[] = [];
    const policy = new RobotsPolicy({ userAgent: USER_AGENT, fetchImpl: respond(200, EURLEX) as any, now: () => clock, sleep: async (ms: number) => { waits.push(ms); clock += ms; } });
    await policy.admit('https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:1');
    clock += 2_000;
    await policy.admit('https://eur-lex.europa.eu/legal-content/CS/TXT/PDF/?uri=CELEX:1');
    expect(waits).toEqual([8_000]);
    await expect(policy.admit('https://eur-lex.europa.eu/legal-content/EN/TXT/DOC/?uri=CELEX:1')).rejects.toThrow(/does not allow/);
  });

  it('fails closed when robots.txt cannot be read, but allows a host without one', async () => {
    const opts = { userAgent: USER_AGENT, sleep: async () => undefined };
    await expect(new RobotsPolicy({ ...opts, fetchImpl: respond(503) as any }).admit('https://example.gov/law.pdf')).rejects.toThrow(/HTTP 503/);
    await expect(new RobotsPolicy({ ...opts, fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as any }).admit('https://example.gov/law.pdf')).rejects.toThrow(/not readable/);
    await expect(new RobotsPolicy({ ...opts, fetchImpl: respond(404) as any }).admit('https://example.gov/law.pdf')).resolves.toMatchObject({ allowed: true });
  });
});

describe('a bot challenge stops the run for that host', () => {
  it('refuses the challenge page and sends no further request to the host', async () => {
    const { fetchOfficialBytes } = await import('../importer.mjs');
    const robots = new RobotsPolicy({ userAgent: USER_AGENT, fetchImpl: (async () => new Response(EURLEX, { status: 200 })) as any, sleep: async () => undefined });
    let documentRequests = 0;
    const challenged = (async () => {
      documentRequests++;
      return new Response('', { status: 202, headers: { 'x-amzn-waf-action': 'challenge', 'content-length': '0' } });
    }) as any;
    const url = 'https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:02015L0413-20250119';
    await expect(fetchOfficialBytes(url, { fetchImpl: challenged, robots })).rejects.toThrow(/bot challenge \(challenge\); not circumvented, retry later/);
    await expect(fetchOfficialBytes(url.replace('EN', 'CS'), { fetchImpl: challenged, robots })).rejects.toThrow(/does not allow this download/);
    expect(documentRequests).toBe(1);
    const limited = (async () => new Response('', { status: 429 })) as any;
    const other = new RobotsPolicy({ userAgent: USER_AGENT, fetchImpl: (async () => new Response('', { status: 404 })) as any, sleep: async () => undefined });
    await expect(fetchOfficialBytes(url, { fetchImpl: limited, robots: other })).rejects.toThrow(/rate limited/);
  });
});
