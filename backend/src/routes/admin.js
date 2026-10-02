import { Router } from 'express';
import { z } from 'zod';
import { one, many, query, tx, getSetting } from '../db.js';
import { wrap, parse, badRequest, notFound, HttpError } from '../util/http.js';
import { requireRole } from '../middleware/auth.js';
import { notify } from '../services/notify.js';
import { audit } from '../services/audit.js';
import { cancelSubOrder } from '../services/orders.js';
import { refreshRatings } from './customer.js';

export const admin = Router();
admin.use('/admin', (req, res, next) => (req.path.startsWith('/setup') || req.path === '/login' ? next() : requireRole('admin')(req, res, next)));
// (setup/login/2fa/password live in routes/auth.js; everything else under /admin requires the admin role)

const uuid = z.string().uuid();
const pageOf = (req) => ({ page: Math.max(1, Number(req.query.page) || 1), q: String(req.query.q || '').trim().slice(0, 80) });
const paged = (rows, limit = 30) => ({ items: rows.slice(0, limit), hasMore: rows.length > limit });

// ───────────── analytics ─────────────
admin.get('/admin/dashboard', wrap(async (_req, res) => {
  const [counts, money, subRev, support, daily] = await Promise.all([
    one(`select (select count(*)::int from users where role = 'customer' and deleted_at is null) customers,
                (select count(*)::int from shops where deleted_at is null) sellers,
                (select count(*)::int from live_shops) active_sellers,
                (select count(*)::int from shops where status = 'pending' and deleted_at is null) pending_sellers,
                (select count(*)::int from products where deleted_at is null) products,
                (select count(*)::int from products where approval_status = 'pending' and deleted_at is null) pending_products,
                (select count(*)::int from orders where status in ('paid','refunded','partially_refunded')) orders_total,
                (select count(*)::int from orders where status = 'paid') successful_orders`),
    one(`select coalesce(sum(so.subtotal_paise),0)::bigint sales, coalesce(sum(so.commission_paise),0)::bigint commission
           from sub_orders so join orders o on o.id = so.order_id where o.status in ('paid','partially_refunded') and so.status <> 'cancelled'`),
    one(`select coalesce(sum(amount_paise),0)::bigint revenue from payments where purpose = 'subscription' and status = 'captured'`),
    one(`select count(*) filter (where status = 'open')::int open_tickets, count(*) filter (where status = 'pending')::int pending_tickets, count(*) filter (where status = 'resolved')::int resolved_tickets from support_conversations`),
    many(`select to_char(d,'YYYY-MM-DD') as day, coalesce(sum(so.subtotal_paise) filter (where so.status <> 'cancelled'),0)::int as sales
            from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), '1 day') d
            left join sub_orders so on date_trunc('day', so.created_at) = d and so.order_id in (select id from orders where status in ('paid','partially_refunded'))
           group by d order by d`),
  ]);
  const st = await one(`select coalesce(sum(net_paise) filter (where status in ('released','settled')),0)::bigint settled, coalesce(sum(net_paise) filter (where status in ('pending','on_hold')),0)::bigint pending from settlements`);
  res.json({ ...counts, salesPaise: money.sales, commissionPaise: money.commission, settledPaise: st.settled, pendingSettlementPaise: st.pending,
    subscriptionRevenuePaise: subRev.revenue, ...support, daily });
}));

