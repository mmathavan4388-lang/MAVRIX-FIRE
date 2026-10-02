import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { api, qs, money, fmtDate, fmtTime } from '../api.js';
import { useApp } from '../store.jsx';
import { useI18n, useT, LANGS, catName } from '../i18n.jsx';
import { Icon, Logo, Async, useLoad, usePaged, PagedFooter, Empty, ErrorBox, Spinner, Field, fieldErr, Btn, Modal, Stars, StarInput, Img, Status, Price, TopBar, ImageUploader } from '../ui.jsx';
import { payWithRazorpay } from '../pay.js';

// ───────── shell with bottom navigation ─────────
export function CustomerShell() {
  const t = useT(); const { cartCount } = useApp(); const loc = useLocation();
  const tabs = [['/', 'home', 'nav.home', true], ['/search', 'search', 'nav.search'], ['/cart', 'cart', 'nav.cart'], ['/orders', 'bag', 'nav.orders'], ['/profile', 'user', 'nav.profile']];
  const hideNav = false;
  return (
    <div className="app-shell">
      <Outlet />
      {!hideNav && (
        <nav className="bottom-nav" aria-label="main"><div className="inner">
          {tabs.map(([to, icon, key, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={icon} />{to === '/cart' && cartCount > 0 && <span className="badge-dot">{cartCount}</span>}<span>{t(key)}</span>
            </NavLink>
          ))}
        </div></nav>
      )}
      <span className="hide">{loc.key}</span>
    </div>
  );
}

export function RequireCustomer({ children }) {
  const { user } = useApp(); const loc = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (user.role !== 'customer') return <Navigate to={user.role === 'seller' ? '/seller' : '/admin'} replace />;
  return children;
}

// ───────── product card ─────────
export function useWishlist() {
  const { user } = useApp(); const nav = useNavigate(); const [ids, setIds] = useState(new Set());
  useEffect(() => { if (user?.role === 'customer') api.get('/wishlist/ids').then((r) => setIds(new Set(r.ids))).catch(() => {}); }, [user]);
  const toggle = async (id) => {
    if (!user) return nav('/login', { state: { from: location.pathname } });
    const on = ids.has(id); const next = new Set(ids); on ? next.delete(id) : next.add(id); setIds(next);
    try { on ? await api.del(`/wishlist/${id}`) : await api.put(`/wishlist/${id}`); } catch { setIds(ids); }
  };
  return { ids, toggle };
}

export function ProductCard({ p, wl, horizontal }) {
  const t = useT(); const pct = p.final_price_paise < p.price_paise ? Math.round((1 - p.final_price_paise / p.price_paise) * 100) : 0;
  return (
    <div className={`pcard ${horizontal ? 'h' : ''}`}>
      <Link to={`/product/${p.id}`} style={{ display: 'contents' }}>
        <div style={{ position: 'relative' }}>
          <Img src={p.image_url} alt={p.name} className="img" />
          {!p.in_stock && <div className="oos">{t('out_of_stock')}</div>}
          {pct > 0 && <span className="pill grad off">{pct}% {t('off')}</span>}
        </div>
        <div className="body">
          <div className="name">{p.name}</div>
          <div className="tiny muted">{p.shop_name}{p.shop_verified && ' ✓'}</div>
          <div style={{ marginTop: 'auto' }}><Price item={p} /></div>
        </div>
      </Link>
      {wl && <button className={`heart ${wl.ids.has(p.id) ? 'on' : ''}`} onClick={() => wl.toggle(p.id)} aria-label={t('wishlist')}><Icon name="heart" fill={wl.ids.has(p.id) ? 'currentColor' : 'none'} /></button>}
    </div>
  );
}
const Skeletons = ({ n = 4 }) => <div className="grid">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: 230 }} />)}</div>;

// ───────── home ─────────
export function Home() {
  const t = useT(); const { lang } = useI18n(); const { config, user, unread } = useApp(); const nav = useNavigate(); const wl = useWishlist();
  const load = useLoad(() => api.get('/home'), []);
  const [q, setQ] = useState('');
  const cats = config?.categories || [];
  const submit = (e) => { e.preventDefault(); nav(`/search${qs({ q })}`); };
  return (
    <div>
      <div className="topbar" style={{ flexWrap: 'wrap' }}>
        <Link to="/"><Logo /></Link>
        <div className="grow row gap-s" style={{ justifyContent: 'center' }}><Icon name="pin" width="16" height="16" /><b className="small">Sivakasi</b></div>
        <Link to={user ? '/notifications' : '/login'} className="icon-btn" aria-label={t('notifications')}><Icon name="bell" />{unread > 0 && <span className="badge-dot" style={{ top: 2, marginLeft: 12 }}>{unread}</span>}</Link>
        <Link to={user ? '/profile' : '/login'} className="icon-btn" aria-label={t('nav.profile')}><Icon name="user" /></Link>
      </div>
      <div className="page">
        <form className="search" onSubmit={submit}><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_placeholder')} aria-label={t('nav.search')} /></form>
        <Async load={load} skeleton={<div className="mt"><div className="skeleton" style={{ height: 150 }} /><div className="mt"><Skeletons /></div></div>}>
          {(d) => (<>
            <div className="hscroll mt">
              {(d.banners.length ? d.banners : [null]).map((b, i) => (
                <Link key={b?.id || i} to={b?.link || '/search'} className="hero" style={{ width: 'min(88vw, 520px)' }}>
                  {b?.image_url && <><img className="bg" src={b.image_url} alt="" loading="lazy" /><div className="shade" /></>}
                  <h2>{b?.title || t('hero_title')}</h2><span className="small">{b?.subtitle || t('hero_sub')}</span>
                </Link>
              ))}
            </div>
            <div className="chips mt">{cats.map((c) => <Link key={c.id} to={`/search?category=${c.slug}`} className="chip">{catName(c, lang)}</Link>)}</div>

            {d.shops.length > 0 && <Rail title={t('featured_shops')} to="/search?tab=shops">{d.shops.map((s) => <ShopCard key={s.id} s={s} />)}</Rail>}
            {(d.featured.length > 0 || d.trending.length > 0) && <Rail title={t('trending')} to="/search?sort=popular">{(d.featured.length ? d.featured : d.trending).map((p) => <ProductCard key={p.id} p={p} wl={wl} horizontal />)}</Rail>}
            {d.offers.length > 0 && <div className="section"><div className="section-head"><h2>{t('offers')}</h2></div><div className="hscroll">{d.offers.map((o) => (
              <Link key={o.id} to={o.shop_slug ? `/shop/${o.shop_slug}` : '/search'} className="card" style={{ width: 230, background: 'var(--grad-soft)', border: 0 }}>
                <span className="pill grad">{o.discount_percent}% {t('off')}</span><h3 style={{ marginTop: 8 }}>{o.title}</h3><div className="small muted">{o.shop_name || 'MAVRIX FIRE'}</div></Link>))}</div></div>}
            {d.trending.length > 0 && <Rail title={t('popular')} to="/search?sort=popular">{d.trending.map((p) => <ProductCard key={p.id} p={p} wl={wl} horizontal />)}</Rail>}
            {d.newArrivals.length > 0 && <Rail title={t('new_arrivals')} to="/search?sort=newest">{d.newArrivals.map((p) => <ProductCard key={p.id} p={p} wl={wl} horizontal />)}</Rail>}
            {d.verifiedShops.length > 0 && <Rail title={t('verified_shops')} to="/search?tab=shops&verified=true">{d.verifiedShops.map((s) => <ShopCard key={s.id} s={{ ...s, verified: true }} />)}</Rail>}
            {!d.shops.length && !d.trending.length && <Empty icon="store" title={t('no_shops_yet')} hint={t('no_shops_hint')} />}
          </>)}
        </Async>
      </div>
    </div>
  );
}
const Rail = ({ title, to, children }) => { const t = useT(); return <div className="section"><div className="section-head"><h2>{title}</h2><Link to={to}>{t('see_all')}</Link></div><div className="hscroll">{children}</div></div>; };
export function ShopCard({ s }) {
  return (
    <Link to={`/shop/${s.slug}`} className="shopcard">
      <Img src={s.photo_url || s.logo_url} className="cover" alt="" />
      <div className="b"><div className="nm"><b>{s.name}</b>{s.verified && <span className="tick" title="verified">✓</span>}</div><div><Stars value={s.rating_avg} count={s.rating_count} /></div></div>
    </Link>
  );
}

