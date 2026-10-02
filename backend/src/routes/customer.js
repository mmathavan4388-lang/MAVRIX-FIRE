import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, query, tx } from '../db.js';
import { wrap, parse, HttpError, badRequest, notFound, conflict } from '../util/http.js';
import { requireRole, requireUser } from '../middleware/auth.js';
import { uploadLimiter, supportLimiter } from '../middleware/limits.js';
import { uploadImage } from '../services/storage.js';
import { createCheckout, resumePayment, cancelSubOrder, handlePaymentCaptured } from '../services/orders.js';
import * as rzp from '../services/razorpay.js';
import { notify, notifyAdmin } from '../services/notify.js';
import { config } from '../config.js';

export const customer = Router();
const cust = requireRole('customer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const uuid = z.string().uuid();

// ───────────── uploads (all roles; scoped folder per purpose) ─────────────
customer.post('/uploads/:kind', requireUser, uploadLimiter, upload.single('file'), wrap(async (req, res) => {
  const kind = req.params.kind;
  const allowed = { review: ['customer'], support: ['customer', 'admin'], product: ['seller'], 'shop-photo': ['seller'], 'shop-logo': ['seller'], banner: ['admin'] };
  if (!allowed[kind]?.includes(req.user.role)) throw new HttpError(403, 'forbidden', 'Not allowed');
  if (!req.file) throw badRequest('no_file', 'Choose an image');
  let folder = `${kind}/${req.user.id}`;
  if (req.user.role === 'seller') {
    const shop = await one('select id from shops where owner_id = $1 and deleted_at is null', [req.user.id]);
    if (!shop) throw notFound('Shop not found');
    folder = `${kind === 'product' ? 'products' : kind === 'shop-photo' ? 'shop-photos' : 'shop-logos'}/${shop.id}`;
  }
  const out = await uploadImage(req.file, folder, kind === 'banner' ? { maxWidth: 2000 } : undefined);
  res.status(201).json(out);
}));

// ───────────── notifications (all roles) ─────────────
customer.get('/notifications', requireUser, wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = await many(
    `select id, kind, title, body, data, read_at, created_at from notifications where user_id = $1 order by created_at desc limit 31 offset $2`,
    [req.user.id, (page - 1) * 30]);
  const unread = await one('select count(*)::int n from notifications where user_id = $1 and read_at is null', [req.user.id]);
  res.json({ items: rows.slice(0, 30), hasMore: rows.length > 30, unread: unread.n });
}));
customer.get('/notifications/unread-count', requireUser, wrap(async (req, res) => {
  res.json({ unread: (await one('select count(*)::int n from notifications where user_id = $1 and read_at is null', [req.user.id])).n });
}));
customer.post('/notifications/read', requireUser, wrap(async (req, res) => {
  const b = parse(z.object({ ids: z.array(uuid).max(100).optional() }), req.body);
  await query(`update notifications set read_at = now() where user_id = $1 and read_at is null and ($2::uuid[] is null or id = any($2))`, [req.user.id, b.ids ?? null]);
  res.json({ ok: true });
}));

// ───────────── cart ─────────────
async function loadCart(userId) {
  const rows = await many(
    `select ci.product_id, ci.qty, p.name, p.price_paise, p.shop_id, s.name as shop_name, s.slug as shop_slug,
            cp.final_price_paise, cp.in_stock, cp.stock, cp.image_url, cp.pack_quantity, (cp.id is not null) as available
       from cart_items ci join products p on p.id = ci.product_id join shops s on s.id = p.shop_id
       left join catalog_products cp on cp.id = p.id where ci.user_id = $1 order by ci.updated_at desc`, [userId]);
  const items = rows.map((r) => ({ productId: r.product_id, name: r.name, qty: r.qty, shopId: r.shop_id, shopName: r.shop_name, shopSlug: r.shop_slug,
    unitPaise: r.final_price_paise ?? r.price_paise, listPaise: r.price_paise, image: r.image_url, pack: r.pack_quantity, stock: r.stock ?? 0,
    purchasable: !!(r.available && r.in_stock && r.stock >= r.qty), reason: !r.available ? 'unavailable' : !r.in_stock ? 'out_of_stock' : r.stock < r.qty ? 'insufficient_stock' : null }));
  const bySeller = {};
  for (const i of items) { if (i.purchasable) bySeller[i.shopId] = (bySeller[i.shopId] || 0) + i.unitPaise * i.qty; }
  return { items, sellerTotals: bySeller, totalPaise: Object.values(bySeller).reduce((a, b) => a + b, 0) };
}
customer.get('/cart', cust, wrap(async (req, res) => res.json(await loadCart(req.user.id))));
customer.put('/cart/:productId', cust, wrap(async (req, res) => {
  const productId = parse(uuid, req.params.productId);
  const { qty } = parse(z.object({ qty: z.number().int().min(0).max(100) }), req.body);
  if (qty === 0) await query('delete from cart_items where user_id = $1 and product_id = $2', [req.user.id, productId]);
  else {
    const p = await one('select in_stock, stock from catalog_products where id = $1', [productId]);
    if (!p) throw notFound('Product not available');
    if (!p.in_stock) throw conflict('out_of_stock', 'Out of Stock');
    if (qty > p.stock) throw conflict('insufficient_stock', `Only ${p.stock} left`);
    await query(`insert into cart_items (user_id, product_id, qty) values ($1,$2,$3)
                 on conflict (user_id, product_id) do update set qty = excluded.qty, updated_at = now()`, [req.user.id, productId, qty]);
  }
  res.json(await loadCart(req.user.id));
}));

