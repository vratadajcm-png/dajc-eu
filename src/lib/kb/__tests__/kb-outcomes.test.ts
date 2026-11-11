import { describe, expect, it } from 'vitest';
import { AcquireError } from '../acquire/polite-fetch.mjs';
import { classifyError, classifyHttp, OUTCOMES } from '../acquire/outcomes.mjs';
import { runProbe } from '../probe.mjs';
import { readFileSync } from 'node:fs';

const h = (o: Record<string, string> = {}) => new Headers(o);

describe('outcome taxonomy', () => {
  it('distinguishes a WAF challenge, rate limiting, HTTP errors and success', () => {
    expect(classifyHttp(200, h())).toBe('OK');
    expect(classifyHttp(202, h({ 'x-amzn-waf-action': 'challenge' }))).toBe('WAF_BLOCKED');
    expect(classifyHttp(202, h({ 'content-length': '0' }))).toBe('WAF_BLOCKED');
    expect(classifyHttp(429, h())).toBe('RATE_LIMITED');
    expect(classifyHttp(503, h())).toBe('HTTP_ERROR');
  });
  it('maps client errors to the exact reason', () => {
    expect(classifyError(new AcquireError('ROBOTS_DISALLOWED', 'x'))).toBe('ROBOTS_DISALLOWED');
    expect(classifyError(new AcquireError('ROBOTS_UNAVAILABLE', 'x'))).toBe('ROBOTS_UNAVAILABLE');
    expect(classifyError(new AcquireError('RATE_LIMITED', 'x'))).toBe('RATE_LIMITED');
    expect(classifyError(new AcquireError('WAF_BLOCKED', 'x'))).toBe('WAF_BLOCKED');
    expect(classifyError(new AcquireError('NETWORK_ERROR', 'x'))).toBe('NETWORK_ERROR');
    expect(classifyError(new Error('boom'))).toBe('NETWORK_ERROR');
    expect(OUTCOMES).toContain('ROBOTS_UNAVAILABLE');
  });
  it('probes carry the same classification', async () => {
    const unavailable = await runProbe({ id: 'x', url: 'https://x.example/a', markers: ['a'] }, { robots: { admit: async () => { throw new Error('robots.txt of x does not allow this download (HTTP 503 for robots.txt)'); } } as never });
    expect(unavailable.classification).toBe('ROBOTS_UNAVAILABLE');
    const disallowed = await runProbe({ id: 'x', url: 'https://x.example/a', markers: ['a'] }, { robots: { admit: async () => { throw new Error('robots.txt of x does not allow this download (disallowed)'); } } as never });
    expect(disallowed.classification).toBe('ROBOTS_DISALLOWED');
    const rate = await runProbe({ id: 'x', url: 'https://x.example/a', markers: ['a'] }, { robots: { admit: async () => undefined } as never, fetchImpl: (async () => ({ ok: false, status: 429, headers: new Headers() })) as never });
    expect(rate.classification).toBe('RATE_LIMITED');
  });
});

describe('audit workflow safety', () => {
  const wf = readFileSync('.github/workflows/kb-audit-dev.yml', 'utf8');
  it('runs on pull_request with a label, owner-only, environment-gated, never pull_request_target', () => {
    expect(wf).not.toMatch(/^\s*pull_request_target:/m);
    expect(wf).toContain("github.event.label.name == 'kb-audit-dev'");
    expect(wf).toContain('github.actor == github.repository_owner');
    expect(wf).toContain('head.repo.full_name == github.repository');
    expect(wf).toContain('environment: kb-audit-dev');
  });
  it('has no secrets, only read permission, and uploads the report even on failure', () => {
    expect(wf).not.toMatch(/secrets\./);
    expect(wf).toMatch(/permissions:\n  contents: read/);
    expect(wf).toContain('if: ${{ !cancelled() }}');
    expect(wf).not.toMatch(/DATABASE|DB_URL|S3_/);
  });
});
