import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../../../portal/lib/tokens';
import { MemoryAskStore } from '../store/memory';
import { fixtureView } from './helpers';
import { applyVerifiedPaymentEvent } from '../paid/subscription';
import { answerPaidDrivingBans, type PaidBansDeps } from '../paid/driving-bans';

const NOW = new Date('2026-11-01T14:00:00.000Z');
const SESSION = 'test-authenticated-session-token-1234567890';
const ON = { DAJC_AI_PAID_ENABLED: 'true', DAJC_AI_DRIVING_BANS_ENABLED: 'true' };
const INPUT = {
  jurisdictions: ['CZ'],
  from: '2026-11-01T12:00:00.000Z',
  to: '2026-11-01T17:00:00.000Z',
};

async function scenario() {
  const store = new MemoryAskStore();
  const userId = await store.upsertUser('hmac_test_only', NOW);
  await store.createSession({
    tokenHash: hashToken(SESSION), userId,
    expiresAt: new Date('2026-11-08T12:00:00.000Z'),
  });
  const ledger = applyVerifiedPaymentEvent(null, {
    kind: 'PAYMENT_SETTLED', eventId: 'evt_paid_bans_001',
    provider: 'STRIPE', userId, customerRef: 'customer_paid_bans',
    occurredAt: '2026-11-01T12:00:00.000Z', paymentRef: 'pay_paid_bans_001',
    amountCents: 1500, currency: 'EUR',
    periodStart: '2026-11-01T00:00:00.000Z',
    periodEnd: '2026-12-01T00:00:00.000Z',
  });
  const deps: PaidBansDeps = {
    store, findSubscription: async () => ledger,
    sessionToken: SESSION, tool: 'search_bans', input: INPUT,
    now: NOW, env: ON, released: true, view: fixtureView(),
  };
  return { store, userId, ledger, deps };
}

describe('DAJC AI paid Driving Bans adapter — strictly internal, no live route', () => {
  it('stays closed without a reviewed release, even when flags are on', async () => {
    const { deps } = await scenario();
    const resolver = vi.fn(async () => { throw new Error('must not reach database'); });
    expect(await answerPaidDrivingBans({ ...deps, released: false, findSubscription: resolver }))
      .toEqual({ status: 'DISABLED', answer: null });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated and non-paying requests before tool execution', async () => {
    const { deps } = await scenario();
    const spy = vi.fn(deps.findSubscription);
    expect(await answerPaidDrivingBans({ ...deps, sessionToken: undefined, findSubscription: spy }))
      .toEqual({ status: 'UNAUTHENTICATED', answer: null });
    expect(spy).not.toHaveBeenCalled();
    expect(await answerPaidDrivingBans({ ...deps, findSubscription: async () => null }))
      .toEqual({ status: 'NOT_PAID', answer: null });
    expect(await answerPaidDrivingBans({ ...deps, tool: 'issue_permit' }))
      .toEqual({ status: 'INVALID_TOOL', answer: null });
  });

  it('keeps personal subscription identity server-side (cross-account ledger fails)', async () => {
    const { deps, ledger } = await scenario();
    const wrong = { ...ledger, userId: 'other-user-1234' };
    expect(await answerPaidDrivingBans({ ...deps, findSubscription: async () => wrong }))
      .toEqual({ status: 'NOT_PAID', answer: null });
  });

  it('uses existing verified Driving Bans contract for a paid subscriber', async () => {
    const { deps } = await scenario();
    const result = await answerPaidDrivingBans(deps);
    expect(result.status).toBe('ANSWER');
    if (result.status === 'ANSWER') {
      expect(result.answer.tool).toBe('search_bans');
      expect(result.answer.status).not.toBe('NOT_ENTITLED');
      expect(result.answer.disclaimer).toMatch(/permit|exception|authoris/i);
    }
  });

  it('denies if the specific paid Driving Bans feature flag is off', async () => {
    const { deps } = await scenario();
    expect(await answerPaidDrivingBans({ ...deps, env: { DAJC_AI_PAID_ENABLED: 'true' } }))
      .toEqual({ status: 'DISABLED', answer: null });
  });
});
