import { Router } from 'express';
import { z } from 'zod';
import { one, many, query, tx } from '../db.js';
import { wrap, parse, HttpError, badRequest, notFound, conflict, forbidden } from '../util/http.js';
import { requireRole } from '../middleware/auth.js';
import { config } from '../config.js';
import * as rzp from '../services/razorpay.js';
import { advanceSubOrder, cancelSubOrder, startSubscriptionPayment, SUB_STATUS_FLOW } from '../services/orders.js';
import { notifyAdmin } from '../services/notify.js';

export const seller = Router();
seller.use('/seller', requireRole('seller'));
const uuid = z.string().uuid();

// Attaches req.shop for every seller route.
seller.use('/seller', wrap(async (req, _res, next) => {
  req.shop = await one(
    `select s.*, c.name as city_name, c.state as city_state from shops s join cities c on c.id = s.city_id where s.owner_id = $1 and s.deleted_at is null`, [req.user.id]);
  if (!req.shop) throw notFound('Shop not found');
  next();
}));

const requireApproved = (req, _res, next) => (req.shop.status === 'approved' ? next()
  : next(forbidden(`Your shop is ${req.shop.status.replace('_', ' ')}. This is available once the admin approves it.`)));

const ownImage = (kind, shopId) => z.string().url().refine((u) => u.startsWith(`${config.storage.publicBaseUrl}/${kind}/${shopId}/`), 'Invalid image');

// ───────────── shop profile ─────────────
async function shopPayload(shop) {
  const [photos, sub] = await Promise.all([
    many('select id, url from shop_photos where shop_id = $1 and deleted_at is null order by sort_order', [shop.id]),
    one(`select status, starts_at, expires_at, amount_paise from seller_subscriptions where shop_id = $1 and status = 'active' and expires_at > now() order by expires_at desc limit 1`, [shop.id]),
  ]);
  const hist = await many('select id, status, amount_paise, starts_at, expires_at, created_at from seller_subscriptions where shop_id = $1 order by created_at desc limit 12', [shop.id]);
  const { razorpay_account_id, ...rest } = shop;
  return { shop: { ...rest, razorpay_linked: !!razorpay_account_id }, photos, subscription: sub, subscriptionHistory: hist,
    live: shop.status === 'approved' && shop.payout_status === 'active' && !!sub };
}
seller.get('/seller/shop', wrap(async (req, res) => res.json(await shopPayload(req.shop))));

seller.patch('/seller/shop', wrap(async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2).max(100).optional(), ownerName: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(1500).optional(), address: z.string().trim().min(10).max(400).optional(),
    pincode: z.string().regex(/^[0-9]{6}$/).optional(), phone: z.string().regex(/^\+?[0-9]{10,15}$/).optional(),
    pickupEnabled: z.boolean().optional(), deliveryEnabled: z.boolean().optional(), logoUrl: ownImage('shop-logos', req.shop.id).nullable().optional(),
  }), req.body);
  if (b.pickupEnabled === false && (b.deliveryEnabled ?? req.shop.delivery_enabled) === false) throw badRequest('no_fulfilment', 'Enable pickup or delivery');
  const resubmit = req.shop.status === 'update_required';
  const s = await one(
    `update shops set name = coalesce($2,name), owner_name = coalesce($3,owner_name), description = coalesce($4,description), address = coalesce($5,address),
       pincode = coalesce($6,pincode), phone = coalesce($7,phone), pickup_enabled = coalesce($8,pickup_enabled), delivery_enabled = coalesce($9,delivery_enabled),
       logo_url = case when $10::boolean then $11 else logo_url end, status = case when $12 then 'pending'::shop_status else status end
     where id = $1 returning *`,
    [req.shop.id, b.name ?? null, b.ownerName ?? null, b.description ?? null, b.address ?? null, b.pincode ?? null, b.phone ?? null,
      b.pickupEnabled ?? null, b.deliveryEnabled ?? null, 'logoUrl' in b, b.logoUrl ?? null, resubmit]);
  if (resubmit) await notifyAdmin('seller_resubmitted', { shop: s.name });
  res.json(await shopPayload({ ...req.shop, ...s }));
}));

