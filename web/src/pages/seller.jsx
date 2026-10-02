import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, Navigate } from 'react-router-dom';
import { api, money, fmtDate, fmtTime } from '../api.js';
import { useApp } from '../store.jsx';
import { useI18n, useT, catName } from '../i18n.jsx';
import { Icon, Logo, Async, useLoad, usePaged, PagedFooter, Empty, ErrorBox, Field, fieldErr, Btn, Modal, Img, Status, ImageUploader, TopBar, Stars, Spinner } from '../ui.jsx';
import { DataList, Stat, Bars, rupeesToPaise, paiseToRupees } from './panel.jsx';
import { payWithRazorpay } from '../pay.js';
import { notifVars } from './customer.jsx';

// ───────── registration ─────────
export function SellerRegister() {
  const t = useT(); const { lang } = useI18n(); const { signIn, user } = useApp(); const nav = useNavigate();
  const [f, setF] = useState({ shopName: '', ownerName: '', phone: '', email: '', password: '', address: '', pincode: '', description: '', pickupEnabled: true, deliveryEnabled: false });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  if (user) return <Navigate to={user.role === 'seller' ? '/seller' : '/'} replace />;
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await api.post('/auth/register-seller', { ...f, language: lang }); signIn(r); nav('/seller/shop', { replace: true }); } catch (e2) { setErr(e2); } finally { setBusy(false); } };
  const E = (p) => fieldErr(err, p);
  return (<div className="app-shell" style={{ paddingBottom: 24 }}><TopBar title={t('become_seller')} back="/login" />
    <form className="page col" style={{ maxWidth: 520, margin: '0 auto' }} onSubmit={submit}>
      <div className="notice info">{t('seller.reg_intro')}</div>
      <Field label={t('seller.shop_name')} error={E('shopName')}><input className="input" value={f.shopName} onChange={(e) => up('shopName', e.target.value)} required /></Field>
      <Field label={t('seller.owner_name')} error={E('ownerName')}><input className="input" value={f.ownerName} onChange={(e) => up('ownerName', e.target.value)} required /></Field>
      <div className="row"><Field label={t('mobile')} error={E('phone')}><input className="input" inputMode="tel" value={f.phone} onChange={(e) => up('phone', e.target.value)} required /></Field><Field label={t('email')} error={E('email')}><input className="input" type="email" value={f.email} onChange={(e) => up('email', e.target.value)} required /></Field></div>
      <Field label={t('password')} error={E('password')} hint={t('password_hint')}><input className="input" type="password" value={f.password} onChange={(e) => up('password', e.target.value)} minLength={8} required autoComplete="new-password" /></Field>
      <Field label={t('seller.shop_address')} error={E('address')}><textarea className="textarea" value={f.address} onChange={(e) => up('address', e.target.value)} required /></Field>
      <div className="row"><Field label={t('pincode')} error={E('pincode')}><input className="input" inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => up('pincode', e.target.value.replace(/\D/g, ''))} required /></Field><Field label={t('city')}><input className="input" value="Sivakasi" disabled /></Field></div>
      <Field label={t('seller.business_info')} error={E('description')}><textarea className="textarea" value={f.description} onChange={(e) => up('description', e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={f.pickupEnabled} onChange={(e) => up('pickupEnabled', e.target.checked)} />{t('pickup')}</label>
      <label className="check"><input type="checkbox" checked={f.deliveryEnabled} onChange={(e) => up('deliveryEnabled', e.target.checked)} />{t('seller.offer_delivery')}</label>
      <div className="notice">{t('seller.reg_next')}</div>
      {err && !err.details && <div className="notice bad" role="alert">{err.status === 0 ? t('err.network') : err.code === 'duplicate' ? t('err.duplicate') : err.message}</div>}
      <Btn className="primary" busy={busy} type="submit">{t('seller.submit_reg')}</Btn>
    </form></div>);
}

