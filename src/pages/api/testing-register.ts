import type { APIRoute } from 'astro';
import { Resend } from 'resend';

export const prerender = false;

const DESTINATION = 'platform@dajc.eu';
const ALLOWED_ORIGINS = new Set([
  'https://www.dajc.eu',
  'https://dajc.eu',
  'https://www.dajc.cz',
  'https://dajc.cz',
]);

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }

  return headers;
}

function clean(value: unknown, max = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function asBoolean(value: unknown) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

async function readPayload(request: Request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return await request.json();
  }

  const form = await request.formData();
  const payload: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key === 'role') {
      const current = payload.role;
      payload.role = Array.isArray(current) ? [...current, String(value)] : current ? [String(current), String(value)] : [String(value)];
    } else {
      payload[key] = String(value);
    }
  }
  return payload;
}

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

export const GET: APIRoute = async ({ request }) => {
  const ready = Boolean(process.env.RESEND_API_KEY);
  return new Response(
    JSON.stringify({ ready, destination: DESTINATION }),
    { status: 200, headers: corsHeaders(request.headers.get('origin')) }
  );
};

export const POST: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ ok: false, error: 'Origin not allowed.' }), { status: 403, headers });
  }

  try {
    const payload = await readPayload(request);

    // Honeypot: bots often fill this invisible field. Return success so they do not retry.
    if (clean(payload.website, 200)) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    const fullName = clean(payload.fullName, 120);
    const company = clean(payload.company, 160);
    const businessEmail = clean(payload.businessEmail, 254).toLowerCase();
    const country = clean(payload.country, 120);
    const operationType = clean(payload.operationType, 180);
    const fleetSize = clean(payload.fleetSize, 80);
    const biggestProblem = clean(payload.biggestProblem, 2500);
    const source = clean(payload.source, 300) || 'dajc.eu/testing';
    const consent = asBoolean(payload.consent);

    const rawRoles = Array.isArray(payload.role) ? payload.role : [payload.role];
    const roles = rawRoles.map((item) => clean(item, 100)).filter(Boolean).slice(0, 12);

    const missing = [
      !fullName && 'fullName',
      !company && 'company',
      !businessEmail && 'businessEmail',
      !country && 'country',
      roles.length === 0 && 'role',
      !consent && 'consent',
    ].filter(Boolean);

    if (missing.length > 0 || !validEmail(businessEmail)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Please complete the required fields and provide a valid business email.',
          fields: missing,
        }),
        { status: 400, headers }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Registration delivery is temporarily unavailable.',
          fallbackEmail: DESTINATION,
        }),
        { status: 503, headers }
      );
    }

    const from = process.env.DAJC_TESTING_EMAIL_FROM
      || process.env.DAJC_PARTNER_EMAIL_FROM
      || 'DAJC Platform <team@dajc.eu>';

    const submittedAt = new Date().toISOString();
    const body = [
      'New DAJC Platform Testing 2027 registration',
      '',
      `Name: ${fullName}`,
      `Company: ${company}`,
      `Business email: ${businessEmail}`,
      `Country: ${country}`,
      `Role(s): ${roles.join(', ')}`,
      `Operation type: ${operationType || 'Not provided'}`,
      `Fleet / organisation size: ${fleetSize || 'Not provided'}`,
      '',
      'Biggest workflow problem:',
      biggestProblem || 'Not provided',
      '',
      `Source: ${source}`,
      `Submitted: ${submittedAt}`,
      'Privacy notice acknowledged: yes',
      '',
      'Testing starts: 4 January 2027',
      'Programme model: registered relevant users test the same DAJC production product while it is under active development; no separate pilot or Early Access edition.',
    ].join('\n');

    const resend = new Resend(apiKey);
    const delivery = await resend.emails.send({
      from,
      to: [DESTINATION],
      replyTo: businessEmail,
      subject: `DAJC Testing 2027 registration — ${company}`,
      text: body,
    });

    if (delivery.error) {
      console.error('DAJC testing registration delivery failed', delivery.error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Registration delivery failed.',
          fallbackEmail: DESTINATION,
        }),
        { status: 502, headers }
      );
    }

    // Best-effort acknowledgement. The registration itself is already delivered above.
    try {
      await resend.emails.send({
        from,
        to: [businessEmail],
        replyTo: DESTINATION,
        subject: 'DAJC Platform Testing 2027 — registration received',
        text: [
          `Hello ${fullName},`,
          '',
          'Thank you for registering for DAJC Platform pre-production testing.',
          'Testing starts on Monday, 4 January 2027.',
          '',
          'Registered participants will test the same DAJC Platform production product while it is under active development. DAJC will not operate a separate pilot, Founding Pilot or Early Access product edition.',
          '',
          'We will use the contact details you provided to send information needed to participate in the testing programme.',
          '',
          'DAJC',
          'European Heavy & Oversized Transport Platform',
          'platform@dajc.eu',
        ].join('\n'),
      });
    } catch (error) {
      console.warn('DAJC testing acknowledgement failed', error);
    }

    return new Response(
      JSON.stringify({ ok: true, id: delivery.data?.id || null }),
      { status: 200, headers }
    );
  } catch (error) {
    console.error('DAJC testing registration error', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Unexpected registration error.',
        fallbackEmail: DESTINATION,
      }),
      { status: 500, headers }
    );
  }
};