seller.post('/seller/shop/photos', wrap(async (req, res) => {
  const b = parse(z.object({ url: ownImage('shop-photos', req.shop.id) }), req.body);
  const n = await one('select count(*)::int n from shop_photos where shop_id = $1 and deleted_at is null', [req.shop.id]);
  if (n.n >= 8) throw badRequest('too_many', 'Up to 8 shop photos');
  const key = b.url.slice(config.storage.publicBaseUrl.length + 1);
  const p = await one('insert into shop_photos (shop_id, url, storage_key, sort_order) values ($1,$2,$3,$4) returning id, url', [req.shop.id, b.url, key, n.n]);
  res.status(201).json(p);
}));
seller.delete('/seller/shop/photos/:id', wrap(async (req, res) => {
  await query('update shop_photos set deleted_at = now() where id = $1 and shop_id = $2', [parse(uuid, req.params.id), req.shop.id]);
  res.json({ ok: true });
}));

// ───────────── subscription & payout onboarding ─────────────
seller.post('/seller/subscription/pay', requireApproved, wrap(async (req, res) => res.status(201).json(await startSubscriptionPayment(req.user, req.shop))));

seller.post('/seller/payout/onboard', requireApproved, wrap(async (req, res) => {
  if (req.shop.razorpay_account_id) throw conflict('already_linked', 'Payout account already linked');
  const b = parse(z.object({
    legalName: z.string().trim().min(2).max(120), businessType: z.enum(['individual', 'proprietorship', 'partnership', 'private_limited', 'llp']),
    pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN'), gst: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/).optional(),
    accountNumber: z.string().regex(/^[0-9]{6,20}$/), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), beneficiaryName: z.string().trim().min(2).max(120),
  }), req.body);
  // Bank/PAN details are forwarded to the payment provider and never written to our database.
  const acc = await rzp.createLinkedAccount(req.shop, b);
  await query(`update shops set razorpay_account_id = $2, payout_status = 'pending' where id = $1`, [req.shop.id, acc.id]);
  res.status(201).json({ payoutStatus: 'pending' });
}));
seller.get('/seller/payout/status', wrap(async (req, res) => {
  if (!req.shop.razorpay_account_id) return res.json({ payoutStatus: req.shop.payout_status });
  const acc = await rzp.fetchAccount(req.shop.razorpay_account_id);
  const map = { activated: 'active', instantly_activated: 'active', needs_clarification: 'needs_clarification', rejected: 'rejected', suspended: 'rejected' };
  const st = map[acc.status] ?? 'pending';
  if (st !== req.shop.payout_status) await query('update shops set payout_status = $2 where id = $1', [req.shop.id, st]);
  res.json({ payoutStatus: st });
}));

// ───────────── products ─────────────
const productBody = (shopId) => z.object({
  name: z.string().trim().min(2).max(120), description: z.string().trim().max(3000).default(''), packQuantity: z.string().trim().max(80).default(''),
  categoryId: z.number().int(), pricePaise: z.number().int().min(100).max(10_000_000), discountPricePaise: z.number().int().min(100).nullable().optional(),
  stock: z.number().int().min(0).max(1_000_000), isAvailable: z.boolean().default(true), safetyNote: z.string().trim().max(500).default(''),
  images: z.array(ownImage('products', shopId)).min(1, 'Add at least one photo').max(8),
}).refine((x) => x.discountPricePaise == null || x.discountPricePaise < x.pricePaise, { message: 'Discount price must be lower than price', path: ['discountPricePaise'] });

const sellerProduct = `select p.*, c.name_en, c.name_ta, c.name_hi,
  (select coalesce(json_agg(url order by sort_order), '[]') from product_images i where i.product_id = p.id and i.deleted_at is null) as images from products p join categories c on c.id = p.category_id`;

