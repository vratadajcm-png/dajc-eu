#!/usr/bin/env node
// Checks every registered official legal source (src/lib/kb/legal-sources.mjs)
// from the environment it runs in: is the publisher reachable, what does its
// robots.txt allow for the library's user agent, and at which crawl delay.
// Writes config/legal-library/source-checks.json (no secrets involved).
//
//   node scripts/kb-sources-check.mjs [--out config/legal-library/source-checks.json]
//
// Outcomes (per domain, on the check day, from this environment only):
//   REACHABLE           - homepage answered 2xx/3xx and robots.txt allows "/";
//   ROBOTS_RESTRICTED   - reachable, but robots.txt disallows "/" for our agent;
//   BLOCKED_FROM_DEV    - refused with 403/429/5xx in this environment: by the
//                         publisher's server or by this environment's network
//                         policy (a sandbox proxy answers 503 too) - re-check
//                         from the GitHub runner before concluding anything;
//   UNREACHABLE         - no answer (DNS, TLS, timeout, network policy).
// A reachable site is not yet permission to import: reuse terms must be read
// (reuse.status in the registry) and each document path is checked against
// robots.txt again at download time (src/lib/kb/robots.mjs).

import { writeFileSync } from 'node:fs';
import { USER_AGENT } from '../src/lib/kb/importer.mjs';
import { legalSources } from '../src/lib/kb/legal-sources.mjs';
import { parseRobots, robotsDecision } from '../src/lib/kb/robots.mjs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'config/legal-library/source-checks.json';
const checkedOn = new Date().toISOString().slice(0, 10);

async function get(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': USER_AGENT } });
    const body = (await res.text()).slice(0, 300_000);
    return { status: res.status, body, finalHost: new URL(res.url).host };
  } catch (error) {
    return { status: null, error: String(error?.cause?.code || error?.name || 'error') };
  }
}

const results = [];
const seen = new Set();
for (const source of legalSources) {
  for (const domain of source.domains) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    const base = `https://${domain.includes('.') && domain.split('.').length === 2 && !domain.startsWith('www.') ? `www.${domain}` : domain}`;
    // Try the bare domain first; some official sites only answer on www.
    let origin = `https://${domain}`;
    let home = await get(`${origin}/`);
    if (home.status === null && base !== origin) {
      origin = base;
      home = await get(`${origin}/`);
    }
    const robotsRes = await get(`${origin}/robots.txt`);
    let robots = { status: robotsRes.status, rootAllowed: null, crawlDelaySec: null };
    if (robotsRes.status && robotsRes.status < 400) {
      const decision = robotsDecision(parseRobots(robotsRes.body), USER_AGENT, '/');
      robots = { status: robotsRes.status, rootAllowed: decision.allowed, crawlDelaySec: decision.crawlDelaySec };
    } else if (robotsRes.status && robotsRes.status < 500) {
      robots = { status: robotsRes.status, rootAllowed: true, crawlDelaySec: null };
    }
    const outcome = home.status === null ? 'UNREACHABLE'
      : [403, 429].includes(home.status) || home.status >= 500 ? 'BLOCKED_FROM_DEV'
        : robots.rootAllowed === false ? 'ROBOTS_RESTRICTED' : 'REACHABLE';
    results.push({ sourceId: source.id, jurisdiction: source.jurisdiction, region: source.region ?? null, domain, origin, home: { status: home.status, error: home.error ?? null }, robots, outcome });
    console.log(`${outcome.padEnd(18)} ${source.jurisdiction}${source.region ? `/${source.region}` : ''} ${domain} (home ${home.status ?? home.error}, robots ${robots.status ?? '-'}${robots.crawlDelaySec != null ? `, delay ${robots.crawlDelaySec}s` : ''})`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
const summary = Object.fromEntries(['REACHABLE', 'ROBOTS_RESTRICTED', 'BLOCKED_FROM_DEV', 'UNREACHABLE'].map((k) => [k, results.filter((r) => r.outcome === k).length]));
writeFileSync(out, `${JSON.stringify({
  $comment: 'Reachability and robots.txt of the registered official legal sources, checked by scripts/kb-sources-check.mjs from the environment named here. Not a statement about reuse terms.',
  checkedOn, environment: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions runner' : 'DAJC development sandbox (Claude Code, egress through a proxy)', userAgent: USER_AGENT, summary, results,
}, null, 1)}\n`);
console.log(`\n${JSON.stringify(summary)} -> ${out}`);