// ───────────── sellers ─────────────
admin.get('/admin/sellers', wrap(async (req, res) => {
  const { page, q } = pageOf(req); const status = req.query.status ? String(req.query.status) : null;
  const rows = await many(
    `select s.id, s.name, s.owner_name, s.phone, s.email, s.status, s.payout_status, s.verified_at, s.created_at,
            (select max(expires_at) from seller_subscriptions ss where ss.shop_id = s.id and ss.status = 'active') as subscription_expires_at,
            (select count(*)::int from products p where p.shop_id = s.id and p.deleted_at is null) as products
       from shops s where s.deleted_at is null and ($1::text is null or s.status::text = $1) and ($2 = '' or s.name ilike '%' || $2 || '%' or s.phone like '%' || $2 || '%')
      order by (s.status = 'pending') desc, s.created_at desc limit 31 offset $3`, [status, q, (page - 1) * 30]);
  res.json(paged(rows));
}));
admin.get('/admin/sellers/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const shop = await one(`select s.*, c.name as city_name from shops s join cities c on c.id = s.city_id where s.id = $1`, [id]);
  if (!shop) throw notFound('Seller not found');
  const { razorpay_account_id, ...safe } = shop;
  const [photos, subs, sales, settle, products] = await Promise.all([
    many('select url from shop_photos where shop_id = $1 and deleted_at is null order by sort_order', [id]),
    many('select id, status, amount_paise, starts_at, expires_at, created_at from seller_subscriptions where shop_id = $1 order by created_at desc', [id]),
    one(`select count(*)::int orders, coalesce(sum(subtotal_paise) filter (where so.status <> 'cancelled'),0)::bigint sales, coalesce(sum(commission_paise) filter (where so.status <> 'cancelled'),0)::bigint commission
           from sub_orders so join orders o on o.id = so.order_id where so.shop_id = $1 and o.status in ('paid','partially_refunded','refunded')`, [id]),
    one(`select coalesce(sum(net_paise) filter (where status in ('released','settled')),0)::bigint paid, coalesce(sum(net_paise) filter (where status in ('pending','on_hold')),0)::bigint pending from settlements where shop_id = $1`, [id]),
    many('select id, name, price_paise, stock, approval_status, is_available from products where shop_id = $1 and deleted_at is null order by created_at desc limit 100', [id]),
  ]);
  res.json({ shop: { ...safe, razorpay_linked: !!razorpay_account_id }, photos: photos.map((p) => p.url), subscriptions: subs, sales, settlements: settle, products });
}));
admin.post('/admin/sellers/:id/status', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ status: z.enum(['approved', 'rejected', 'update_required', 'suspended']), note: z.string().trim().max(500).optional() })
    .refine((x) => x.status !== 'update_required' || x.note, { message: 'Tell the seller what to update', path: ['note'] }), req.body);
  await tx(async (c) => {
    const s = await c.one(`update shops set status = $2::shop_status, status_note = $3, verified_at = case when $2::text = 'approved' then coalesce(verified_at, now()) else verified_at end where id = $1 returning owner_id, name`, [id, b.status, b.note ?? null]);
    if (!s) throw notFound('Seller not found');
    await notify(s.owner_id, 'shop_status', { status: b.status, note: b.note ?? null, shop: s.name }, {}, c);
    await audit(req, `seller.${b.status}`, 'shop', id, { note: b.note }, c);
    if (b.status === 'suspended') await c.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [s.owner_id]);
  });
  res.json({ ok: true });
}));
admin.post('/admin/sellers/:id/verified', wrap(async (req, res) => {
  const b = parse(z.object({ verified: z.boolean() }), req.body); const id = parse(uuid, req.params.id);
  await query('update shops set verified_at = case when $2 then coalesce(verified_at, now()) else null end where id = $1', [id, b.verified]);
  await audit(req, 'seller.verified', 'shop', id, b);
  res.json({ ok: true });
}));

