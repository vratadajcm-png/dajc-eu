// Request bodies are read in chunks and abandoned once they exceed the limit,
// whatever Content-Length claims or omits; text decodes like Request.text().

import { describe, expect, it } from 'vitest';
import { readBodyLimited, readJson } from '../handlers';

function streamed(parts: string[], headers: Record<string, string> = {}): Request {
  const encoder = new TextEncoder();
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < parts.length) controller.enqueue(encoder.encode(parts[pulled++]));
      else controller.close();
    },
  });
  // A streamed body has no Content-Length.
  return new Request('https://www.dajc.eu/api/x', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
}

describe('bounded body reading', () => {
  it('stops a streamed body without Content-Length as soon as it exceeds the limit', async () => {
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(new Uint8Array(1024));
        if (produced > 10_000) controller.close();
      },
    });
    const request = new Request('https://www.dajc.eu/api/x', { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(await readBodyLimited(request, 4096)).toBeNull();
    expect(produced).toBeLessThan(20);
  });

  it('counts bytes, not characters, and refuses a too-large declared length up front', async () => {
    expect(await readBodyLimited(streamed(['žžžž']), 8)).toBe('žžžž');
    expect(await readBodyLimited(streamed(['žžžžž']), 8)).toBeNull();
    const declared = new Request('https://www.dajc.eu/api/x', { method: 'POST', body: 'x', headers: { 'content-length': '999999' } });
    expect(await readBodyLimited(declared, 1024)).toBeNull();
  });

  it('decodes exactly like Request.text(), including a byte-order mark and invalid bytes', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0xff]);
    const viaText = await new Request('https://www.dajc.eu/api/x', { method: 'POST', body: bytes }).text();
    expect(await readBodyLimited(new Request('https://www.dajc.eu/api/x', { method: 'POST', body: bytes }), 64)).toBe(viaText);
    expect(await readBodyLimited(new Request('https://www.dajc.eu/api/x', { method: 'POST' }), 64)).toBe('');
  });

  it('keeps readJson behaviour: JSON objects only, within the limit', async () => {
    const json = (body: string) => new Request('https://www.dajc.eu/api/x', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    expect(await readJson(json('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(json('[1]'))).toBeNull();
    expect(await readJson(json(`{"a":"${'x'.repeat(9000)}"}`))).toBeNull();
    expect(await readJson(streamed(['{"a":', '1}'], { 'content-type': 'application/json' }))).toEqual({ a: 1 });
    expect(await readJson(new Request('https://www.dajc.eu/api/x', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }))).toBeNull();
  });
});
