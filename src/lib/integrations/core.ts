import { createHmac, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { Resend } from 'resend';

export type IntegrationProduct = 'platform' | 'tar';
export const AREAS = ['tms-erp','routing-permits','telematics','documents','assistance','dispatch','other'] as const;
export const PRODUCT_VALUES = ['platform','tar'] as const;
export const VERIFY_HOURS = 24;
export const ACCESS_DAYS = 7;
export const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};
export const response = (status: number, value: Record<string,unknown>) =>
  new Response(JSON.stringify(value), { status, headers: RESPONSE_HEADERS });
export function validUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export const tidy = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\0\r\n\t]/g,' ').trim().slice(0,max) : '';
export const emailValid = (email: string) =>
  email.length >= 5 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const tokenValid = (v: string) => /^[a-f0-9]{64}$/i.test(v);
export function token(): string { return randomBytes(32).toString('hex'); }
export function hash(value: string): string {
  const key = process.env.DAJC_INTEGRATIONS_TOKEN_KEY;
  if (!key) throw new Error('Integration secret not configured');
  return createHmac('sha256', key).update(value).digest('hex');
}
export const hashIp = (ip: string) => hash('network:' + ip);
export const hashToken = (t: string) => hash('token:' + t);
export const configReady = () =>
  Boolean(process.env.DAJC_INTEGRATIONS_DATABASE_URL &&
          process.env.DAJC_INTEGRATIONS_TOKEN_KEY && process.env.RESEND_API_KEY);
export function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin === 'https://www.dajc.eu' || origin === 'https://dajc.eu') return true;
  const url = new URL(request.url);
  return process.env.VERCEL_ENV === 'preview' &&
    url.hostname.endsWith('.vercel.app') && origin === url.origin;
}
let client: ReturnType<typeof postgres> | undefined;
export function db() {
  const url = process.env.DAJC_INTEGRATIONS_DATABASE_URL;
  if (!url) throw new Error('Integration DB URL missing');
  return client ??= postgres(url,{ max:2, connect_timeout:10, idle_timeout:10 });
}
export function publicUrl(path: string, request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  // Keep preview links within the branch's protected preview deployment.
  const origin = process.env.VERCEL_ENV === 'preview' &&
    requestOrigin.endsWith('.vercel.app') ? requestOrigin : 'https://www.dajc.eu';
  return new URL(path, origin).toString();
}
export async function sendEmail(to:string,subject:string,body:string) {
  const key=process.env.RESEND_API_KEY;
  if (!key) throw new Error('Mail delivery unconfigured');
  const from=process.env.DAJC_INTEGRATIONS_EMAIL_FROM ||
    process.env.DAJC_TESTING_EMAIL_FROM ||
    'DAJC Technical Documentation <team@dajc.eu>';
  const result=await new Resend(key).emails.send({ from, to:[to], subject, text:body });
  if (result.error) throw new Error('Mail provider declined delivery');
}
export class RateLimitError extends Error {
  constructor(){ super('Too many requests'); }
}
export async function limit(tx: any, clientAddress: string) {
  const visitorHash=hashIp(clientAddress||'unknown');
  const window=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
  const rows=await tx`
    INSERT INTO integration_docs.rate_limits (visitor_hash, window_start, attempts)
    VALUES (${visitorHash},${window}::timestamptz,1)
    ON CONFLICT (visitor_hash,window_start)
    DO UPDATE SET attempts=integration_docs.rate_limits.attempts+1
    WHERE integration_docs.rate_limits.attempts<4
    RETURNING attempts`;
  if (!rows.length) throw new RateLimitError();
}
export async function cleanup() {
  const sql=db();
  await Promise.allSettled([
    sql`DELETE FROM integration_docs.rate_limits WHERE window_start<now()-interval '48 hours'`,
    sql`DELETE FROM integration_docs.requests WHERE created_at<now()-interval '12 months'`,
  ]);
}