// ───────────── wishlist ─────────────
customer.get('/wishlist', cust, wrap(async (req, res) => {
  res.json({ items: await many(
    `select cp.id, cp.name, cp.pack_quantity, cp.price_paise, cp.discount_price_paise, cp.final_price_paise, cp.in_stock, cp.image_url, cp.shop_name, cp.shop_slug, cp.shop_verified
       from wishlist_items w join catalog_products cp on cp.id = w.product_id where w.user_id = $1 order by w.created_at desc`, [req.user.id]) });
}));
customer.get('/wishlist/ids', cust, wrap(async (req, res) => res.json({ ids: (await many('select product_id from wishlist_items where user_id = $1', [req.user.id])).map((r) => r.product_id) })));
customer.put('/wishlist/:productId', cust, wrap(async (req, res) => {
  await query('insert into wishlist_items (user_id, product_id) select $1, id from products where id = $2 on conflict do nothing', [req.user.id, parse(uuid, req.params.productId)]);
  res.json({ ok: true });
}));
customer.delete('/wishlist/:productId', cust, wrap(async (req, res) => {
  await query('delete from wishlist_items where user_id = $1 and product_id = $2', [req.user.id, parse(uuid, req.params.productId)]);
  res.json({ ok: true });
}));

// ───────────── checkout & payment ─────────────
const checkoutSchema = z.object({
  fulfilment: z.enum(['pickup', 'delivery']),
  contactName: z.string().trim().min(2).max(80),
  contactPhone: z.string().trim().transform((s) => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\+?[0-9]{10,15}$/)),
  address: z.object({ line1: z.string().trim().min(5).max(200), city: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60), pincode: z.string().regex(/^[0-9]{6}$/) }).optional(),
  ageConfirmed: z.literal(true, { errorMap: () => ({ message: 'You must confirm you meet the minimum age' }) }),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: 'Please accept the safety terms' }) }),
}).refine((x) => x.fulfilment === 'pickup' || x.address, { message: 'Delivery address is required', path: ['address'] });

customer.post('/checkout', cust, wrap(async (req, res) => {
  const b = parse(checkoutSchema, req.body);
  res.status(201).json(await createCheckout(req.user, b));
}));
customer.post('/orders/:id/pay', cust, wrap(async (req, res) => res.json(await resumePayment(req.user, parse(uuid, req.params.id)))));

// Server-side verification after the client reports success. The signature is checked, then the
// payment is re-fetched from the gateway; the client's word alone never marks anything paid.
customer.post('/payments/verify', requireUser, wrap(async (req, res) => {
  const b = parse(z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }), req.body);
  if (!rzp.verifyCheckoutSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw badRequest('bad_signature', 'Payment could not be verified');
  const mine = await one(
    `select 1 from payments p left join orders o on o.id = p.order_id left join seller_subscriptions ss on ss.id = p.subscription_id left join shops s on s.id = ss.shop_id
      where p.razorpay_order_id = $1 and (o.customer_id = $2 or s.owner_id = $2)`, [b.razorpay_order_id, req.user.id]);
  if (!mine) throw notFound('Payment not found');
  const p = await rzp.fetchPayment(b.razorpay_payment_id);
  if (p.order_id !== b.razorpay_order_id) throw badRequest('mismatch', 'Payment does not match this order');
  if (p.status !== 'captured') return res.json({ status: p.status, confirmed: false });   // webhook will finish it when captured
  await handlePaymentCaptured(p);
  res.json({ status: 'captured', confirmed: true });
}));

