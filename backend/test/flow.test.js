// End-to-end test against a real PostgreSQL database. Only Razorpay's HTTPS API is stubbed (no network
// in CI); webhook signatures are real HMACs computed with the same secret the server verifies against.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://mavrix:mavrix_dev@localhost:5432/mavrix_test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key'; process.env.RAZORPAY_KEY_SECRET = 'test_secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.S3_BUCKET = 'b'; process.env.S3_ACCESS_KEY_ID = 'k'; process.env.S3_SECRET_ACCESS_KEY = 's'; process.env.S3_PUBLIC_BASE_URL = 'https://cdn.test';
process.env.ADMIN_SETUP_TOKEN = 'setup-token-123'; process.env.NODE_ENV = 'test';

const { pool, query } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { expireStaleOrders } = await import('../src/services/orders.js');

// ── Razorpay stub ──
const rzpCalls = [];
const lastPayments = new Map();
const createdOrders = new Map();
let rid = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith('https://api.razorpay.com')) return realFetch(url, opts);
  const path = String(url).replace('https://api.razorpay.com', '');
  const body = opts.body ? JSON.parse(opts.body) : null;
  rzpCalls.push({ method: opts.method, path, body });
  const json = (o) => new Response(JSON.stringify(o), { status: 200 });
  if (path === '/v1/orders') { const id = `order_${++rid}`; createdOrders.set(id, body); return json({ id, amount: body.amount }); }
  if (path.match(/^\/v1\/payments\/[^/]+\/refund$/)) return json({ id: `rfnd_${++rid}` });
  if (path.match(/^\/v1\/payments\/[^/]+\/transfers$/)) {
    const pay = lastPayments.get(path.split('/')[3]);
    return json({ items: (pay?.transfers || []).map((t, i) => ({ id: `trf_${pay.id}_${i}`, notes: t.notes })) });
  }
  if (path.match(/^\/v1\/transfers\//)) return json({ id: path.split('/')[3], on_hold: false });
  if (path === '/v2/accounts') return json({ id: `acc_${++rid}` });
  if (path.includes('/stakeholders')) return json({ id: 'sh_1' });
  if (path.endsWith('/products')) return json({ id: 'prod_1' });
  if (path.includes('/products/')) return json({ id: 'prod_1' });
  return new Response('{}', { status: 404 });
};

let server, base;
before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await pool.query('create extension if not exists pgcrypto; create extension if not exists citext; create extension if not exists pg_trgm;');
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
});
after(async () => { server.close(); await pool.end(); });