// ───────────── customers ─────────────
admin.get('/admin/customers', wrap(async (req, res) => {
  const { page, q } = pageOf(req);
  res.json(paged(await many(
    `select u.id, u.name, u.email, u.phone, u.status, u.created_at, u.phone_verified_at,
            (select count(*)::int from orders o where o.customer_id = u.id and o.status in ('paid','refunded','partially_refunded')) as orders
       from users u where u.role = 'customer' and u.deleted_at is null and ($1 = '' or u.name ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%' or u.phone like '%' || $1 || '%')
      order by u.created_at desc limit 31 offset $2`, [q, (page - 1) * 30])));
}));
admin.post('/admin/customers/:id/block', wrap(async (req, res) => {
  const b = parse(z.object({ blocked: z.boolean() }), req.body); const id = parse(uuid, req.params.id);
  const r = await query(`update users set status = $2 where id = $1 and role = 'customer'`, [id, b.blocked ? 'blocked' : 'active']);
  if (!r.rowCount) throw notFound('Customer not found');
  if (b.blocked) await query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [id]);
  await audit(req, b.blocked ? 'customer.blocked' : 'customer.unblocked', 'user', id);
  res.json({ ok: true });
}));

// ───────────── products & categories ─────────────
admin.get('/admin/products', wrap(async (req, res) => {
  const { page, q } = pageOf(req); const st = req.query.status ? String(req.query.status) : null; const shop = req.query.shop ? parse(uuid, req.query.shop) : null;
  res.json(paged(await many(
    `select p.id, p.name, p.price_paise, p.discount_price_paise, p.stock, p.approval_status, p.is_available, p.is_featured, p.hidden_by_admin, p.created_at, s.name as shop_name, c.name_en as category,
            (select url from product_images i where i.product_id = p.id and i.deleted_at is null order by sort_order limit 1) as image_url
       from products p join shops s on s.id = p.shop_id join categories c on c.id = p.category_id
      where p.deleted_at is null and ($1::text is null or p.approval_status = $1) and ($2::uuid is null or p.shop_id = $2) and ($3 = '' or p.name ilike '%' || $3 || '%')
      order by (p.approval_status = 'pending') desc, p.created_at desc limit 31 offset $4`, [st, shop, q, (page - 1) * 30])));
}));
admin.post('/admin/products/:id/approval', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() }), req.body);
  await tx(async (c) => {
    const p = await c.one('update products set approval_status = $2, rejection_note = $3 where id = $1 and deleted_at is null returning name, shop_id', [id, b.status, b.note ?? null]);
    if (!p) throw notFound('Product not found');
    const s = await c.one('select owner_id from shops where id = $1', [p.shop_id]);
    await notify(s.owner_id, 'product_' + b.status, { name: p.name, note: b.note ?? null }, {}, c);
    await audit(req, `product.${b.status}`, 'product', id, { note: b.note }, c);
  });
  res.json({ ok: true });
}));
admin.patch('/admin/products/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ isFeatured: z.boolean().optional(), hiddenByAdmin: z.boolean().optional() }), req.body);
  const r = await query('update products set is_featured = coalesce($2,is_featured), hidden_by_admin = coalesce($3,hidden_by_admin) where id = $1', [id, b.isFeatured ?? null, b.hiddenByAdmin ?? null]);
  if (!r.rowCount) throw notFound('Product not found');
  await audit(req, 'product.update', 'product', id, b);
  res.json({ ok: true });
}));
admin.delete('/admin/products/:id', wrap(async (req, res) => {   // soft remove — order history is preserved
  const id = parse(uuid, req.params.id);
  await query('update products set deleted_at = now(), is_available = false where id = $1 and deleted_at is null', [id]);
  await audit(req, 'product.removed', 'product', id);
  res.json({ ok: true });
}));

