// Order lifecycle: checkout (stock reservation + seller split), payment confirmation, status flow,
// cancellation/refund, settlement records. Everything here runs server-side inside transactions.
import { tx, one, many, query, getSetting } from '../db.js';
import * as rzp from './razorpay.js';
import { notify, notifyAdmin } from './notify.js';
import { commissionFor } from '../util/money.js';
import { HttpError, badRequest, conflict, forbidden } from '../util/http.js';

export const SUB_STATUS_FLOW = {
  pickup:   { placed: ['accepted', 'cancelled'], accepted: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['delivered'] },
  delivery: { placed: ['accepted', 'cancelled'], accepted: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['dispatched'], dispatched: ['out_for_delivery', 'delivered'], out_for_delivery: ['delivered'] },
};

// ───────────── checkout ─────────────
export async function createCheckout(user, input) {
  if (!(await getSetting('checkout_enabled', true))) throw new HttpError(503, 'checkout_disabled', 'Ordering is temporarily disabled');
  const bps = await getSetting('commission_bps', 500);
  const holdMin = await getSetting('order_hold_minutes', 15);
  const deliveryAllowed = await getSetting('delivery_enabled', false);
  if (input.fulfilment === 'delivery' && !deliveryAllowed) throw badRequest('delivery_unavailable', 'Home delivery is not currently available. Please choose pickup.');

  const order = await tx(async (c) => {
    const cart = await c.many(
      `select ci.product_id, ci.qty from cart_items ci where ci.user_id = $1 order by ci.product_id`, [user.id]);
    if (!cart.length) throw badRequest('empty_cart', 'Your cart is empty');

    // Lock product rows in a stable order to avoid deadlocks, then reserve stock atomically.
    const ids = cart.map((x) => x.product_id);
    await c.many('select id from products where id = any($1) order by id for update', [ids]);
    const live = await c.many('select * from catalog_products where id = any($1)', [ids]);
    const byId = new Map(live.map((p) => [p.id, p]));
    const problems = [];
    for (const it of cart) {
      const p = byId.get(it.product_id);
      if (!p) problems.push({ productId: it.product_id, reason: 'unavailable' });
      else if (!p.in_stock) problems.push({ productId: p.id, name: p.name, reason: 'out_of_stock' });
      else if (p.stock < it.qty) problems.push({ productId: p.id, name: p.name, reason: 'insufficient_stock', available: p.stock });
      else if (input.fulfilment === 'delivery' && !p.delivery_enabled) problems.push({ productId: p.id, name: p.name, reason: 'delivery_not_offered' });
      else if (input.fulfilment === 'pickup' && !p.pickup_enabled) problems.push({ productId: p.id, name: p.name, reason: 'pickup_not_offered' });
    }
    if (problems.length) throw new HttpError(409, 'cart_unavailable', 'Some items are no longer available', problems);

    const groups = new Map();
    let total = 0;
    for (const it of cart) {
      const p = byId.get(it.product_id);
      const line = p.final_price_paise * it.qty;
      total += line;
      if (!groups.has(p.shop_id)) groups.set(p.shop_id, { subtotal: 0, items: [] });
      const g = groups.get(p.shop_id);
      g.subtotal += line; g.items.push({ p, qty: it.qty, line });
      const r = await c.query('update products set stock = stock - $2 where id = $1 and stock >= $2', [p.id, it.qty]);
      if (r.rowCount !== 1) throw new HttpError(409, 'cart_unavailable', 'Stock changed, please review your cart', [{ productId: p.id, reason: 'insufficient_stock' }]);
    }

    const o = await c.one(
      `insert into orders (customer_id, total_paise, fulfilment, contact_name, contact_phone, delivery_address,
                           age_confirmed_at, terms_accepted_at, expires_at)
       values ($1,$2,$3,$4,$5,$6, now(), now(), now() + make_interval(mins => $7)) returning *`,
      [user.id, total, input.fulfilment, input.contactName, input.contactPhone, input.address ?? null, holdMin]);

    const transfers = [];
    for (const [shopId, g] of groups) {
      const commission = commissionFor(g.subtotal, bps);
      const net = g.subtotal - commission;
      const so = await c.one(
        `insert into sub_orders (order_id, shop_id, subtotal_paise, commission_bps, commission_paise, seller_amount_paise)
         values ($1,$2,$3,$4,$5,$6) returning id`, [o.id, shopId, g.subtotal, bps, commission, net]);
      for (const { p, qty, line } of g.items) {
        await c.query(
          `insert into order_items (sub_order_id, product_id, name, image_url, unit_price_paise, qty, line_total_paise)
           values ($1,$2,$3,$4,$5,$6,$7)`, [so.id, p.id, p.name, p.image_url, p.final_price_paise, qty, line]);
      }
      const shop = await c.one('select razorpay_account_id from shops where id = $1', [shopId]);
      transfers.push({ account: shop.razorpay_account_id, amount: net, currency: 'INR', on_hold: true, notes: { sub_order_id: so.id, shop_id: shopId } });
    }
    return { ...o, transfers };
  });

  try {
    const ro = await rzp.createOrder({ amountPaise: order.total_paise, receipt: order.order_number, notes: { order_id: order.id }, transfers: order.transfers });
    await tx(async (c) => {
      await c.query('update orders set razorpay_order_id = $2 where id = $1', [order.id, ro.id]);
      await c.query(`insert into payments (purpose, order_id, razorpay_order_id, amount_paise) values ('order',$1,$2,$3)`, [order.id, ro.id, order.total_paise]);
    });
    return { orderId: order.id, orderNumber: order.order_number, expiresAt: order.expires_at, checkout: rzp.checkoutOptions({
      razorpayOrderId: ro.id, amountPaise: order.total_paise, name: user.name, phone: order.contact_phone, email: user.email || undefined,
      description: `Order ${order.order_number}` }) };
  } catch (e) {
    await releaseReservation(order.id, 'failed');   // never leave stock reserved if the gateway refused
    throw e;
  }
}

