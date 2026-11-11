import { describe, expect, it } from 'vitest';
import {
  FOUNDING_PLANS, getFoundingPlan, validateFoundingCustomer, makeMockReservation,
  simulateRefund, outstandingMockCredit, isMockReservation,
} from './founding-preview';

const customer = {
  company: 'Demo Transport s.r.o.',
  contact: 'Test Customer',
  email: 'test@example.invalid',
  country: 'Czech Republic',
  companyId: 'DEMO-123',
  activity: 'Oversized transport',
};

describe('internal founding customers preview', () => {
  it('keeps Platform and TAR as independent B2B offers', () => {
    expect(FOUNDING_PLANS.map(x => [x.id, x.amountEUR])).toEqual([
      ['platform', 199], ['tar', 299], ['both', 399],
    ]);
    expect(getFoundingPlan('invalid')).toBeUndefined();
  });
  it('validates input before creating a simulation', () => {
    expect(validateFoundingCustomer(customer)).toEqual([]);
    expect(validateFoundingCustomer({ ...customer, email: 'bad' }).length).toBeGreaterThan(0);
    expect(() => makeMockReservation(FOUNDING_PLANS[0], { ...customer, company: '' }, 'abcdef1234', '2026-11-08T10:00:00.000Z')).toThrow();
  });
  it('creates DEMO-only reservation after simulated successful payment', () => {
    const order = makeMockReservation(FOUNDING_PLANS[2], customer, 'abcde12345', '2026-11-08T10:00:00.000Z');
    expect(order.id).toBe('DEMO-20261108-ABCDE12345');
    expect(order.paymentStatus).toBe('simulated_paid');
    expect(outstandingMockCredit(order)).toBe(399);
    expect(isMockReservation(order)).toBe(true);
  });
  it('handles refund exactly once and clears the test credit', () => {
    const order = makeMockReservation(FOUNDING_PLANS[1], customer, 'abcdef1234', '2026-11-08T10:00:00.000Z');
    const refunded = simulateRefund(order, '2026-11-09T10:00:00.000Z');
    expect(refunded.paymentStatus).toBe('simulated_refunded');
    expect(outstandingMockCredit(refunded)).toBe(0);
    expect(simulateRefund(refunded, '2026-11-10T10:00:00.000Z')).toBe(refunded);
  });
  it('rejects malformed demo persistence data', () => {
    expect(isMockReservation(null)).toBe(false);
    expect(isMockReservation({marker:'REAL_PAID',product:'platform',amountEUR:199,id:'DEMO-1'})).toBe(false);
  });
});
