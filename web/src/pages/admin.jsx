import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { api, money, fmtDate, fmtTime, qs } from '../api.js';
import { useApp } from '../store.jsx';
import { useI18n, useT, catName } from '../i18n.jsx';
import { Icon, Logo, Async, useLoad, usePaged, PagedFooter, Empty, ErrorBox, Field, fieldErr, Btn, Modal, Img, Status, ImageUploader, Spinner, LangPicker } from '../ui.jsx';
import { DataList, Stat, Bars } from './panel.jsx';
import { useThread } from './customer.jsx';

// ───────── setup + login (no public admin registration exists) ─────────
function AuthFrame({ title, children }) {
  return <div className="splash" style={{ padding: 20, justifyContent: 'flex-start', paddingTop: 50 }}><Logo className="logo-sm" /><h1>{title}</h1><div className="card col" style={{ width: '100%', maxWidth: 420 }}>{children}</div><div style={{ marginTop: 6 }}><LangPicker /></div><div className="from small muted" style={{ whiteSpace: 'nowrap' }}>from SAYRIX MATHAV</div></div>;
}
export function AdminSetup() {
  const t = useT(); const { signIn } = useApp(); const nav = useNavigate(); const st = useLoad(() => api.get('/admin/setup/status'), []);
  const [f, setF] = useState({ email: '', password: '', confirmPassword: '', setupToken: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v })); const E = (p) => fieldErr(err, p);
  if (st.loading && !st.data) return <Spinner />;
  if (st.error) return <ErrorBox error={st.error} onRetry={st.reload} />;
  if (!st.data.setupAvailable) return <AuthFrame title={t('admin.setup_title')}><div className="notice info">{t('admin.setup_closed')}</div><Link to="/admin/login" className="btn primary">{t('admin.login')}</Link></AuthFrame>;
  const go = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await api.post('/admin/setup', f); signIn(r); nav('/admin', { replace: true }); } catch (e2) { setErr(e2); } finally { setBusy(false); } };
  return (<AuthFrame title={t('admin.setup_title')}><form className="col" onSubmit={go}>
    <div className="notice info small">{t('admin.setup_note')}</div>
    <Field label={t('admin.email')} error={E('email')}><input className="input" type="email" value={f.email} onChange={(e) => up('email', e.target.value)} autoComplete="username" required /></Field>
    <Field label={t('admin.app_password')} error={E('password')} hint={t('admin.password_hint')}><input className="input" type="password" value={f.password} onChange={(e) => up('password', e.target.value)} autoComplete="new-password" required /></Field>
    <Field label={t('admin.confirm_password')} error={E('confirmPassword')}><input className="input" type="password" value={f.confirmPassword} onChange={(e) => up('confirmPassword', e.target.value)} autoComplete="new-password" required /></Field>
    <Field label={t('admin.setup_token')} hint={t('admin.setup_token_hint')} error={E('setupToken')}><input className="input" type="password" value={f.setupToken} onChange={(e) => up('setupToken', e.target.value)} required /></Field>
    <div className="notice small">{t('admin.not_gmail_password')}</div>
    {err && !err.details && <div className="notice bad" role="alert">{err.code === 'setup_not_configured' ? t('admin.err_setup_token') : err.message}</div>}
    <Btn className="primary" busy={busy} type="submit">{t('admin.create_admin')}</Btn></form></AuthFrame>);
}
export function AdminLogin() {
  const t = useT(); const { signIn, user } = useApp(); const nav = useNavigate(); const [f, setF] = useState({ email: '', password: '', otp: '' }); const [needOtp, setNeedOtp] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  const go = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await api.post('/admin/login', { email: f.email, password: f.password, ...(f.otp ? { otp: f.otp } : {}) }); signIn(r); nav('/admin', { replace: true }); } catch (e2) { if (e2.code === 'otp_required') setNeedOtp(true); else setErr(e2); } finally { setBusy(false); } };
  return (<AuthFrame title={t('admin.login')}><form className="col" onSubmit={go}>
    <Field label={t('admin.email')}><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" required /></Field>
    <Field label={t('admin.app_password')}><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" required /></Field>
    {needOtp && <Field label={t('admin.otp')}><input className="input" inputMode="numeric" maxLength={6} autoFocus value={f.otp} onChange={(e) => setF({ ...f, otp: e.target.value.replace(/\D/g, '') })} /></Field>}
    {err && <div className="notice bad" role="alert">{err.status === 0 ? t('err.network') : err.message}</div>}
    <Btn className="primary" busy={busy} type="submit">{t('login')}</Btn></form></AuthFrame>);
}

