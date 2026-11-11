import {
  FOUNDING_PLANS, getFoundingPlan, validateFoundingCustomer, makeMockReservation,
  simulateRefund, outstandingMockCredit, isMockReservation, MOCK_STORAGE_KEY,
  type FoundingCustomer, type FoundingPlanId, type MockReservation,
} from '../lib/founding-preview';

// Internal UI only. There are NO network calls, real payment-provider credentials,
// real order IDs, emails sent or backend entitlements in this module.
if (document.querySelector('#founding-plan-form')) {
const q = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error('Missing internal demo element: ' + selector);
  return element;
};
const setText = (selector: string, text: string) => { q<HTMLElement>(selector).textContent = text; };
const planForm = q<HTMLFormElement>('#founding-plan-form');
const companyForm = q<HTMLFormElement>('#founding-company-form');
const termsForm = q<HTMLFormElement>('#founding-terms-form');
const productSelect = q<HTMLSelectElement>('#founding-product');
const actionFailure = q<HTMLElement>('#founding-payment-result');
const emailPreview = q<HTMLElement>('#founding-email-preview');

let currentPlan: FoundingPlanId = 'platform';
let currentCustomer: FoundingCustomer | null = null;
let reservation: MockReservation | null = null;
let currentStep = 1;

function showStep(step: number) {
  currentStep = step;
  document.querySelectorAll<HTMLElement>('[data-demo-step]').forEach((element) => {
    element.hidden = Number(element.dataset.demoStep) !== step;
  });
  document.querySelectorAll<HTMLElement>('[data-progress]').forEach((element) => {
    const active = Number(element.dataset.progress) === step;
    element.dataset.current = active ? 'true' : 'false';
    if (active) element.setAttribute('aria-current', 'step');
    else element.removeAttribute('aria-current');
  });
  setText('#founding-step-indicator', 'Step ' + step + ' of 5');
  q<HTMLElement>('#founding-step-container').scrollIntoView({block:'start', behavior:'auto'});
}

function selectedPlan() {
  const result = getFoundingPlan(currentPlan);
  if (!result) throw new Error('A valid product is required');
  return result;
}

function updatePlan() {
  const plan = selectedPlan();
  setText('#founding-plan-summary', plan.title);
  setText('#founding-price-summary', plan.amountEUR + ' €');
  setText('#founding-testing-summary', plan.testing);
  setText('#founding-checkout-plan', plan.title + ' · ' + plan.amountEUR + ' € proposed');
}

planForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const choice = planForm.querySelector<HTMLInputElement>('input[name="plan"]:checked');
  if (!choice) return;
  const plan = getFoundingPlan(choice.value);
  if (!plan) return;
  currentPlan = plan.id;
  productSelect.value = currentPlan;
  updatePlan();
  showStep(2);
});

q<HTMLButtonElement>('#founding-back-product').addEventListener('click', () => showStep(1));
productSelect.addEventListener('change', () => {
  const plan = getFoundingPlan(productSelect.value);
  if (!plan) return;
  currentPlan = plan.id;
  const choice = planForm.querySelector<HTMLInputElement>('input[name="plan"][value="' + plan.id + '"]');
  if (choice) choice.checked = true;
  updatePlan();
});

companyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!companyForm.reportValidity()) return;
  const input = new FormData(companyForm);
  const field = (name: string) => String(input.get(name) ?? '').trim();
  const customer: FoundingCustomer = {
    company: field('company'), contact: field('contact'),
    email: field('email'), country: field('country'),
    companyId: field('companyId'), activity: field('activity'),
  };
  const errors = validateFoundingCustomer(customer);
  if (errors.length) {
    setText('#founding-customer-errors', errors.join(' '));
    return;
  }
  setText('#founding-customer-errors', '');
  currentCustomer = customer;
  updatePlan();
  setText('#founding-review-customer', customer.company + ' · ' + customer.contact + ' · ' + customer.email + ' · ' + customer.country);
  showStep(3);
});

q<HTMLButtonElement>('#founding-back-company').addEventListener('click', () => showStep(2));
termsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!termsForm.reportValidity() || !currentCustomer) return;
  actionFailure.textContent = '';
  showStep(4);
});
q<HTMLButtonElement>('#founding-back-review').addEventListener('click', () => showStep(3));

