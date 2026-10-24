import { describe, expect, it } from 'vitest';
import { checkReachable } from '../verify-candidates.mjs';

const response = (status) => ({ ok: status >= 200 && status < 300, status, body: { cancel: async () => {} } });

// Resolves like fetch, but only after `ms`, and honours the abort signal.
const slow = (ms, status) => (url, { signal }) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(response(status)), ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); });
});

describe('checkReachable', () => {
  it('falls back to GET with its own timeout when HEAD is too slow (rijkswaterstaat.nl, W44)', async () => {
    const calls = [];
    const fetchFn = (url, init) => {
      calls.push(init.method);
      return init.method === 'HEAD' ? slow(500, 200)(url, init) : slow(20, 200)(url, init);
    };
    expect(await checkReachable('https://www.rijkswaterstaat.nl/nieuws/n307', { fetchFn, timeoutMs: 100 })).toBe(true);
    expect(calls).toEqual(['HEAD', 'GET']);
  });

  it('falls back to GET when HEAD is refused', async () => {
    const fetchFn = async (url, { method }) => response(method === 'HEAD' ? 405 : 200);
    expect(await checkReachable('https://example.gov/notice', { fetchFn })).toBe(true);
  });

  it('needs no GET when HEAD succeeds', async () => {
    const calls = [];
    const fetchFn = async (url, { method }) => { calls.push(method); return response(200); };
    expect(await checkReachable('https://example.gov/notice', { fetchFn })).toBe(true);
    expect(calls).toEqual(['HEAD']);
  });

  it('reports a dead link as unreachable', async () => {
    expect(await checkReachable('https://example.gov/gone', { fetchFn: async () => response(404) })).toBe(false);
    expect(await checkReachable('https://example.gov/down', { fetchFn: async () => { throw new Error('ECONNRESET'); } })).toBe(false);
    expect(await checkReachable('https://example.gov/hangs', { fetchFn: slow(500, 200), timeoutMs: 50 })).toBe(false);
  });
});