// ───────── dashboard ─────────
export function AdminDashboard() {
  const t = useT(); const load = useLoad(() => api.get('/admin/dashboard'), []);
  return (<Async load={load}>{(d) => (<div className="col gap-l"><h1>{t('admin.dashboard')}</h1>
    {(d.pending_sellers > 0 || d.pending_products > 0 || d.open_tickets > 0) && <div className="row wrap">{d.pending_sellers > 0 && <Link to="/admin/sellers?status=pending" className="pill warn">{d.pending_sellers} {t('admin.pending_sellers')}</Link>}{d.pending_products > 0 && <Link to="/admin/products?status=pending" className="pill warn">{d.pending_products} {t('admin.pending_products')}</Link>}{d.open_tickets > 0 && <Link to="/admin/support?status=open" className="pill bad">{d.open_tickets} {t('admin.open_tickets')}</Link>}</div>}
    <div className="stats"><Stat grad label={t('admin.total_sales')} value={money(d.salesPaise)} /><Stat grad label={t('admin.commission')} value={money(d.commissionPaise)} />
      <Stat label={t('admin.customers')} value={d.customers} /><Stat label={t('admin.total_sellers')} value={d.sellers} /><Stat label={t('admin.active_sellers')} value={d.active_sellers} /><Stat label={t('admin.total_products')} value={d.products} />
      <Stat label={t('admin.total_orders')} value={d.orders_total} /><Stat label={t('admin.successful_orders')} value={d.successful_orders} /><Stat label={t('admin.settled')} value={money(d.settledPaise)} /><Stat label={t('admin.pending_settlement')} value={money(d.pendingSettlementPaise)} />
      <Stat label={t('admin.sub_revenue')} value={money(d.subscriptionRevenuePaise)} /><Stat label={t('admin.open_tickets')} value={d.open_tickets} /><Stat label={t('admin.resolved_tickets')} value={d.resolved_tickets} /></div>
    <div className="card"><h3 className="mb">{t('admin.sales_30')}</h3><Bars data={d.daily} valueKey="sales" /></div></div>)}</Async>);
}

// ───────── sellers ─────────
export function AdminSellers() {
  const t = useT(); const [sp, setSp] = useSearchParams(); const st = sp.get('status') || ''; const [q, setQ] = useState(''); const [sel, setSel] = useState(null); const rr = useRef();
  return (<div className="col gap-l"><h1>{t('admin.sellers')}</h1>
    <div className="chips">{['', 'pending', 'approved', 'update_required', 'rejected', 'suspended'].map((s) => <button key={s} className={`chip ${st === s ? 'active' : ''}`} onClick={() => setSp(s ? { status: s } : {})}>{s ? t(`status.${s}`) : t('all')}</button>)}</div>
    <div className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_generic')} /></div>
    <DataList path={`/admin/sellers${qs({ status: st, q })}`} deps={[st, q]} reloadRef={rr} onRow={(r) => setSel(r.id)} columns={[
      { h: t('seller.shop_name'), render: (r) => <b>{r.name}</b> }, { h: t('seller.owner_name'), render: (r) => r.owner_name }, { h: t('mobile'), render: (r) => r.phone }, { h: t('status'), render: (r) => <Status value={r.status} /> },
      { h: t('seller.payout'), render: (r) => <Status value={r.payout_status} /> }, { h: t('seller.plan'), render: (r) => (r.subscription_expires_at ? fmtDate(r.subscription_expires_at) : '—') }, { h: t('admin.products'), render: (r) => r.products }]} />
    {sel && <SellerModal id={sel} onClose={() => setSel(null)} onChanged={() => rr.current?.()} />}</div>);
}
function SellerModal({ id, onClose, onChanged }) {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => api.get(`/admin/sellers/${id}`), [id]); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const act = async (status) => { setBusy(true); try { await api.post(`/admin/sellers/${id}/status`, { status, note: note || undefined }); notify(t('saved')); setNote(''); await load.reload(); onChanged(); } catch (e) { notify(e.details?.[0]?.message || e.message, 'bad'); } finally { setBusy(false); } };
  return (<Modal title={load.data?.shop.name || t('admin.sellers')} onClose={onClose}><Async load={load}>{({ shop: s, photos, subscriptions, sales, settlements, products }) => (<div className="col">
    <div className="row between"><Status value={s.status} /><Status value={s.payout_status} /></div>
    <div className="card soft small col gap-s"><div><b>{s.owner_name}</b> · {s.phone} · {s.email}</div><div>{s.address} - {s.pincode}, {s.city_name}</div><div>{s.description}</div><div>{[s.pickup_enabled && t('pickup'), s.delivery_enabled && t('delivery')].filter(Boolean).join(' · ')}</div></div>
    {photos.length > 0 && <div className="row wrap">{photos.map((u) => <Img key={u} src={u} className="thumb" alt="" />)}</div>}
    <div className="stats"><Stat label={t('admin.total_orders')} value={sales.orders} /><Stat label={t('admin.total_sales')} value={money(sales.sales)} /><Stat label={t('admin.commission')} value={money(sales.commission)} /><Stat label={t('admin.pending_settlement')} value={money(settlements.pending)} /><Stat label={t('admin.settled')} value={money(settlements.paid)} /></div>
    <div><h3>{t('seller.plan')}</h3>{subscriptions.length === 0 ? <p className="small muted">{t('seller.no_plan')}</p> : subscriptions.map((x) => <div key={x.id} className="listrow small"><Status value={x.status} /><span className="grow">{x.expires_at ? `${fmtDate(x.starts_at)} → ${fmtDate(x.expires_at)}` : fmtDate(x.created_at)}</span><b>{money(x.amount_paise)}</b></div>)}</div>
    <div><h3>{t('admin.products')} ({products.length})</h3>{products.slice(0, 10).map((p) => <div key={p.id} className="listrow small"><span className="grow">{p.name}</span><span>{p.stock}</span><Status value={p.approval_status} /></div>)}</div>
    <Field label={t('admin.note_to_seller')}><textarea className="textarea" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    <div className="row wrap">{s.status !== 'approved' && <Btn className="ok" busy={busy} onClick={() => act('approved')}>{s.status === 'suspended' ? t('admin.activate') : t('admin.approve')}</Btn>}
      {s.status !== 'rejected' && <Btn className="danger" busy={busy} onClick={() => act('rejected')}>{t('admin.reject')}</Btn>}
      {s.status !== 'update_required' && <Btn className="outline" busy={busy} onClick={() => act('update_required')}>{t('admin.request_update')}</Btn>}
      {s.status === 'approved' && <Btn className="danger" busy={busy} onClick={() => act('suspended')}>{t('admin.suspend')}</Btn>}</div>
  </div>)}</Async></Modal>);
}

