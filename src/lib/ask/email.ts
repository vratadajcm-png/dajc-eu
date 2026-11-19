// E-mail for "Ask DAJC AI" sign-in links. Two independent safety layers,
// as for the Partner Portal (src/portal/lib/email.ts): the feature must be
// configured (getAskConfig) AND DAJC_ASK_EMAIL_MODE must be exactly "live"
// with RESEND_API_KEY set. Anything else uses a sender that never touches
// the network and never logs the link or the full address.

import { Resend } from 'resend';
import type { AskConfig } from './config';

export interface AskMailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

function maskAddress(address: string): string {
  const [local, domain] = address.split('@');
  return `${local.slice(0, 1)}***@${domain || '?'}`;
}

export function createMailer(config: Pick<AskConfig, 'emailLive' | 'resendKey' | 'emailFrom'>): AskMailer {
  if (config.emailLive && config.resendKey) {
    const client = new Resend(config.resendKey);
    return {
      async send({ to, subject, text }) {
        const result = await client.emails.send({ from: config.emailFrom, to, subject, text });
        if (result.error) throw new Error(`Resend send failed: ${result.error.name}`);
      },
    };
  }
  return {
    async send({ to, subject }) {
      console.log(`[ask email:dev-noop] would send "${subject}" to ${maskAddress(to)}`);
    },
  };
}
