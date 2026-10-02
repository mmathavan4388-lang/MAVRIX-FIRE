// Razorpay (Orders + Route for marketplace split settlement). Implemented over the REST API;
// secrets stay server-side. Payment verification is done here and in the webhook — never trusted from the client.
import { config, flags } from '../config.js';
import { hmacHex, safeEqualHex } from '../util/crypto.js';
import { HttpError, unavailable } from '../util/http.js';

const BASE = 'https://api.razorpay.com';

async function rzp(method, path, body) {
  if (!flags.payments()) throw unavailable('payments_not_configured', 'Online payments are not configured on the server');
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    console.error('[razorpay]', method, path, res.status, text.slice(0, 500));
    throw new HttpError(502, 'payment_provider_error', json?.error?.description || 'Payment provider error', { status: res.status });
  }
  return json;
}

export const publicKeyId = () => config.razorpay.keyId;

/** transfers: [{ account, amount, currency:'INR', on_hold:true, notes }] — amounts in paise. */
export const createOrder = ({ amountPaise, receipt, notes, transfers }) =>
  rzp('POST', '/v1/orders', { amount: amountPaise, currency: 'INR', receipt, notes, ...(transfers?.length ? { transfers } : {}) });

export const fetchPayment = (id) => rzp('GET', `/v1/payments/${id}`);
export const fetchPaymentTransfers = (paymentId) => rzp('GET', `/v1/payments/${paymentId}/transfers`);
export const releaseTransfer = (transferId) => rzp('PATCH', `/v1/transfers/${transferId}`, { on_hold: false });
export const refundPayment = (paymentId, { amountPaise, notes } = {}) =>
  rzp('POST', `/v1/payments/${paymentId}/refund`, { ...(amountPaise ? { amount: amountPaise } : {}), reverse_all: true, notes });

/** Checkout signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  if (!flags.payments() || !signature) return false;
  return safeEqualHex(hmacHex(config.razorpay.keySecret, `${orderId}|${paymentId}`), signature);
}
/** Webhook signature: HMAC_SHA256(raw_body, webhook_secret). rawBody must be the unparsed Buffer. */
export function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !signature) return false;
  return safeEqualHex(hmacHex(config.razorpay.webhookSecret, rawBody), signature);
}

// ── Route linked accounts (seller payout onboarding). Bank/PAN details are forwarded to Razorpay
// and are NOT stored in MAVRIX FIRE's database; we keep only the linked account id and status.
export async function createLinkedAccount(shop, kyc) {
  const acc = await rzp('POST', '/v2/accounts', {
    email: String(shop.email), phone: shop.phone.replace(/^\+?91/, ''), type: 'route',
    reference_id: shop.id.slice(0, 20),
    legal_business_name: kyc.legalName, business_type: kyc.businessType,
    contact_name: shop.owner_name,
    profile: {
      category: 'ecommerce', subcategory: 'ecommerce_marketplace',
      addresses: { registered: { street1: shop.address.slice(0, 100), street2: 'NA', city: shop.city_name, state: shop.city_state.toUpperCase(), postal_code: shop.pincode, country: 'IN' } },
    },
    legal_info: { pan: kyc.pan, ...(kyc.gst ? { gst: kyc.gst } : {}) },
  });
  await rzp('POST', `/v2/accounts/${acc.id}/stakeholders`, { name: shop.owner_name, email: String(shop.email) });
  const product = await rzp('POST', `/v2/accounts/${acc.id}/products`, { product_name: 'route', tnc_accepted: true });
  await rzp('PATCH', `/v2/accounts/${acc.id}/products/${product.id}`, {
    settlements: { account_number: kyc.accountNumber, ifsc_code: kyc.ifsc, beneficiary_name: kyc.beneficiaryName },
    tnc_accepted: true,
  });
  return acc;
}
export const fetchAccount = (id) => rzp('GET', `/v2/accounts/${id}`);

/** Standard-checkout options for the web/Android client — UPI only, no secrets. */
export function checkoutOptions({ razorpayOrderId, amountPaise, name, phone, email, description }) {
  return {
    key: config.razorpay.keyId, order_id: razorpayOrderId, amount: amountPaise, currency: 'INR',
    name: 'MAVRIX FIRE', description,
    prefill: { name, contact: phone, email },
    config: { display: { blocks: { upi: { name: 'Pay via UPI / GPay', instruments: [{ method: 'upi' }] } }, sequence: ['block.upi'], preferences: { show_default_blocks: false } } },
    theme: { color: '#7C3AED' },
  };
}
