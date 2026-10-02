// Public catalogue. Everything here reads the real database; only "live" shops/products are exposed.
import { Router } from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { flags, config } from '../config.js';
import { getSetting } from '../db.js';
import { wrap, parse, notFound } from '../util/http.js';

export const pub = Router();

const PRODUCT_COLS = `id, name, pack_quantity, price_paise, discount_price_paise, final_price_paise, in_stock, stock, image_url,
  rating_avg, rating_count, shop_id, shop_name, shop_slug, shop_verified, category_slug, name_en, name_ta, name_hi, is_featured, created_at`;

const SORTS = {
  popular: 'sold_count desc, created_at desc',
  newest: 'created_at desc',
  price_asc: 'final_price_paise asc',
  price_desc: 'final_price_paise desc',
  rating: 'rating_avg desc, rating_count desc',
};

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().max(60).optional(),
  shop: z.string().uuid().optional(),
  city: z.string().max(40).default('sivakasi'),
  minPrice: z.coerce.number().int().min(0).optional(),     // rupees
  maxPrice: z.coerce.number().int().min(0).optional(),
  inStock: z.enum(['true', 'false']).optional(),
  featured: z.enum(['true', 'false']).optional(),
  sort: z.enum(['popular', 'newest', 'price_asc', 'price_desc', 'rating', 'relevance']).default('popular'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(40).default(20),
});

export async function searchProducts(raw) {
  const f = parse(listQuery, raw);
  const where = ['city_id = (select id from cities where slug = $1)'];
  const params = [f.city];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  let qIdx = 0;
  if (f.q) {
    params.push(f.q);
    const i = qIdx = params.length;
    where.push(`(name ilike '%' || $${i} || '%' or name_en ilike '%' || $${i} || '%' or name_ta ilike '%' || $${i} || '%'
                 or name_hi ilike '%' || $${i} || '%' or shop_name ilike '%' || $${i} || '%' or word_similarity($${i}, name) > 0.45)`);
  }
  if (f.category) add('category_slug = ?', f.category);
  if (f.shop) add('shop_id = ?', f.shop);
  if (f.minPrice != null) add('final_price_paise >= ?', f.minPrice * 100);
  if (f.maxPrice != null) add('final_price_paise <= ?', f.maxPrice * 100);
  if (f.inStock === 'true') where.push('in_stock');
  if (f.featured === 'true') where.push('is_featured');
  const order = f.sort === 'relevance' && f.q ? `word_similarity($${qIdx}, name) desc, sold_count desc` : SORTS[f.sort === 'relevance' ? 'popular' : f.sort];
  params.push(f.limit + 1, (f.page - 1) * f.limit);
  const rows = await many(
    `select ${PRODUCT_COLS} from catalog_products where ${where.join(' and ')} order by ${order}, id limit $${params.length - 1} offset $${params.length}`, params);
  return { items: rows.slice(0, f.limit), page: f.page, hasMore: rows.length > f.limit };
}

pub.get('/public/config', wrap(async (_req, res) => {
  const [cities, categories, settings] = await Promise.all([
    many('select slug, name, state, is_active from cities order by name'),
    many('select id, slug, name_en, name_ta, name_hi from categories where is_active and deleted_at is null order by sort_order'),
    many(`select key, value from settings where key in ('checkout_enabled','delivery_enabled','min_customer_age','subscription_paise','subscription_months','commission_bps','support_phone','support_email','app_version')`),
  ]);
  const s = Object.fromEntries(settings.map((r) => [r.key, r.value]));
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ cities, categories, settings: s, features: { google: flags.google(), sms: flags.sms(), payments: flags.payments(), storage: flags.storage() },
    googleClientId: config.googleClientId || null });
}));

