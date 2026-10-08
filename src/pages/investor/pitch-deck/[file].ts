import type { APIRoute } from 'astro';
import { ACCESS_COOKIE, hasAccessSession, PRIVATE_HEADERS } from '../../../investor/access';
import { DOCUMENTS, documentStream, readInvestorDocument } from '../../../investor/documents';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, params, request }) => {
  const name = params.file;
  if (!name || !Object.hasOwn(DOCUMENTS, name)) {
    return new Response('Not found', { status: 404, headers: PRIVATE_HEADERS });
  }
  if (!hasAccessSession(cookies.get(ACCESS_COOKIE)?.value)) {
    return new Response('An access code is required. Open /investor/pitch-deck to sign in.', {
      status: 401, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const document = DOCUMENTS[name as keyof typeof DOCUMENTS];
  try {
    const bytes = await readInvestorDocument(name as keyof typeof DOCUMENTS);
    const headers = {
      ...PRIVATE_HEADERS,
      'Content-Type': document.mime,
      'Content-Disposition': `attachment; filename="${document.filename}"`,
      'Content-Length': String(bytes.length),
    };
    return new Response(request.method === 'HEAD' ? null : documentStream(bytes), { headers });
  } catch {
    return new Response('The document is temporarily unavailable. Please contact team@dajc.eu.', {
      status: 503, headers: PRIVATE_HEADERS,
    });
  }
};

export const HEAD = GET;