// ───────── customers / products / categories ─────────
export function AdminCustomers() {
  const t = useT(); const { notify } = useApp(); const [q, setQ] = useState(''); const rr = useRef();
  const block = async (r) => { try { await api.post(`/admin/customers/${r.id}/block`, { blocked: r.status !== 'blocked' }); rr.current?.(); } catch (e) { notify(e.message, 'bad'); } };
  return (<div className="col gap-l"><h1>{t('admin.customers')}</h1><div className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_generic')} /></div>
    <DataList path={`/admin/customers${qs({ q })}`} deps={[q]} reloadRef={rr} columns={[{ h: t('name'), render: (r) => <b>{r.name}</b> }, { h: t('email'), render: (r) => r.email || '—' }, { h: t('mobile'), render: (r) => <>{r.phone || '—'} {r.phone_verified_at && '✓'}</> }, { h: t('admin.orders'), render: (r) => r.orders }, { h: t('date'), render: (r) => fmtDate(r.created_at) }, { h: t('status'), render: (r) => <Status value={r.status} /> },
      { h: '', render: (r) => <button className={`btn sm ${r.status === 'blocked' ? 'ok' : 'danger'}`} onClick={() => block(r)}>{r.status === 'blocked' ? t('admin.unblock') : t('admin.block')}</button> }]} /></div>);
}
export function AdminProducts() {
  const t = useT(); const { notify } = useApp(); const [sp, setSp] = useSearchParams(); const st = sp.get('status') || ''; const [q, setQ] = useState(''); const rr = useRef(); const [rej, setRej] = useState(null); const [note, setNote] = useState('');
  const call = async (fn) => { try { await fn(); rr.current?.(); } catch (e) { notify(e.message, 'bad'); } };
  return (<div className="col gap-l"><h1>{t('admin.products')}</h1>
    <div className="chips">{['', 'pending', 'approved', 'rejected'].map((s) => <button key={s} className={`chip ${st === s ? 'active' : ''}`} onClick={() => setSp(s ? { status: s } : {})}>{s ? t(`status.${s}`) : t('all')}</button>)}</div>
    <div className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_generic')} /></div>
    <DataList path={`/admin/products${qs({ status: st, q })}`} deps={[st, q]} reloadRef={rr} columns={[
      { h: '', render: (r) => <Img src={r.image_url} className="thumb" alt="" /> }, { h: t('product'), render: (r) => <><b>{r.name}</b><div className="tiny muted">{r.shop_name} · {r.category}</div></> }, { h: t('price'), render: (r) => money(r.discount_price_paise || r.price_paise) }, { h: t('seller.stock'), render: (r) => r.stock },
      { h: t('status'), render: (r) => <><Status value={r.approval_status} />{r.hidden_by_admin && <span className="pill bad">{t('admin.hidden')}</span>}</> },
      { h: '', render: (r) => <div className="row wrap">
        {r.approval_status !== 'approved' && <button className="btn sm ok" onClick={() => call(() => api.post(`/admin/products/${r.id}/approval`, { status: 'approved' }))}>{t('admin.approve')}</button>}
        {r.approval_status !== 'rejected' && <button className="btn sm danger" onClick={() => { setRej(r); setNote(''); }}>{t('admin.reject')}</button>}
        <button className="btn sm outline" onClick={() => call(() => api.patch(`/admin/products/${r.id}`, { isFeatured: !r.is_featured }))}>{r.is_featured ? t('admin.unfeature') : t('admin.feature')}</button>
        <button className="btn sm outline" onClick={() => call(() => api.patch(`/admin/products/${r.id}`, { hiddenByAdmin: !r.hidden_by_admin }))}>{r.hidden_by_admin ? t('admin.show') : t('admin.hide')}</button>
        <button className="icon-btn" onClick={() => confirm(t('confirm_delete')) && call(() => api.del(`/admin/products/${r.id}`))} aria-label={t('delete')}><Icon name="trash" /></button></div> }]} />
    {rej && <Modal title={t('admin.reject')} onClose={() => setRej(null)}><div className="col"><Field label={t('admin.note_to_seller')}><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field><Btn className="danger" onClick={async () => { await call(() => api.post(`/admin/products/${rej.id}/approval`, { status: 'rejected', note })); setRej(null); }}>{t('admin.reject')}</Btn></div></Modal>}</div>);
}
export function AdminCategories() {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => api.get('/admin/categories'), []); const [m, setM] = useState(null); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { const body = { slug: m.slug, nameEn: m.name_en, nameTa: m.name_ta, nameHi: m.name_hi, sortOrder: Number(m.sort_order) || 0, isActive: m.is_active }; m.id ? await api.put(`/admin/categories/${m.id}`, body) : await api.post('/admin/categories', body); setM(null); load.reload(); } catch (e) { notify(e.details?.[0]?.message || e.message, 'bad'); } finally { setBusy(false); } };
  return (<div className="col gap-l"><div className="row between"><h1>{t('admin.categories')}</h1><button className="btn primary" onClick={() => setM({ slug: '', name_en: '', name_ta: '', name_hi: '', sort_order: 99, is_active: true })}><Icon name="plus" width="18" height="18" />{t('add')}</button></div>
    <Async load={load}>{(d) => <div className="card"><div className="tablewrap"><table className="t"><thead><tr><th>#</th><th>English</th><th>தமிழ்</th><th>हिन्दी</th><th>{t('status')}</th><th /></tr></thead><tbody>{d.items.map((c) => <tr key={c.id}><td>{c.sort_order}</td><td>{c.name_en}</td><td>{c.name_ta}</td><td>{c.name_hi}</td><td>{c.is_active ? <span className="pill ok">{t('status.active')}</span> : <span className="pill">—</span>}</td><td className="row"><button className="icon-btn" onClick={() => setM(c)} aria-label={t('edit')}><Icon name="edit" /></button><button className="icon-btn" onClick={async () => { if (confirm(t('confirm_delete'))) { await api.del(`/admin/categories/${c.id}`); load.reload(); } }} aria-label={t('delete')}><Icon name="trash" /></button></td></tr>)}</tbody></table></div></div>}</Async>
    {m && <Modal title={t('admin.categories')} onClose={() => setM(null)}><div className="col"><Field label="Slug"><input className="input" value={m.slug} onChange={(e) => setM({ ...m, slug: e.target.value.toLowerCase() })} /></Field><Field label="English"><input className="input" value={m.name_en} onChange={(e) => setM({ ...m, name_en: e.target.value })} /></Field><Field label="தமிழ்"><input className="input" value={m.name_ta} onChange={(e) => setM({ ...m, name_ta: e.target.value })} /></Field><Field label="हिन्दी"><input className="input" value={m.name_hi} onChange={(e) => setM({ ...m, name_hi: e.target.value })} /></Field>
      <Field label={t('admin.sort')}><input className="input" inputMode="numeric" value={m.sort_order} onChange={(e) => setM({ ...m, sort_order: e.target.value.replace(/\D/g, '') })} /></Field><label className="check"><input type="checkbox" checked={m.is_active} onChange={(e) => setM({ ...m, is_active: e.target.checked })} />{t('status.active')}</label><Btn className="primary" busy={busy} onClick={save}>{t('save')}</Btn></div></Modal>}</div>);
}