/** Re-open payment for a still-valid pending order. */
export async function resumePayment(user, orderId) {
  const o = await one(`select * from orders where id = $1 and customer_id = $2`, [orderId, user.id]);
  if (!o) throw new HttpError(404, 'not_found', 'Order not found');
  if (o.status !== 'pending_payment' || new Date(o.expires_at) < new Date()) throw conflict('order_expired', 'This order has expired. Please place it again.');
  return { orderId: o.id, orderNumber: o.order_number, expiresAt: o.expires_at, checkout: rzp.checkoutOptions({
    razorpayOrderId: o.razorpay_order_id, amountPaise: o.total_paise, name: user.name, phone: o.contact_phone, email: user.email || undefined, description: `Order ${o.order_number}` }) };
}

/** Return reserved stock and close the order. Idempotent: only acts on pending_payment orders. */
export async function releaseReservation(orderId, newStatus) {
  return tx(async (c) => {
    const o = await c.one('select id, status from orders where id = $1 for update', [orderId]);
    if (!o || o.status !== 'pending_payment') return false;
    const items = await c.many(
      `select oi.product_id, sum(oi.qty)::int as qty from order_items oi join sub_orders so on so.id = oi.sub_order_id
        where so.order_id = $1 group by oi.product_id order by oi.product_id`, [orderId]);
    for (const it of items) await c.query('update products set stock = stock + $2 where id = $1', [it.product_id, it.qty]);
    await c.query('update orders set status = $2 where id = $1', [orderId, newStatus]);
    return true;
  });
}

export async function expireStaleOrders() {
  const rows = await many(`select id from orders where status = 'pending_payment' and expires_at < now() - interval '2 minutes' limit 200`);
  for (const r of rows) await releaseReservation(r.id, 'expired').catch((e) => console.error('[expire]', e.message));
  return rows.length;
}