// ───────── dashboard ─────────
export function SellerDashboard() {
  const t = useT(); const load = useLoad(() => Promise.all([api.get('/seller/dashboard'), api.get('/seller/shop')]), []);
  return (<Async load={load}>{([d, s]) => (
    <div className="col gap-l">
      <h1>{s.shop.name}</h1>
      <StatusBanner shop={s.shop} />
      <Checklist s={s} />
      <div className="stats">
        <Stat grad label={t('seller.sales_today')} value={money(d.sales.today)} /><Stat label={t('seller.sales_month')} value={money(d.sales.month)} /><Stat label={t('seller.sales_total')} value={money(d.sales.total)} />
        <Stat label={t('seller.commission')} value={money(d.sales.commission)} /><Stat label={t('seller.net_earnings')} value={money(d.sales.net)} />
        <Stat label={t('status.placed')} value={d.byStatus.placed || 0} /><Stat label={t('status.preparing')} value={(d.byStatus.accepted || 0) + (d.byStatus.preparing || 0)} /><Stat label={t('rating')} value={`${Number(d.rating.avg).toFixed(1)} (${d.rating.count})`} />
      </div>
      <div className="card"><h3 className="mb">{t('seller.last14')}</h3><Bars data={d.daily} valueKey="paise" /></div>
      {d.lowStock.length > 0 && <div className="card"><h3 className="mb">{t('seller.low_stock')}</h3>{d.lowStock.map((p) => <Link key={p.id} to={`/seller/products/${p.id}`} className="listrow"><span className="grow">{p.name}</span>{p.stock === 0 ? <span className="pill bad">{t('out_of_stock')}</span> : <span className="pill warn">{p.stock}</span>}</Link>)}</div>}
    </div>)}</Async>);
}
function StatusBanner({ shop }) {
  const t = useT();
  if (shop.status === 'approved') return null;
  return <div className={`notice ${shop.status === 'pending' ? 'info' : 'bad'}`} role="status"><b>{t(`seller.banner.${shop.status}`)}</b>{shop.status_note && <div>{shop.status_note}</div>}{shop.status === 'update_required' && <Link to="/seller/shop" style={{ textDecoration: 'underline' }}> {t('seller.update_profile')}</Link>}</div>;
}
function Checklist({ s }) {
  const t = useT(); if (s.live) return null;
  const steps = [[s.shop.status === 'approved', 'seller.step_approval', null], [!!s.subscription, 'seller.step_plan', '/seller/payments'], [s.shop.payout_status === 'active', 'seller.step_payout', '/seller/payments']];
  return <div className="card"><h3 className="mb">{t('seller.go_live')}</h3>{steps.map(([ok, k, to]) => <div key={k} className="listrow"><span className={`pill ${ok ? 'ok' : 'warn'}`}>{ok ? '✓' : '•'}</span><span className="grow">{t(k)}</span>{!ok && to && s.shop.status === 'approved' && <Link to={to} className="btn sm primary">{t('open')}</Link>}</div>)}</div>;
}