// ───────── search ─────────
export function Search() {
  const t = useT(); const { lang } = useI18n(); const { config } = useApp(); const wl = useWishlist();
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get('q') || '');
  const [filters, setFilters] = useState(false);
  const tab = sp.get('tab') === 'shops' ? 'shops' : 'products';
  const f = Object.fromEntries(['q', 'category', 'minPrice', 'maxPrice', 'inStock', 'sort'].map((k) => [k, sp.get(k) || '']));
  const set = (patch) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  const list = usePaged(`/products${qs({ ...f, sort: f.sort || (f.q ? 'relevance' : 'popular'), limit: 20 })}`, [sp.toString()]);
  const shops = useLoad(() => tab === 'shops' ? api.get(`/shops${qs({ q: f.q, verified: sp.get('verified') })}`) : Promise.resolve({ items: [] }), [tab, f.q, sp.get('verified')]);
  const active = ['category', 'minPrice', 'maxPrice', 'inStock'].filter((k) => f[k]).length;
  useEffect(() => { const id = setTimeout(() => text !== f.q && set({ q: text }), 350); return () => clearTimeout(id); }, [text]); // debounce typing
  return (
    <div>
      <div className="topbar"><div className="search grow"><Icon name="search" /><input autoFocus={!sp.get('q') && !sp.get('category')} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('search_placeholder')} aria-label={t('nav.search')} />{text && <button onClick={() => { setText(''); set({ q: '' }); }} aria-label="clear"><Icon name="x" width="18" height="18" /></button>}</div>
        {tab === 'products' && <button className="icon-btn" onClick={() => setFilters(true)} aria-label={t('filters')} style={{ background: active ? 'var(--grad-soft)' : undefined }}><Icon name="filter" />{active > 0 && <span className="badge-dot" style={{ top: 0, marginLeft: 14 }}>{active}</span>}</button>}
      </div>
      <div className="page">
        <div className="tabs mb"><button className={tab === 'products' ? 'active' : ''} onClick={() => set({ tab: '' })}>{t('products')}</button><button className={tab === 'shops' ? 'active' : ''} onClick={() => set({ tab: 'shops' })}>{t('shops')}</button></div>
        {tab === 'products' && <>
          <div className="chips"><button className={`chip ${!f.category ? 'active' : ''}`} onClick={() => set({ category: '' })}>{t('all')}</button>{(config?.categories || []).map((c) => <button key={c.id} className={`chip ${f.category === c.slug ? 'active' : ''}`} onClick={() => set({ category: c.slug })}>{catName(c, lang)}</button>)}</div>
          {list.items.length === 0 && list.loading && <Skeletons />}
          {list.items.length === 0 && list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
          {list.items.length === 0 && !list.loading && !list.error && <Empty icon="search" title={t('no_results')} hint={t('no_results_hint')} />}
          <div className="grid mt">{list.items.map((p) => <ProductCard key={p.id} p={p} wl={wl} />)}</div>
          {list.items.length > 0 && <PagedFooter list={list} />}
        </>}
        {tab === 'shops' && <Async load={shops}>{(d) => d.items.length ? <div className="col">{d.items.map((s) => <Link key={s.id} to={`/shop/${s.slug}`} className="card row"><Img src={s.logo_url || s.photo_url} className="avatar" alt="" /><div className="grow"><b>{s.name}{s.verified && <span className="pill ok" style={{ marginLeft: 6 }}>✓ {t('verified')}</span>}</b><div className="small muted">{s.address}</div><Stars value={s.rating_avg} count={s.rating_count} /></div></Link>)}</div> : <Empty icon="store" title={t('no_results')} />}</Async>}
      </div>
      {filters && <FilterModal f={f} cats={config?.categories || []} lang={lang} onApply={(p) => { set(p); setFilters(false); }} onClose={() => setFilters(false)} />}
    </div>
  );
}
function FilterModal({ f, cats, lang, onApply, onClose }) {
  const t = useT(); const [v, setV] = useState({ ...f });
  const up = (k, val) => setV((x) => ({ ...x, [k]: val }));
  return (
    <Modal title={t('filters')} onClose={onClose}>
      <div className="col">
        <Field label={t('sort_by')}><select className="select" value={v.sort} onChange={(e) => up('sort', e.target.value)}>{[['', 'sort.default'], ['popular', 'sort.popular'], ['newest', 'sort.newest'], ['price_asc', 'sort.price_asc'], ['price_desc', 'sort.price_desc'], ['rating', 'sort.rating']].map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></Field>
        <Field label={t('category')}><select className="select" value={v.category} onChange={(e) => up('category', e.target.value)}><option value="">{t('all')}</option>{cats.map((c) => <option key={c.id} value={c.slug}>{catName(c, lang)}</option>)}</select></Field>
        <div className="row"><Field label={`${t('price')} ₹ ${t('min')}`}><input className="input" inputMode="numeric" value={v.minPrice} onChange={(e) => up('minPrice', e.target.value.replace(/\D/g, ''))} /></Field><Field label={`₹ ${t('max')}`}><input className="input" inputMode="numeric" value={v.maxPrice} onChange={(e) => up('maxPrice', e.target.value.replace(/\D/g, ''))} /></Field></div>
        <label className="check"><input type="checkbox" checked={v.inStock === 'true'} onChange={(e) => up('inStock', e.target.checked ? 'true' : '')} />{t('in_stock_only')}</label>
        <div className="row"><button className="btn outline grow" onClick={() => onApply({ category: '', minPrice: '', maxPrice: '', inStock: '', sort: '' })}>{t('reset')}</button><button className="btn primary grow" onClick={() => onApply(v)}>{t('apply')}</button></div>
      </div>
    </Modal>
  );
}

// ───────── product page ─────────
export function ProductPage() {
  const { id } = useParams(); const t = useT(); const { lang } = useI18n(); const { user, notify, refreshCounts } = useApp(); const nav = useNavigate(); const wl = useWishlist();
  const load = useLoad(() => api.get(`/products/${id}`), [id]);
  const reviews = usePaged(`/products/${id}/reviews`, [id]);
  const [idx, setIdx] = useState(0); const [busy, setBusy] = useState(null);
  const gal = useRef();
  const add = async (buyNow) => {
    if (!user) return nav('/login', { state: { from: `/product/${id}` } });
    if (user.role !== 'customer') return notify(t('customers_only'), 'bad');
    setBusy(buyNow ? 'buy' : 'add');
    try {
      const cart = await api.get('/cart'); const cur = cart.items.find((i) => i.productId === id)?.qty || 0;
      await api.put(`/cart/${id}`, { qty: cur + 1 }); refreshCounts();
      buyNow ? nav('/checkout') : notify(t('added_to_cart'));
    } catch (e) { notify(e.code === 'out_of_stock' ? t('out_of_stock') : e.code === 'insufficient_stock' ? t('err.stock_limit', {}) : e.message, 'bad'); } finally { setBusy(null); }
  };
  return (
    <div>
      <TopBar title={t('product')} back right={load.data && <button className={`icon-btn ${wl.ids.has(id) ? 'heart on' : ''}`} style={wl.ids.has(id) ? { color: 'var(--pink)', position: 'static', boxShadow: 'none', background: 'none' } : undefined} onClick={() => wl.toggle(id)} aria-label={t('wishlist')}><Icon name="heart" fill={wl.ids.has(id) ? 'currentColor' : 'none'} /></button>} />
      <div className="page">
        <Async load={load}>{({ product: p, shop }) => (<>
          <div className="gallery" ref={gal} onScroll={(e) => setIdx(Math.round(e.target.scrollLeft / e.target.clientWidth))}>{(p.images.length ? p.images : [null]).map((u, i) => <Img key={i} src={u} alt={p.name} />)}</div>
          {p.images.length > 1 && <div className="dots">{p.images.map((_, i) => <i key={i} className={i === idx ? 'on' : ''} />)}</div>}
          <div className="col mt">
            <div className="row between"><span className="pill info">{p[`name_${lang}`] || p.name_en}</span>{p.in_stock ? <span className="pill ok">{t('in_stock')}</span> : <span className="pill bad">{t('out_of_stock')}</span>}</div>
            <h1>{p.name}</h1>
            <div className="row gap-s wrap"><span style={{ fontSize: 24 }}><Price item={p} /></span>{p.final_price_paise < p.price_paise && <span className="pill grad">{Math.round((1 - p.final_price_paise / p.price_paise) * 100)}% {t('off')}</span>}</div>
            {p.pack_quantity && <div className="small muted">{t('pack')}: <b style={{ color: 'var(--text)' }}>{p.pack_quantity}</b></div>}
            {p.in_stock && p.stock <= 5 && <div className="small" style={{ color: 'var(--warn)' }}>{t('only_left', { n: p.stock })}</div>}
            <Stars value={p.rating_avg} count={p.rating_count} />
            {shop && <Link to={`/shop/${shop.slug}`} className="card row"><div className="avatar">{shop.name[0]}</div><div className="grow"><b>{shop.name}</b>{shop.verified && <span className="pill ok" style={{ marginLeft: 6 }}>✓ {t('verified')}</span>}<div className="small muted">{shop.address}</div></div><Icon name="chevron" width="18" height="18" /></Link>}
            <div className="card soft small"><b>{t('fulfilment')}:</b> {[shop?.pickup_enabled && t('pickup'), shop?.delivery_enabled && t('delivery')].filter(Boolean).join(' · ')}</div>
            {p.description && <div><h3>{t('description')}</h3><p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p></div>}
            <div className="notice"><b>{t('safety')}:</b> {p.safety_note || t('safety_default')} <Link to="/safety" style={{ textDecoration: 'underline' }}>{t('safety_guidelines')}</Link></div>
            <div><h3 className="mb">{t('reviews')}</h3>
              {reviews.items.length === 0 && !reviews.loading && <p className="muted small">{t('no_reviews')}</p>}
              {reviews.items.map((r) => <ReviewRow key={r.id} r={r} />)}
              <PagedFooter list={reviews} /></div>
          </div>
          <div style={{ height: 70 }} />
          <div className="sticky-cta"><div>
            <Btn className="outline grow" busy={busy === 'add'} disabled={!p.in_stock} onClick={() => add(false)}><Icon name="cart" width="20" height="20" />{t('add_to_cart')}</Btn>
            <Btn className="primary grow" busy={busy === 'buy'} disabled={!p.in_stock} onClick={() => add(true)}>{p.in_stock ? t('buy_now') : t('out_of_stock')}</Btn>
          </div></div>
        </>)}</Async>
      </div>
    </div>
  );
}
function ReviewRow({ r }) {
  const t = useT(); const { user, notify } = useApp(); const [done, setDone] = useState(false);
  const report = async () => { if (!user) return notify(t('login_required'), 'bad'); try { await api.post(`/reviews/${r.id}/report`, {}); setDone(true); notify(t('review_reported')); } catch (e) { notify(e.message, 'bad'); } };
  return <div className="listrow" style={{ alignItems: 'flex-start' }}><div className="avatar">{r.reviewer?.[0]}</div><div className="grow"><div className="row between"><b>{r.reviewer}</b><span className="tiny muted">{fmtDate(r.created_at)}</span></div><Stars value={r.rating} />{r.body && <p style={{ margin: '4px 0' }}>{r.body}</p>}{r.image_url && <Img src={r.image_url} className="thumb" />}{!done && <button className="tiny muted" onClick={report}>{t('report')}</button>}</div></div>;
}

// ───────── shop page ─────────
export function ShopPage() {
  const { slug } = useParams(); const t = useT(); const wl = useWishlist();
  const load = useLoad(() => api.get(`/shops/${slug}`), [slug]);
  const [tab, setTab] = useState('products');
  return (
    <div>
      <TopBar title={load.data?.shop.name || t('shop')} back />
      <div className="page">
        <Async load={load}>{({ shop, photos, offers }) => (<>
          <div className="gallery" style={{ borderRadius: 20 }}>{(photos.length ? photos : [shop.logo_url]).map((u, i) => <Img key={i} src={u} alt={shop.name} />)}</div>
          <div className="row mt"><Img src={shop.logo_url} className="avatar" alt="" /><div className="grow"><h1>{shop.name}</h1><Stars value={shop.rating_avg} count={shop.rating_count} /></div>{shop.verified && <span className="pill ok">✓ {t('verified')}</span>}</div>
          <div className="card soft mt small col gap-s"><div className="row"><Icon name="pin" width="18" height="18" />{shop.address} - {shop.pincode}</div><div>{[shop.pickup_enabled && t('pickup'), shop.delivery_enabled && t('delivery')].filter(Boolean).join(' · ')}</div>{shop.description && <div className="muted">{shop.description}</div>}</div>
          {offers.length > 0 && <div className="hscroll mt">{offers.map((o) => <div key={o.id} className="card" style={{ width: 220, background: 'var(--grad-soft)', border: 0 }}><span className="pill grad">{o.discount_percent}% {t('off')}</span><h3 style={{ marginTop: 6 }}>{o.title}</h3><div className="tiny muted">{t('until')} {fmtDate(o.ends_at)}</div></div>)}</div>}
          <div className="tabs mt"><button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>{t('products')}</button><button className={tab === 'reviews' ? 'active' : ''} onClick={() => setTab('reviews')}>{t('reviews')}</button></div>
          <div className="mt">{tab === 'products' ? <ShopProducts shopId={shop.id} wl={wl} /> : <ShopReviews slug={slug} />}</div>
        </>)}</Async>
      </div>
    </div>
  );
}
function ShopProducts({ shopId, wl }) {
  const t = useT(); const list = usePaged(`/products?shop=${shopId}&limit=20`, [shopId]);
  return <>{list.items.length === 0 && !list.loading && <Empty icon="box" title={t('no_products')} />}<div className="grid">{list.items.map((p) => <ProductCard key={p.id} p={p} wl={wl} />)}</div><PagedFooter list={list} /></>;
}
function ShopReviews({ slug }) {
  const t = useT(); const load = useLoad(() => api.get(`/shops/${slug}/reviews`), [slug]);
  return <Async load={load}>{(d) => d.items.length ? d.items.map((r) => <ReviewRow key={r.id} r={r} />) : <p className="muted">{t('no_reviews')}</p>}</Async>;
}

// ───────── cart ─────────
export function CartPage() {
  const t = useT(); const { notify, refreshCounts } = useApp(); const nav = useNavigate();
  const load = useLoad(() => api.get('/cart'), []);
  const setQty = async (id, qty) => { try { load.setData(await api.put(`/cart/${id}`, { qty })); refreshCounts(); } catch (e) { notify(e.code === 'insufficient_stock' ? e.message : e.code === 'out_of_stock' ? t('out_of_stock') : e.message, 'bad'); } };
  return (
    <div><TopBar title={t('nav.cart')} />
      <div className="page"><Async load={load}>{(c) => {
        if (!c.items.length) return <Empty icon="cart" title={t('cart_empty')} hint={t('cart_empty_hint')} action={<Link to="/search" className="btn primary mt">{t('browse')}</Link>} />;
        const groups = Object.values(c.items.reduce((m, i) => { (m[i.shopId] ||= { name: i.shopName, slug: i.shopSlug, items: [] }).items.push(i); return m; }, {}));
        const blocked = c.items.some((i) => !i.purchasable);
        return (<>
          <div className="col gap-l">{groups.map((g) => (
            <div key={g.slug} className="card"><Link to={`/shop/${g.slug}`} className="row mb"><Icon name="store" width="20" height="20" /><b>{g.name}</b></Link>
              {g.items.map((i) => (
                <div key={i.productId} className="listrow" style={{ alignItems: 'flex-start' }}>
                  <Img src={i.image} className="thumb" alt="" />
                  <div className="grow"><Link to={`/product/${i.productId}`}><b>{i.name}</b></Link><div className="small muted">{i.pack}</div><div className="price">{money(i.unitPaise)}</div>
                    {!i.purchasable && <div className="small" style={{ color: 'var(--bad)' }}>{t(`cart.${i.reason}`)}</div>}
                    <div className="row between mt" style={{ marginTop: 8 }}><div className="qty"><button onClick={() => setQty(i.productId, i.qty - 1)} aria-label="-"><Icon name="minus" width="16" height="16" /></button><span>{i.qty}</span><button onClick={() => setQty(i.productId, i.qty + 1)} aria-label="+"><Icon name="plus" width="16" height="16" /></button></div>
                      <button className="icon-btn" onClick={() => setQty(i.productId, 0)} aria-label={t('remove')}><Icon name="trash" /></button></div></div>
                </div>))}
              <div className="row between small mt"><span className="muted">{t('seller_subtotal')}</span><b>{money(c.sellerTotals[g.items[0].shopId] || 0)}</b></div>
            </div>))}</div>
          <div style={{ height: 90 }} />
          <div className="sticky-cta"><div><div className="grow"><div className="tiny muted">{t('total')}</div><div className="price" style={{ fontSize: 20 }}>{money(c.totalPaise)}</div></div>
            <Btn className="primary" style={{ minWidth: 160 }} disabled={blocked || !c.totalPaise} onClick={() => nav('/checkout')}>{t('checkout')}</Btn></div></div>
        </>);
      }}</Async></div>
    </div>
  );
}

// ───────── checkout ─────────
export function CheckoutPage() {
  const t = useT(); const { user, config, notify, refreshCounts } = useApp(); const nav = useNavigate();
  const load = useLoad(() => api.get('/cart'), []);
  const [f, setF] = useState({ fulfilment: 'pickup', contactName: user?.name || '', contactPhone: user?.phone?.replace(/^\+91/, '') || '', line1: '', city: 'Sivakasi', state: 'Tamil Nadu', pincode: '', age: false, terms: false });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [pending, setPending] = useState(null);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const minAge = config?.settings?.min_customer_age || 18;
  const deliveryOn = config?.settings?.delivery_enabled === true;
  const checkoutOn = config?.settings?.checkout_enabled !== false;

  const finish = async (checkout, orderId) => {
    try {
      const r = await payWithRazorpay(checkout);
      try { await api.post('/payments/verify', r); } catch { /* webhook will confirm; order page polls */ }
      refreshCounts(); nav(`/orders/${orderId}`, { replace: true, state: { justPaid: true } });
    } catch (e) {
      setPending({ orderId });   // reserved stock is held for the hold window so the buyer can retry
      setErr(e.dismissed ? { message: t('pay.cancelled') } : e.failed ? { message: `${t('pay.failed')} ${e.message}` } : { message: t('pay.script_error') });
    }
  };
  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const body = { fulfilment: f.fulfilment, contactName: f.contactName, contactPhone: f.contactPhone, ageConfirmed: f.age, termsAccepted: f.terms,
        ...(f.fulfilment === 'delivery' ? { address: { line1: f.line1, city: f.city, state: f.state, pincode: f.pincode } } : {}) };
      const r = await api.post('/checkout', body);
      await finish(r.checkout, r.orderId);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const retry = async () => { setBusy(true); setErr(null); try { const r = await api.post(`/orders/${pending.orderId}/pay`); await finish(r.checkout, r.orderId); } catch (e) { setErr(e); setPending(null); } finally { setBusy(false); } };
  const errText = err && (err.code === 'cart_unavailable' ? t('err.cart_unavailable') : err.code === 'payments_not_configured' ? t('err.payments_off') : err.code === 'checkout_disabled' ? t('err.checkout_off') : err.status === 0 ? t('err.network') : err.message);

  return (
    <div><TopBar title={t('checkout')} back="/cart" />
      <div className="page"><Async load={load}>{(c) => {
        if (!c.items.length) return <Empty icon="cart" title={t('cart_empty')} />;
        const canPay = f.age && f.terms && f.contactName.length > 1 && /^[0-9+]{10,15}$/.test(f.contactPhone) && c.totalPaise > 0 && (f.fulfilment === 'pickup' || (f.line1 && /^[0-9]{6}$/.test(f.pincode)));
        return (<div className="col gap-l">
          {!checkoutOn && <div className="notice bad">{t('err.checkout_off')}</div>}
          <div><h3 className="mb">{t('fulfilment')}</h3>
            <div className="tabs"><button className={f.fulfilment === 'pickup' ? 'active' : ''} onClick={() => up('fulfilment', 'pickup')}>{t('pickup')}</button><button className={f.fulfilment === 'delivery' ? 'active' : ''} disabled={!deliveryOn} onClick={() => up('fulfilment', 'delivery')}>{t('delivery')}</button></div>
            {!deliveryOn && <p className="tiny muted">{t('delivery_unavailable')}</p>}</div>
          <div className="col"><Field label={t('name')} error={fieldErr(err, 'contactName')}><input className="input" value={f.contactName} onChange={(e) => up('contactName', e.target.value)} autoComplete="name" /></Field>
            <Field label={t('mobile')}><input className="input" inputMode="tel" value={f.contactPhone} onChange={(e) => up('contactPhone', e.target.value.replace(/[^\d+]/g, ''))} autoComplete="tel" /></Field>
            {f.fulfilment === 'delivery' && <><Field label={t('address')}><textarea className="textarea" value={f.line1} onChange={(e) => up('line1', e.target.value)} /></Field><div className="row"><Field label={t('city')}><input className="input" value={f.city} onChange={(e) => up('city', e.target.value)} /></Field><Field label={t('pincode')}><input className="input" inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => up('pincode', e.target.value.replace(/\D/g, ''))} /></Field></div></>}
            {f.fulfilment === 'pickup' && <div className="notice info small">{t('pickup_note')}</div>}</div>
          <div className="card"><h3 className="mb">{t('order_summary')}</h3>
            {Object.entries(c.sellerTotals).map(([sid, amt]) => <div key={sid} className="row between small"><span>{c.items.find((i) => i.shopId === sid)?.shopName}</span><b>{money(amt)}</b></div>)}
            <div className="row between mt"><b>{t('total')}</b><b className="price" style={{ fontSize: 20 }}>{money(c.totalPaise)}</b></div></div>
          <div className="notice"><b>{t('safety')}</b><br />{t('safety_checkout')} <Link to="/safety" style={{ textDecoration: 'underline' }}>{t('safety_guidelines')}</Link></div>
          <label className="check"><input type="checkbox" checked={f.age} onChange={(e) => up('age', e.target.checked)} />{t('age_confirm', { n: minAge })}</label>
          <label className="check"><input type="checkbox" checked={f.terms} onChange={(e) => up('terms', e.target.checked)} />{t('terms_confirm')}</label>
          {err && <div className="notice bad" role="alert">{errText}{err.details?.length > 0 && err.code === 'cart_unavailable' && <ul>{err.details.map((d, i) => <li key={i}>{d.name || ''} — {t(`cart.${d.reason}`)}</li>)}</ul>}</div>}
          <div className="row small muted"><Icon name="lock" width="16" height="16" />{t('pay.secure')}</div>
          {pending ? <Btn className="primary block" busy={busy} onClick={retry}>{t('pay.retry')}</Btn>
            : <Btn className="primary block" busy={busy} disabled={!canPay || !checkoutOn} onClick={submit}>{t('pay.upi')} · {money(c.totalPaise)}</Btn>}
          {err?.code === 'cart_unavailable' && <Link to="/cart" className="btn outline block">{t('review_cart')}</Link>}
        </div>);
      }}</Async></div>
    </div>
  );
}

