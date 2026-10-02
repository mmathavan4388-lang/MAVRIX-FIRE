-- MAVRIX FIRE v1.0 — initial schema.
-- Money is always stored as integer paise. Nothing is hard-deleted: history tables use deleted_at / status.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ───────────── identity ─────────────
create type user_role as enum ('customer', 'seller', 'admin');

create table users (
  id uuid primary key default gen_random_uuid(),
  role user_role not null,
  email citext unique,
  phone text unique check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),
  name text not null,
  password_hash text,
  google_sub text unique,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  language text not null default 'en' check (language in ('en','ta','hi')),
  status text not null default 'active' check (status in ('active','blocked')),
  twofa_secret text,
  twofa_enabled boolean not null default false,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (email is not null or phone is not null)
);
-- ONLY ONE ADMIN, enforced by the database itself.
create unique index users_single_admin on users (role) where role = 'admin';
create index users_role_idx on users (role) where deleted_at is null;
create trigger users_upd before update on users for each row execute function set_updated_at();

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip text,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions (user_id) where revoked_at is null;

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  purpose text not null check (purpose in ('login','verify')),
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_phone_idx on otp_codes (phone, created_at desc);

-- ───────────── reference data ─────────────
create table cities (
  id serial primary key,
  slug text unique not null,
  name text not null,
  state text not null,
  is_active boolean not null default false
);

create table categories (
  id serial primary key,
  slug text unique not null,
  name_en text not null,
  name_ta text not null,
  name_hi text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ───────────── shops ─────────────
create type shop_status as enum ('pending', 'approved', 'rejected', 'update_required', 'suspended');

create table shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references users(id),
  city_id int not null references cities(id),
  slug text not null unique,
  name text not null,
  owner_name text not null,
  phone text not null,
  email citext not null,
  address text not null,
  pincode text not null check (pincode ~ '^[0-9]{6}$'),
  description text not null default '',
  logo_url text,
  status shop_status not null default 'pending',
  status_note text,
  verified_at timestamptz,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  razorpay_account_id text,
  payout_status text not null default 'not_started'
    check (payout_status in ('not_started','pending','active','needs_clarification','rejected')),
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index shops_city_status_idx on shops (city_id, status) where deleted_at is null;
create index shops_name_trgm on shops using gin (name gin_trgm_ops);
create trigger shops_upd before update on shops for each row execute function set_updated_at();

create table shop_photos (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  url text not null,
  storage_key text not null,
  sort_order int not null default 0,
  deleted_at timestamptz
);
create index shop_photos_idx on shop_photos (shop_id) where deleted_at is null;

create table seller_subscriptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  amount_paise int not null,
  months int not null,
  status text not null default 'pending' check (status in ('pending','active','expired','failed')),
  starts_at timestamptz,
  expires_at timestamptz,
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  created_at timestamptz not null default now()
);
create index subs_shop_idx on seller_subscriptions (shop_id, expires_at desc);

-- ───────────── catalogue ─────────────
create table products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  category_id int not null references categories(id),
  name text not null,
  description text not null default '',
  pack_quantity text not null default '',
  price_paise int not null check (price_paise > 0),
  discount_price_paise int check (discount_price_paise is null or (discount_price_paise > 0 and discount_price_paise < price_paise)),
  stock int not null default 0 check (stock >= 0),
  is_available boolean not null default true,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  rejection_note text,
  is_featured boolean not null default false,
  hidden_by_admin boolean not null default false,
  safety_note text not null default '',
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  sold_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index products_shop_idx on products (shop_id) where deleted_at is null;
create index products_cat_idx on products (category_id) where deleted_at is null;
create index products_name_trgm on products using gin (name gin_trgm_ops);
create index products_created_idx on products (created_at desc);
create index products_sold_idx on products (sold_count desc);
create trigger products_upd before update on products for each row execute function set_updated_at();

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  url text not null,
  storage_key text not null,
  sort_order int not null default 0,
  deleted_at timestamptz
);
create index product_images_idx on product_images (product_id, sort_order) where deleted_at is null;