q<HTMLButtonElement>('#founding-decline').addEventListener('click', () => {
  actionFailure.textContent = 'TEST RESULT: payment declined. No test reservation created. You can retry or go back.';
  actionFailure.dataset.status = 'error';
});
q<HTMLButtonElement>('#founding-cancel').addEventListener('click', () => {
  actionFailure.textContent = '';
  showStep(3);
});
q<HTMLButtonElement>('#founding-pay').addEventListener('click', () => {
  if (!currentCustomer) return;
  const nonce = [...crypto.getRandomValues(new Uint8Array(6))].map(n => n.toString(16).padStart(2, '0')).join('');
  reservation = makeMockReservation(selectedPlan(), currentCustomer, nonce, new Date().toISOString());
  try {
    sessionStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(reservation));
  } catch {
    // In private browsing or when storage is blocked, the demo still runs in memory.
  }
  renderReservation();
  showStep(5);
});

function buildEmailText(order: MockReservation) {
  const plan = getFoundingPlan(order.product);
  return [
    '*** INTERNAL DEMONSTRATION — NOT A REAL RESERVATION ***',
    'DAJC Founding Customers · sample confirmation',
    '',
    'Demo reference: ' + order.id,
    'Product: ' + (plan?.title || order.product),
    'Company (test data): ' + order.customer.company,
    'Amount (SIMULATED, NOT CHARGED): ' + order.amountEUR + ' EUR',
    'Mock payment status: ' + order.paymentStatus,
    'Indicative testing: ' + (plan?.testing || 'To be confirmed'),
    'Date: ' + order.createdAt,
    '',
    'No funds have been collected. No contract or software entitlement exists.',
    'This sample is NOT A TAX DOCUMENT and must not be sent to customers.',
  ].join('\n');
}
function renderReservation() {
  if (!reservation) return;
  const plan = getFoundingPlan(reservation.product);
  setText('#founding-order-id', reservation.id);
  setText('#founding-order-product', plan?.title || reservation.product);
  setText('#founding-order-company', reservation.customer.company);
  setText('#founding-order-amount', reservation.amountEUR + ' € · TEST ONLY');
  setText('#founding-order-date', new Date(reservation.createdAt).toLocaleString('en-GB'));
  setText('#founding-order-testing', plan?.testing || 'To be announced');
  setText('#founding-order-status', reservation.paymentStatus === 'simulated_paid' ? 'SIMULATED PAID' : 'SIMULATED REFUNDED');
  setText('#founding-order-credit', outstandingMockCredit(reservation) + ' € · DEMO CREDIT');
  const refundable = reservation.paymentStatus === 'simulated_paid';
  q<HTMLButtonElement>('#founding-refund').disabled = !refundable;
  q<HTMLElement>('#founding-refund-info').textContent =
    refundable ? 'Try a simulated refund to test the cancellation flow.' : 'Demo refund recorded; no money was moved.';
  if (!emailPreview.hidden) emailPreview.textContent = buildEmailText(reservation);
}

q<HTMLButtonElement>('#founding-preview-email').addEventListener('click', () => {
  if (!reservation) return;
  emailPreview.hidden = !emailPreview.hidden;
  if (!emailPreview.hidden) emailPreview.textContent = buildEmailText(reservation);
});
q<HTMLButtonElement>('#founding-download').addEventListener('click', () => {
  if (!reservation) return;
  const blob = new Blob([buildEmailText(reservation)], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reservation.id + '-TEST-NOT-INVOICE.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});
q<HTMLButtonElement>('#founding-refund').addEventListener('click', () => {
  if (!reservation || reservation.paymentStatus !== 'simulated_paid') return;
  if (!window.confirm('SIMULATE A REFUND? No real money will move.')) return;
  reservation = simulateRefund(reservation, new Date().toISOString());
  try { sessionStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(reservation)); } catch { /* demo storage optional */ }
  renderReservation();
});
q<HTMLButtonElement>('#founding-start-over').addEventListener('click', () => {
  if (!window.confirm('Clear the test reservation from this browser tab?')) return;
  reservation = null;
  currentCustomer = null;
  currentPlan = 'platform';
  companyForm.reset();
  termsForm.reset();
  planForm.reset();
  productSelect.value = 'platform';
  emailPreview.hidden = true;
  try { sessionStorage.removeItem(MOCK_STORAGE_KEY); } catch { /* optional */ }
  updatePlan();
  showStep(1);
});

try {
  const stored = sessionStorage.getItem(MOCK_STORAGE_KEY);
  if (stored) {
    const parsed: unknown = JSON.parse(stored);
    if (isMockReservation(parsed)) reservation = parsed;
  }
} catch { /* no persistence available */ }

updatePlan();
if (reservation) {
  renderReservation();
  showStep(5);
} else {
  showStep(1);
}

} // No form is rendered if this preview-only route is unavailable.