const catBody = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,50}$/), nameEn: z.string().trim().min(2).max(60), nameTa: z.string().trim().min(1).max(80), nameHi: z.string().trim().min(1).max(80), sortOrder: z.number().int().default(0), isActive: z.boolean().default(true) });
admin.get('/admin/categories', wrap(async (_req, res) => res.json({ items: await many('select * from categories where deleted_at is null order by sort_order, id') })));
admin.post('/admin/categories', wrap(async (req, res) => {
  const b = parse(catBody, req.body);
  const c = await one('insert into categories (slug, name_en, name_ta, name_hi, sort_order, is_active) values ($1,$2,$3,$4,$5,$6) returning id', [b.slug, b.nameEn, b.nameTa, b.nameHi, b.sortOrder, b.isActive]);
  await audit(req, 'category.created', 'category', c.id, b);
  res.status(201).json(c);
}));
admin.put('/admin/categories/:id', wrap(async (req, res) => {
  const b = parse(catBody, req.body);
  const r = await query('update categories set slug=$2, name_en=$3, name_ta=$4, name_hi=$5, sort_order=$6, is_active=$7 where id = $1 and deleted_at is null', [Number(req.params.id), b.slug, b.nameEn, b.nameTa, b.nameHi, b.sortOrder, b.isActive]);
  if (!r.rowCount) throw notFound('Category not found');
  await audit(req, 'category.updated', 'category', req.params.id, b);
  res.json({ ok: true });
}));
admin.delete('/admin/categories/:id', wrap(async (req, res) => {
  await query('update categories set deleted_at = now(), is_active = false where id = $1', [Number(req.params.id)]);
  await audit(req, 'category.removed', 'category', req.params.id);
  res.json({ ok: true });
}));

// ───────────── orders, payments, commission, settlements, subscriptions ─────────────
admin.get('/admin/orders', wrap(async (req, res) => {
  const { page, q } = pageOf(req); const st = req.query.status ? String(req.query.status) : null; const shop = req.query.shop ? parse(uuid, req.query.shop) : null;
  res.json(paged(await many(
    `select o.id, o.order_number, o.status, o.total_paise, o.fulfilment, o.created_at, u.name as customer, u.phone as customer_phone,
            (select json_agg(json_build_object('id', so.id, 'shop', s.name, 'status', so.status, 'subtotal', so.subtotal_paise, 'commission', so.commission_paise)) from sub_orders so join shops s on s.id = so.shop_id where so.order_id = o.id) as subs
       from orders o join users u on u.id = o.customer_id
      where ($1::text is null or o.status = $1) and ($2 = '' or o.order_number ilike $2 || '%' or u.name ilike '%' || $2 || '%')
        and ($3::uuid is null or exists (select 1 from sub_orders so where so.order_id = o.id and so.shop_id = $3))
      order by o.created_at desc limit 31 offset $4`, [st, q, shop, (page - 1) * 30])));
}));
admin.get('/admin/orders/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const o = await one(`select o.*, u.name as customer_name, u.email as customer_email from orders o join users u on u.id = o.customer_id where o.id = $1`, [id]);
  if (!o) throw notFound('Order not found');
  const [subs, payments, refunds] = await Promise.all([
    many(`select so.*, s.name as shop_name, (select json_agg(row_to_json(oi)) from order_items oi where oi.sub_order_id = so.id) as items,
                 (select json_agg(json_build_object('status', e.status, 'note', e.note, 'at', e.created_at) order by e.id) from sub_order_events e where e.sub_order_id = so.id) as events,
                 (select row_to_json(st) from settlements st where st.sub_order_id = so.id) as settlement
            from sub_orders so join shops s on s.id = so.shop_id where so.order_id = $1`, [id]),
    many('select id, purpose, razorpay_payment_id, amount_paise, method, status, failure_reason, created_at from payments where order_id = $1 order by created_at', [id]),
    many('select id, amount_paise, status, reason, created_at from refunds where order_id = $1 order by created_at', [id]),
  ]);
  res.json({ order: o, subOrders: subs, payments, refunds });
}));
admin.post('/admin/sub-orders/:id/refund', wrap(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const id = parse(uuid, req.params.id);
  await cancelSubOrder(req.user, id, b.reason);
  await audit(req, 'suborder.refunded', 'sub_order', id, b);
  res.json({ ok: true });
}));
admin.get('/admin/payments', wrap(async (req, res) => {
  const { page } = pageOf(req); const st = req.query.status ? String(req.query.status) : null; const purpose = req.query.purpose ? String(req.query.purpose) : null;
  res.json(paged(await many(
    `select p.id, p.purpose, p.razorpay_order_id, p.razorpay_payment_id, p.amount_paise, p.method, p.status, p.failure_reason, p.created_at, o.order_number, s.name as shop_name
       from payments p left join orders o on o.id = p.order_id left join seller_subscriptions ss on ss.id = p.subscription_id left join shops s on s.id = ss.shop_id
      where ($1::text is null or p.status = $1) and ($2::text is null or p.purpose = $2) order by p.created_at desc limit 31 offset $3`, [st, purpose, (page - 1) * 30])));
}));
admin.get('/admin/commissions', wrap(async (_req, res) => {
  const byShop = await many(
    `select s.id, s.name, count(*)::int orders, sum(so.subtotal_paise)::bigint gross, sum(so.commission_paise)::bigint commission, sum(so.seller_amount_paise)::bigint net
       from sub_orders so join orders o on o.id = so.order_id join shops s on s.id = so.shop_id
      where o.status in ('paid','partially_refunded') and so.status <> 'cancelled' group by s.id order by commission desc limit 200`);
  res.json({ commissionBps: await getSetting('commission_bps', 500), byShop });
}));
admin.get('/admin/settlements', wrap(async (req, res) => {
  const { page } = pageOf(req); const st = req.query.status ? String(req.query.status) : null;
  res.json(paged(await many(
    `select st.id, st.status, st.gross_paise, st.commission_paise, st.net_paise, st.released_at, st.created_at, s.name as shop_name, o.order_number
       from settlements st join shops s on s.id = st.shop_id join sub_orders so on so.id = st.sub_order_id join orders o on o.id = so.order_id
      where ($1::text is null or st.status = $1) order by st.created_at desc limit 31 offset $2`, [st, (page - 1) * 30])));
}));
admin.get('/admin/subscriptions', wrap(async (req, res) => {
  const { page } = pageOf(req);
  res.json(paged(await many(
    `select ss.id, ss.status, ss.amount_paise, ss.starts_at, ss.expires_at, ss.created_at, s.name as shop_name, s.id as shop_id
       from seller_subscriptions ss join shops s on s.id = ss.shop_id order by ss.created_at desc limit 31 offset $1`, [(page - 1) * 30])));
}));