// ───────── orders ─────────
const STEPS = { pickup: ['placed', 'accepted', 'preparing', 'ready', 'delivered'], delivery: ['placed', 'accepted', 'preparing', 'ready', 'dispatched', 'out_for_delivery', 'delivered'] };
export function OrdersPage() {
  const t = useT(); const list = usePaged('/orders');
  return (<div><TopBar title={t('nav.orders')} /><div className="page">
    {list.items.length === 0 && !list.loading && !list.error && <Empty icon="bag" title={t('no_orders')} action={<Link to="/search" className="btn primary mt">{t('browse')}</Link>} />}
    {list.items.length === 0 && list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
    <div className="col">{list.items.map((o) => (
      <Link key={o.id} to={`/orders/${o.id}`} className="card"><div className="row between"><b>{o.order_number}</b><Status value={o.status === 'paid' ? (o.statuses?.length === 1 ? o.statuses[0] : 'paid') : o.status} /></div>
        <div className="row mt" style={{ marginTop: 10 }}>{(o.items || []).slice(0, 4).map((i, k) => <Img key={k} src={i.image} className="thumb" alt="" />)}<div className="grow small muted">{(o.items || []).map((i) => `${i.name} ×${i.qty}`).join(', ').slice(0, 80)}</div></div>
        <div className="row between small mt" style={{ marginTop: 10 }}><span className="muted">{fmtDate(o.created_at)}</span><b>{money(o.total_paise)}</b></div></Link>))}</div>
    <PagedFooter list={list} /></div></div>);
}

export function OrderDetail() {
  const { id } = useParams(); const t = useT(); const { notify } = useApp(); const nav = useNavigate(); const loc = useLocation();
  const load = useLoad(() => api.get(`/orders/${id}`), [id]);
  const [review, setReview] = useState(null); const [busy, setBusy] = useState(false);
  // After paying, the webhook may land a moment after the client; poll briefly until the order is confirmed.
  useEffect(() => {
    if (!loc.state?.justPaid || load.data?.order.status !== 'pending_payment') return undefined;
    const iv = setInterval(load.reload, 3000); const stop = setTimeout(() => clearInterval(iv), 60000);
    return () => { clearInterval(iv); clearTimeout(stop); };
  }, [loc.state, load.data?.order.status]); // eslint-disable-line
  const cancel = async (sid) => { if (!confirm(t('cancel_confirm'))) return; setBusy(true); try { await api.post(`/orders/${id}/sub-orders/${sid}/cancel`, {}); notify(t('cancelled_ok')); load.reload(); } catch (e) { notify(e.message, 'bad'); } finally { setBusy(false); } };
  const payNow = async () => { setBusy(true); try { const r = await api.post(`/orders/${id}/pay`); const res = await payWithRazorpay(r.checkout); await api.post('/payments/verify', res).catch(() => {}); load.reload(); } catch (e) { if (!e.dismissed) notify(e.message, 'bad'); } finally { setBusy(false); } };
  return (<div><TopBar title={t('order_details')} back="/orders" /><div className="page"><Async load={load}>{({ order: o, subOrders }) => (
    <div className="col gap-l">
      {loc.state?.justPaid && o.status === 'paid' && <div className="notice ok">{t('order_confirmed')}</div>}
      {loc.state?.justPaid && o.status === 'pending_payment' && <div className="notice info">{t('payment_confirming')}</div>}
      <div className="card"><div className="row between"><b>{o.orderNumber}</b><Status value={o.status} /></div><div className="small muted">{fmtTime(o.createdAt)} · {t(o.fulfilment)}</div><div className="row between mt"><span>{t('total')}</span><b className="price">{money(o.totalPaise)}</b></div>
        {o.status === 'pending_payment' && new Date(o.expiresAt) > new Date() && <Btn className="primary block mt" busy={busy} onClick={payNow}>{t('pay.retry')}</Btn>}</div>
      {subOrders.map((s) => {
        const steps = STEPS[o.fulfilment]; const cur = steps.indexOf(s.status);
        return (<div key={s.id} className="card"><div className="row between"><Link to={`/shop/${s.shop_slug}`}><b>{s.shop_name}</b></Link><Status value={s.status} /></div>
          {(s.items || []).map((i) => (<div key={i.id} className="listrow"><Img src={i.image} className="thumb" alt="" /><div className="grow"><Link to={`/product/${i.productId}`}><b>{i.name}</b></Link><div className="small muted">{money(i.unitPaise)} × {i.qty}</div></div>
            {s.status === 'delivered' && !i.reviewed && <button className="btn sm outline" onClick={() => setReview(i)}>{t('write_review')}</button>}{i.reviewed && <span className="pill ok">✓</span>}</div>))}
          {s.status !== 'cancelled' && o.status !== 'pending_payment' && <div className="timeline mt">{steps.map((st, i) => { const ev = (s.events || []).find((e) => e.status === st); return <div key={st} className={`tl ${i <= cur ? 'done' : ''} ${i === cur ? 'now' : ''}`}><i /><div><b className="small">{t(`status.${st === 'delivered' && o.fulfilment === 'pickup' ? 'completed' : st}`)}</b>{ev && <div className="tiny muted">{fmtTime(ev.at)}</div>}</div></div>; })}</div>}
          <div className="small muted mt"><Icon name="pin" width="14" height="14" /> {s.shop_address} · <a href={`tel:${s.shop_phone}`} style={{ color: 'var(--purple)' }}>{s.shop_phone}</a></div>
          {s.status === 'placed' && o.status !== 'pending_payment' && <Btn className="danger sm mt" busy={busy} onClick={() => cancel(s.id)}>{t('cancel_order')}</Btn>}
        </div>);
      })}
      <Link to={`/support/new?order=${o.orderNumber}`} className="btn outline"><Icon name="help" width="20" height="20" />{t('need_help')}</Link>
    </div>)}</Async></div>
    {review && <ReviewModal item={review} onClose={() => setReview(null)} onDone={() => { setReview(null); load.reload(); }} />}</div>);
}
function ReviewModal({ item, onClose, onDone }) {
  const t = useT(); const { notify } = useApp(); const [r, setR] = useState(5); const [body, setBody] = useState(''); const [img, setImg] = useState(null); const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); try { await api.post('/reviews', { orderItemId: item.id, rating: r, body, ...(img ? { imageUrl: img } : {}) }); notify(t('review_thanks')); onDone(); } catch (e) { notify(e.message, 'bad'); } finally { setBusy(false); } };
  return <Modal title={`${t('write_review')} · ${item.name}`} onClose={onClose}><div className="col"><StarInput value={r} onChange={setR} /><textarea className="textarea" placeholder={t('review_placeholder')} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />{img && <Img src={img} className="thumb" />}<ImageUploader kind="review" onUploaded={setImg} /><Btn className="primary" busy={busy} onClick={send}>{t('submit')}</Btn></div></Modal>;
}