create table offers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id),            -- null = platform-wide (admin)
  product_id uuid references products(id),      -- null = whole shop / platform
  title text not null,
  description text not null default '',
  discount_percent int not null check (discount_percent between 1 and 90),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index offers_active_idx on offers (ends_at) where is_active;

create table banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text not null default '',
  image_url text,
  link text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

-- A shop is "live" (publicly listed) only when approved, subscribed, payout-ready and in an active city.
create view live_shops as
select s.* from shops s join cities c on c.id = s.city_id
where s.status = 'approved' and s.deleted_at is null and s.payout_status = 'active' and c.is_active
  and exists (select 1 from seller_subscriptions ss where ss.shop_id = s.id and ss.status = 'active' and ss.expires_at > now());

-- Public catalogue. Effective price = best of seller discount price and the best live offer.
create view catalog_products as
select p.id, p.shop_id, p.category_id, p.name, p.description, p.pack_quantity, p.price_paise, p.discount_price_paise,
       least(coalesce(p.discount_price_paise, p.price_paise), ceil(p.price_paise * (100 - o.pct) / 100.0)::int) as final_price_paise,
       p.stock, (p.is_available and p.stock > 0) as in_stock, p.is_featured, p.rating_avg, p.rating_count, p.sold_count,
       p.created_at, p.safety_note,
       s.name as shop_name, s.slug as shop_slug, (s.verified_at is not null) as shop_verified, s.city_id,
       s.pickup_enabled, s.delivery_enabled,
       c.slug as category_slug, c.name_en, c.name_ta, c.name_hi,
       (select url from product_images i where i.product_id = p.id and i.deleted_at is null order by sort_order limit 1) as image_url
from products p
join live_shops s on s.id = p.shop_id
join categories c on c.id = p.category_id and c.is_active and c.deleted_at is null
left join lateral (
  select coalesce(max(f.discount_percent), 0) as pct from offers f
  where f.is_active and now() between f.starts_at and f.ends_at
    and (f.product_id = p.id or (f.product_id is null and (f.shop_id = p.shop_id or f.shop_id is null)))
) o on true
where p.deleted_at is null and p.approval_status = 'approved' and not p.hidden_by_admin;