const call = async (method, path, { token, body, raw, headers } = {}) => {
  const r = await realFetch(base + path, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
};
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

let evt = 0;
function webhook(event, payload, { sign = true, secret = 'whsec_test' } = {}) {
  const raw = JSON.stringify({ event, payload, created_at: ++evt });
  const sig = sign ? createHmac('sha256', secret).update(raw).digest('hex') : 'bad';
  return call('POST', '/webhooks/razorpay', { raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': `evt_${evt}` } });
}
const capture = (rzOrderId, amount, method = 'upi') => {
  const id = `pay_${++rid}`;
  lastPayments.set(id, { id, transfers: createdOrders.get(rzOrderId)?.transfers });
  return { id, order_id: rzOrderId, amount, method, status: 'captured' };
};

const S = {};   // shared state across ordered tests
const img = (shopId, n) => `https://cdn.test/products/${shopId}/${n}.webp`;

test('admin: setup requires token, works once, then is closed forever', async () => {
  assert.equal((await ok('GET', '/admin/setup/status')).setupAvailable, true);
  const weak = await call('POST', '/admin/setup', { body: { email: 'owner@example.com', password: 'short', confirmPassword: 'short', setupToken: 'setup-token-123' } });
  assert.equal(weak.status, 400);
  const wrongTok = await call('POST', '/admin/setup', { body: { email: 'owner@example.com', password: 'Str0ngPassword!x', confirmPassword: 'Str0ngPassword!x', setupToken: 'nope' } });
  assert.equal(wrongTok.status, 403);
  const r = await ok('POST', '/admin/setup', { body: { email: 'owner@example.com', password: 'Str0ngPassword!x', confirmPassword: 'Str0ngPassword!x', setupToken: 'setup-token-123' } });
  S.admin = r.token;
  assert.equal(r.user.role, 'admin');
  assert.equal((await ok('GET', '/admin/setup/status')).setupAvailable, false);
  const again = await call('POST', '/admin/setup', { body: { email: 'evil@example.com', password: 'Str0ngPassword!x', confirmPassword: 'Str0ngPassword!x', setupToken: 'setup-token-123' } });
  assert.equal(again.status, 403);
  assert.equal((await query("select count(*)::int n from users where role = 'admin'")).rows[0].n, 1);
  assert.equal((await call('POST', '/admin/login', { body: { email: 'owner@example.com', password: 'wrong-password' } })).status, 401);
  assert.equal((await ok('POST', '/admin/login', { body: { email: 'owner@example.com', password: 'Str0ngPassword!x' } })).user.role, 'admin');
});

test('roles: customers/sellers cannot reach admin; nobody can register as admin', async () => {
  const c = await ok('POST', '/auth/register', { body: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9876543210', password: 'password123' } });
  S.cust = c.token;
  assert.equal((await call('GET', '/admin/dashboard', { token: S.cust })).status, 403);
  assert.equal((await call('GET', '/admin/dashboard')).status, 401);
  assert.equal((await call('GET', '/seller/shop', { token: S.cust })).status, 403);
  const attempt = await call('POST', '/auth/register', { body: { name: 'x y', email: 'a@b.com', password: 'password123', role: 'admin' } });
  assert.equal(attempt.body.user.role, 'customer');
  assert.equal((await call('POST', '/admin/login', { body: { email: 'ravi@example.com', password: 'password123' } })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { identifier: 'owner@example.com', password: 'Str0ngPassword!x' } })).status, 401);   // admin can't use the public login
});

test('sellers register, admin approves, subscription + payout onboarding make the shop live', async () => {
  for (const [k, name, phone] of [['A', 'Sri Murugan Crackers', '9000000001'], ['B', 'Kaliswari Fireworks', '9000000002']]) {
    const r = await ok('POST', '/auth/register-seller', { body: { shopName: name, ownerName: `Owner ${k}`, phone, email: `seller${k}@example.com`, password: 'password123', address: '12 Main Road, Sivakasi', pincode: '626123' } });
    S['seller' + k] = r.token;
    S['shop' + k] = (await ok('GET', '/seller/shop', { token: r.token })).shop.id;
  }
  const dash = await ok('GET', '/admin/dashboard', { token: S.admin });
  assert.equal(dash.pending_sellers, 2);
  // unapproved seller cannot list products or buy a plan
  assert.equal((await call('POST', '/seller/subscription/pay', { token: S.sellerA })).status, 403);
  for (const k of ['A', 'B']) {
    await ok('POST', `/admin/sellers/${S['shop' + k]}/status`, { token: S.admin, body: { status: 'approved' } });
    const sub = await ok('POST', '/seller/subscription/pay', { token: S['seller' + k] });
    const rzCall = rzpCalls.filter((c) => c.path === '/v1/orders').at(-1);
    assert.equal(rzCall.body.amount, 19900);   // ₹199
    const ro = `order_${rid}`;
    // signature-less webhook is rejected; non-UPI is refunded; UPI activates
    assert.equal((await webhook('payment.captured', { payment: { entity: capture(ro, 19900) } }, { sign: false })).status, 400);
    const card = await webhook('payment.captured', { payment: { entity: { ...capture(ro, 19900), method: 'card' } } });
    assert.equal(card.status, 200);
    assert.ok(rzpCalls.some((c) => c.path.endsWith('/refund')));
    assert.equal((await ok('GET', '/seller/shop', { token: S['seller' + k] })).subscription, null);
    // The failed card attempt voided the payment row; make a fresh plan payment via UPI
    await ok('POST', '/seller/subscription/pay', { token: S['seller' + k] });
    const ro2 = `order_${rid}`;
    await ok('POST', '/seller/payout/onboard', { token: S['seller' + k], body: { legalName: 'Test Proprietor', businessType: 'proprietorship', pan: 'ABCDE1234F', accountNumber: '123456789012', ifsc: 'HDFC0001234', beneficiaryName: 'Test Proprietor' } });
    const up = await webhook('payment.captured', { payment: { entity: capture(ro2, 19900) } });
    assert.equal(up.status, 200);
    const shop = await ok('GET', '/seller/shop', { token: S['seller' + k] });
    assert.ok(shop.subscription, 'subscription active');
    const months = (new Date(shop.subscription.expires_at) - new Date(shop.subscription.starts_at)) / 86400000;
    assert.ok(months > 178 && months < 186, `~6 months, got ${months}d`);
    const acc = (await query('select razorpay_account_id from shops where id = $1', [S['shop' + k]])).rows[0].razorpay_account_id;
    await webhook('account.activated', { account: { entity: { id: acc } } });
    assert.equal((await ok('GET', '/seller/shop', { token: S['seller' + k] })).live, true);
  }
  // bank details never stored
  const cols = (await query("select column_name from information_schema.columns where table_name in ('shops','users')")).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /pan|bank|ifsc|account_number/.test(c)));
});

test('products: seller creates, admin approves, public search sees only approved live products', async () => {
  const cats = (await ok('GET', '/public/config')).categories;
  const rocket = cats.find((c) => c.slug === 'rockets').id, pots = cats.find((c) => c.slug === 'flower-pots').id;
  const mk = async (k, name, cat, price, disc, stock) => (await ok('POST', '/seller/products', { token: S['seller' + k], body: { name, categoryId: cat, pricePaise: price, discountPricePaise: disc, stock, packQuantity: '5 pcs', images: [img(S['shop' + k], name.length)] } })).id;
  S.pRocket = await mk('A', 'Sky Rocket Deluxe', rocket, 200000, 150000, 10);
  S.pPot = await mk('B', 'Flower Pot Big', pots, 300000, null, 2);
  S.pHidden = await mk('A', 'Unapproved Thing', pots, 10000, null, 5);
  assert.equal((await ok('GET', '/products?q=rocket')).items.length, 0, 'pending products are not public');
  assert.equal((await call('POST', '/seller/products', { token: S.sellerA, body: { name: 'Bad', categoryId: rocket, pricePaise: 100000, stock: 1, images: ['https://evil.example/x.png'] } })).status, 400);
  assert.equal((await call('POST', '/seller/products', { token: S.sellerA, body: { name: 'Bad Disc', categoryId: rocket, pricePaise: 100000, discountPricePaise: 120000, stock: 1, images: [img(S.shopA, 9)] } })).status, 400);
  for (const id of [S.pRocket, S.pPot]) await ok('POST', `/admin/products/${id}/approval`, { token: S.admin, body: { status: 'approved' } });
  const s = await ok('GET', '/products?q=rocket');
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].final_price_paise, 150000);
  assert.equal((await ok('GET', '/products?q=Rockt')).items.length, 1, 'typo-tolerant');
  assert.equal((await ok('GET', '/products?category=flower-pots&sort=price_desc')).items[0].name, 'Flower Pot Big');
  assert.equal((await ok('GET', '/products?minPrice=2000&maxPrice=2500')).items.length, 0);
  const home = await ok('GET', '/home');
  assert.equal(home.shops.length, 2);
  const detail = await ok('GET', `/products/${S.pRocket}`);
  assert.equal(detail.shop.name, 'Sri Murugan Crackers');
  // seller B can't touch seller A's product
  assert.equal((await call('PATCH', `/seller/products/${S.pRocket}/stock`, { token: S.sellerB, body: { delta: 5 } })).status, 404);
});