// ───────── orders & finance ─────────
export function AdminOrders() {
  const t = useT(); const [st, setSt] = useState(''); const [q, setQ] = useState(''); const [sel, setSel] = useState(null);
  return (<div className="col gap-l"><h1>{t('admin.orders')}</h1><div className="chips">{['', 'pending_payment', 'paid', 'partially_refunded', 'refunded', 'failed', 'expired'].map((s) => <button key={s} className={`chip ${st === s ? 'active' : ''}`} onClick={() => setSt(s)}>{s ? t(`status.${s}`) : t('all')}</button>)}</div>
    <div className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="MF100001 / name" /></div>
    <DataList path={`/admin/orders${qs({ status: st, q })}`} deps={[st, q]} onRow={(r) => setSel(r.id)} columns={[{ h: t('order'), render: (r) => <b>{r.order_number}</b> }, { h: t('admin.customers'), render: (r) => <>{r.customer}<div className="tiny muted">{r.customer_phone}</div></> }, { h: t('total'), render: (r) => money(r.total_paise) }, { h: t('status'), render: (r) => <Status value={r.status} /> }, { h: t('admin.sellers'), render: (r) => (r.subs || []).map((s) => <div key={s.id} className="tiny">{s.shop} · <Status value={s.status} /></div>) }, { h: t('date'), render: (r) => fmtTime(r.created_at) }]} />
    {sel && <AdminOrderModal id={sel} onClose={() => setSel(null)} />}</div>);
}
function AdminOrderModal({ id, onClose }) {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => api.get(`/admin/orders/${id}`), [id]); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(null);
  const refund = async (sid) => { if (!reason.trim() || reason.trim().length < 3) return notify(t('cancel_reason'), 'bad'); if (!confirm(t('admin.confirm_refund'))) return; setBusy(sid); try { await api.post(`/admin/sub-orders/${sid}/refund`, { reason }); notify(t('saved')); load.reload(); } catch (e) { notify(e.message, 'bad'); } finally { setBusy(null); } };
  return (<Modal title={load.data?.order.order_number || t('order_details')} onClose={onClose}><Async load={load}>{({ order: o, subOrders, payments, refunds }) => (<div className="col">
    <div className="row between"><Status value={o.status} /><b>{money(o.total_paise)}</b></div><div className="card soft small"><b>{o.customer_name}</b> · {o.contact_phone} · {o.customer_email}<div>{t(o.fulfilment)}{o.delivery_address && ` · ${o.delivery_address.line1}, ${o.delivery_address.city} ${o.delivery_address.pincode}`}</div><div className="muted">{t('admin.age_confirmed')}: {fmtTime(o.age_confirmed_at)}</div></div>
    {subOrders.map((s) => <div key={s.id} className="card"><div className="row between"><b>{s.shop_name}</b><Status value={s.status} /></div>{(s.items || []).map((i) => <div key={i.id} className="small row between"><span>{i.name} × {i.qty}</span><span>{money(i.line_total_paise)}</span></div>)}
      <div className="small muted row between mt" style={{ marginTop: 8 }}><span>{t('admin.commission')} {s.commission_bps / 100}%: {money(s.commission_paise)}</span><span>{t('seller.net')}: {money(s.seller_amount_paise)}</span></div>
      {s.settlement && <div className="small row between"><span>{t('admin.settlement')}</span><Status value={s.settlement.status} /></div>}
      {s.status !== 'cancelled' && s.status !== 'delivered' && o.status !== 'pending_payment' && <Btn className="danger sm" style={{ marginTop: 8 }} busy={busy === s.id} onClick={() => refund(s.id)}>{t('admin.refund')}</Btn>}</div>)}
    <Field label={t('cancel_reason')}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    <div><h3>{t('admin.payments')}</h3>{payments.map((p) => <div key={p.id} className="listrow small"><Status value={p.status} /><span className="grow tiny">{p.razorpay_payment_id || '—'} · {p.method || ''}{p.failure_reason && ` · ${p.failure_reason}`}</span><b>{money(p.amount_paise)}</b></div>)}{refunds.map((r) => <div key={r.id} className="listrow small"><Status value={r.status} /><span className="grow">{t('admin.refund')} · {r.reason}</span><b>{money(r.amount_paise)}</b></div>)}</div>
  </div>)}</Async></Modal>);
}