// ───────────── customer support inbox ─────────────
admin.get('/admin/support', wrap(async (req, res) => {
  const { page, q } = pageOf(req); const st = req.query.status ? String(req.query.status) : null; const cat = req.query.category ? String(req.query.category) : null;
  res.json(paged(await many(
    `select c.id, c.category, c.status, c.order_ref, c.created_at, c.last_message_at, u.name as customer_name, u.phone as customer_phone, u.email as customer_email,
            (select body from support_messages m where m.conversation_id = c.id order by created_at desc limit 1) as last_message,
            (select sender_role from support_messages m where m.conversation_id = c.id order by created_at desc limit 1) as last_sender
       from support_conversations c join users u on u.id = c.customer_id
      where ($1::text is null or c.status = $1) and ($2::text is null or c.category = $2) and ($3 = '' or u.name ilike '%' || $3 || '%' or c.order_ref ilike $3 || '%')
      order by (c.status = 'open') desc, c.last_message_at desc limit 31 offset $4`, [st, cat, q, (page - 1) * 30])));
}));
admin.get('/admin/support/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const c = await one(`select c.*, u.name as customer_name, u.phone as customer_phone, u.email as customer_email from support_conversations c join users u on u.id = c.customer_id where c.id = $1`, [id]);
  if (!c) throw notFound('Conversation not found');
  res.json({ conversation: c, messages: await many('select id, sender_role, body, image_url, created_at from support_messages where conversation_id = $1 order by created_at', [id]) });
}));
admin.post('/admin/support/:id/reply', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ message: z.string().trim().min(1).max(3000), imageUrl: z.string().url().optional(), status: z.enum(['open', 'pending', 'resolved']).default('pending') }), req.body);
  await tx(async (c) => {
    const cv = await c.one('select id, customer_id from support_conversations where id = $1 for update', [id]);
    if (!cv) throw notFound('Conversation not found');
    await c.query(`insert into support_messages (conversation_id, sender_id, sender_role, body, image_url) values ($1,$2,'admin',$3,$4)`, [id, req.user.id, b.message, b.imageUrl ?? null]);
    await c.query('update support_conversations set last_message_at = now(), status = $2 where id = $1', [id, b.status]);
    await notify(cv.customer_id, 'support_reply', { conversationId: id }, {}, c);
    await audit(req, 'support.reply', 'support', id, {}, c);
  });
  res.status(201).json({ ok: true });
}));
admin.post('/admin/support/:id/status', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ status: z.enum(['open', 'pending', 'resolved']) }), req.body);
  const cv = await one('update support_conversations set status = $2 where id = $1 returning customer_id', [id, b.status]);
  if (!cv) throw notFound('Conversation not found');
  if (b.status === 'resolved') await notify(cv.customer_id, 'support_resolved', { conversationId: id });
  await audit(req, 'support.status', 'support', id, b);
  res.json({ ok: true });
}));