test('multi-seller checkout: stock reserved, UPI-only, per-seller 5% commission, webhook confirms', async () => {
  await ok('PUT', `/cart/${S.pRocket}`, { token: S.cust, body: { qty: 2 } });   // A: 2 x 1500 = 3000
  await ok('PUT', `/cart/${S.pPot}`, { token: S.cust, body: { qty: 1 } });      // B: 1 x 3000 = 3000
  assert.equal((await call('PUT', `/cart/${S.pPot}`, { token: S.cust, body: { qty: 3 } })).status, 409, 'cannot exceed stock');
  const cart = await ok('GET', '/cart', { token: S.cust });
  assert.equal(cart.totalPaise, 600000);

  const bad = await call('POST', '/checkout', { token: S.cust, body: { fulfilment: 'pickup', contactName: 'Ravi', contactPhone: '9876543210', ageConfirmed: false, termsAccepted: true } });
  assert.equal(bad.status, 400, 'age confirmation is mandatory');
  assert.equal((await call('POST', '/checkout', { token: S.cust, body: { fulfilment: 'delivery', contactName: 'Ravi', contactPhone: '9876543210', address: { line1: '1 Test Street', city: 'Sivakasi', state: 'TN', pincode: '626123' }, ageConfirmed: true, termsAccepted: true } })).status, 400, 'delivery disabled by default');

  const co = await ok('POST', '/checkout', { token: S.cust, body: { fulfilment: 'pickup', contactName: 'Ravi', contactPhone: '9876543210', ageConfirmed: true, termsAccepted: true } });
  S.order = co;
  const rzOrder = rzpCalls.filter((c) => c.path === '/v1/orders').at(-1).body;
  assert.equal(rzOrder.amount, 600000);
  assert.equal(rzOrder.transfers.length, 2);
  const sorted = rzOrder.transfers.map((t) => t.amount).sort();
  assert.deepEqual(sorted, [285000, 285000], '₹3000 each minus 5% commission = ₹2850');
  assert.ok(rzOrder.transfers.every((t) => t.on_hold === true), 'funds held until delivery');
  assert.ok(JSON.stringify(co).includes('"upi"') && !JSON.stringify(co).includes('test_secret'), 'UPI-only options, no secret leaked');
  assert.equal(co.checkout.key, 'rzp_test_key');
  // stock reserved immediately
  assert.equal((await query('select stock from products where id = $1', [S.pPot])).rows[0].stock, 1);
  // a second customer cannot take the last pot twice
  const c2 = (await ok('POST', '/auth/register', { body: { name: 'Second Buyer', email: 'b2@example.com', password: 'password123' } })).token;
  await ok('PUT', `/cart/${S.pPot}`, { token: c2, body: { qty: 1 } });
  await ok('PUT', `/cart/${S.pPot}`, { token: c2, body: { qty: 1 } });
  S.c2 = c2;

  // Not paid until the gateway says so — even a client "verify" with a forged signature does nothing.
  assert.equal((await call('POST', '/payments/verify', { token: S.cust, body: { razorpay_order_id: `order_${rid}`, razorpay_payment_id: 'pay_x', razorpay_signature: 'forged' } })).status, 400);
  assert.equal((await query('select status from orders where id = $1', [co.orderId])).rows[0].status, 'pending_payment');
  assert.equal((await ok('GET', '/seller/orders', { token: S.sellerA })).items.length, 0, 'sellers do not see unpaid orders');

  const pay = capture(`order_${rid}`, 600000);
  S.pay = pay;
  assert.equal((await webhook('payment.captured', { payment: { entity: { ...pay, amount: 1 } } })).status, 500, 'amount mismatch rejected');
  assert.equal((await webhook('payment.captured', { payment: { entity: pay } })).status, 200);
  const dup = await webhook('payment.captured', { payment: { entity: pay } });   // new event id, same payment → idempotent
  assert.equal(dup.status, 200);

  const o = (await query('select * from orders where id = $1', [co.orderId])).rows[0];
  assert.equal(o.status, 'paid');
  const st = (await query('select * from settlements order by net_paise')).rows.filter((r) => r.gross_paise === 300000);
  assert.equal(st.length, 2);
  assert.ok(st.every((r) => r.commission_paise === 15000 && r.net_paise === 285000 && r.status === 'on_hold' && r.razorpay_transfer_id));
  assert.equal((await query("select count(*)::int n from settlements where sub_order_id in (select id from sub_orders where order_id = $1)", [co.orderId])).rows[0].n, 2);
  assert.equal((await ok('GET', '/cart', { token: S.cust })).items.length, 0, 'cart cleared after payment');
  assert.equal((await query('select sold_count from products where id = $1', [S.pPot])).rows[0].sold_count, 1);

  // each seller sees only their own part
  const a = await ok('GET', '/seller/orders', { token: S.sellerA });
  assert.equal(a.items.length, 1); assert.equal(a.items[0].subtotal_paise, 300000); assert.equal(a.items[0].commission_paise, 15000);
  assert.deepEqual(a.items[0].items.map((i) => i.name), ['Sky Rocket Deluxe']);
  S.subA = a.items[0].id; S.subB = (await ok('GET', '/seller/orders', { token: S.sellerB })).items[0].id;
  assert.equal((await call('GET', `/seller/orders/${S.subB}`, { token: S.sellerA })).status, 404);

  // out of stock now: pot has 1 reserved for nobody → c2 can buy 1; then it is gone
  const co2 = await ok('POST', '/checkout', { token: S.c2, body: { fulfilment: 'pickup', contactName: 'B2', contactPhone: '9876500000', ageConfirmed: true, termsAccepted: true } });
  assert.equal((await query('select stock from products where id = $1', [S.pPot])).rows[0].stock, 0);
  const shown = await ok('GET', `/products/${S.pPot}`);
  assert.equal(shown.product.in_stock, false, 'shows Out of Stock');
  assert.equal((await call('PUT', `/cart/${S.pPot}`, { token: S.cust, body: { qty: 1 } })).status, 409);
  // abandon: hold expires and stock returns
  await query("update orders set expires_at = now() - interval '10 minutes' where id = $1", [co2.orderId]);
  assert.equal(await expireStaleOrders(), 1);
  assert.equal((await query('select stock from products where id = $1', [S.pPot])).rows[0].stock, 1);
  assert.equal((await query('select status from orders where id = $1', [co2.orderId])).rows[0].status, 'expired');
});

