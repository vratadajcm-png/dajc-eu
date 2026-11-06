// ABRA Flexi REST client for DAJC billing synchronisation.
//
// ABRA Flexi is the authority for accounting documents (double-entry
// bookkeeping); DAJC only records business events and sends each one once.
// Idempotency: every record carries an external identifier
// "ext:DAJC:<key>", so a retried PUT updates the same record instead of
// creating a second document.
//
// Endpoint: PUT {baseUrl}/c/{company}/{evidence}.json with
// {"winstrom": {"@version": "1.0", "<evidence>": [ ... ]}} and HTTP Basic
// authentication of a dedicated API user. The request shape follows the
// public ABRA Flexi REST documentation; it is verified here only against
// the simulated server (fake-abra.ts) and must be validated against an ABRA
// Flexi test company before any production use.

export type FetchFn = typeof fetch;

export interface AbraSettings {
  baseUrl: string;
  company: string;
  username: string;
  password: string;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

/** Temporary: network, timeout, 429, 5xx. The outbox retries with backoff. */
export class AbraUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbraUnavailable';
  }
}

/** Permanent for this payload: validation or a missing record. Needs a human. */
export class AbraRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbraRejected';
  }
}

/** Credentials or permissions: retried slowly so it heals once fixed. */
export class AbraConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbraConfigError';
  }
}

export const EXT_PREFIX = 'ext:DAJC:';

export function extId(key: string): string {
  return `${EXT_PREFIX}${key.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 180)}`;
}

export interface AbraWriteResult {
  id: string;
  ref: string | null;
}

export interface AbraClient {
  upsert(evidence: string, record: Record<string, unknown>): Promise<AbraWriteResult>;
}

const EVIDENCE = /^[a-z][a-z0-9-]{1,60}$/;

export function createAbraClient(settings: AbraSettings): AbraClient {
  const fetchFn = settings.fetchFn ?? fetch;
  const base = settings.baseUrl.replace(/\/+$/, '');
  const auth = `Basic ${Buffer.from(`${settings.username}:${settings.password}`, 'utf8').toString('base64')}`;
  return {
    async upsert(evidence, record) {
      if (!EVIDENCE.test(evidence)) throw new AbraRejected(`invalid evidence ${evidence}`);
      const url = `${base}/c/${encodeURIComponent(settings.company)}/${evidence}.json`;
      let response: Response;
      try {
        response = await fetchFn(url, {
          method: 'PUT',
          headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ winstrom: { '@version': '1.0', [evidence]: [record] } }),
          signal: AbortSignal.timeout(settings.timeoutMs ?? 20_000),
        });
      } catch (error) {
        throw new AbraUnavailable((error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network error');
      }
      if (response.status === 401 || response.status === 403) throw new AbraConfigError(`HTTP ${response.status}`);
      if (response.status === 429 || response.status >= 500) throw new AbraUnavailable(`HTTP ${response.status}`);
      let body: any;
      try {
        body = await response.json();
      } catch {
        throw new AbraUnavailable('invalid JSON response');
      }
      const winstrom = body?.winstrom;
      const success = winstrom?.success === true || winstrom?.success === 'true';
      const result = Array.isArray(winstrom?.results) ? winstrom.results[0] : null;
      if (!response.ok || !success || !result?.id) {
        // Only field names and messages, never the submitted values.
        const errors = (Array.isArray(result?.errors) ? result.errors : []).map((e: any) => `${e?.for ?? ''}: ${e?.message ?? ''}`.slice(0, 160));
        throw new AbraRejected(`HTTP ${response.status}${errors.length ? ` ${errors.join('; ')}` : ''}`);
      }
      return { id: String(result.id), ref: typeof result.ref === 'string' ? result.ref : null };
    },
  };
}
