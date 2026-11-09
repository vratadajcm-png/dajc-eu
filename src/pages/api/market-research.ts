import type { APIRoute } from 'astro';
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { Resend } from 'resend';
import { allowRegistrationAttempt } from '../../lib/testing-registration/throttle';

export const prerender = false;
const ALLOWED_ORIGINS = new Set(['https://www.dajc.eu', 'https://dajc.eu']);
const ROLES = new Set(['owner','dispatcher','driver','customer','other']);
const INTEREST = new Set(['yes','maybe','no']);
const FEATURES = {
  platform: new Set(['coordination','permits','documents','integrations','none']),
  tar: new Set(['dispatch','case','partners','billing','none']),
} as const;
const JSON_HEADERS = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' };
const reply = (status:number, value:Record<string,unknown>) =>
  new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });

const clean = (value:unknown, limit:number) =>
  typeof value === 'string' ? value.replace(/\0/g,'').trim().slice(0,limit) : '';
const single = (value:unknown, limit:number) => clean(value,limit).replace(/[\r\n\t]+/g,' ');
const isEmail = (email:string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

function originAllowed(origin:string|null, requestUrl:string):boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  const url = new URL(requestUrl);
  return process.env.VERCEL_ENV === 'preview'
    && url.hostname.endsWith('.vercel.app')
    && origin === url.origin;
}

let db:ReturnType<typeof postgres>|undefined;
function connection() {
  const url = process.env.DAJC_RESEARCH_DATABASE_URL;
  if (!url) throw new Error('Database not configured');
  return db ??= postgres(url, { max:2, connect_timeout:10, idle_timeout:10 });
}
class RateLimitError extends Error {}

export const POST:APIRoute = async ({ request, clientAddress }) => {
  if (!originAllowed(request.headers.get('origin'), request.url)) {
    return reply(403,{ok:false,error:'Origin not allowed.'});
  }
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return reply(415,{ok:false,error:'Expected JSON.'});
  }
  if (!allowRegistrationAttempt(clientAddress || 'unknown')) {
    return reply(429,{ok:false,error:'Too many submissions. Please try again later.'});
  }
  let data:Record<string,unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return reply(413,{ok:false,error:'Submission too large.'});
    const parsed:unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return reply(400,{ok:false,error:'Invalid submission.'});
    }
    data = parsed as Record<string,unknown>;
  } catch { return reply(400,{ok:false,error:'Invalid submission.'}); }

  // Honeypot: silently discard non-human submissions.
  if (clean(data.website,150)) return reply(200,{ok:true});
  const product = data.product;
  if (product !== 'platform' && product !== 'tar') {
    return reply(400,{ok:false,error:'Invalid product.'});
  }
  const company = single(data.company,160);
  const country = single(data.country,100);
  const role = single(data.role,30);
  const currentSoftware = clean(data.currentSoftware,300);
  const biggestProblem = clean(data.biggestProblem,1500);
  const mostUseful = single(data.mostUseful,40);
  const usageInterest = single(data.usageInterest,20);
  const suggestion = clean(data.suggestion,1200);
  const email = single(data.email,254).toLowerCase();
  const followUp = data.followUp === 'on';
  const acknowledged = data.privacyAcknowledged === 'on';
  const id = single(data.submissionId,36);

  if (!company || !country || !currentSoftware || !biggestProblem ||
      !ROLES.has(role) || !FEATURES[product].has(mostUseful) ||
      !INTEREST.has(usageInterest) || !acknowledged ||
      (email !== '' && !isEmail(email)) || (followUp && !email) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return reply(400,{ok:false,error:'Please complete all required fields and check your contact details.'});
  }

  const hashKey = process.env.DAJC_RESEARCH_HASH_KEY;
  if (!hashKey) return reply(503,{ok:false,error:'Research service is temporarily unavailable.'});
  const hash = createHmac('sha256',hashKey).update(clientAddress || 'unknown').digest('hex');
  const bucket = new Date(Math.floor(Date.now()/900000)*900000).toISOString();

  let inserted = false;
  try {
    const sql = connection();
    inserted = await sql.begin(async tx => {
      const attempts = await tx`
        INSERT INTO public.market_research_rate_limits (visitor_hash, window_start, attempts)
        VALUES (${hash}, ${bucket}::timestamptz, 1)
        ON CONFLICT (visitor_hash, window_start) DO UPDATE
        SET attempts = market_research_rate_limits.attempts + 1
        WHERE market_research_rate_limits.attempts < 5
        RETURNING attempts`;
      if (!attempts.length) throw new RateLimitError();
      const row = await tx`
        INSERT INTO public.market_research_submissions
        (id,product,company,country,role,current_software,biggest_problem,most_useful,
         usage_interest,suggestion,contact_email,follow_up_allowed)
        VALUES (${id}::uuid,${product},${company},${country},${role},${currentSoftware},
          ${biggestProblem},${mostUseful},${usageInterest},${suggestion},
          ${followUp ? email : null},${followUp})
        ON CONFLICT (id) DO NOTHING
        RETURNING id`;
      return row.length > 0;
    });

    // Automatic data hygiene. Notifications never determine write success.
    await Promise.allSettled([
      sql`DELETE FROM public.market_research_rate_limits
          WHERE window_start < now() - interval '48 hours'`,
      sql`DELETE FROM public.market_research_submissions
          WHERE created_at < now() - interval '12 months'`,
    ]);
  } catch(error) {
    if (error instanceof RateLimitError) {
      return reply(429,{ok:false,error:'Too many submissions. Please try again later.'});
    }
    console.error('DAJC research database write failed');
    return reply(503,{ok:false,error:'Your answer could not be saved. Please try again.'});
  }

  // Email is optional best-effort, not the primary research store.
  const key = process.env.RESEND_API_KEY;
  if (inserted && key) {
    try {
      const message = [
        'DAJC RESEARCH RESPONSE',
        'Product: '+product.toUpperCase(),
        'Company: '+company,
        'Country: '+country,
        'Role: '+role,
        'Current software: '+currentSoftware,
        'Biggest problem: '+biggestProblem,
        'Most useful function: '+mostUseful,
        'Interest: '+usageInterest,
        'Suggestions: '+(suggestion||'None'),
        'Contact permitted: '+(followUp?'Yes':'No'),
        'Contact email: '+(followUp?email:'Not provided'),
        'Saved to dedicated DAJC research database.'
      ].join('\n');
      const result = await new Resend(key).emails.send({
        from: process.env.DAJC_TESTING_EMAIL_FROM ||
          process.env.DAJC_PARTNER_EMAIL_FROM || 'DAJC Research <team@dajc.eu>',
        to: ['team@dajc.eu'],
        ...(followUp ? {replyTo:email} : {}),
        subject: '[DAJC Research] '+product.toUpperCase()+' — '+company,
        text:message
      });
      if (result.error) console.error('DAJC research notification not delivered');
    } catch {
      console.error('DAJC research notification not delivered');
    }
  }
  return reply(200,{ok:true,saved:true});
};