// ───────────── payment confirmation (called by verify endpoint AND webhook; idempotent) ─────────────
export async function handleOrderPaymentCaptured(payment) {
  const pay = await one('select * from payments where razorpay_order_id = $1 and purpose = $2', [payment.order_id, 'order']);
  if (!pay) return { ignored: true };
  if (pay.amount_paise !== payment.amount) {
    await notifyAdmin('payment_issue', { reason: 'amount_mismatch', razorpayPaymentId: payment.id });
    throw new HttpError(409, 'amount_mismatch', 'Payment amount mismatch');
  }
  if (payment.method !== 'upi') {   // UPI-only platform: anything else is refunded automatically
    await query(`update payments set razorpay_payment_id = $2, method = $3, status = 'failed', failure_reason = 'non_upi_method' where id = $1`, [pay.id, payment.id, payment.method]);
    await rzp.refundPayment(payment.id, { notes: { reason: 'non_upi_method' } }).catch((e) => console.error('[refund]', e.message));
    await releaseReservation(pay.order_id, 'failed');
    await notifyAdmin('payment_issue', { reason: 'non_upi_method', orderId: pay.order_id });
    return { refunded: true };
  }

  const result = await tx(async (c) => {
    const o = await c.one('select * from orders where id = $1 for update', [pay.order_id]);
    if (o.status === 'paid') return { already: true };
    await c.query(`update payments set razorpay_payment_id = $2, method = 'upi', status = 'captured', raw = $3 where id = $1`, [pay.id, payment.id, payment]);

    if (o.status !== 'pending_payment') {
      // Late capture after the hold expired: try to re-reserve; otherwise refund automatically.
      const items = await c.many(
        `select oi.product_id, sum(oi.qty)::int as qty from order_items oi join sub_orders so on so.id = oi.sub_order_id
          where so.order_id = $1 group by oi.product_id order by oi.product_id`, [o.id]);
      for (const it of items) await c.many('select id from products where id = $1 for update', [it.product_id]);
      for (const it of items) {
        const r = await c.query('update products set stock = stock - $2 where id = $1 and stock >= $2', [it.product_id, it.qty]);
        if (r.rowCount !== 1) return { needsRefund: true };
      }
    }

    await c.query(`update orders set status = 'paid', paid_at = now() where id = $1`, [o.id]);
    const subs = await c.many('select * from sub_orders where order_id = $1', [o.id]);
    for (const so of subs) {
      await c.query(
        `insert into settlements (sub_order_id, shop_id, gross_paise, commission_paise, net_paise, status)
         values ($1,$2,$3,$4,$5,'on_hold') on conflict (sub_order_id) do nothing`,
        [so.id, so.shop_id, so.subtotal_paise, so.commission_paise, so.seller_amount_paise]);
      await c.query(`insert into sub_order_events (sub_order_id, status, note) values ($1,'placed','payment confirmed')`, [so.id]);
      const shop = await c.one('select owner_id from shops where id = $1', [so.shop_id]);
      await notify(shop.owner_id, 'new_order', { orderNumber: o.order_number, subOrderId: so.id, amountPaise: so.subtotal_paise }, {}, c);
    }
    await c.query(
      `update products p set sold_count = sold_count + x.q from (
         select oi.product_id, sum(oi.qty)::int q from order_items oi join sub_orders so on so.id = oi.sub_order_id where so.order_id = $1 group by 1) x
       where p.id = x.product_id`, [o.id]);
    await c.query(`delete from cart_items where user_id = $1 and product_id in (
       select oi.product_id from order_items oi join sub_orders so on so.id = oi.sub_order_id where so.order_id = $2)`, [o.customer_id, o.id]);
    await notify(o.customer_id, 'payment_success', { orderNumber: o.order_number, orderId: o.id }, {}, c);
    await notify(o.customer_id, 'order_placed', { orderNumber: o.order_number, orderId: o.id }, {}, c);
    await notifyAdmin('new_order', { orderNumber: o.order_number, amountPaise: o.total_paise }, {}, c);

    const low = await c.many(
      `select p.id, p.name, p.stock, s.owner_id from products p join shops s on s.id = p.shop_id
        where p.id in (select oi.product_id from order_items oi join sub_orders so on so.id = oi.sub_order_id where so.order_id = $1) and p.stock <= 5`, [o.id]);
    for (const p of low) await notify(p.owner_id, p.stock === 0 ? 'out_of_stock' : 'low_stock', { productId: p.id, name: p.name, stock: p.stock }, { dedupeKey: `stock:${p.id}:${p.stock}` }, c);
    return { paid: true, orderId: o.id };
  });

  if (result.needsRefund) {
    await rzp.refundPayment(payment.id, { notes: { reason: 'stock_unavailable_after_expiry' } });
    await query(`update payments set status = 'refunded' where id = $1`, [pay.id]);
    await query(`update orders set status = 'refunded' where id = $1`, [pay.order_id]);
    await notifyAdmin('payment_issue', { reason: 'late_payment_refunded', orderId: pay.order_id });
    return { refunded: true };
  }
  if (result.paid) await captureTransferIds(result.orderId, payment.id).catch((e) => console.error('[transfers]', e.message));
  return result;
}