// ───────────── orders ─────────────
customer.get('/orders', cust, wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = await many(
    `select o.id, o.order_number, o.status, o.total_paise, o.fulfilment, o.created_at, o.expires_at,
            (select json_agg(json_build_object('name', oi.name, 'qty', oi.qty, 'image', oi.image_url) order by oi.name)
               from order_items oi join sub_orders so on so.id = oi.sub_order_id where so.order_id = o.id) as items,
            (select json_agg(distinct so.status) from sub_orders so where so.order_id = o.id) as statuses
       from orders o where o.customer_id = $1 and o.status in ('pending_payment','paid','refunded','partially_refunded')
        and (o.status <> 'pending_payment' or o.expires_at > now()) order by o.created_at desc limit 21 offset $2`, [req.user.id, (page - 1) * 20]);
  res.json({ items: rows.slice(0, 20), hasMore: rows.length > 20 });
}));

customer.get('/orders/:id', cust, wrap(async (req, res) => {
  const o = await one('select * from orders where id = $1 and customer_id = $2', [parse(uuid, req.params.id), req.user.id]);
  if (!o) throw notFound('Order not found');
  const subs = await many(
    `select so.id, so.status, so.subtotal_paise, s.name as shop_name, s.slug as shop_slug, s.address as shop_address, s.phone as shop_phone,
            (select json_agg(json_build_object('id', oi.id, 'productId', oi.product_id, 'name', oi.name, 'image', oi.image_url, 'qty', oi.qty, 'unitPaise', oi.unit_price_paise,
               'reviewed', exists(select 1 from reviews r where r.order_item_id = oi.id))) from order_items oi where oi.sub_order_id = so.id) as items,
            (select json_agg(json_build_object('status', e.status, 'at', e.created_at) order by e.id) from sub_order_events e where e.sub_order_id = so.id) as events
       from sub_orders so join shops s on s.id = so.shop_id where so.order_id = $1 order by s.name`, [o.id]);
  res.json({ order: { id: o.id, orderNumber: o.order_number, status: o.status, totalPaise: o.total_paise, fulfilment: o.fulfilment, createdAt: o.created_at,
    paidAt: o.paid_at, expiresAt: o.expires_at, contactName: o.contact_name, contactPhone: o.contact_phone, deliveryAddress: o.delivery_address }, subOrders: subs });
}));

customer.post('/orders/:id/sub-orders/:subId/cancel', cust, wrap(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body);
  await cancelSubOrder(req.user, parse(uuid, req.params.subId), b.reason);
  res.json({ ok: true });
}));

// ───────────── reviews ─────────────
async function refreshRatings(c, productId, shopId) {
  await c.query(`update products set rating_avg = coalesce((select round(avg(rating),2) from reviews where product_id = $1 and status='visible'),0),
                  rating_count = (select count(*) from reviews where product_id = $1 and status='visible') where id = $1`, [productId]);
  await c.query(`update shops set rating_avg = coalesce((select round(avg(rating),2) from reviews where shop_id = $1 and status='visible'),0),
                  rating_count = (select count(*) from reviews where shop_id = $1 and status='visible') where id = $1`, [shopId]);
}
export { refreshRatings };