// ───────────── reviews moderation ─────────────
admin.get('/admin/reviews', wrap(async (req, res) => {
  const { page } = pageOf(req); const f = String(req.query.filter || 'reported');
  res.json(paged(await many(
    `select r.id, r.rating, r.body, r.image_url, r.status, r.report_count, r.created_at, p.name as product_name, s.name as shop_name, u.name as reviewer
       from reviews r join products p on p.id = r.product_id join shops s on s.id = r.shop_id join users u on u.id = r.customer_id
      where ($1 = 'all' or ($1 = 'reported' and r.report_count > 0 and r.status = 'visible') or ($1 = 'hidden' and r.status = 'hidden'))
      order by r.report_count desc, r.created_at desc limit 31 offset $2`, [f, (page - 1) * 30])));
}));
admin.post('/admin/reviews/:id/status', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id); const b = parse(z.object({ status: z.enum(['visible', 'hidden']) }), req.body);
  await tx(async (c) => {
    const r = await c.one('update reviews set status = $2 where id = $1 returning product_id, shop_id', [id, b.status]);
    if (!r) throw notFound('Review not found');
    await refreshRatings(c, r.product_id, r.shop_id);
    await audit(req, `review.${b.status}`, 'review', id, {}, c);
  });
  res.json({ ok: true });
}));

// ───────────── offers, banners, broadcast, settings, audit ─────────────
admin.get('/admin/offers', wrap(async (_req, res) => res.json({ items: await many(
  `select o.*, s.name as shop_name from offers o left join shops s on s.id = o.shop_id order by o.created_at desc limit 200`) })));
admin.post('/admin/offers', wrap(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(3).max(100), description: z.string().trim().max(300).default(''), discountPercent: z.number().int().min(1).max(90), endsAt: z.coerce.date().refine((d) => d > new Date()) }), req.body);
  const o = await one('insert into offers (title, description, discount_percent, ends_at, created_by) values ($1,$2,$3,$4,$5) returning id', [b.title, b.description, b.discountPercent, b.endsAt, req.user.id]);
  await audit(req, 'offer.created', 'offer', o.id, b);
  res.status(201).json(o);
}));
admin.post('/admin/offers/:id/active', wrap(async (req, res) => {
  const b = parse(z.object({ active: z.boolean() }), req.body); const id = parse(uuid, req.params.id);
  await query('update offers set is_active = $2 where id = $1', [id, b.active]);
  await audit(req, 'offer.active', 'offer', id, b);
  res.json({ ok: true });
}));