async function captureTransferIds(orderId, paymentId) {
  const t = await rzp.fetchPaymentTransfers(paymentId);
  for (const tr of t.items || []) {
    const subId = tr.notes?.sub_order_id;
    if (subId) await query('update settlements set razorpay_transfer_id = $2 where sub_order_id = $1 and razorpay_transfer_id is null', [subId, tr.id]);
  }
}

export async function handlePaymentFailed(payment) {
  const pay = await one('select * from payments where razorpay_order_id = $1', [payment.order_id]);
  if (!pay || pay.status === 'captured') return;
  await query(`update payments set status = 'failed', failure_reason = $2, method = $3 where id = $1`,
    [pay.id, payment.error_description || payment.error_code || 'failed', payment.method ?? null]);
  // The order stays reserved until it expires so the customer can retry the payment on the same order.
  if (pay.order_id) await notifyAdmin('payment_issue', { reason: 'payment_failed', orderId: pay.order_id }, { dedupeKey: `pf:${payment.id}` });
}

// ───────────── fulfilment status ─────────────
export async function advanceSubOrder(actor, subOrderId, next, note) {
  const out = await tx(async (c) => {
    const so = await c.one(
      `select so.*, o.fulfilment, o.customer_id, o.order_number, o.status as order_status, s.owner_id
         from sub_orders so join orders o on o.id = so.order_id join shops s on s.id = so.shop_id
        where so.id = $1 for update of so`, [subOrderId]);
    if (!so || (actor.role === 'seller' && so.owner_id !== actor.id)) throw new HttpError(404, 'not_found', 'Order not found');
    if (so.order_status !== 'paid') throw conflict('not_paid', 'Order is not paid');
    const allowed = SUB_STATUS_FLOW[so.fulfilment][so.status] || [];
    if (!allowed.includes(next)) throw conflict('bad_transition', `Cannot move from ${so.status} to ${next}`);
    if (next === 'cancelled') throw badRequest('use_cancel', 'Use the cancel action');
    await c.query('update sub_orders set status = $2 where id = $1', [subOrderId, next]);
    await c.query('insert into sub_order_events (sub_order_id, status, note, actor_id) values ($1,$2,$3,$4)', [subOrderId, next, note ?? null, actor.id]);
    const kindMap = { accepted: 'seller_accepted', preparing: 'preparing', ready: 'ready', dispatched: 'dispatched', out_for_delivery: 'out_for_delivery', delivered: 'delivered' };
    await notify(so.customer_id, kindMap[next], { orderNumber: so.order_number, orderId: so.order_id, fulfilment: so.fulfilment }, {}, c);
    return { customerId: so.customer_id, delivered: next === 'delivered' };
  });
  if (out.delivered) await releaseSettlement(subOrderId).catch((e) => console.error('[release]', e.message));
  return out;
}

/** Funds are held at the gateway until the buyer has the goods, then released to the seller. */
export async function releaseSettlement(subOrderId) {
  const st = await one(`select * from settlements where sub_order_id = $1`, [subOrderId]);
  if (!st || st.status !== 'on_hold') return;
  if (!st.razorpay_transfer_id) {
    const pay = await one(`select p.razorpay_payment_id from payments p join sub_orders so on so.order_id = p.order_id where so.id = $1 and p.status = 'captured'`, [subOrderId]);
    if (pay?.razorpay_payment_id) await captureTransferIds((await one('select order_id from sub_orders where id = $1', [subOrderId])).order_id, pay.razorpay_payment_id);
  }
  const fresh = await one('select razorpay_transfer_id from settlements where id = $1', [st.id]);
  if (!fresh.razorpay_transfer_id) throw new Error('transfer id unavailable');
  await rzp.releaseTransfer(fresh.razorpay_transfer_id);
  await query(`update settlements set status = 'released', released_at = now() where id = $1 and status = 'on_hold'`, [st.id]);
}

