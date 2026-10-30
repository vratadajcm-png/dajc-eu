import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guideAiAvailabilityResponse, isGuideAiAvailable } from '../guide-entry';
import { FULL_ENV } from './helpers';

const guide = readFileSync(new URL('../../../components/DAJCGuide.astro', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../../pages/api/guide/ai-availability.ts', import.meta.url), 'utf8');

describe('Ask DAJC · FAQ is the entry point to DAJC AI', () => {
  it('preserves the existing public widget name and prepared FAQ answers', () => {
    expect(guide.match(/Ask DAJC · FAQ/g)).toHaveLength(1);
    expect(guide).toContain('data-guide-question="driving-bans"');
    expect(guide).toContain('data-guide-question="what-is-dajc"');
    expect(guide).toContain('mailto:team@dajc.eu');
  });

  it('hides the AI link by default and checks availability before navigation', () => {
    expect(guide).toMatch(/data-guide-ai-link href="\/intelligence\/ask" hidden/);
    expect(guide).toMatch(/fetch\('\/api\/guide\/ai-availability', \{ cache: 'no-store', credentials: 'same-origin' \}\)/);
    expect(guide).toMatch(/event\.preventDefault\(\)/);
    expect(guide).toMatch(/if \(await refreshAiEntry\(\)\) window\.location\.assign\(aiLink\.href\)/);
    expect(guide).toMatch(/\.dajc-guide__ai-entry a\[hidden\]/);
    expect(guide).toContain('This FAQ is not a live chat.');
  });

  it('returns a non-404, non-cached readiness response while disabled', async () => {
    expect(isGuideAiAvailable({})).toBe(false);
    const res = guideAiAvailabilityResponse({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('does not treat an incomplete config or incorrect flag as available', async () => {
    for (const env of [
      { ...FULL_ENV, DAJC_ASK_ENABLED: 'false' },
      { ...FULL_ENV, DAJC_ASK_ENABLED: 'TRUE' },
      { ...FULL_ENV, DAJC_ASK_DB_URL: '' },
    ]) {
      const res = guideAiAvailabilityResponse(env);
      expect((await res.json()).available).toBe(false);
    }
  });

  it('reports available only when the complete existing Ask gate is enabled', async () => {
    const res = guideAiAvailabilityResponse(FULL_ENV);
    expect(isGuideAiAvailable(FULL_ENV)).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });

  it('never exposes configuration, user data or an Ask endpoint from the public gate', () => {
    const text = JSON.stringify(guideAiAvailabilityResponse({}));
    expect(text).not.toMatch(/apiKey|pepper|organisation|customer/i);
    expect(route).toContain('export const prerender = false');
    expect(route).toContain('guideAiAvailabilityResponse()');
    expect(route).not.toMatch(/DAJC_ASK_\w+|PUBLIC_DAJC_ASK/);
    expect(guide).not.toContain('fetch(\'/api/ask/status');
    expect(guide).not.toContain('fetch(\'/api/ask/query');
  });
});