seller.get('/seller/products', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json({ items: await many(`${sellerProduct} where p.shop_id = $1 and p.deleted_at is null and ($2 = '' or p.name ilike '%' || $2 || '%') order by p.created_at desc limit 300`, [req.shop.id, q]) });
}));
seller.get('/seller/products/:id', wrap(async (req, res) => {
  const p = await one(`${sellerProduct} where p.id = $1 and p.shop_id = $2 and p.deleted_at is null`, [parse(uuid, req.params.id), req.shop.id]);
  if (!p) throw notFound('Product not found');
  res.json({ product: p });
}));

async function setImages(c, productId, shopId, urls) {
  await c.query('update product_images set deleted_at = now() where product_id = $1 and deleted_at is null', [productId]);
  for (const [i, u] of urls.entries()) {
    await c.query('insert into product_images (product_id, url, storage_key, sort_order) values ($1,$2,$3,$4)', [productId, u, u.slice(config.storage.publicBaseUrl.length + 1), i]);
  }
}

seller.post('/seller/products', requireApproved, wrap(async (req, res) => {
  const b = parse(productBody(req.shop.id), req.body);
  const id = await tx(async (c) => {
    const p = await c.one(
      `insert into products (shop_id, category_id, name, description, pack_quantity, price_paise, discount_price_paise, stock, is_available, safety_note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [req.shop.id, b.categoryId, b.name, b.description, b.packQuantity, b.pricePaise, b.discountPricePaise ?? null, b.stock, b.isAvailable, b.safetyNote]);
    await setImages(c, p.id, req.shop.id, b.images);
    await notifyAdmin('product_pending', { name: b.name, shop: req.shop.name }, {}, c);
    return p.id;
  });
  res.status(201).json({ id });
}));

seller.put('/seller/products/:id', requireApproved, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(productBody(req.shop.id), req.body);
  await tx(async (c) => {
    const cur = await c.one('select * from products where id = $1 and shop_id = $2 and deleted_at is null for update', [id, req.shop.id]);
    if (!cur) throw notFound('Product not found');
    const oldImages = (await c.many('select url from product_images where product_id = $1 and deleted_at is null order by sort_order', [id])).map((r) => r.url);
    const contentChanged = cur.name !== b.name || cur.description !== b.description || cur.category_id !== b.categoryId || JSON.stringify(oldImages) !== JSON.stringify(b.images);
    await c.query(
      `update products set category_id=$2, name=$3, description=$4, pack_quantity=$5, price_paise=$6, discount_price_paise=$7, stock=$8, is_available=$9, safety_note=$10,
         approval_status = case when $11 then 'pending' else approval_status end, rejection_note = case when $11 then null else rejection_note end where id = $1`,
      [id, b.categoryId, b.name, b.description, b.packQuantity, b.pricePaise, b.discountPricePaise ?? null, b.stock, b.isAvailable, b.safetyNote, contentChanged]);
    if (contentChanged) { await setImages(c, id, req.shop.id, b.images); await notifyAdmin('product_pending', { name: b.name, shop: req.shop.name }, { dedupeKey: `pp:${id}:${Date.now() / 3600000 | 0}` }, c); }
  });
  res.json({ ok: true });
}));

// Quick stock control: relative (+/-) or absolute. Never drops below zero.
seller.patch('/seller/products/:id/stock', wrap(async (req, res) => {
  const b = parse(z.object({ delta: z.number().int().min(-10000).max(10000).optional(), set: z.number().int().min(0).max(1_000_000).optional() })
    .refine((x) => (x.delta === undefined) !== (x.set === undefined), 'Provide delta or set'), req.body);
  const r = await one(
    `update products set stock = case when $3::int is not null then $3 else greatest(stock + $4, 0) end
      where id = $1 and shop_id = $2 and deleted_at is null returning id, stock`, [parse(uuid, req.params.id), req.shop.id, b.set ?? null, b.delta ?? 0]);
  if (!r) throw notFound('Product not found');
  res.json(r);
}));
seller.patch('/seller/products/:id/availability', wrap(async (req, res) => {
  const b = parse(z.object({ isAvailable: z.boolean() }), req.body);
  const r = await one('update products set is_available = $3 where id = $1 and shop_id = $2 and deleted_at is null returning id', [parse(uuid, req.params.id), req.shop.id, b.isAvailable]);
  if (!r) throw notFound('Product not found');
  res.json({ ok: true });
}));
seller.delete('/seller/products/:id', wrap(async (req, res) => {   // soft delete: order history keeps its product reference
  const r = await query('update products set deleted_at = now(), is_available = false where id = $1 and shop_id = $2 and deleted_at is null', [parse(uuid, req.params.id), req.shop.id]);
  if (!r.rowCount) throw notFound('Product not found');
  res.json({ ok: true });
}));

// ───────────── orders ─────────────
seller.get('/seller/orders', wrap(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = await many(
    `select so.id, so.status, so.subtotal_paise, so.commission_paise, so.seller_amount_paise, so.created_at, o.order_number, o.fulfilment, o.contact_name,
            (select json_agg(json_build_object('name', oi.name, 'qty', oi.qty)) from order_items oi where oi.sub_order_id = so.id) as items
       from sub_orders so join orders o on o.id = so.order_id
      where so.shop_id = $1 and o.status in ('paid','refunded','partially_refunded') and ($2::text is null or so.status = $2)
      order by so.created_at desc limit 21 offset $3`, [req.shop.id, status, (page - 1) * 20]);
  res.json({ items: rows.slice(0, 20), hasMore: rows.length > 20 });
}));
seller.get('/seller/orders/:id', wrap(async (req, res) => {
  const so = await one(
    `select so.*, o.order_number, o.fulfilment, o.contact_name, o.contact_phone, o.delivery_address, o.paid_at
       from sub_orders so join orders o on o.id = so.order_id where so.id = $1 and so.shop_id = $2 and o.status in ('paid','refunded','partially_refunded')`, [parse(uuid, req.params.id), req.shop.id]);
  if (!so) throw notFound('Order not found');
  const [items, events] = await Promise.all([
    many('select id, product_id, name, image_url, unit_price_paise, qty, line_total_paise from order_items where sub_order_id = $1', [so.id]),
    many('select status, note, created_at from sub_order_events where sub_order_id = $1 order by id', [so.id]),
  ]);
  res.json({ order: so, items, events, nextStatuses: SUB_STATUS_FLOW[so.fulfilment][so.status] ?? [] });
}));
seller.post('/seller/orders/:id/status', wrap(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['accepted', 'preparing', 'ready', 'dispatched', 'out_for_delivery', 'delivered']), note: z.string().trim().max(300).optional() }), req.body);
  await advanceSubOrder(req.user, parse(uuid, req.params.id), b.status, b.note);
  res.json({ ok: true });
}));
seller.post('/seller/orders/:id/cancel', wrap(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  await cancelSubOrder(req.user, parse(uuid, req.params.id), b.reason);
  res.json({ ok: true });
}));

// ───────────── dashboard, settlements, offers, reviews ─────────────
seller.get('/seller/dashboard', wrap(async (req, res) => {
  const sid = req.shop.id;
  const [byStatus, sales, low, sub] = await Promise.all([
    many(`select so.status, count(*)::int n from sub_orders so join orders o on o.id = so.order_id where so.shop_id = $1 and o.status in ('paid','partially_refunded') group by so.status`, [sid]),
    one(`select coalesce(sum(subtotal_paise) filter (where so.status <> 'cancelled'), 0) as total, coalesce(sum(subtotal_paise) filter (where so.status <> 'cancelled' and so.created_at >= date_trunc('day', now())), 0) as today,
                coalesce(sum(subtotal_paise) filter (where so.status <> 'cancelled' and so.created_at >= date_trunc('month', now())), 0) as month,
                coalesce(sum(commission_paise) filter (where so.status <> 'cancelled'), 0) as commission, coalesce(sum(seller_amount_paise) filter (where so.status <> 'cancelled'), 0) as net
           from sub_orders so join orders o on o.id = so.order_id where so.shop_id = $1 and o.status in ('paid','partially_refunded','refunded')`, [sid]),
    many(`select id, name, stock from products where shop_id = $1 and deleted_at is null and stock <= 5 order by stock, name limit 20`, [sid]),
    one(`select max(expires_at) as expires_at from seller_subscriptions where shop_id = $1 and status = 'active'`, [sid]),
  ]);
  const daily = await many(
    `select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(so.subtotal_paise) filter (where so.status <> 'cancelled'), 0)::int as paise
       from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), '1 day') d
       left join sub_orders so on so.shop_id = $1 and date_trunc('day', so.created_at) = d and so.order_id in (select id from orders where status in ('paid','partially_refunded'))
      group by d order by d`, [sid]);
  res.json({ byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), sales, lowStock: low, subscriptionExpiresAt: sub?.expires_at ?? null,
    shopStatus: req.shop.status, payoutStatus: req.shop.payout_status, rating: { avg: req.shop.rating_avg, count: req.shop.rating_count }, daily });
}));
seller.get('/seller/settlements', wrap(async (req, res) => {
  const [items, totals] = await Promise.all([
    many(`select st.id, st.status, st.gross_paise, st.commission_paise, st.net_paise, st.released_at, st.settled_at, st.created_at, o.order_number
            from settlements st join sub_orders so on so.id = st.sub_order_id join orders o on o.id = so.order_id where st.shop_id = $1 order by st.created_at desc limit 100`, [req.shop.id]),
    one(`select coalesce(sum(net_paise) filter (where status in ('on_hold','pending')),0)::int as pending, coalesce(sum(net_paise) filter (where status in ('released','settled')),0)::int as paid from settlements where shop_id = $1`, [req.shop.id]),
  ]);
  res.json({ items, totals });
}));
seller.get('/seller/offers', wrap(async (req, res) => res.json({ items: await many(
  `select o.*, p.name as product_name from offers o left join products p on p.id = o.product_id where o.shop_id = $1 order by o.created_at desc limit 100`, [req.shop.id]) })));
seller.post('/seller/offers', requireApproved, wrap(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(3).max(100), description: z.string().trim().max(300).default(''), discountPercent: z.number().int().min(1).max(90),
    productId: uuid.nullable().optional(), endsAt: z.coerce.date().refine((d) => d > new Date(), 'Must end in the future') }), req.body);
  if (b.productId && !(await one('select 1 from products where id = $1 and shop_id = $2', [b.productId, req.shop.id]))) throw notFound('Product not found');
  const o = await one(`insert into offers (shop_id, product_id, title, description, discount_percent, ends_at, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [req.shop.id, b.productId ?? null, b.title, b.description, b.discountPercent, b.endsAt, req.user.id]);
  res.status(201).json(o);
}));
seller.delete('/seller/offers/:id', wrap(async (req, res) => {
  await query('update offers set is_active = false where id = $1 and shop_id = $2', [parse(uuid, req.params.id), req.shop.id]);
  res.json({ ok: true });
}));
seller.get('/seller/reviews', wrap(async (req, res) => res.json({ items: await many(
  `select r.id, r.rating, r.body, r.image_url, r.created_at, r.status, p.name as product_name, split_part(u.name,' ',1) as reviewer
     from reviews r join products p on p.id = r.product_id join users u on u.id = r.customer_id where r.shop_id = $1 and r.status = 'visible' order by r.created_at desc limit 100`, [req.shop.id]) })));