customer.post('/reviews', cust, wrap(async (req, res) => {
  const b = parse(z.object({ orderItemId: uuid, rating: z.number().int().min(1).max(5), body: z.string().trim().max(1000).default(''), imageUrl: z.string().url().optional() }), req.body);
  if (b.imageUrl && !b.imageUrl.startsWith(`${config.storage.publicBaseUrl}/review/${req.user.id}/`)) throw badRequest('bad_image', 'Invalid image');
  const r = await tx(async (c) => {
    const it = await c.one(
      `select oi.id, oi.product_id, so.shop_id from order_items oi join sub_orders so on so.id = oi.sub_order_id join orders o on o.id = so.order_id
        where oi.id = $1 and o.customer_id = $2 and so.status = 'delivered'`, [b.orderItemId, req.user.id]);
    if (!it) throw new HttpError(403, 'not_reviewable', 'You can review items after they are delivered');
    const row = await c.one(`insert into reviews (product_id, shop_id, order_item_id, customer_id, rating, body, image_url) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [it.product_id, it.shop_id, it.id, req.user.id, b.rating, b.body, b.imageUrl ?? null]);
    await refreshRatings(c, it.product_id, it.shop_id);
    const shop = await c.one('select owner_id from shops where id = $1', [it.shop_id]);
    await notify(shop.owner_id, 'new_review', { rating: b.rating, productId: it.product_id }, {}, c);
    return row;
  });
  res.status(201).json({ id: r.id });
}));
customer.post('/reviews/:id/report', requireUser, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ reason: z.string().trim().max(300).default('') }), req.body);
  const r = await query('insert into review_reports (review_id, reporter_id, reason) values ($1,$2,$3) on conflict do nothing', [id, req.user.id, b.reason]);
  if (r.rowCount) {
    await query('update reviews set report_count = report_count + 1 where id = $1', [id]);
    await notifyAdmin('review_reported', { reviewId: id }, { dedupeKey: `rr:${id}` });
  }
  res.json({ ok: true });
}));

// ───────────── customer care ─────────────
const CATEGORIES = ['order', 'payment', 'product', 'delivery', 'refund', 'seller', 'other'];
customer.get('/support', cust, wrap(async (req, res) => {
  res.json({ items: await many(
    `select c.id, c.category, c.status, c.order_ref, c.created_at, c.last_message_at,
            (select body from support_messages m where m.conversation_id = c.id order by created_at desc limit 1) as last_message
       from support_conversations c where c.customer_id = $1 order by c.last_message_at desc limit 100`, [req.user.id]) });
}));
customer.post('/support', cust, supportLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ category: z.enum(CATEGORIES), orderNumber: z.string().trim().max(30).optional(), message: z.string().trim().min(3).max(3000), imageUrl: z.string().url().optional() }), req.body);
  if (b.imageUrl && !b.imageUrl.startsWith(`${config.storage.publicBaseUrl}/support/${req.user.id}/`)) throw badRequest('bad_image', 'Invalid image');
  let orderId = null;
  if (b.orderNumber) {
    const o = await one('select id from orders where order_number = $1 and customer_id = $2', [b.orderNumber.toUpperCase(), req.user.id]);
    if (!o) throw badRequest('order_not_found', 'We could not find that order ID on your account');
    orderId = o.id;
  }
  const conv = await tx(async (c) => {
    const cv = await c.one(`insert into support_conversations (customer_id, category, order_id, order_ref) values ($1,$2,$3,$4) returning id`, [req.user.id, b.category, orderId, b.orderNumber?.toUpperCase() ?? null]);
    await c.query(`insert into support_messages (conversation_id, sender_id, sender_role, body, image_url) values ($1,$2,'customer',$3,$4)`, [cv.id, req.user.id, b.message, b.imageUrl ?? null]);
    await notifyAdmin('support_new', { conversationId: cv.id, category: b.category, customer: req.user.name }, {}, c);
    return cv;
  });
  res.status(201).json({ id: conv.id });
}));
customer.get('/support/:id', cust, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const c = await one('select id, category, status, order_ref, created_at from support_conversations where id = $1 and customer_id = $2', [id, req.user.id]);
  if (!c) throw notFound('Conversation not found');
  const messages = await many('select id, sender_role, body, image_url, created_at from support_messages where conversation_id = $1 order by created_at', [id]);
  res.json({ conversation: c, messages });
}));
customer.post('/support/:id/messages', cust, supportLimiter, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ message: z.string().trim().min(1).max(3000), imageUrl: z.string().url().optional() }), req.body);
  if (b.imageUrl && !b.imageUrl.startsWith(`${config.storage.publicBaseUrl}/support/${req.user.id}/`)) throw badRequest('bad_image', 'Invalid image');
  await tx(async (c) => {
    const cv = await c.one('select id from support_conversations where id = $1 and customer_id = $2 for update', [id, req.user.id]);
    if (!cv) throw notFound('Conversation not found');
    await c.query(`insert into support_messages (conversation_id, sender_id, sender_role, body, image_url) values ($1,$2,'customer',$3,$4)`, [id, req.user.id, b.message, b.imageUrl ?? null]);
    await c.query(`update support_conversations set last_message_at = now(), status = 'open' where id = $1`, [id]);
    await notifyAdmin('support_message', { conversationId: id, customer: req.user.name }, {}, c);
  });
  res.status(201).json({ ok: true });
}));