export async function retryPendingReleases() {
  const rows = await many(`select st.sub_order_id from settlements st join sub_orders so on so.id = st.sub_order_id where st.status = 'on_hold' and so.status = 'delivered' limit 50`);
  for (const r of rows) await releaseSettlement(r.sub_order_id).catch((e) => console.error('[release-retry]', e.message));
}

/** Seller (or admin) cancels one seller's part of an order → partial refund of that sub-order, stock restored. */
export async function cancelSubOrder(actor, subOrderId, reason) {
  const so = await one(
    `select so.*, o.customer_id, o.order_number, o.id as oid, s.owner_id
       from sub_orders so join orders o on o.id = so.order_id join shops s on s.id = so.shop_id where so.id = $1`, [subOrderId]);
  if (!so || (actor.role === 'seller' && so.owner_id !== actor.id) || (actor.role === 'customer' && so.customer_id !== actor.id)) throw new HttpError(404, 'not_found', 'Order not found');
  if (actor.role === 'customer' && so.status !== 'placed') throw conflict('too_late', 'The seller has already accepted this order. Please contact support to cancel.');
  const cancellable = actor.role === 'admin' ? ['placed', 'accepted', 'preparing', 'ready', 'dispatched', 'out_for_delivery'] : ['placed', 'accepted', 'preparing'];
  if (!cancellable.includes(so.status)) throw conflict('too_late', 'This order can no longer be cancelled');
  const pay = await one(`select * from payments where order_id = $1 and status in ('captured','partially_refunded')`, [so.order_id]);
  if (!pay) throw conflict('not_paid', 'Order is not paid');

  const refund = await rzp.refundPayment(pay.razorpay_payment_id, { amountPaise: so.subtotal_paise, notes: { sub_order_id: so.id, reason: reason ?? '' } });
  await tx(async (c) => {
    await c.query(`update sub_orders set status = 'cancelled' where id = $1`, [so.id]);
    await c.query('insert into sub_order_events (sub_order_id, status, note, actor_id) values ($1,$2,$3,$4)', [so.id, 'cancelled', reason ?? null, actor.id]);
    await c.query(`update settlements set status = 'reversed' where sub_order_id = $1`, [so.id]);
    await c.query(`insert into refunds (payment_id, order_id, amount_paise, razorpay_refund_id, status, reason, created_by) values ($1,$2,$3,$4,'pending',$5,$6)`,
      [pay.id, so.order_id, so.subtotal_paise, refund.id, reason ?? null, actor.id]);
    const remaining = await c.one(`select count(*)::int n from sub_orders where order_id = $1 and status <> 'cancelled'`, [so.order_id]);
    await c.query(`update payments set status = $2 where id = $1`, [pay.id, remaining.n === 0 ? 'refunded' : 'partially_refunded']);
    await c.query(`update orders set status = $2 where id = $1`, [so.order_id, remaining.n === 0 ? 'refunded' : 'partially_refunded']);
    const items = await c.many('select product_id, qty from order_items where sub_order_id = $1 order by product_id', [so.id]);
    const restock = ['placed', 'accepted', 'preparing', 'ready'].includes(so.status);   // goods already out for delivery are not restocked
    for (const it of items) await c.query('update products set stock = stock + $2, sold_count = greatest(sold_count - $2, 0) where id = $1', [it.product_id, restock ? it.qty : 0]);
    await notify(so.customer_id, 'order_cancelled', { orderNumber: so.order_number, orderId: so.order_id, amountPaise: so.subtotal_paise }, {}, c);
    await notifyAdmin('order_cancelled', { orderNumber: so.order_number, by: actor.role }, {}, c);
  });
}

// ───────────── seller subscription ─────────────
export async function startSubscriptionPayment(user, shop) {
  const amount = await getSetting('subscription_paise', 19900);
  const months = await getSetting('subscription_months', 6);
  const sub = await one(`insert into seller_subscriptions (shop_id, amount_paise, months) values ($1,$2,$3) returning id`, [shop.id, amount, months]);
  const ro = await rzp.createOrder({ amountPaise: amount, receipt: `sub_${sub.id.slice(0, 30)}`, notes: { subscription_id: sub.id, shop_id: shop.id } });
  await query('update seller_subscriptions set razorpay_order_id = $2 where id = $1', [sub.id, ro.id]);
  await query(`insert into payments (purpose, subscription_id, razorpay_order_id, amount_paise) values ('subscription',$1,$2,$3)`, [sub.id, ro.id, amount]);
  return { subscriptionId: sub.id, checkout: rzp.checkoutOptions({ razorpayOrderId: ro.id, amountPaise: amount, name: user.name, phone: shop.phone, email: String(shop.email), description: 'MAVRIX FIRE seller plan (6 months)' }) };
}

