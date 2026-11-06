// Simulated ABRA Flexi server for automated tests (no network, no licence).
// It implements only what the DAJC connector uses - PUT of one record per
// evidence with ext: identifiers - and the failure modes the outbox must
// survive: outage (5xx), throttling (429), timeouts, wrong credentials and
// validation errors. It is NOT evidence that a real ABRA Flexi company
// accepts the payloads; that needs the ABRA test company (see docs).

export interface FakeAbra {
  fetchFn: typeof fetch;
  records: Map<string, Map<string, Record<string, unknown>>>;
  requests: number;
  /** Next N requests fail with this status (or 'timeout'). */
  failNext(count: number, status: number | 'timeout'): void;
  /** Reject records of an evidence with a validation error. */
  rejectEvidence: Set<string>;
}

export function createFakeAbra(options: { company: string; username: string; password: string }): FakeAbra {
  const records = new Map<string, Map<string, Record<string, unknown>>>();
  let failures: Array<number | 'timeout'> = [];
  let nextInternalId = 1;
  const fake: FakeAbra = {
    records,
    requests: 0,
    rejectEvidence: new Set(),
    failNext(count, status) {
      failures = Array.from({ length: count }, () => status);
    },
    fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      fake.requests += 1;
      const failure = failures.shift();
      if (failure === 'timeout') {
        const error = new Error('The operation was aborted due to timeout');
        error.name = 'TimeoutError';
        throw error;
      }
      if (typeof failure === 'number') return new Response('{}', { status: failure });
      const url = new URL(String(input));
      const match = url.pathname.match(/^\/c\/([^/]+)\/([a-z0-9-]+)\.json$/);
      const expected = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`;
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') !== expected) return new Response('{}', { status: 401 });
      if (!match || decodeURIComponent(match[1]) !== options.company || init?.method !== 'PUT') return new Response('{}', { status: 404 });
      const evidence = match[2];
      const body = JSON.parse(String(init?.body ?? '{}'));
      const record = body?.winstrom?.[evidence]?.[0];
      const fail = (message: string, field: string) => new Response(JSON.stringify({ winstrom: { '@version': '1.0', success: 'false', results: [{ errors: [{ message, for: field }] }] } }), { status: 400 });
      if (!record || typeof record.id !== 'string' || !record.id.startsWith('ext:DAJC:')) return fail('Missing external identifier', 'id');
      if (fake.rejectEvidence.has(evidence)) return fail('Validation failed', 'typDokl');
      const pairing = record.sparovani?.uhrazovanaFak?.['#'];
      if (pairing && !records.get('faktura-vydana')?.has(pairing)) return fail('Invoice to pair does not exist', 'sparovani');
      const table = records.get(evidence) ?? new Map();
      records.set(evidence, table);
      const existing = table.get(record.id) as { internalId?: number } | undefined;
      const internalId = existing?.internalId ?? nextInternalId++;
      table.set(record.id, { ...record, internalId });
      return new Response(JSON.stringify({
        winstrom: { '@version': '1.0', success: 'true', stats: { created: existing ? '0' : '1', updated: existing ? '1' : '0' }, results: [{ id: String(internalId), 'request-id': record.id, ref: `/c/${options.company}/${evidence}/${internalId}.json` }] },
      }), { status: 201 });
    }) as typeof fetch,
  };
  return fake;
}
