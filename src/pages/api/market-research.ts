import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { allowRegistrationAttempt } from '../../lib/testing-registration/throttle';

export const prerender = false;

const DESTINATION = 'team@dajc.eu';
const ALLOWED_ORIGINS = new Set(['https://www.dajc.eu', 'https://dajc.eu']);
const ROLES = new Set(['owner', 'dispatcher', 'driver', 'customer', 'other']);
const INTEREST = new Set(['yes', 'maybe', 'no']);
const FEATURES = {
  platform: new Set(['coordination', 'permits', 'documents', 'integrations', 'none']),
  tar: new Set(['dispatch', 'case', 'partners', 'billing', 'none']),
} as const;

const jsonHeaders = new Headers({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});

function respond(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function clean(value: unknown, max: number) {
  return typeof value === 'string'
    ? value.replace(/\0/g, '').trim().slice(0, max)
    : '';
}

function cleanOneLine(value: unknown, max: number) {
  return clean(value, max).replace(/[\r\n\t]+/g, ' ');
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const origin = request.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return respond(403, { ok: false, error: 'Origin not allowed.' });
  }
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return respond(415, { ok: false, error: 'Expected JSON.' });
  }
  if (!allowRegistrationAttempt(clientAddress || 'unknown')) {
    return respond(429, { ok: false, error: 'Too many submissions. Please try again later.' });
  }

  try {
    const raw = await request.text();
    if (raw.length > 12000) return respond(413, { ok: false, error: 'Submission too large.' });
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return respond(400, { ok: false, error: 'Invalid submission.' });
    }

    // Honeypot: silently acknowledge and discard scripted submissions.
    if (clean(payload.website, 150)) return respond(200, { ok: true });

    const product = payload.product;
    if (product !== 'platform' && product !== 'tar') {
      return respond(400, { ok: false, error: 'Invalid product.' });
    }
    const company = cleanOneLine(payload.company, 160);
    const country = cleanOneLine(payload.country, 100);
    const role = cleanOneLine(payload.role, 30);
    const currentSoftware = clean(payload.currentSoftware, 300);
    const biggestProblem = clean(payload.biggestProblem, 1500);
    const mostUseful = cleanOneLine(payload.mostUseful, 40);
    const usageInterest = cleanOneLine(payload.usageInterest, 20);
    const suggestion = clean(payload.suggestion, 1200);
    const email = cleanOneLine(payload.email, 254).toLowerCase();
    const followUp = payload.followUp === 'on';
    const privacyAcknowledged = payload.privacyAcknowledged === 'on';

    if (!company || !country || !currentSoftware || !biggestProblem
      || !ROLES.has(role) || !FEATURES[product].has(mostUseful)
      || !INTEREST.has(usageInterest) || !privacyAcknowledged
      || (email !== '' && !validEmail(email))
      || (followUp && !email)) {
      return respond(400, { ok: false, error: 'Please complete the required fields and check the contact information.' });
    }

    const key = process.env.RESEND_API_KEY;
    if (!key) {
      return respond(503, { ok: false, error: 'Research form is temporarily unavailable. Please try again later.' });
    }

    const from = process.env.DAJC_TESTING_EMAIL_FROM
      || process.env.DAJC_PARTNER_EMAIL_FROM
      || 'DAJC Research <team@dajc.eu>';
    const body = [
      'DAJC MARKET VALIDATION — RESEARCH RESPONSE',
      '',
      'Product: ' + product.toUpperCase(),
      'Company: ' + company,
      'Country: ' + country,
      'Role: ' + role,
      'Current software/tools: ' + currentSoftware,
      'Biggest problem: ' + biggestProblem,
      'Most useful planned capability: ' + mostUseful,
      'Would consider using DAJC: ' + usageInterest,
      'Suggestions: ' + (suggestion || 'Not provided'),
      'Contact email: ' + (email || 'Not provided'),
      'Follow-up permission: ' + (followUp ? 'Yes' : 'No'),
      'Privacy information acknowledged: Yes',
      'Received (UTC): ' + new Date().toISOString(),
      '',
      'Research response only — not a customer, contract, or purchase commitment.',
    ].join('\n');

    const resend = new Resend(key);
    const delivery = await resend.emails.send({
      from,
      to: [DESTINATION],
      ...(email && followUp ? { replyTo: email } : {}),
      subject: '[DAJC Research] ' + product.toUpperCase() + ' — ' + company,
      text: body,
    });

    if (delivery.error) {
      console.error('DAJC market research delivery failed', delivery.error);
      return respond(502, { ok: false, error: 'Unable to deliver your response. Please try again later.' });
    }
    return respond(200, { ok: true });
  } catch (error) {
    console.error('DAJC market research submission failed', error);
    return respond(400, { ok: false, error: 'Unable to process your response.' });
  }
};