export async function handleSubscriptionCaptured(payment) {
  const pay = await one(`select * from payments where razorpay_order_id = $1 and purpose = 'subscription'`, [payment.order_id]);
  if (!pay) return { ignored: true };
  if (pay.amount_paise !== payment.amount) throw new HttpError(409, 'amount_mismatch', 'Payment amount mismatch');
  if (payment.method !== 'upi') {
    await query(`update payments set razorpay_payment_id = $2, method = $3, status = 'failed', failure_reason = 'non_upi_method' where id = $1`, [pay.id, payment.id, payment.method]);
    await rzp.refundPayment(payment.id, { notes: { reason: 'non_upi_method' } }).catch(() => {});
    return { refunded: true };
  }
  return tx(async (c) => {
    const sub = await c.one('select * from seller_subscriptions where id = $1 for update', [pay.subscription_id]);
    if (sub.status === 'active') return { already: true };
    await c.query(`update payments set razorpay_payment_id = $2, method = 'upi', status = 'captured', raw = $3 where id = $1`, [pay.id, payment.id, payment]);
    const cur = await c.one(`select max(expires_at) as e from seller_subscriptions where shop_id = $1 and status = 'active' and expires_at > now()`, [sub.shop_id]);
    await c.query(
      `update seller_subscriptions set status = 'active', razorpay_payment_id = $2,
         starts_at = greatest(now(), coalesce($3::timestamptz, now())),
         expires_at = greatest(now(), coalesce($3::timestamptz, now())) + make_interval(months => $4) where id = $1`,
      [sub.id, payment.id, cur?.e ?? null, sub.months]);
    const shop = await c.one('select owner_id, name from shops where id = $1', [sub.shop_id]);
    await notify(shop.owner_id, 'subscription_active', { shop: shop.name }, {}, c);
    await notifyAdmin('subscription_paid', { shop: shop.name, amountPaise: sub.amount_paise }, {}, c);
    return { activated: true };
  });
}

export async function handlePaymentCaptured(payment) {
  const p = await one('select purpose from payments where razorpay_order_id = $1', [payment.order_id]);
  if (!p) return { ignored: true };
  return p.purpose === 'order' ? handleOrderPaymentCaptured(payment) : handleSubscriptionCaptured(payment);
}

export async function runSubscriptionJobs() {
  await query(`update seller_subscriptions set status = 'expired' where status = 'active' and expires_at <= now()`);
  await query(`update seller_subscriptions set status = 'failed' where status = 'pending' and created_at < now() - interval '2 days'`);
  const due = await many(
    `select s.id as shop_id, s.owner_id, s.name, max(ss.expires_at) as expires_at
       from shops s join seller_subscriptions ss on ss.shop_id = s.id and ss.status = 'active'
      where s.deleted_at is null group by s.id having max(ss.expires_at) < now() + interval '15 days'`);
  for (const d of due) {
    const days = Math.ceil((new Date(d.expires_at) - Date.now()) / 86400000);
    const bucket = days <= 1 ? 1 : days <= 3 ? 3 : days <= 7 ? 7 : 15;
    await notify(d.owner_id, 'subscription_expiring', { days, shop: d.name }, { dedupeKey: `subexp:${d.shop_id}:${bucket}:${new Date(d.expires_at).toISOString().slice(0, 10)}` });
  }
  const expired = await many(
    `select s.owner_id, s.name, s.id from shops s where s.status = 'approved' and not exists
       (select 1 from seller_subscriptions ss where ss.shop_id = s.id and ss.status = 'active')
       and exists (select 1 from seller_subscriptions ss where ss.shop_id = s.id and ss.status = 'expired')`);
  for (const e of expired) await notify(e.owner_id, 'subscription_expired', { shop: e.name }, { dedupeKey: `subexpd:${e.id}:${new Date().toISOString().slice(0, 7)}` });
}