// ───────── products ─────────
export function SellerProducts() {
  const t = useT(); const { lang } = useI18n(); const { notify } = useApp(); const [q, setQ] = useState(''); const load = useLoad(() => api.get(`/seller/products?q=${encodeURIComponent(q)}`), [q]);
  const stock = async (p, delta) => { try { const r = await api.patch(`/seller/products/${p.id}/stock`, { delta }); load.setData({ items: load.data.items.map((x) => x.id === p.id ? { ...x, stock: r.stock } : x) }); } catch (e) { notify(e.message, 'bad'); } };
  const toggle = async (p) => { try { await api.patch(`/seller/products/${p.id}/availability`, { isAvailable: !p.is_available }); load.setData({ items: load.data.items.map((x) => x.id === p.id ? { ...x, is_available: !p.is_available } : x) }); } catch (e) { notify(e.message, 'bad'); } };
  const del = async (p) => { if (!confirm(t('confirm_delete'))) return; try { await api.del(`/seller/products/${p.id}`); load.reload(); } catch (e) { notify(e.message, 'bad'); } };
  return (<div className="col gap-l"><div className="row between wrap"><h1>{t('seller.products')}</h1><Link to="/seller/products/new" className="btn primary"><Icon name="plus" width="18" height="18" />{t('seller.add_product')}</Link></div>
    <div className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_generic')} /></div>
    <Async load={load}>{(d) => d.items.length === 0 ? <Empty icon="box" title={t('seller.no_products')} hint={t('seller.no_products_hint')} /> : <div className="col">{d.items.map((p) => (
      <div key={p.id} className="card row" style={{ alignItems: 'flex-start' }}>
        <Img src={p.images?.[0]} className="thumb" alt="" />
        <div className="grow"><div className="row between wrap"><b>{p.name}</b><Status value={p.approval_status} /></div>
          <div className="small muted">{catName(p, lang)} · {money(p.price_paise)}{p.discount_price_paise && ` → ${money(p.discount_price_paise)}`}</div>
          {p.approval_status === 'rejected' && p.rejection_note && <div className="small" style={{ color: 'var(--bad)' }}>{p.rejection_note}</div>}
          <div className="row wrap mt" style={{ marginTop: 8 }}>
            <div className="qty"><button onClick={() => stock(p, -1)} aria-label="-"><Icon name="minus" width="16" height="16" /></button><span>{p.stock}</span><button onClick={() => stock(p, 1)} aria-label="+"><Icon name="plus" width="16" height="16" /></button></div>
            <button className="btn sm outline" onClick={() => stock(p, 10)}>+10</button>
            {p.stock === 0 && <span className="pill bad">{t('out_of_stock')}</span>}
            <label className="check small"><input type="checkbox" checked={p.is_available} onChange={() => toggle(p)} />{t('seller.available')}</label>
            <div className="grow" /><Link to={`/seller/products/${p.id}`} className="icon-btn" aria-label={t('edit')}><Icon name="edit" /></Link><button className="icon-btn" onClick={() => del(p)} aria-label={t('delete')}><Icon name="trash" /></button></div></div>
      </div>))}</div>}</Async></div>);
}