pub.get('/home', wrap(async (req, res) => {
  const city = String(req.query.city || 'sivakasi');
  const base = { city, sort: 'popular', limit: 10 };
  const [banners, trending, newest, featured, offers, shops, verified] = await Promise.all([
    many(`select id, title, subtitle, image_url, link from banners where is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) order by sort_order, created_at desc limit 8`),
    searchProducts({ ...base, sort: 'popular' }),
    searchProducts({ ...base, sort: 'newest' }),
    searchProducts({ ...base, featured: 'true' }),
    many(`select o.id, o.title, o.description, o.discount_percent, o.ends_at, s.name as shop_name, s.slug as shop_slug
            from offers o left join shops s on s.id = o.shop_id
           where o.is_active and now() between o.starts_at and o.ends_at
             and (o.shop_id is null or o.shop_id in (select id from live_shops)) order by o.discount_percent desc limit 10`),
    many(`select s.id, s.slug, s.name, s.logo_url, s.rating_avg, s.rating_count, (s.verified_at is not null) as verified,
                 (select url from shop_photos sp where sp.shop_id = s.id and sp.deleted_at is null order by sort_order limit 1) as photo_url
            from live_shops s where s.city_id = (select id from cities where slug = $1) order by s.rating_count desc, s.created_at desc limit 10`, [city]),
    many(`select s.id, s.slug, s.name, s.logo_url, s.rating_avg, s.rating_count from live_shops s
           where s.verified_at is not null and s.city_id = (select id from cities where slug = $1) order by s.rating_avg desc limit 10`, [city]),
  ]);
  res.json({ banners, trending: trending.items, newArrivals: newest.items, featured: featured.items, offers, shops, verifiedShops: verified });
}));

pub.get('/products', wrap(async (req, res) => res.json(await searchProducts(req.query))));

pub.get('/products/:id', wrap(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const p = await one('select * from catalog_products where id = $1', [id]);
  if (!p) throw notFound('Product not found');
  const [images, shop, ratingBreakdown] = await Promise.all([
    many('select url from product_images where product_id = $1 and deleted_at is null order by sort_order', [id]),
    one(`select id, slug, name, address, pincode, phone, description, logo_url, rating_avg, rating_count, pickup_enabled, delivery_enabled, (verified_at is not null) as verified from live_shops where id = $1`, [p.shop_id]),
    many(`select rating, count(*)::int n from reviews where product_id = $1 and status = 'visible' group by rating`, [id]),
  ]);
  res.json({ product: { ...p, images: images.map((i) => i.url) }, shop, ratingBreakdown });
}));

pub.get('/products/:id/reviews', wrap(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = await many(
    `select r.id, r.rating, r.body, r.image_url, r.created_at, split_part(u.name, ' ', 1) as reviewer from reviews r join users u on u.id = r.customer_id
      where r.product_id = $1 and r.status = 'visible' order by r.created_at desc limit 11 offset $2`, [id, (page - 1) * 10]);
  res.json({ items: rows.slice(0, 10), hasMore: rows.length > 10 });
}));

pub.get('/shops', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const rows = await many(
    `select s.id, s.slug, s.name, s.logo_url, s.address, s.rating_avg, s.rating_count, (s.verified_at is not null) as verified,
            (select url from shop_photos sp where sp.shop_id = s.id and sp.deleted_at is null order by sort_order limit 1) as photo_url
       from live_shops s where s.city_id = (select id from cities where slug = $1)
        and ($2 = '' or s.name ilike '%' || $2 || '%') and ($3::boolean is not true or s.verified_at is not null)
      order by s.rating_count desc, s.name limit 50`, [String(req.query.city || 'sivakasi'), q, req.query.verified === 'true' ? true : null]);
  res.json({ items: rows });
}));

pub.get('/shops/:slug', wrap(async (req, res) => {
  const shop = await one(
    `select id, slug, name, owner_name, address, pincode, phone, description, logo_url, rating_avg, rating_count,
            pickup_enabled, delivery_enabled, (verified_at is not null) as verified, created_at
       from live_shops where slug = $1`, [req.params.slug]);
  if (!shop) throw notFound('Shop not found');
  const [photos, offers] = await Promise.all([
    many('select url from shop_photos where shop_id = $1 and deleted_at is null order by sort_order', [shop.id]),
    many(`select id, title, description, discount_percent, ends_at from offers where shop_id = $1 and is_active and now() between starts_at and ends_at order by discount_percent desc`, [shop.id]),
  ]);
  res.json({ shop, photos: photos.map((p) => p.url), offers });
}));

pub.get('/shops/:slug/reviews', wrap(async (req, res) => {
  const shop = await one('select id from live_shops where slug = $1', [req.params.slug]);
  if (!shop) throw notFound('Shop not found');
  const rows = await many(
    `select r.id, r.rating, r.body, r.image_url, r.created_at, split_part(u.name,' ',1) as reviewer, p.name as product_name
       from reviews r join users u on u.id = r.customer_id join products p on p.id = r.product_id
      where r.shop_id = $1 and r.status = 'visible' order by r.created_at desc limit 30`, [shop.id]);
  res.json({ items: rows });
}));

pub.get('/safety', wrap(async (_req, res) => {
  res.json({ minAge: await getSetting('min_customer_age', 18) });
}));