const bannerBody = z.object({ title: z.string().trim().min(2).max(100), subtitle: z.string().trim().max(200).default(''), imageUrl: z.string().url().nullable().optional(), link: z.string().trim().max(300).nullable().optional(), sortOrder: z.number().int().default(0), isActive: z.boolean().default(true), endsAt: z.coerce.date().nullable().optional() });
admin.get('/admin/banners', wrap(async (_req, res) => res.json({ items: await many('select * from banners order by sort_order, created_at desc') })));
admin.post('/admin/banners', wrap(async (req, res) => {
  const b = parse(bannerBody, req.body);
  const r = await one('insert into banners (title, subtitle, image_url, link, sort_order, is_active, ends_at) values ($1,$2,$3,$4,$5,$6,$7) returning id', [b.title, b.subtitle, b.imageUrl ?? null, b.link ?? null, b.sortOrder, b.isActive, b.endsAt ?? null]);
  await audit(req, 'banner.created', 'banner', r.id);
  res.status(201).json(r);
}));
admin.put('/admin/banners/:id', wrap(async (req, res) => {
  const b = parse(bannerBody, req.body); const id = parse(uuid, req.params.id);
  await query('update banners set title=$2, subtitle=$3, image_url=$4, link=$5, sort_order=$6, is_active=$7, ends_at=$8 where id = $1', [id, b.title, b.subtitle, b.imageUrl ?? null, b.link ?? null, b.sortOrder, b.isActive, b.endsAt ?? null]);
  await audit(req, 'banner.updated', 'banner', id);
  res.json({ ok: true });
}));
admin.delete('/admin/banners/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await query('update banners set is_active = false where id = $1', [id]);   // deactivate, never delete
  await audit(req, 'banner.deactivated', 'banner', id);
  res.json({ ok: true });
}));

admin.post('/admin/broadcast', wrap(async (req, res) => {
  const b = parse(z.object({ audience: z.enum(['customers', 'sellers', 'all']), title: z.string().trim().min(2).max(100), body: z.string().trim().min(2).max(500) }), req.body);
  const roles = b.audience === 'all' ? ['customer', 'seller'] : [b.audience === 'customers' ? 'customer' : 'seller'];
  const r = await query(`insert into notifications (user_id, kind, title, body) select id, 'admin_message', $2, $3 from users where role = any($1::user_role[]) and status = 'active' and deleted_at is null`, [roles, b.title, b.body]);
  await audit(req, 'broadcast.sent', 'notification', null, { audience: b.audience, title: b.title, recipients: r.rowCount });
  res.json({ recipients: r.rowCount });
}));

const EDITABLE = { commission_bps: z.number().int().min(0).max(3000), subscription_paise: z.number().int().min(100), subscription_months: z.number().int().min(1).max(36),
  checkout_enabled: z.boolean(), delivery_enabled: z.boolean(), min_customer_age: z.number().int().min(18).max(99), order_hold_minutes: z.number().int().min(5).max(120),
  support_phone: z.string().max(20), support_email: z.string().max(120) };
admin.get('/admin/settings', wrap(async (_req, res) => res.json({ settings: Object.fromEntries((await many('select key, value from settings')).map((r) => [r.key, r.value])) })));
admin.patch('/admin/settings', wrap(async (req, res) => {
  const entries = Object.entries(req.body || {});
  if (!entries.length) throw badRequest('empty', 'Nothing to change');
  for (const [k, v] of entries) {
    if (!EDITABLE[k]) throw badRequest('bad_setting', `Unknown setting ${k}`);
    parse(EDITABLE[k], v);
    await query(`insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, JSON.stringify(v)]);
    await audit(req, 'setting.changed', 'setting', k, { value: v });
  }
  res.json({ ok: true });
}));
admin.get('/admin/audit', wrap(async (req, res) => {
  const { page } = pageOf(req);
  res.json(paged(await many(`select id, actor_role, action, entity, entity_id, meta, ip, created_at from audit_logs order by id desc limit 51 offset $1`, [(page - 1) * 50]), 50));
}));