export function ProductForm() {
  const { id } = useParams(); const t = useT(); const { lang } = useI18n(); const { config, notify } = useApp(); const nav = useNavigate();
  const isNew = !id || id === 'new';
  const load = useLoad(() => (isNew ? Promise.resolve(null) : api.get(`/seller/products/${id}`)), [id]);
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  useEffect(() => {
    if (load.loading) return;
    const p = load.data?.product;
    setF(p ? { name: p.name, description: p.description, packQuantity: p.pack_quantity, categoryId: p.category_id, price: paiseToRupees(p.price_paise), discount: paiseToRupees(p.discount_price_paise), stock: String(p.stock), isAvailable: p.is_available, safetyNote: p.safety_note, images: p.images }
      : { name: '', description: '', packQuantity: '', categoryId: config?.categories?.[0]?.id, price: '', discount: '', stock: '0', isAvailable: true, safetyNote: '', images: [] });
  }, [load.loading, load.data, config]);
  if (load.error) return <ErrorBox error={load.error} onRetry={load.reload} />;
  if (!f) return <Spinner />;
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const body = { name: f.name, description: f.description, packQuantity: f.packQuantity, categoryId: Number(f.categoryId), pricePaise: rupeesToPaise(f.price), discountPricePaise: f.discount ? rupeesToPaise(f.discount) : null, stock: parseInt(f.stock || '0', 10), isAvailable: f.isAvailable, safetyNote: f.safetyNote, images: f.images };
    try { isNew ? await api.post('/seller/products', body) : await api.put(`/seller/products/${id}`, body); notify(t('saved')); nav('/seller/products'); } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  const E = (p) => fieldErr(err, p);
  return (<form className="col gap-l" style={{ maxWidth: 640 }} onSubmit={save}><h1>{isNew ? t('seller.add_product') : t('seller.edit_product')}</h1>
    <div className="card col"><h3>{t('seller.photos')}</h3><div className="row wrap">{f.images.map((u, i) => <div key={u} style={{ position: 'relative' }}><Img src={u} className="thumb" alt="" /><button type="button" className="icon-btn" style={{ position: 'absolute', top: -10, right: -10, background: '#fff', width: 26, height: 26, boxShadow: 'var(--shadow)' }} onClick={() => up('images', f.images.filter((x) => x !== u))} aria-label={t('remove')}><Icon name="x" width="14" height="14" /></button>{i === 0 && <span className="pill grad" style={{ position: 'absolute', bottom: 2, left: 2, fontSize: 9 }}>{t('seller.cover')}</span>}</div>)}</div>
      {f.images.length < 8 && <ImageUploader kind="product" multiple onUploaded={(u) => setF((x) => ({ ...x, images: [...x.images, u].slice(0, 8) }))} />}{E('images') && <span className="err" style={{ color: 'var(--bad)' }}>{E('images')}</span>}</div>
    <div className="card col">
      <Field label={t('seller.product_name')} error={E('name')}><input className="input" value={f.name} onChange={(e) => up('name', e.target.value)} required /></Field>
      <Field label={t('category')}><select className="select" value={f.categoryId} onChange={(e) => up('categoryId', e.target.value)}>{(config?.categories || []).map((c) => <option key={c.id} value={c.id}>{catName(c, lang)}</option>)}</select></Field>
      <Field label={t('pack')} hint={t('seller.pack_hint')}><input className="input" value={f.packQuantity} onChange={(e) => up('packQuantity', e.target.value)} /></Field>
      <div className="row"><Field label={`${t('price')} (₹)`} error={E('pricePaise')}><input className="input" inputMode="decimal" value={f.price} onChange={(e) => up('price', e.target.value)} required /></Field><Field label={`${t('seller.discount_price')} (₹)`} error={E('discountPricePaise')}><input className="input" inputMode="decimal" value={f.discount} onChange={(e) => up('discount', e.target.value)} /></Field></div>
      <div className="row"><Field label={t('seller.stock')} error={E('stock')}><input className="input" inputMode="numeric" value={f.stock} onChange={(e) => up('stock', e.target.value.replace(/\D/g, ''))} required /></Field></div>
      <Field label={t('description')} error={E('description')}><textarea className="textarea" value={f.description} onChange={(e) => up('description', e.target.value)} /></Field>
      <Field label={t('safety')} hint={t('seller.safety_hint')}><textarea className="textarea" style={{ minHeight: 60 }} value={f.safetyNote} onChange={(e) => up('safetyNote', e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={f.isAvailable} onChange={(e) => up('isAvailable', e.target.checked)} />{t('seller.available')}</label>
    </div>
    <div className="notice info">{t('seller.review_note')}</div>
    {err && !err.details && <div className="notice bad" role="alert">{err.message}</div>}
    <div className="row"><Link to="/seller/products" className="btn outline">{t('cancel')}</Link><Btn className="primary grow" busy={busy} type="submit" disabled={f.images.length === 0}>{t('save')}</Btn></div>
  </form>);
}

// ───────── orders ─────────
const FILTERS = ['', 'placed', 'accepted', 'preparing', 'ready', 'dispatched', 'out_for_delivery', 'delivered', 'cancelled'];
export function SellerOrders() {
  const t = useT(); const [st, setSt] = useState(''); const [sel, setSel] = useState(null); const list = usePaged(`/seller/orders${st ? `?status=${st}` : ''}`, [st]);
  return (<div className="col gap-l"><h1>{t('seller.orders')}</h1>
    <div className="chips">{FILTERS.map((s) => <button key={s} className={`chip ${st === s ? 'active' : ''}`} onClick={() => setSt(s)}>{s ? t(`status.${s}`) : t('all')}</button>)}</div>
    {list.items.length === 0 && !list.loading && !list.error && <Empty icon="bag" title={t('seller.no_orders')} />}
    {list.items.length === 0 && list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
    <div className="col">{list.items.map((o) => <button key={o.id} className="card" style={{ textAlign: 'left' }} onClick={() => setSel(o.id)}><div className="row between"><b>{o.order_number}</b><Status value={o.status} /></div><div className="small muted">{(o.items || []).map((i) => `${i.name} ×${i.qty}`).join(', ')}</div><div className="row between small" style={{ marginTop: 6 }}><span>{o.contact_name} · {t(o.fulfilment)} · {fmtTime(o.created_at)}</span><b>{money(o.subtotal_paise)}</b></div></button>)}</div>
    <PagedFooter list={list} />{sel && <SellerOrderModal id={sel} onClose={() => setSel(null)} onChanged={list.reload} />}</div>);
}
function SellerOrderModal({ id, onClose, onChanged }) {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => api.get(`/seller/orders/${id}`), [id]); const [busy, setBusy] = useState(false); const [reason, setReason] = useState('');
  const go = async (status) => { setBusy(true); try { await api.post(`/seller/orders/${id}/status`, { status }); await load.reload(); onChanged(); } catch (e) { notify(e.message, 'bad'); } finally { setBusy(false); } };
  const cancel = async () => { setBusy(true); try { await api.post(`/seller/orders/${id}/cancel`, { reason }); notify(t('cancelled_ok')); onChanged(); onClose(); } catch (e) { notify(e.message, 'bad'); } finally { setBusy(false); } };
  return (<Modal title={load.data?.order.order_number || t('order_details')} onClose={onClose}><Async load={load}>{({ order: o, items, events, nextStatuses }) => (<div className="col">
    <div className="row between"><Status value={o.status} /><span className="small muted">{t(o.fulfilment)}</span></div>
    <div className="card soft small"><b>{o.contact_name}</b> · <a href={`tel:${o.contact_phone}`} style={{ color: 'var(--purple)' }}>{o.contact_phone}</a>{o.delivery_address && <div>{o.delivery_address.line1}, {o.delivery_address.city} {o.delivery_address.pincode}</div>}</div>
    {items.map((i) => <div key={i.id} className="listrow"><Img src={i.image_url} className="thumb" alt="" /><div className="grow"><b>{i.name}</b><div className="small muted">{money(i.unit_price_paise)} × {i.qty}</div></div><b>{money(i.line_total_paise)}</b></div>)}
    <div className="small col gap-s"><div className="row between"><span>{t('total')}</span><b>{money(o.subtotal_paise)}</b></div><div className="row between muted"><span>{t('seller.commission')} ({o.commission_bps / 100}%)</span><span>− {money(o.commission_paise)}</span></div><div className="row between"><span>{t('seller.you_receive')}</span><b>{money(o.seller_amount_paise)}</b></div></div>
    <div className="timeline">{events.map((e, i) => <div key={i} className="tl done"><i /><div><b className="small">{t(`status.${e.status}`)}</b><div className="tiny muted">{fmtTime(e.created_at)}</div></div></div>)}</div>
    {nextStatuses.filter((s) => s !== 'cancelled').map((s) => <Btn key={s} className="primary" busy={busy} onClick={() => go(s)}>{t(`seller.mark.${s === 'delivered' && o.fulfilment === 'pickup' ? 'completed' : s}`)}</Btn>)}
    {['placed', 'accepted', 'preparing'].includes(o.status) && <div className="col"><input className="input" placeholder={t('cancel_reason')} value={reason} onChange={(e) => setReason(e.target.value)} /><Btn className="danger" busy={busy} disabled={reason.trim().length < 3} onClick={cancel}>{t('seller.cancel_refund')}</Btn></div>}
  </div>)}</Async></Modal>);
}

// ───────── offers / reviews / payments / shop ─────────
export function SellerOffers() {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => Promise.all([api.get('/seller/offers'), api.get('/seller/products')]), []); const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', discountPercent: '10', productId: '', endsAt: '' }); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api.post('/seller/offers', { title: f.title, discountPercent: parseInt(f.discountPercent, 10), productId: f.productId || null, endsAt: new Date(f.endsAt + 'T23:59:59').toISOString() }); setOpen(false); load.reload(); } catch (e) { notify(e.message, 'bad'); } finally { setBusy(false); } };
  return (<div className="col gap-l"><div className="row between"><h1>{t('seller.offers')}</h1><button className="btn primary" onClick={() => setOpen(true)}><Icon name="plus" width="18" height="18" />{t('seller.new_offer')}</button></div>
    <Async load={load}>{([o, p]) => <>{o.items.length === 0 ? <Empty icon="tag" title={t('seller.no_offers')} /> : <div className="col">{o.items.map((x) => <div key={x.id} className="card row"><span className="pill grad">{x.discount_percent}%</span><div className="grow"><b>{x.title}</b><div className="small muted">{x.product_name || t('seller.whole_shop')} · {t('until')} {fmtDate(x.ends_at)}</div></div>{x.is_active && new Date(x.ends_at) > new Date() ? <button className="btn sm danger" onClick={async () => { await api.del(`/seller/offers/${x.id}`); load.reload(); }}>{t('stop')}</button> : <span className="pill">{t('ended')}</span>}</div>)}</div>}
      {open && <Modal title={t('seller.new_offer')} onClose={() => setOpen(false)}><div className="col"><Field label={t('title')}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label={`${t('seller.discount')} %`}><input className="input" inputMode="numeric" value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label={t('product')}><select className="select" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="">{t('seller.whole_shop')}</option>{p.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label={t('seller.ends_on')}><input className="input" type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field><Btn className="primary" busy={busy} disabled={!f.title || !f.endsAt} onClick={save}>{t('save')}</Btn></div></Modal>}</>}</Async></div>);
}
export function SellerReviews() {
  const t = useT(); const load = useLoad(() => api.get('/seller/reviews'), []);
  return <div className="col gap-l"><h1>{t('seller.reviews')}</h1><Async load={load}>{(d) => d.items.length ? <div className="col">{d.items.map((r) => <div key={r.id} className="card"><div className="row between"><b>{r.product_name}</b><Stars value={r.rating} /></div><p style={{ margin: '4px 0' }}>{r.body}</p><div className="tiny muted">{r.reviewer} · {fmtDate(r.created_at)}</div></div>)}</div> : <Empty icon="star" title={t('no_reviews')} />}</Async></div>;
}

export function SellerPayments() {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => Promise.all([api.get('/seller/shop'), api.get('/seller/settlements')]), []); const [busy, setBusy] = useState(false); const [kyc, setKyc] = useState(false);
  const pay = async () => { setBusy(true); try { const r = await api.post('/seller/subscription/pay'); const res = await payWithRazorpay(r.checkout); await api.post('/payments/verify', res).catch(() => {}); notify(t('seller.plan_paid')); load.reload(); } catch (e) { if (!e.dismissed) notify(e.code === 'payments_not_configured' ? t('err.payments_off') : e.message, 'bad'); } finally { setBusy(false); } };
  const refresh = async () => { try { await api.get('/seller/payout/status'); load.reload(); } catch (e) { notify(e.message, 'bad'); } };
  return (<Async load={load}>{([s, st]) => { const sub = s.subscription; const days = sub ? Math.ceil((new Date(sub.expires_at) - Date.now()) / 86400000) : 0;
    return (<div className="col gap-l"><h1>{t('seller.payments')}</h1>
      <div className="card col"><h3>{t('seller.plan')}</h3>
        {sub ? <><div className="row between"><span className="pill ok">{t('status.active')}</span><b>{t('seller.expires')} {fmtDate(sub.expires_at)}</b></div>{days <= 15 && <div className="notice">{t('notif.subscription_expiring.b', { days, shop: s.shop.name })}</div>}</> : <div className="notice">{t('seller.no_plan')}</div>}
        <div className="small muted">{t('seller.plan_price')}</div>
        <Btn className="primary" busy={busy} disabled={s.shop.status !== 'approved'} onClick={pay}>{sub ? t('seller.renew') : t('seller.pay_plan')}</Btn>
        {s.shop.status !== 'approved' && <div className="small muted">{t('seller.after_approval')}</div>}
        {s.subscriptionHistory.length > 0 && <table className="t"><thead><tr><th>{t('date')}</th><th>{t('amount')}</th><th>{t('status')}</th></tr></thead><tbody>{s.subscriptionHistory.map((h) => <tr key={h.id}><td>{fmtDate(h.created_at)}</td><td>{money(h.amount_paise)}</td><td><Status value={h.status} /></td></tr>)}</tbody></table>}</div>
      <div className="card col"><h3>{t('seller.payout')}</h3><div className="row between"><span>{t('status')}</span><Status value={s.shop.payout_status} /></div>
        <p className="small muted">{t('seller.payout_info')}</p>
        {s.shop.status === 'approved' && !s.shop.razorpay_linked && <Btn className="primary" onClick={() => setKyc(true)}>{t('seller.setup_payout')}</Btn>}
        {s.shop.razorpay_linked && s.shop.payout_status !== 'active' && <Btn className="outline" onClick={refresh}>{t('refresh')}</Btn>}</div>
      <div className="stats"><Stat label={t('seller.pending_settlement')} value={money(st.totals.pending)} /><Stat label={t('seller.paid_out')} value={money(st.totals.paid)} /></div>
      <div className="card"><h3 className="mb">{t('seller.settlements')}</h3>{st.items.length === 0 ? <Empty icon="wallet" title={t('nothing_here')} /> : <div className="tablewrap"><table className="t"><thead><tr><th>{t('order')}</th><th>{t('seller.gross')}</th><th>{t('seller.commission')}</th><th>{t('seller.net')}</th><th>{t('status')}</th></tr></thead><tbody>{st.items.map((r) => <tr key={r.id}><td>{r.order_number}</td><td>{money(r.gross_paise)}</td><td>{money(r.commission_paise)}</td><td><b>{money(r.net_paise)}</b></td><td><Status value={r.status} /></td></tr>)}</tbody></table></div>}</div>
      {kyc && <PayoutModal onClose={() => setKyc(false)} onDone={() => { setKyc(false); load.reload(); }} />}</div>); }}</Async>);
}
function PayoutModal({ onClose, onDone }) {
  const t = useT(); const { notify } = useApp(); const [f, setF] = useState({ legalName: '', businessType: 'proprietorship', pan: '', gst: '', accountNumber: '', ifsc: '', beneficiaryName: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v })); const E = (p) => fieldErr(err, p);
  const go = async () => { setBusy(true); setErr(null); try { await api.post('/seller/payout/onboard', { ...f, gst: f.gst || undefined }); notify(t('seller.payout_submitted')); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return <Modal title={t('seller.setup_payout')} onClose={onClose}><div className="col"><div className="notice info small"><Icon name="lock" width="14" height="14" /> {t('seller.payout_secure')}</div>
    <Field label={t('seller.legal_name')} error={E('legalName')}><input className="input" value={f.legalName} onChange={(e) => up('legalName', e.target.value)} /></Field>
    <Field label={t('seller.business_type')}><select className="select" value={f.businessType} onChange={(e) => up('businessType', e.target.value)}>{['individual', 'proprietorship', 'partnership', 'private_limited', 'llp'].map((b) => <option key={b} value={b}>{t(`seller.bt.${b}`)}</option>)}</select></Field>
    <div className="row"><Field label="PAN" error={E('pan')}><input className="input" value={f.pan} maxLength={10} onChange={(e) => up('pan', e.target.value.toUpperCase())} /></Field><Field label="GST (optional)" error={E('gst')}><input className="input" value={f.gst} maxLength={15} onChange={(e) => up('gst', e.target.value.toUpperCase())} /></Field></div>
    <Field label={t('seller.account_name')} error={E('beneficiaryName')}><input className="input" value={f.beneficiaryName} onChange={(e) => up('beneficiaryName', e.target.value)} /></Field>
    <div className="row"><Field label={t('seller.account_no')} error={E('accountNumber')}><input className="input" inputMode="numeric" value={f.accountNumber} onChange={(e) => up('accountNumber', e.target.value.replace(/\D/g, ''))} /></Field><Field label="IFSC" error={E('ifsc')}><input className="input" value={f.ifsc} maxLength={11} onChange={(e) => up('ifsc', e.target.value.toUpperCase())} /></Field></div>
    {err && !err.details && <div className="notice bad" role="alert">{err.code === 'payments_not_configured' ? t('err.payments_off') : err.message}</div>}
    <Btn className="primary" busy={busy} onClick={go}>{t('submit')}</Btn></div></Modal>;
}

export function SellerShop() {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => api.get('/seller/shop'), []); const [f, setF] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  useEffect(() => { const s = load.data?.shop; if (s) setF({ name: s.name, ownerName: s.owner_name, phone: s.phone, description: s.description, address: s.address, pincode: s.pincode, pickupEnabled: s.pickup_enabled, deliveryEnabled: s.delivery_enabled }); }, [load.data]);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v })); const E = (p) => fieldErr(err, p);
  const save = async () => { setBusy(true); setErr(null); try { await api.patch('/seller/shop', f); notify(t('saved')); load.reload(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const addPhoto = async (url) => { try { await api.post('/seller/shop/photos', { url }); load.reload(); } catch (e) { notify(e.message, 'bad'); } };
  const setLogo = async (url) => { try { await api.patch('/seller/shop', { logoUrl: url }); load.reload(); } catch (e) { notify(e.message, 'bad'); } };
  return (<Async load={load}>{(d) => !f ? <Spinner /> : (<div className="col gap-l" style={{ maxWidth: 640 }}><h1>{t('seller.shop')}</h1><div className="row"><Status value={d.shop.status} />{d.shop.verified_at && <span className="pill ok">✓ {t('verified')}</span>}</div>
    {d.shop.status_note && <div className="notice">{d.shop.status_note}</div>}
    <div className="card col"><h3>{t('seller.logo')}</h3><div className="row"><Img src={d.shop.logo_url} className="avatar" alt="" /><ImageUploader kind="shop-logo" onUploaded={setLogo} /></div>
      <h3>{t('seller.shop_photos')}</h3><div className="row wrap">{d.photos.map((p) => <div key={p.id} style={{ position: 'relative' }}><Img src={p.url} className="thumb" alt="" /><button className="icon-btn" style={{ position: 'absolute', top: -10, right: -10, background: '#fff', width: 26, height: 26, boxShadow: 'var(--shadow)' }} onClick={async () => { await api.del(`/seller/shop/photos/${p.id}`); load.reload(); }} aria-label={t('remove')}><Icon name="x" width="14" height="14" /></button></div>)}</div><ImageUploader kind="shop-photo" onUploaded={addPhoto} label={t('seller.add_photo')} /></div>
    <div className="card col"><Field label={t('seller.shop_name')} error={E('name')}><input className="input" value={f.name} onChange={(e) => up('name', e.target.value)} /></Field>
      <Field label={t('seller.owner_name')}><input className="input" value={f.ownerName} onChange={(e) => up('ownerName', e.target.value)} /></Field>
      <Field label={t('mobile')} error={E('phone')}><input className="input" value={f.phone} onChange={(e) => up('phone', e.target.value)} /></Field>
      <Field label={t('seller.shop_address')} error={E('address')}><textarea className="textarea" value={f.address} onChange={(e) => up('address', e.target.value)} /></Field>
      <Field label={t('pincode')} error={E('pincode')}><input className="input" maxLength={6} value={f.pincode} onChange={(e) => up('pincode', e.target.value.replace(/\D/g, ''))} /></Field>
      <Field label={t('seller.business_info')}><textarea className="textarea" value={f.description} onChange={(e) => up('description', e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={f.pickupEnabled} onChange={(e) => up('pickupEnabled', e.target.checked)} />{t('pickup')}</label>
      <label className="check"><input type="checkbox" checked={f.deliveryEnabled} onChange={(e) => up('deliveryEnabled', e.target.checked)} />{t('seller.offer_delivery')}</label>
      {err && !err.details && <div className="notice bad">{err.message}</div>}<Btn className="primary" busy={busy} onClick={save}>{t('save')}</Btn></div></div>)}</Async>);
}