test('order flow → delivered releases held seller funds; reviews only after delivery', async () => {
  const flow = ['accepted', 'preparing', 'ready'];
  assert.equal((await call('POST', `/seller/orders/${S.subA}/status`, { token: S.sellerA, body: { status: 'ready' } })).status, 409, 'cannot skip steps');
  for (const s of flow) await ok('POST', `/seller/orders/${S.subA}/status`, { token: S.sellerA, body: { status: s } });
  assert.equal((await call('POST', `/seller/orders/${S.subA}/status`, { token: S.sellerA, body: { status: 'dispatched' } })).status, 409, 'pickup orders complete at the shop');
  const items = (await ok('GET', `/orders/${S.order.orderId}`, { token: S.cust }));
  const itemA = items.subOrders.find((s) => s.shop_name === 'Sri Murugan Crackers').items[0];
  assert.equal((await call('POST', '/reviews', { token: S.cust, body: { orderItemId: itemA.id, rating: 5 } })).status, 403, 'not delivered yet');
  const before = rzpCalls.length;
  await ok('POST', `/seller/orders/${S.subA}/status`, { token: S.sellerA, body: { status: 'delivered' } });
  assert.ok(rzpCalls.slice(before).some((c) => c.method === 'PATCH' && c.path.startsWith('/v1/transfers/') && c.body.on_hold === false), 'transfer released');
  assert.equal((await query('select status from settlements where sub_order_id = $1', [S.subA])).rows[0].status, 'released');
  assert.equal((await query('select status from settlements where sub_order_id = $1', [S.subB])).rows[0].status, 'on_hold');
  await webhook('transfer.processed', { transfer: { entity: { id: (await query('select razorpay_transfer_id t from settlements where sub_order_id = $1', [S.subA])).rows[0].t } } });
  assert.equal((await query('select status from settlements where sub_order_id = $1', [S.subA])).rows[0].status, 'settled');

  const rv = await ok('POST', '/reviews', { token: S.cust, body: { orderItemId: itemA.id, rating: 4, body: 'Great rockets' } });
  assert.equal((await call('POST', '/reviews', { token: S.cust, body: { orderItemId: itemA.id, rating: 4 } })).status, 409, 'one review per item');
  const p = await ok('GET', `/products/${S.pRocket}`);
  assert.equal(Number(p.product.rating_avg), 4);
  await ok('POST', `/reviews/${rv.id}/report`, { token: S.c2, body: { reason: 'spam' } });
  assert.equal((await ok('GET', '/admin/reviews?filter=reported', { token: S.admin })).items.length, 1);
  await ok('POST', `/admin/reviews/${rv.id}/status`, { token: S.admin, body: { status: 'hidden' } });
  assert.equal(Number((await ok('GET', `/products/${S.pRocket}`)).product.rating_count), 0);

  const notes = await ok('GET', '/notifications', { token: S.cust });
  const kinds = notes.items.map((n) => n.kind);
  for (const k of ['payment_success', 'order_placed', 'seller_accepted', 'preparing', 'ready', 'delivered']) assert.ok(kinds.includes(k), `customer notified: ${k}`);
  assert.ok((await ok('GET', '/notifications', { token: S.sellerA })).items.some((n) => n.kind === 'new_order'));
  assert.ok((await ok('GET', '/notifications', { token: S.admin })).items.some((n) => n.kind === 'new_order'));
});

