import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { useT } from '../i18n.jsx';
import { Icon, Logo, LangPicker, Spinner, usePaged, PagedFooter, Empty, ErrorBox } from '../ui.jsx';
import { notifVars } from './customer.jsx';
import { api, fmtTime } from '../api.js';

export function PanelLayout({ role, items, base }) {
  const t = useT(); const { user, booting, signOut, unread } = useApp(); const nav = useNavigate(); const [open, setOpen] = useState(false);
  if (booting) return <Spinner />;
  if (!user) return <Navigate to={role === 'admin' ? '/admin/login' : '/login'} state={{ from: base }} replace />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : user.role === 'seller' ? '/seller' : '/'} replace />;
  return (
    <div className="panel">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="row" style={{ padding: '4px 8px 14px' }}><Logo /><span className="pill grad">{role === 'admin' ? t('role.admin') : t('role.seller')}</span></div>
        {items.map(([to, icon, key, end]) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={icon} />{t(key)}</NavLink>)}
        <div style={{ flex: 1 }} />
        <button className="btn outline sm" onClick={async () => { await signOut(); nav(role === 'admin' ? '/admin/login' : '/'); }}><Icon name="logout" width="18" height="18" />{t('logout')}</button>
        <div className="tiny muted center" style={{ marginTop: 8 }}>from SAYRIX MATHAV</div>
      </aside>
      <div className="panel-main">
        <div className="panel-top"><button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="menu"><Icon name="menu" /></button><div className="grow" />
          <LangPicker /><Link to={`${base}/notifications`} className="icon-btn" aria-label={t('notifications')}><Icon name="bell" />{unread > 0 && <span className="badge-dot" style={{ top: 2, marginLeft: 12 }}>{unread}</span>}</Link></div>
        <div className="panel-body"><Outlet /></div>
      </div>
    </div>
  );
}

export function PanelNotifications({ linkFor }) {
  const t = useT(); const { refreshCounts } = useApp(); const nav = useNavigate(); const list = usePaged('/notifications');
  useEffect(() => { if (list.items.some((n) => !n.read_at)) api.post('/notifications/read', {}).then(refreshCounts).catch(() => {}); }, [list.items.length]); // eslint-disable-line
  return (
    <div className="col gap-l" style={{ maxWidth: 720 }}><h1>{t('notifications')}</h1>
      {list.items.length === 0 && !list.loading && !list.error && <Empty icon="bell" title={t('no_notifications')} />}
      {list.items.length === 0 && list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <div className="col gap-s">{list.items.map((n) => (
        <button key={n.id} className="card" style={{ textAlign: 'left', background: n.read_at ? '#fff' : undefined, outline: n.read_at ? 'none' : '2px solid rgba(124,58,237,.25)' }} onClick={() => { const l = linkFor?.(n); if (l) nav(l); }}>
          <b>{n.title || t(`notif.${n.kind}.t`)}</b><div className="small">{n.body || t(`notif.${n.kind}.b`, notifVars(n, t))}</div><div className="tiny muted">{fmtTime(n.created_at)}</div>
        </button>))}</div>
      <PagedFooter list={list} />
    </div>
  );
}

/** Simple list/table with loading, empty, error and "load more". */
export function DataList({ path, columns, empty, rowKey = (r) => r.id, onRow, deps = [], reloadRef }) {
  const t = useT(); const list = usePaged(path, deps);
  if (reloadRef) reloadRef.current = list.reload;
  return (
    <div className="card">
      {list.items.length === 0 && list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.items.length === 0 && !list.loading && !list.error && <Empty icon="list" title={empty || t('nothing_here')} />}
      {list.items.length > 0 && <div className="tablewrap"><table className="t"><thead><tr>{columns.map((c) => <th key={c.h}>{typeof c.h === 'string' && c.h.includes('.') ? t(c.h) : c.h}</th>)}</tr></thead>
        <tbody>{list.items.map((r) => <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: 'pointer' } : undefined}>{columns.map((c) => <td key={c.h}>{c.render(r)}</td>)}</tr>)}</tbody></table></div>}
      <PagedFooter list={list} />
    </div>
  );
}
export const Stat = ({ label, value, grad }) => <div className={`stat ${grad ? 'grad' : ''}`}><div className="muted small">{label}</div><div className="v">{value}</div></div>;
export function Bars({ data, valueKey, labelKey = 'day' }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  return <div className="bars" role="img" aria-label="chart">{data.map((d) => <div key={d[labelKey]} title={`${d[labelKey]}: ₹${(d[valueKey] / 100).toLocaleString('en-IN')}`} style={{ height: `${Math.max(2, (d[valueKey] / max) * 100)}%` }} />)}</div>;
}
export const rupeesToPaise = (v) => Math.round(parseFloat(String(v).replace(/,/g, '')) * 100);
export const paiseToRupees = (p) => (p == null ? '' : String(p / 100));