// ───────── wishlist / notifications / profile ─────────
export function WishlistPage() {
  const t = useT(); const wl = useWishlist(); const load = useLoad(() => api.get('/wishlist'), [wl.ids.size]);
  return (<div><TopBar title={t('wishlist')} back /><div className="page"><Async load={load}>{(d) => d.items.length ? <div className="grid">{d.items.map((p) => <ProductCard key={p.id} p={p} wl={wl} />)}</div> : <Empty icon="heart" title={t('wishlist_empty')} />}</Async></div></div>);
}

const NOTIF_LINK = (n) => n.data?.orderId ? `/orders/${n.data.orderId}` : n.data?.conversationId ? `/support/${n.data.conversationId}` : null;
export function NotificationsPage({ panelLink }) {
  const t = useT(); const { refreshCounts } = useApp(); const nav = useNavigate(); const list = usePaged('/notifications');
  useEffect(() => { if (list.items.some((n) => !n.read_at)) api.post('/notifications/read', {}).then(refreshCounts).catch(() => {}); }, [list.items.length]); // eslint-disable-line
  return (<div><TopBar title={t('notifications')} back />
    <div className="page">{list.items.length === 0 && !list.loading && !list.error && <Empty icon="bell" title={t('no_notifications')} />}
      {list.items.length === 0 && list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <div className="col gap-s">{list.items.map((n) => <button key={n.id} className="card" style={{ textAlign: 'left', background: n.read_at ? '#fff' : 'var(--grad-soft)' }} onClick={() => { const l = (panelLink && panelLink(n)) || NOTIF_LINK(n); if (l) nav(l); }}><b>{n.title || t(`notif.${n.kind}.t`)}</b><div className="small">{n.body || t(`notif.${n.kind}.b`, notifVars(n, t))}</div><div className="tiny muted">{fmtTime(n.created_at)}</div></button>)}</div>
      <PagedFooter list={list} /></div></div>);
}
export const notifVars = (n, t) => ({ ...n.data, amount: n.data?.amountPaise != null ? money(n.data.amountPaise) : '', status: n.data?.status ? t(`status.${n.data.status}`) : '', note: n.data?.note ? ` — ${n.data.note}` : '' });

export function ProfilePage() {
  const t = useT(); const { lang, setLang } = useI18n(); const { user, signOut, setLanguage, notify, config } = useApp(); const nav = useNavigate();
  const [lg, setLg] = useState(false);
  if (!user) return (<div><TopBar title={t('nav.profile')} /><div className="page col"><Empty icon="user" title={t('login_prompt')} action={<Link to="/login" className="btn primary mt">{t('login')}</Link>} />
    <button className="listrow" onClick={() => setLg(true)}><Icon name="globe" className="lead" /><span className="grow">{t('language')}</span><b>{LANGS.find((l) => l.code === lang)?.label}</b></button>
    <Link to="/seller/register" className="listrow"><Icon name="store" className="lead" /><span className="grow">{t('become_seller')}</span><Icon name="chevron" width="18" height="18" /></Link>
    {lg && <LanguageModal onClose={() => setLg(false)} />}</div></div>);
  const rows = [['/orders', 'bag', 'nav.orders'], ['/wishlist', 'heart', 'wishlist'], ['/notifications', 'bell', 'notifications'], ['/support', 'help', 'help_support'], ['/safety', 'shield', 'safety_guidelines']];
  return (<div><TopBar title={t('nav.profile')} /><div className="page">
    <div className="card row"><div className="avatar" style={{ width: 56, height: 56, fontSize: 22 }}>{user.name[0]}</div><div className="grow"><h2>{user.name}</h2><div className="small muted">{user.email || user.phone}</div></div></div>
    {user.phone && !user.phoneVerified && config?.features.sms && <VerifyPhone />}
    <div className="mt">{rows.map(([to, ic, k]) => <Link key={to} to={to} className="listrow"><Icon name={ic} className="lead" /><span className="grow">{t(k)}</span><Icon name="chevron" width="18" height="18" /></Link>)}
      <button className="listrow" style={{ width: '100%' }} onClick={() => setLg(true)}><Icon name="globe" className="lead" /><span className="grow" style={{ textAlign: 'left' }}>{t('language')}</span><b>{LANGS.find((l) => l.code === lang)?.label}</b></button>
      <button className="listrow" style={{ width: '100%', color: 'var(--bad)' }} onClick={async () => { await signOut(); nav('/'); }}><Icon name="logout" className="lead" style={{ color: 'var(--bad)' }} /><span className="grow" style={{ textAlign: 'left' }}>{t('logout')}</span></button></div>
    <p className="tiny muted center mt">MAVRIX FIRE v1.0 · from SAYRIX MATHAV</p>
    {lg && <LanguageModal onClose={() => setLg(false)} />}</div></div>);
}
export function LanguageModal({ onClose }) {
  const t = useT(); const { lang } = useI18n(); const { setLanguage } = useApp();
  return <Modal title={t('language')} onClose={onClose}><div className="col">{LANGS.map((l) => <button key={l.code} className="langcard" style={lang === l.code ? { borderColor: 'var(--purple)', background: 'var(--grad-soft)' } : undefined} onClick={() => { setLanguage(l.code); onClose(); }}>{l.label}{lang === l.code && <Icon name="check" />}</button>)}</div></Modal>;
}

// ───────── customer care ─────────
const CATS = ['order', 'payment', 'product', 'delivery', 'refund', 'seller', 'other'];
export function SupportList() {
  const t = useT(); const load = useLoad(() => api.get('/support'), []);
  return (<div><TopBar title={t('help_support')} back="/profile" /><div className="page">
    <Link to="/support/new" className="btn primary block mb"><Icon name="message" width="20" height="20" />{t('contact_support')}</Link>
    <Async load={load}>{(d) => d.items.length ? <div className="col">{d.items.map((c) => <Link key={c.id} to={`/support/${c.id}`} className="card"><div className="row between"><b>{t(`support.cat.${c.category}`)}{c.order_ref && ` · ${c.order_ref}`}</b><Status value={c.status} /></div><div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_message}</div><div className="tiny muted">{fmtTime(c.last_message_at)}</div></Link>)}</div> : <Empty icon="message" title={t('support_none')} />}</Async></div></div>);
}
export function SupportNew() {
  const t = useT(); const { notify } = useApp(); const nav = useNavigate(); const [sp] = useSearchParams();
  // The typed message is kept in the form (and in sessionStorage) so a failed send never loses it.
  const draft = (() => { try { return JSON.parse(sessionStorage.getItem('mf_support_draft') || '{}'); } catch { return {}; } })();
  const [f, setF] = useState({ category: draft.category || 'order', orderNumber: sp.get('order') || draft.orderNumber || '', message: draft.message || '' });
  const [img, setImg] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const up = (k, v) => { const n = { ...f, [k]: v }; setF(n); try { sessionStorage.setItem('mf_support_draft', JSON.stringify(n)); } catch { /* ignore */ } };
  const send = async () => { setBusy(true); setErr(null); try { const r = await api.post('/support', { category: f.category, message: f.message, ...(f.orderNumber ? { orderNumber: f.orderNumber } : {}), ...(img ? { imageUrl: img } : {}) }); try { sessionStorage.removeItem('mf_support_draft'); } catch { /* ignore */ } notify(t('support_sent')); nav(`/support/${r.id}`, { replace: true }); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (<div><TopBar title={t('contact_support')} back /><div className="page col">
    <Field label={t('issue_category')}><select className="select" value={f.category} onChange={(e) => up('category', e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{t(`support.cat.${c}`)}</option>)}</select></Field>
    <Field label={t('order_id_optional')}><input className="input" value={f.orderNumber} onChange={(e) => up('orderNumber', e.target.value.toUpperCase())} placeholder="MF100001" /></Field>
    <Field label={t('message')} error={fieldErr(err, 'message')}><textarea className="textarea" value={f.message} onChange={(e) => up('message', e.target.value)} maxLength={3000} /></Field>
    {img && <Img src={img} className="thumb" />}<ImageUploader kind="support" onUploaded={setImg} label={t('attach_image')} />
    {err && <div className="notice bad" role="alert">{err.status === 0 ? t('err.network') : err.message} <button className="btn sm outline" onClick={send}>{t('retry')}</button></div>}
    <Btn className="primary" busy={busy} disabled={f.message.trim().length < 3} onClick={send}><Icon name="send" width="18" height="18" />{t('send')}</Btn></div></div>);
}
export function useThread({ loadPath, postPath, onChanged }) {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => api.get(loadPath), [loadPath]);
  const [text, setText] = useState(''); const [img, setImg] = useState(null); const [busy, setBusy] = useState(false); const end = useRef();
  useEffect(() => { const iv = setInterval(load.reload, 15000); return () => clearInterval(iv); }, [loadPath]); // eslint-disable-line
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [load.data?.messages.length]);
  const send = async (extra = {}) => { setBusy(true); try { await api.post(postPath, { message: text, ...(img ? { imageUrl: img } : {}), ...extra }); setText(''); setImg(null); await load.reload(); onChanged?.(); } catch (e) { notify(e.status === 0 ? t('err.network') : e.message, 'bad'); } finally { setBusy(false); } };
  return { load, text, setText, img, setImg, busy, send, end };
}
export function SupportThread() {
  const { id } = useParams(); const t = useT();
  const th = useThread({ loadPath: `/support/${id}`, postPath: `/support/${id}/messages` });
  return (<div><TopBar title={t('help_support')} back="/support" /><div className="page"><Async load={th.load}>{({ conversation: c, messages }) => (<>
    <div className="row between mb"><b>{t(`support.cat.${c.category}`)}{c.order_ref && ` · ${c.order_ref}`}</b><Status value={c.status} /></div>
    <div className="col" style={{ minHeight: 200 }}>{messages.map((m) => <div key={m.id} className={`bubble ${m.sender_role === 'customer' ? 'me' : ''}`}>{m.body}{m.image_url && <Img src={m.image_url} />}<div className="tiny" style={{ opacity: .7, marginTop: 4 }}>{m.sender_role === 'admin' ? 'MAVRIX FIRE · ' : ''}{fmtTime(m.created_at)}</div></div>)}<div ref={th.end} /></div>
    <div className="mt col">{th.img && <Img src={th.img} className="thumb" />}<div className="row"><textarea className="textarea" style={{ minHeight: 46, height: 46 }} value={th.text} onChange={(e) => th.setText(e.target.value)} placeholder={t('type_message')} /><Btn className="primary" busy={th.busy} disabled={!th.text.trim()} onClick={() => th.send()} aria-label={t('send')}><Icon name="send" width="18" height="18" /></Btn></div><div><ImageUploader kind="support" onUploaded={th.setImg} label={t('attach_image')} /></div></div>
  </>)}</Async></div></div>);
}