test('cancel before accept refunds just that seller’s part and restores stock', async () => {
  const pay = (await query("select razorpay_payment_id from payments where purpose = 'order' and status = 'captured'")).rows[0].razorpay_payment_id;
  assert.ok(pay);
  const before = (await query('select stock from products where id = $1', [S.pPot])).rows[0].stock;
  assert.equal((await call('POST', `/orders/${S.order.orderId}/sub-orders/${S.subB}/cancel`, { token: S.c2, body: {} })).status, 404, 'other customers cannot cancel');
  await ok('POST', `/orders/${S.order.orderId}/sub-orders/${S.subB}/cancel`, { token: S.cust, body: { reason: 'changed my mind' } });
  const refund = rzpCalls.filter((c) => c.path.endsWith('/refund')).at(-1);
  assert.equal(refund.body.amount, 300000); assert.equal(refund.body.reverse_all, true);
  assert.equal((await query('select stock from products where id = $1', [S.pPot])).rows[0].stock, before + 1);
  assert.equal((await query('select status from settlements where sub_order_id = $1', [S.subB])).rows[0].status, 'reversed');
  assert.equal((await query('select status from orders where id = $1', [S.order.orderId])).rows[0].status, 'partially_refunded');
});

test('customer support: message → admin inbox → reply → customer notified, history kept', async () => {
  const c = await ok('POST', '/support', { token: S.cust, body: { category: 'order', orderNumber: S.order.orderNumber, message: 'Where is my order?' } });
  assert.equal((await call('POST', '/support', { token: S.cust, body: { category: 'order', orderNumber: 'MF999999', message: 'Not mine' } })).status, 400);
  const inbox = await ok('GET', '/admin/support?status=open', { token: S.admin });
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].customer_name, 'Ravi Kumar'); assert.equal(inbox.items[0].customer_phone, '+919876543210'); assert.equal(inbox.items[0].order_ref, S.order.orderNumber);
  assert.ok((await ok('GET', '/notifications', { token: S.admin })).items.some((n) => n.kind === 'support_new'));
  assert.equal((await call('GET', `/support/${c.id}`, { token: S.c2 })).status, 404);
  await ok('POST', `/admin/support/${c.id}/reply`, { token: S.admin, body: { message: 'Ready for pickup tomorrow.' } });
  const thread = await ok('GET', `/support/${c.id}`, { token: S.cust });
  assert.deepEqual(thread.messages.map((m) => m.sender_role), ['customer', 'admin']);
  assert.equal(thread.conversation.status, 'pending');
  assert.ok((await ok('GET', '/notifications', { token: S.cust })).items.some((n) => n.kind === 'support_reply'));
  await ok('POST', `/support/${c.id}/messages`, { token: S.cust, body: { message: 'Thanks!' } });
  assert.equal((await ok('GET', `/support/${c.id}`, { token: S.cust })).conversation.status, 'open');
  await ok('POST', `/admin/support/${c.id}/status`, { token: S.admin, body: { status: 'resolved' } });
  assert.equal((await ok('GET', '/admin/dashboard', { token: S.admin })).resolved_tickets, 1);
});

