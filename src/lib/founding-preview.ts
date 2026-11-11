export type FoundingPlanId = 'platform' | 'tar' | 'both';
export type MockPaymentStatus = 'simulated_paid' | 'simulated_refunded';

export interface FoundingCustomer {
  company: string;
  contact: string;
  email: string;
  country: string;
  companyId: string;
  activity: string;
}
export interface FoundingPlan {
  id: FoundingPlanId;
  title: string;
  amountEUR: number;
  testing: string;
  details: string;
}
export interface MockReservation {
  id: string;
  product: FoundingPlanId;
  amountEUR: number;
  customer: FoundingCustomer;
  paymentStatus: MockPaymentStatus;
  createdAt: string;
  refundedAt: string | null;
  marker: 'DAJC_INTERNAL_DEMO_ONLY';
}
export const FOUNDING_PLANS: readonly FoundingPlan[] = [
  { id: 'platform', title: 'DAJC Platform', amountEUR: 199, testing: 'Q3 2027 (planned)', details: 'Heavy & oversized transport operations' },
  { id: 'tar', title: 'DAJC TAR', amountEUR: 299, testing: 'Q1 2028 (tentative)', details: 'Tow, Assistance & Recovery' },
  { id: 'both', title: 'Platform + TAR', amountEUR: 399, testing: 'Q3 2027 + tentative Q1 2028', details: 'Two independent B2B products' },
] as const;
export const TEST_TERMS_VERSION = 'INTERNAL-REVIEW-2026-11-08';
export const MOCK_STORAGE_KEY = 'dajc-founding-internal-demo-v1';

export function getFoundingPlan(value: string): FoundingPlan | undefined {
  return FOUNDING_PLANS.find((plan) => plan.id === value);
}
export function validateFoundingCustomer(value: FoundingCustomer): string[] {
  const errors: string[] = [];
  if (value.company.trim().length < 2 || value.company.length > 160) errors.push('Company name is required (2–160 characters).');
  if (value.contact.trim().length < 2 || value.contact.length > 120) errors.push('Contact name is required (2–120 characters).');
  if (value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) errors.push('Enter a valid business email.');
  if (value.country.trim().length < 2 || value.country.length > 100) errors.push('Country is required.');
  if (value.companyId.length > 70) errors.push('Company ID is too long.');
  return errors;
}
export function makeMockReservation(
  plan: FoundingPlan,
  customer: FoundingCustomer,
  nonce: string,
  createdAt: string,
): MockReservation {
  const errors = validateFoundingCustomer(customer);
  if (errors.length) throw new Error(errors.join(' '));
  if (!/^[a-zA-Z0-9]{6,32}$/.test(nonce)) throw new Error('Invalid mock identifier');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid mock date');
  return {
    id: `DEMO-${createdAt.slice(0, 10).replace(/-/g, '')}-${nonce.toUpperCase()}`,
    product: plan.id,
    amountEUR: plan.amountEUR,
    customer: { ...customer },
    paymentStatus: 'simulated_paid',
    createdAt,
    refundedAt: null,
    marker: 'DAJC_INTERNAL_DEMO_ONLY',
  };
}
export function simulateRefund(reservation: MockReservation, at: string): MockReservation {
  if (reservation.paymentStatus !== 'simulated_paid') return reservation;
  if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid mock date');
  return { ...reservation, paymentStatus: 'simulated_refunded', refundedAt: at };
}
export function outstandingMockCredit(reservation: MockReservation): number {
  return reservation.paymentStatus === 'simulated_paid' ? reservation.amountEUR : 0;
}
export function isMockReservation(value: unknown): value is MockReservation {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<MockReservation>;
  const plan = getFoundingPlan(String(r.product || ''));
  return r.marker === 'DAJC_INTERNAL_DEMO_ONLY'
    && typeof r.id === 'string' && r.id.startsWith('DEMO-')
    && (r.paymentStatus === 'simulated_paid' || r.paymentStatus === 'simulated_refunded')
    && Boolean(plan) && r.amountEUR === plan?.amountEUR
    && typeof r.createdAt === 'string'
    && typeof r.customer === 'object' && r.customer !== null
    && typeof r.customer.company === 'string';
}
