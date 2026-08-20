// Email sending for the Partner Portal. Reuses no prior email infra
// because this repo has none (the only existing external API call,
// scripts/lib/openai-client.mjs, is for AI content generation, not email)
// - see docs/PARTNER_PORTAL.md "Email" for the audit finding.
//
// Two independent safety layers before any real email leaves the process:
//  1. isPartnerPortalEnabled() - the same central gate as every route.
//  2. DAJC_PARTNER_EMAIL_MODE must be exactly "live" - anything else
//     (unset, "dev", a typo) uses a sender that never touches the network,
//     so local/dev/test/preview runs cannot ever reach a real partner's
//     inbox even if RESEND_API_KEY happens to be set in that environment.
// Both must hold. Neither one alone is enough.
import { Resend } from 'resend';
import { isPartnerPortalEnabled } from '../config/gate';
import { recordAuditEvent } from './audit';

const DEFAULT_FROM = 'DAJC <team@dajc.eu>';

export interface SendInvitationEmailParams {
  to: string;
  partnerLegalName: string;
  activationUrl: string;
  expiresAt: Date;
  partnerId: string;
  correlationId?: string;
}

export interface SendMagicLinkEmailParams {
  to: string;
  loginUrl: string;
  expiresAt: Date;
  correlationId?: string;
}

interface EmailSender {
  send(params: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

// Never performs a network call. Used for every environment except an
// explicit, fully-configured production live mode.
class DevNoopEmailSender implements EmailSender {
  async send(params: { to: string; subject: string; html: string }): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[partner-portal email:dev-noop] would send "${params.subject}" to ${params.to}`);
  }
}

class ResendEmailSender implements EmailSender {
  private client: Resend;
  private from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async send(params: { to: string; subject: string; html: string; text: string }): Promise<void> {
    const result = await this.client.emails.send({
      from: this.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    if (result.error) {
      throw new Error(`Resend send failed: ${result.error.message}`);
    }
  }
}

function resolveSender(): EmailSender {
  const liveMode = process.env.DAJC_PARTNER_EMAIL_MODE === 'live';
  const apiKey = process.env.RESEND_API_KEY;
  if (liveMode && apiKey) {
    return new ResendEmailSender(apiKey, process.env.DAJC_PARTNER_EMAIL_FROM ?? DEFAULT_FROM);
  }
  return new DevNoopEmailSender();
}

function formatExpiry(expiresAt: Date): string {
  return expiresAt.toISOString();
}

export async function sendInvitationEmail(params: SendInvitationEmailParams): Promise<void> {
  if (!isPartnerPortalEnabled()) {
    throw new Error('Partner Portal is disabled - invitation emails cannot be sent.');
  }

  const subject = `DAJC Partner Portal - activate access for ${params.partnerLegalName}`;
  const text =
    `You have been invited to activate DAJC Partner Portal access for ${params.partnerLegalName}.\n\n` +
    `Activation link (expires ${formatExpiry(params.expiresAt)}):\n${params.activationUrl}\n\n` +
    `This link is single-use and tied to this email address. If you did not expect this invitation, ignore this message.`;
  const html =
    `<p>You have been invited to activate DAJC Partner Portal access for <strong>${escapeHtml(params.partnerLegalName)}</strong>.</p>` +
    `<p><a href="${escapeHtml(params.activationUrl)}">Activate your access</a> (expires ${formatExpiry(params.expiresAt)}).</p>` +
    `<p>This link is single-use and tied to this email address. If you did not expect this invitation, ignore this message.</p>`;

  await resolveSender().send({ to: params.to, subject, html, text });

  await recordAuditEvent({
    actor: 'system',
    actorType: 'SYSTEM',
    action: 'invitation.sent',
    targetType: 'invitation',
    partnerId: params.partnerId,
    correlationId: params.correlationId,
    metadata: { to: params.to },
  });
}

export async function sendMagicLinkEmail(params: SendMagicLinkEmailParams): Promise<void> {
  if (!isPartnerPortalEnabled()) {
    throw new Error('Partner Portal is disabled - login emails cannot be sent.');
  }

  const subject = 'DAJC Partner Portal - sign-in link';
  const text =
    `Sign-in link (expires ${formatExpiry(params.expiresAt)}):\n${params.loginUrl}\n\n` +
    `This link is single-use. If you did not request this, ignore this message.`;
  const html =
    `<p><a href="${escapeHtml(params.loginUrl)}">Sign in to DAJC Partner Portal</a> (expires ${formatExpiry(params.expiresAt)}).</p>` +
    `<p>This link is single-use. If you did not request this, ignore this message.</p>`;

  await resolveSender().send({ to: params.to, subject, html, text });

  await recordAuditEvent({
    actor: 'system',
    actorType: 'SYSTEM',
    action: 'login.magic_link_requested',
    metadata: { to: params.to },
    correlationId: params.correlationId,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
