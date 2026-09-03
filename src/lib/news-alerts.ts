import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Resend } from 'resend';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FROM = 'DAJC News <team@dajc.eu>';

export function isNewsAlertsEnabled(): boolean {
  return process.env.DAJC_NEWS_ALERTS_ENABLED === 'true';
}

export function isNewsAlertsReady(): boolean {
  return (
    isNewsAlertsEnabled() &&
    process.env.DAJC_NEWS_ALERTS_EMAIL_MODE === 'live' &&
    Boolean(process.env.RESEND_API_KEY) &&
    Boolean(process.env.DAJC_NEWS_ALERTS_SEGMENT_ID) &&
    Boolean(process.env.DAJC_NEWS_ALERTS_SIGNING_SECRET)
  );
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function encryptionKey(): Buffer {
  const secret = process.env.DAJC_NEWS_ALERTS_SIGNING_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error('DAJC_NEWS_ALERTS_SIGNING_SECRET is missing or too short.');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function createConfirmationToken(email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: now + TOKEN_TTL_MS }), 'utf8');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function readConfirmationToken(token: string, now = Date.now()): string | null {
  try {
    const packed = Buffer.from(token, 'base64url');
    if (packed.length <= 28) return null;

    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const data = JSON.parse(plaintext) as { email?: unknown; exp?: unknown };

    if (typeof data.email !== 'string' || typeof data.exp !== 'number' || data.exp < now) return null;
    return normalizeEmail(data.email);
  } catch {
    return null;
  }
}

export async function sendNewsAlertConfirmation(email: string, confirmationUrl: string): Promise<void> {
  if (!isNewsAlertsEnabled()) throw new Error('DAJC News Alerts are disabled.');

  const live = process.env.DAJC_NEWS_ALERTS_EMAIL_MODE === 'live';
  const apiKey = process.env.RESEND_API_KEY;

  if (!live || !apiKey) {
    console.log(`[news-alerts email:dev-noop] confirmation for ${email}: ${confirmationUrl}`);
    return;
  }

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: process.env.DAJC_NEWS_ALERTS_FROM || DEFAULT_FROM,
    to: email,
    subject: 'Confirm your DAJC News Alerts',
    text:
      `Confirm your DAJC News Alerts subscription:\n\n${confirmationUrl}\n\n` +
      'This link expires in 24 hours. If you did not request DAJC News Alerts, ignore this email.',
    html:
      '<p>Confirm your subscription to <strong>DAJC News Alerts</strong>.</p>' +
      `<p><a href="${confirmationUrl}">Confirm DAJC News Alerts</a></p>` +
      '<p>This link expires in 24 hours. If you did not request DAJC News Alerts, ignore this email.</p>',
  });

  if (result.error) throw new Error(`Resend confirmation failed: ${result.error.message}`);
}

export async function addNewsAlertContact(email: string): Promise<void> {
  if (!isNewsAlertsEnabled()) throw new Error('DAJC News Alerts are disabled.');

  const apiKey = process.env.RESEND_API_KEY;
  const segmentId = process.env.DAJC_NEWS_ALERTS_SEGMENT_ID;
  if (!apiKey || !segmentId) throw new Error('News Alerts contact configuration is incomplete.');

  const resend = new Resend(apiKey);
  const existing = await resend.contacts.get({ email });

  if (existing.data?.id) {
    const added = await resend.contacts.segments.add({ email, segmentId });
    if (added.error) {
      const message = added.error.message.toLowerCase();
      if (!message.includes('already')) throw new Error(`Resend segment add failed: ${added.error.message}`);
    }
    return;
  }

  const created = await resend.contacts.create({
    email,
    unsubscribed: false,
    segments: [{ id: segmentId }],
  });

  if (created.error) {
    throw new Error(`Resend contact create failed: ${created.error.message}`);
  }
}