export function SafetyPage() {
  const t = useT(); const { config } = useApp();
  const pts = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  return (<div><TopBar title={t('safety_guidelines')} back /><div className="page col">
    <div className="notice">{t('safety.legal', { n: config?.settings?.min_customer_age || 18 })}</div>
    <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>{pts.map((p) => <li key={p}>{t(`safety.${p}`)}</li>)}</ul>
    <p className="muted small">{t('safety.restrictions')}</p></div></div>);
}

function VerifyPhone() {
  const t = useT(); const { notify, user, setUser } = useApp(); const [sent, setSent] = useState(false); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); try { await api.post('/auth/otp/send', { phone: user.phone, purpose: 'verify' }); setSent(true); notify(t('otp_sent')); } catch (e) { notify(e.status === 0 ? t('err.network') : e.message, 'bad'); } finally { setBusy(false); } };
  const verify = async () => { setBusy(true); try { await api.post('/me/phone/verify', { code }); setUser({ ...user, phoneVerified: true }); notify(t('mobile_verified')); } catch (e) { notify(e.message, 'bad'); } finally { setBusy(false); } };
  return <div className="card soft mt col"><b>{t('verify_mobile')}</b>{sent && <input className="input" inputMode="numeric" maxLength={6} placeholder={t('enter_otp')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
    {sent ? <Btn className="primary" busy={busy} disabled={code.length !== 6} onClick={verify}>{t('verify')}</Btn> : <Btn className="primary" busy={busy} onClick={send}>{t('send_otp')}</Btn>}</div>;
}
