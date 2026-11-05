// The reason an API gave for refusing a request, for the run log. Anthropic
// and Perplexity return {"error":{"type","message"}}; the message says why
// (e.g. "Your credit balance is too low ..."), which the HTTP status alone
// does not: W46 failed on 5 November 2026 with only "HTTP 400" to go on.
// Request keys are never part of these messages.

const MAX_DETAIL = 240;

/** Pure - exported for tests. */
export function errorDetailFromBody(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  let detail = raw;
  try {
    const body = JSON.parse(raw);
    const error = body?.error ?? body;
    detail = typeof error === 'string'
      ? error
      : [error?.type, error?.message ?? body?.message ?? body?.detail].filter(Boolean).join(': ');
  } catch {
    // Not JSON: keep the start of the text.
  }
  return String(detail).replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL);
}

/** " (reason)" for a failed response, or "" when the body is empty or unreadable. */
export async function providerErrorDetail(res) {
  try {
    const detail = errorDetailFromBody(await res.text());
    return detail ? ` (${detail})` : '';
  } catch {
    return '';
  }
}