export function AdminFinance() {
  const t = useT(); const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') || 'payments';
  const tabs = ['payments', 'commissions', 'settlements', 'subscriptions'];
  return (<div className="col gap-l"><h1>{t('admin.finance')}</h1><div className="chips">{tabs.map((x) => <button key={x} className={`chip ${tab === x ? 'active' : ''}`} onClick={() => setSp({ tab: x })}>{t(`admin.${x}`)}</button>)}</div>
    {tab === 'payments' && <DataList path="/admin/payments" columns={[{ h: t('date'), render: (r) => fmtTime(r.created_at) }, { h: t('order'), render: (r) => r.order_number || r.shop_name || '—' }, { h: t('type'), render: (r) => t(`admin.purpose.${r.purpose}`) }, { h: 'Razorpay', render: (r) => <span className="tiny">{r.razorpay_payment_id || r.razorpay_order_id}</span> }, { h: t('method'), render: (r) => r.method || '—' }, { h: t('amount'), render: (r) => money(r.amount_paise) }, { h: t('status'), render: (r) => <><Status value={r.status} />{r.failure_reason && <div className="tiny muted">{r.failure_reason}</div>}</> }]} />}
    {tab === 'commissions' && <Commissions />}
    {tab === 'settlements' && <DataList path="/admin/settlements" columns={[{ h: t('date'), render: (r) => fmtDate(r.created_at) }, { h: t('order'), render: (r) => r.order_number }, { h: t('seller.shop_name'), render: (r) => r.shop_name }, { h: t('seller.gross'), render: (r) => money(r.gross_paise) }, { h: t('admin.commission'), render: (r) => money(r.commission_paise) }, { h: t('seller.net'), render: (r) => <b>{money(r.net_paise)}</b> }, { h: t('status'), render: (r) => <Status value={r.status} /> }]} />}
    {tab === 'subscriptions' && <DataList path="/admin/subscriptions" columns={[{ h: t('seller.shop_name'), render: (r) => r.shop_name }, { h: t('amount'), render: (r) => money(r.amount_paise) }, { h: t('status'), render: (r) => <Status value={r.status} /> }, { h: t('seller.plan'), render: (r) => (r.expires_at ? `${fmtDate(r.starts_at)} → ${fmtDate(r.expires_at)}` : '—') }]} />}</div>);
}
function Commissions() {
  const t = useT(); const load = useLoad(() => api.get('/admin/commissions'), []);
  return <Async load={load}>{(d) => <div className="card"><div className="notice info small mb">{t('admin.commission_auto', { n: d.commissionBps / 100 })}</div>{d.byShop.length === 0 ? <Empty icon="wallet" title={t('nothing_here')} /> : <div className="tablewrap"><table className="t"><thead><tr><th>{t('seller.shop_name')}</th><th>{t('admin.orders')}</th><th>{t('seller.gross')}</th><th>{t('admin.commission')}</th><th>{t('seller.net')}</th></tr></thead><tbody>{d.byShop.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.orders}</td><td>{money(r.gross)}</td><td><b>{money(r.commission)}</b></td><td>{money(r.net)}</td></tr>)}</tbody></table></div>}</div>}</Async>;
}