test('admin analytics, audit log is append-only, soft delete, logout-all', async () => {
  const d = await ok('GET', '/admin/dashboard', { token: S.admin });
  assert.equal(d.customers, 3); assert.equal(d.sellers, 2); assert.equal(d.active_sellers, 2);
  assert.equal(Number(d.salesPaise), 300000); assert.equal(Number(d.commissionPaise), 15000);   // B's part was refunded
  assert.equal(Number(d.subscriptionRevenuePaise), 39800);
  const audit = await ok('GET', '/admin/audit', { token: S.admin });
  assert.ok(audit.items.some((a) => a.action === 'admin.setup_completed'));
  await assert.rejects(query("update audit_logs set action = 'x'"), /append-only/);
  await assert.rejects(query("delete from audit_logs"), /append-only/);
  await ok('DELETE', `/seller/products/${S.pHidden}`, { token: S.sellerA });
  assert.ok((await query('select deleted_at from products where id = $1', [S.pHidden])).rows[0].deleted_at, 'soft-deleted, row retained');
  await ok('PATCH', '/admin/settings', { token: S.admin, body: { checkout_enabled: false } });
  assert.equal((await call('POST', '/checkout', { token: S.cust, body: { fulfilment: 'pickup', contactName: 'Ravi', contactPhone: '9876543210', ageConfirmed: true, termsAccepted: true } })).status, 503, 'compliance kill-switch');
  await ok('PATCH', '/admin/settings', { token: S.admin, body: { checkout_enabled: true } });
  await ok('POST', '/auth/logout-all', { token: S.admin });
  assert.equal((await call('GET', '/admin/dashboard', { token: S.admin })).status, 401);
});

test('migrations are checksummed and idempotent', async () => {
  await migrate({ log: () => {} });
  assert.equal((await query('select count(*)::int n from schema_migrations')).rows[0].n, 2);
});