create table cart_items (
  user_id uuid not null references users(id),
  product_id uuid not null references products(id),
  qty int not null check (qty between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table wishlist_items (
  user_id uuid not null references users(id),
  product_id uuid not null references products(id),
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ───────────── orders & money ─────────────
create sequence order_number_seq start 100001;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('MF' || nextval('order_number_seq')),
  customer_id uuid not null references users(id),
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','failed','expired','refunded','partially_refunded')),
  total_paise int not null check (total_paise > 0),
  fulfilment text not null check (fulfilment in ('pickup','delivery')),
  contact_name text not null,
  contact_phone text not null,
  delivery_address jsonb,
  age_confirmed_at timestamptz not null,
  terms_accepted_at timestamptz not null,
  razorpay_order_id text unique,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fulfilment = 'pickup' or delivery_address is not null)
);
create index orders_customer_idx on orders (customer_id, created_at desc);
create index orders_pending_idx on orders (expires_at) where status = 'pending_payment';
create trigger orders_upd before update on orders for each row execute function set_updated_at();

create table sub_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  shop_id uuid not null references shops(id),
  subtotal_paise int not null check (subtotal_paise > 0),
  commission_bps int not null,
  commission_paise int not null check (commission_paise >= 0),
  seller_amount_paise int not null check (seller_amount_paise >= 0),
  status text not null default 'placed'
    check (status in ('placed','accepted','preparing','ready','dispatched','out_for_delivery','delivered','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (commission_paise + seller_amount_paise = subtotal_paise),
  unique (order_id, shop_id)
);
create index sub_orders_shop_idx on sub_orders (shop_id, created_at desc);
create trigger sub_orders_upd before update on sub_orders for each row execute function set_updated_at();

create table sub_order_events (
  id bigserial primary key,
  sub_order_id uuid not null references sub_orders(id),
  status text not null,
  note text,
  actor_id uuid references users(id),
  created_at timestamptz not null default now()
);
create index sub_order_events_idx on sub_order_events (sub_order_id, id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  sub_order_id uuid not null references sub_orders(id),
  product_id uuid not null references products(id),
  name text not null,
  image_url text,
  unit_price_paise int not null check (unit_price_paise > 0),
  qty int not null check (qty > 0),
  line_total_paise int not null,
  check (line_total_paise = unit_price_paise * qty)
);
create index order_items_sub_idx on order_items (sub_order_id);
create index order_items_product_idx on order_items (product_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('order','subscription')),
  order_id uuid references orders(id),
  subscription_id uuid references seller_subscriptions(id),
  razorpay_order_id text not null,
  razorpay_payment_id text unique,
  amount_paise int not null,
  method text,
  status text not null default 'created' check (status in ('created','captured','failed','refunded','partially_refunded')),
  failure_reason text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_rzp_order_idx on payments (razorpay_order_id);
create trigger payments_upd before update on payments for each row execute function set_updated_at();

create table webhook_events (
  id text primary key,                 -- provider event id → idempotency
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  sub_order_id uuid not null unique references sub_orders(id),
  shop_id uuid not null references shops(id),
  gross_paise int not null,
  commission_paise int not null,
  net_paise int not null,
  status text not null default 'pending' check (status in ('pending','on_hold','released','settled','failed','reversed')),
  razorpay_transfer_id text,
  released_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index settlements_shop_idx on settlements (shop_id, created_at desc);
create trigger settlements_upd before update on settlements for each row execute function set_updated_at();

create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  order_id uuid references orders(id),
  amount_paise int not null check (amount_paise > 0),
  razorpay_refund_id text unique,
  status text not null default 'pending' check (status in ('pending','processed','failed')),
  reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ───────────── reviews ─────────────
create table reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  shop_id uuid not null references shops(id),
  order_item_id uuid not null unique references order_items(id),
  customer_id uuid not null references users(id),
  rating int not null check (rating between 1 and 5),
  body text not null default '',
  image_url text,
  status text not null default 'visible' check (status in ('visible','hidden')),
  report_count int not null default 0,
  created_at timestamptz not null default now()
);
create index reviews_product_idx on reviews (product_id, created_at desc) where status = 'visible';
create index reviews_shop_idx on reviews (shop_id, created_at desc) where status = 'visible';

create table review_reports (
  review_id uuid not null references reviews(id),
  reporter_id uuid not null references users(id),
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (review_id, reporter_id)
);

-- ───────────── notifications & support ─────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null,                       -- translated on the client via i18n key notif.<kind>
  title text,                               -- only for free-text admin broadcasts
  body text,
  data jsonb not null default '{}',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create unique index notifications_dedupe on notifications (user_id, dedupe_key) where dedupe_key is not null;

create table support_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references users(id),
  category text not null check (category in
    ('order','payment','product','delivery','refund','seller','other')),
  order_id uuid references orders(id),
  order_ref text,
  status text not null default 'open' check (status in ('open','pending','resolved')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index support_status_idx on support_conversations (status, last_message_at desc);
create index support_customer_idx on support_conversations (customer_id, last_message_at desc);

create table support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations(id),
  sender_id uuid not null references users(id),
  sender_role user_role not null,
  body text not null,
  image_url text,
  created_at timestamptz not null default now()
);
create index support_messages_idx on support_messages (conversation_id, created_at);

create table audit_logs (
  id bigserial primary key,
  actor_id uuid references users(id),
  actor_role user_role,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index audit_created_idx on audit_logs (created_at desc);

-- Audit logs and payment history are append-only.
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger audit_no_update before update or delete on audit_logs for each row execute function forbid_mutation();
create trigger events_no_update before update or delete on sub_order_events for each row execute function forbid_mutation();