// ───────── support inbox ─────────
const SUPPORT_CATS = ['order', 'payment', 'product', 'delivery', 'refund', 'seller', 'other'];
export function AdminSupport({ complaints }) {
  const t = useT(); const [sp, setSp] = useSearchParams(); const [sel, setSel] = useState(null); const st = sp.get('status') || ''; const cat = complaints ? 'seller' : sp.get('category') || ''; const [q, setQ] = useState('');
  const list = usePaged(`/admin/support${qs({ status: st, category: cat, q })}`, [st, cat, q]);
  return (<div className="col gap-l"><h1>{complaints ? t('admin.complaints') : t('admin.support')}</h1>
    <div className="chips">{['', 'open', 'pending', 'resolved'].map((s) => <button key={s} className={`chip ${st === s ? 'active' : ''}`} onClick={() => setSp(s ? { status: s } : {})}>{s ? t(`status.${s}`) : t('all')}</button>)}
      {!complaints && <select className="select" style={{ width: 'auto', minHeight: 36 }} value={cat} onChange={(e) => setSp({ ...(st ? { status: st } : {}), ...(e.target.value ? { category: e.target.value } : {}) })}><option value="">{t('all')}</option>{SUPPORT_CATS.map((c) => <option key={c} value={c}>{t(`support.cat.${c}`)}</option>)}</select>}</div>
    <div className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_generic')} /></div>
    <div className="split inbox"><div className="card" style={{ alignSelf: 'start' }}>
      {list.items.length === 0 && !list.loading && !list.error && <Empty icon="message" title={t('support_none')} />}{list.items.length === 0 && list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.items.map((c) => <div key={c.id} className={`inbox-item ${sel === c.id ? 'sel' : ''}`} onClick={() => setSel(c.id)}><div className="row between"><b>{c.customer_name}</b><Status value={c.status} /></div><div className="tiny muted">{t(`support.cat.${c.category}`)}{c.order_ref && ` · ${c.order_ref}`} · {fmtTime(c.last_message_at)}</div><div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_sender === 'admin' && '↩ '}{c.last_message}</div></div>)}
      <PagedFooter list={list} /></div>
      <div>{sel ? <AdminThread key={sel} id={sel} onChanged={list.reload} /> : <div className="card"><Empty icon="message" title={t('admin.select_conversation')} /></div>}</div></div></div>);
}
function AdminThread({ id, onChanged }) {
  const t = useT(); const { notify } = useApp(); const th = useThread({ loadPath: `/admin/support/${id}`, postPath: `/admin/support/${id}/reply`, onChanged });
  const setStatus = async (status) => { try { await api.post(`/admin/support/${id}/status`, { status }); await th.load.reload(); onChanged(); } catch (e) { notify(e.message, 'bad'); } };
  return <div className="card"><Async load={th.load}>{({ conversation: c, messages }) => (<>
    <div className="row between wrap"><div><b>{c.customer_name}</b><div className="small muted">{c.customer_phone || '—'} · {c.customer_email || '—'}</div><div className="small">{t(`support.cat.${c.category}`)}{c.order_ref && ` · ${t('order')} ${c.order_ref}`} · {fmtTime(c.created_at)}</div></div><div className="row"><Status value={c.status} /></div></div>
    <div className="row wrap mt" style={{ marginTop: 10 }}>{['open', 'pending', 'resolved'].filter((s) => s !== c.status).map((s) => <button key={s} className="btn sm outline" onClick={() => setStatus(s)}>{t(`admin.mark_${s}`)}</button>)}</div>
    <div className="col mt" style={{ marginTop: 14, maxHeight: 420, overflowY: 'auto' }}>{messages.map((m) => <div key={m.id} className={`bubble ${m.sender_role === 'admin' ? 'me' : ''}`}>{m.body}{m.image_url && <a href={m.image_url} target="_blank" rel="noreferrer"><Img src={m.image_url} /></a>}<div className="tiny" style={{ opacity: .7, marginTop: 4 }}>{fmtTime(m.created_at)}</div></div>)}<div ref={th.end} /></div>
    <div className="row mt" style={{ marginTop: 12, alignItems: 'flex-end' }}><textarea className="textarea" style={{ minHeight: 56 }} value={th.text} onChange={(e) => th.setText(e.target.value)} placeholder={t('admin.reply_placeholder')} /><Btn className="primary" busy={th.busy} disabled={!th.text.trim()} onClick={() => th.send({ status: 'pending' })}><Icon name="send" width="18" height="18" />{t('admin.reply')}</Btn></div></>)}</Async></div>;
}

