// Test harness only (node --require): makes every AI provider and payment API
// host unreachable for the local dev server, so a browser E2E run never sends
// data outside and exercises the "AI provider down" path. Not imported by the app.
const BLOCKED = /(^|\.)(api\.openai\.com|api\.anthropic\.com|api\.perplexity\.ai|generativelanguage\.googleapis\.com|api\.x\.ai|api\.mistral\.ai|api\.stripe\.com|merchant\.revolut\.com|gpwebpay\.com)$/;
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (BLOCKED.test(url.hostname)) return new Response('{"error":"blocked by DAJC E2E harness"}', { status: 503, headers: { 'content-type': 'application/json' } });
  return original(input, init);
};