// ───────── reviews / offers / banners / broadcast / audit / settings ─────────
export function AdminReviews() {
  const t = useT(); const { notify } = useApp(); const [f, setF] = useState('reported'); const rr = useRef();
  const set = async (r, status) => { try { await api.post(`/admin/reviews/${r.id}/status`, { status }); rr.current?.(); } catch (e) { notify(e.message, 'bad'); } };
  return (<div className="col gap-l"><h1>{t('admin.reviews')}</h1><div className="chips">{['reported', 'hidden', 'all'].map((s) => <button key={s} className={`chip ${f === s ? 'active' : ''}`} onClick={() => setF(s)}>{t(`admin.rv.${s}`)}</button>)}</div>
    <DataList path={`/admin/reviews?filter=${f}`} deps={[f]} reloadRef={rr} columns={[{ h: t('product'), render: (r) => <><b>{r.product_name}</b><div className="tiny muted">{r.shop_name}</div></> }, { h: t('rating'), render: (r) => '★'.repeat(r.rating) }, { h: t('reviews'), render: (r) => <div style={{ maxWidth: 320 }}>{r.body}<div className="tiny muted">{r.reviewer}</div></div> }, { h: t('admin.reports'), render: (r) => r.report_count }, { h: t('status'), render: (r) => <Status value={r.status} /> },
      { h: '', render: (r) => <button className={`btn sm ${r.status === 'visible' ? 'danger' : 'ok'}`} onClick={() => set(r, r.status === 'visible' ? 'hidden' : 'visible')}>{r.status === 'visible' ? t('admin.hide') : t('admin.show')}</button> }]} /></div>);
}
export function AdminOffers() {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => api.get('/admin/offers'), []); const [open, setOpen] = useState(false); const [f, setF] = useState({ title: '', discountPercent: '10', endsAt: '' });
  const save = async () => { try { await api.post('/admin/offers', { title: f.title, discountPercent: parseInt(f.discountPercent, 10), endsAt: new Date(f.endsAt + 'T23:59:59').toISOString() }); setOpen(false); load.reload(); } catch (e) { notify(e.message, 'bad'); } };
  return (<div className="col gap-l"><div className="row between"><h1>{t('admin.offers')}</h1><button className="btn primary" onClick={() => setOpen(true)}><Icon name="plus" width="18" height="18" />{t('add')}</button></div>
    <Async load={load}>{(d) => d.items.length === 0 ? <Empty icon="tag" title={t('seller.no_offers')} /> : <div className="card"><table className="t"><thead><tr><th>{t('title')}</th><th>{t('seller.shop_name')}</th><th>%</th><th>{t('seller.ends_on')}</th><th>{t('status')}</th></tr></thead><tbody>{d.items.map((o) => <tr key={o.id}><td>{o.title}</td><td>{o.shop_name || 'MAVRIX FIRE'}</td><td>{o.discount_percent}%</td><td>{fmtDate(o.ends_at)}</td><td><button className={`btn sm ${o.is_active ? 'danger' : 'ok'}`} onClick={async () => { await api.post(`/admin/offers/${o.id}/active`, { active: !o.is_active }); load.reload(); }}>{o.is_active ? t('stop') : t('admin.activate')}</button></td></tr>)}</tbody></table></div>}</Async>
    {open && <Modal title={t('admin.offers')} onClose={() => setOpen(false)}><div className="col"><Field label={t('title')}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label="%"><input className="input" inputMode="numeric" value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: e.target.value.replace(/\D/g, '') })} /></Field><Field label={t('seller.ends_on')}><input className="input" type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field><div className="notice info small">{t('admin.offer_platform_note')}</div><Btn className="primary" disabled={!f.title || !f.endsAt} onClick={save}>{t('save')}</Btn></div></Modal>}</div>);
}
export function AdminBanners() {
  const t = useT(); const { notify } = useApp(); const load = useLoad(() => api.get('/admin/banners'), []); const [m, setM] = useState(null);
  const save = async () => { try { const body = { title: m.title, subtitle: m.subtitle || '', imageUrl: m.image_url || null, link: m.link || null, sortOrder: Number(m.sort_order) || 0, isActive: m.is_active }; m.id ? await api.put(`/admin/banners/${m.id}`, body) : await api.post('/admin/banners', body); setM(null); load.reload(); } catch (e) { notify(e.details?.[0]?.message || e.message, 'bad'); } };
  return (<div className="col gap-l"><div className="row between"><h1>{t('admin.banners')}</h1><button className="btn primary" onClick={() => setM({ title: '', subtitle: '', image_url: '', link: '', sort_order: 0, is_active: true })}><Icon name="plus" width="18" height="18" />{t('add')}</button></div>
    <Async load={load}>{(d) => d.items.length === 0 ? <Empty icon="image" title={t('nothing_here')} /> : <div className="col">{d.items.map((b) => <div key={b.id} className="card row"><Img src={b.image_url} className="thumb" alt="" /><div className="grow"><b>{b.title}</b><div className="small muted">{b.subtitle}</div></div>{b.is_active ? <span className="pill ok">{t('status.active')}</span> : <span className="pill">—</span>}<button className="icon-btn" onClick={() => setM(b)} aria-label={t('edit')}><Icon name="edit" /></button></div>)}</div>}</Async>
    {m && <Modal title={t('admin.banners')} onClose={() => setM(null)}><div className="col"><Field label={t('title')}><input className="input" value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} /></Field><Field label={t('admin.subtitle')}><input className="input" value={m.subtitle || ''} onChange={(e) => setM({ ...m, subtitle: e.target.value })} /></Field><Field label="Link (/search?category=rockets)"><input className="input" value={m.link || ''} onChange={(e) => setM({ ...m, link: e.target.value })} /></Field>{m.image_url && <Img src={m.image_url} className="thumb" />}<ImageUploader kind="banner" onUploaded={(u) => setM((x) => ({ ...x, image_url: u }))} /><label className="check"><input type="checkbox" checked={m.is_active} onChange={(e) => setM({ ...m, is_active: e.target.checked })} />{t('status.active')}</label><Btn className="primary" disabled={!m.title} onClick={save}>{t('save')}</Btn></div></Modal>}</div>);
}
export function AdminBroadcast() {
  const t = useT(); const { notify } = useApp(); const [f, setF] = useState({ audience: 'customers', title: '', body: '' }); const [busy, setBusy] = useState(false);
  const send = async () => { if (!confirm(t('admin.confirm_broadcast'))) return; setBusy(true); try { const r = await api.post('/admin/broadcast', f); notify(t('admin.sent_to', { n: r.recipients })); setF({ ...f, title: '', body: '' }); } catch (e) { notify(e.details?.[0]?.message || e.message, 'bad'); } finally { setBusy(false); } };
  return (<div className="col gap-l" style={{ maxWidth: 560 }}><h1>{t('admin.broadcast')}</h1><div className="card col"><Field label={t('admin.audience')}><select className="select" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{['customers', 'sellers', 'all'].map((a) => <option key={a} value={a}>{t(`admin.aud.${a}`)}</option>)}</select></Field><Field label={t('title')}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label={t('message')}><textarea className="textarea" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field><div className="notice info small">{t('admin.broadcast_note')}</div><Btn className="primary" busy={busy} disabled={f.title.length < 2 || f.body.length < 2} onClick={send}><Icon name="send" width="18" height="18" />{t('send')}</Btn></div></div>);
}
export function AdminAudit() {
  const t = useT();
  return <div className="col gap-l"><h1>{t('admin.audit')}</h1><DataList path="/admin/audit" rowKey={(r) => r.id} columns={[{ h: t('date'), render: (r) => fmtTime(r.created_at) }, { h: t('admin.action'), render: (r) => <b>{r.action}</b> }, { h: t('admin.entity'), render: (r) => `${r.entity || ''} ${r.entity_id ? String(r.entity_id).slice(0, 8) : ''}` }, { h: 'IP', render: (r) => r.ip }, { h: t('admin.details'), render: (r) => <span className="tiny">{Object.keys(r.meta || {}).length ? JSON.stringify(r.meta).slice(0, 80) : ''}</span> }]} /></div>;
}
export function AdminSettings() {
  const t = useT(); const { notify, user, setUser, signOut } = useApp(); const nav = useNavigate(); const load = useLoad(() => api.get('/admin/settings'), []); const [busy, setBusy] = useState(false);
  const patch = async (body) => { setBusy(true); try { await api.patch('/admin/settings', body); notify(t('saved')); load.reload(); } catch (e) { notify(e.details?.[0]?.message || e.message, 'bad'); } finally { setBusy(false); } };
  return (<div className="col gap-l" style={{ maxWidth: 640 }}><h1>{t('admin.settings')}</h1>
    <Async load={load}>{({ settings: s }) => (<div className="card col"><h3>{t('admin.platform')}</h3>
      <label className="check"><input type="checkbox" checked={s.checkout_enabled} onChange={(e) => patch({ checkout_enabled: e.target.checked })} />{t('admin.checkout_enabled')}</label><div className="tiny muted">{t('admin.checkout_hint')}</div>
      <label className="check"><input type="checkbox" checked={s.delivery_enabled} onChange={(e) => patch({ delivery_enabled: e.target.checked })} />{t('admin.delivery_enabled')}</label><div className="tiny muted">{t('admin.delivery_hint')}</div>
      <div className="row"><Field label={`${t('admin.commission')} %`} hint={t('admin.commission_hint')}><input className="input" defaultValue={s.commission_bps / 100} inputMode="decimal" onBlur={(e) => { const v = Math.round(parseFloat(e.target.value) * 100); if (!Number.isNaN(v) && v !== s.commission_bps) patch({ commission_bps: v }); }} /></Field>
        <Field label={`${t('seller.plan')} ₹`}><input className="input" defaultValue={s.subscription_paise / 100} inputMode="numeric" onBlur={(e) => { const v = Math.round(parseFloat(e.target.value) * 100); if (!Number.isNaN(v) && v !== s.subscription_paise) patch({ subscription_paise: v }); }} /></Field></div>
      <div className="row"><Field label={t('admin.support_phone')}><input className="input" defaultValue={s.support_phone} onBlur={(e) => e.target.value !== s.support_phone && patch({ support_phone: e.target.value })} /></Field><Field label={t('admin.support_email')}><input className="input" defaultValue={s.support_email} onBlur={(e) => e.target.value !== s.support_email && patch({ support_email: e.target.value })} /></Field></div></div>)}</Async>
    <Security />
    <div className="card col"><h3>{t('admin.sessions')}</h3><Btn className="danger" onClick={async () => { if (confirm(t('admin.confirm_logout_all'))) { await api.post('/auth/logout-all'); await signOut(); nav('/admin/login'); } }}>{t('admin.logout_all')}</Btn></div></div>);
}
function Security() {
  const t = useT(); const { notify, user, setUser } = useApp(); const [setup, setSetup] = useState(null); const [code, setCode] = useState(''); const [pw, setPw] = useState({ current: '', next: '' }); const [err, setErr] = useState(null);
  const start = async () => { try { setSetup(await api.post('/admin/2fa/setup')); } catch (e) { notify(e.message, 'bad'); } };
  const enable = async () => { try { await api.post('/admin/2fa/enable', { code }); setUser({ ...user, twofaEnabled: true }); setSetup(null); setCode(''); notify(t('admin.twofa_on')); } catch (e) { notify(e.message, 'bad'); } };
  const disable = async () => { const password = prompt(t('admin.app_password')); const c = prompt(t('admin.otp')); if (!password || !c) return; try { await api.post('/admin/2fa/disable', { password, code: c }); setUser({ ...user, twofaEnabled: false }); } catch (e) { notify(e.message, 'bad'); } };
  const change = async () => { setErr(null); try { await api.post('/admin/password', pw); notify(t('saved')); setPw({ current: '', next: '' }); } catch (e) { setErr(e); } };
  return (<><div className="card col"><h3>{t('admin.twofa')}</h3>{user?.twofaEnabled ? <><span className="pill ok">{t('status.active')}</span><Btn className="outline" onClick={disable}>{t('admin.disable_2fa')}</Btn></> : setup ? <><p className="small">{t('admin.twofa_steps')}</p><code style={{ wordBreak: 'break-all', background: 'var(--bg2)', padding: 10, borderRadius: 10 }}>{setup.secret}</code><a className="small" style={{ color: 'var(--purple)' }} href={setup.otpauthUri}>{t('admin.open_authenticator')}</a><Field label={t('admin.otp')}><input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field><Btn className="primary" disabled={code.length !== 6} onClick={enable}>{t('admin.enable_2fa')}</Btn></> : <><p className="small muted">{t('admin.twofa_hint')}</p><Btn className="outline" onClick={start}>{t('admin.enable_2fa')}</Btn></>}</div>
    <div className="card col"><h3>{t('admin.change_password')}</h3><Field label={t('admin.current_password')}><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field><Field label={t('admin.new_password')} hint={t('admin.password_hint')} error={fieldErr(err, 'next')}><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>{err && !err.details && <div className="notice bad">{err.message}</div>}<Btn className="primary" disabled={!pw.current || !pw.next} onClick={change}>{t('save')}</Btn></div></>);
}
