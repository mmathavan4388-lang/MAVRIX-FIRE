import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from './store.jsx';
import { useI18n, useT, LANGS } from './i18n.jsx';
import { api, money } from './api.js';

// ───────── icons (original line icons) ─────────
const P = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  cart: 'M3 4h2.5l2 11h10.5l2-8H7M10 20h.01M17 20h.01',
  bag: 'M5 8h14l-1 12H6L5 8ZM9 8V6a3 3 0 0 1 6 0v2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20c1-4 4-6 8-6s7 2 8 6',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 21h4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.600-7 10-7 10Z',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.700 2.700 0 0 0 5.300 0 2.700 2.700 0 0 0 5.400 0A2.700 2.700 0 0 0 20 9M10 20v-5h4v5',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', check: 'm5 12.500 4.500 4.500L19 7.500', x: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7', chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
  filter: 'M4 6h16M7 12h10M10 18h4', shield: 'M12 3l7 3v5c0 5-3 8.500-7 10-4-1.500-7-5-7-10V6l7-3Zm-3 9 2 2 4-4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.7.400-1 .9-1 1.700M12 17h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.500 2.500 3.500 5.500 3.500 9S14.500 18.500 12 21c-2.500-2.500-3.500-5.500-3.500-9S9.500 5.500 12 3Z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.500 6.500l4 4',
  star: 'm12 3 2.800 5.800 6.200.9-4.500 4.400 1.100 6.200L12 17.300 6.400 20.300l1.100-6.200L3 9.700l6.200-.9L12 3Z',
  pin: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11ZM12 12a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M4 16v4h16v-4', menu: 'M4 7h16M4 12h16M4 17h16',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8', box: 'M3 7.500 12 3l9 4.500v9L12 21l-9-4.500v-9ZM3 7.500 12 12l9-4.500M12 12v9',
  tag: 'M3 12V4h8l10 10-8 8L3 12ZM7.500 8h.01', image: 'M4 5h16v14H4V5Zm0 11 5-5 4 4 3-3 4 4M9 9.500h.01',
  send: 'M21 3 3 10l7 3 3 7 8-17ZM10 13l11-10', wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0V6a2 2 0 0 1 2-2h12M16 14h.01',
  users: 'M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM2 20c.8-3.500 3.500-5.500 7-5.500s6.200 2 7 5.500M16 4.300a3.500 3.500 0 0 1 0 6.400M18 14.800c2 .7 3.500 2.300 4 5.200',
  message: 'M4 5h16v11H9l-5 4V5Z', lock: 'M6 11h12v9H6v-9Zm2 0V8a4 4 0 0 1 8 0v3', flag: 'M5 21V4h12l-2 4 2 4H5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.200l2-1.500-2-3.400-2.300 1a7 7 0 0 0-2-1.200L14.300 3h-4l-.4 2.700a7 7 0 0 0-2 1.200l-2.300-1-2 3.400 2 1.500a7 7 0 0 0 0 2.400l-2 1.500 2 3.400 2.300-1a7 7 0 0 0 2 1.200l.4 2.700h4l.4-2.700a7 7 0 0 0 2-1.200l2.300 1 2-3.400-2-1.500c.1-.4.1-.8.1-1.200Z',
};
export const Icon = ({ name, ...p }) => (
  <svg viewBox="0 0 24 24" fill={name === 'star' && p.fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d={P[name]} />
  </svg>
);

// ───────── brand: the uploaded official logo only; never redrawn ─────────
export function Logo({ className = 'logo-sm', text = true }) {
  const [broken, setBroken] = useState(false);
  if (broken) return text ? <span className="wordmark">MAVRIX FIRE</span> : null;   // text only until /brand/logo.png is added
  return <img src="/brand/logo.png" alt="MAVRIX FIRE" className={className} onError={() => setBroken(true)} />;
}

export function Splash() {
  return (
    <div className="splash" role="status">
      <Logo className="logo" text={false} />
      <h1 className="wordmark" style={{ fontSize: 26 }}>MAVRIX FIRE</h1>
      <div className="from">from SAYRIX MATHAV</div>
    </div>
  );
}

// ───────── states ─────────
export const Spinner = () => <div className="spinner" role="status" aria-label="loading" />;
export function Empty({ icon = 'box', title, hint, action }) {
  return <div className="empty"><Icon name={icon} /><h3 style={{ color: 'var(--text)' }}>{title}</h3>{hint && <p className="small">{hint}</p>}{action}</div>;
}
export function ErrorBox({ error, onRetry }) {
  const t = useT();
  const msg = error?.status === 0 ? t('err.network') : error?.message || t('err.generic');
  return <div className="empty"><Icon name="help" /><h3 style={{ color: 'var(--text)' }}>{msg}</h3><button className="btn primary mt" onClick={onRetry}>{t('retry')}</button></div>;
}

/** Load data with loading / error / retry states. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const alive = useRef(true);
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try { const data = await fn(); if (alive.current) setState({ loading: false, data, error: null }); }
    catch (error) { if (alive.current) setState((s) => ({ loading: false, data: s.data, error })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}
export function Async({ load, children, skeleton }) {
  if (load.loading && !load.data) return skeleton || <Spinner />;
  if (load.error && !load.data) return <ErrorBox error={load.error} onRetry={load.reload} />;
  return children(load.data);
}

/** Paged list helper — fetches pages of {items, hasMore}. */
export function usePaged(path, deps = []) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchPage = useCallback(async (p, reset) => {
    setLoading(true); setError(null);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const r = await api.get(`${path}${sep}page=${p}`);
      setItems((cur) => (reset ? r.items : [...cur, ...r.items])); setHasMore(r.hasMore); setPage(p);
    } catch (e) { setError(e); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { fetchPage(1, true); }, [fetchPage]);
  return { items, loading, error, hasMore, more: () => fetchPage(page + 1, false), reload: () => fetchPage(1, true), setItems };
}
export function PagedFooter({ list }) {
  const t = useT();
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  if (list.loading) return <Spinner />;
  return list.hasMore ? <button className="btn outline block mt" onClick={list.more}>{t('load_more')}</button> : null;
}

// ───────── form bits ─────────
export function Field({ label, error, children, hint }) {
  return <label className="field">{label && <span className="lbl">{label}</span>}{children}{hint && <span className="tiny muted">{hint}</span>}{error && <span className="err" role="alert">{error}</span>}</label>;
}
export const fieldErr = (e, path) => e?.details?.find?.((d) => d.path === path)?.message;

export function Btn({ busy, children, className = '', ...p }) {
  return <button className={`btn ${className}`} disabled={busy || p.disabled} {...p}>{busy ? <span className="spinner" style={{ margin: 0, width: 18, height: 18, borderWidth: 2 }} /> : children}</button>;
}

export function Modal({ onClose, title, children }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="row between mb"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}

export function Toast() {
  const { toast } = useApp();
  return toast ? <div className={`toast ${toast.kind === 'bad' ? 'bad' : ''}`} role="status">{toast.msg}</div> : null;
}

export const Stars = ({ value = 0, count }) => {
  const v = Math.round(Number(value));
  return <span className="stars" aria-label={`${value}/5`}>{'★'.repeat(v)}<span className="off">{'★'.repeat(5 - v)}</span>{count != null && <span className="muted tiny"> ({count})</span>}</span>;
};
export function StarInput({ value, onChange }) {
  return <div className="row gap-s">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="icon-btn" onClick={() => onChange(n)} aria-label={`${n}`} style={{ color: n <= value ? '#f59e0b' : '#d4d4dc' }}><Icon name="star" fill={n <= value ? 1 : 0} /></button>)}</div>;
}

export function Img({ src, alt = '', className }) {
  const [bad, setBad] = useState(false);
  return <img src={bad || !src ? undefined : src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setBad(true)} />;
}

const STATUS_TONE = { placed: 'info', accepted: 'info', preparing: 'warn', ready: 'ok', dispatched: 'info', out_for_delivery: 'info', delivered: 'ok', cancelled: 'bad', pending_payment: 'warn', paid: 'ok', refunded: 'bad', partially_refunded: 'warn', expired: 'bad', failed: 'bad',
  pending: 'warn', approved: 'ok', rejected: 'bad', update_required: 'warn', suspended: 'bad', open: 'warn', resolved: 'ok', active: 'ok', captured: 'ok', on_hold: 'warn', released: 'info', settled: 'ok', reversed: 'bad', visible: 'ok', hidden: 'bad', blocked: 'bad', processed: 'ok', created: 'warn', not_started: 'warn' };
export function Status({ value }) {
  const t = useT();
  return <span className={`pill ${STATUS_TONE[value] || ''}`}>{t(`status.${value}`)}</span>;
}

export function Price({ item }) {
  const hasDisc = item.final_price_paise < item.price_paise;
  return <div className="row gap-s wrap"><span className="price">{money(item.final_price_paise)}</span>{hasDisc && <span className="strike">{money(item.price_paise)}</span>}</div>;
}

export function LangPicker() {
  const { lang } = useI18n(); const { setLanguage } = useApp();
  return <div className="langpick" role="group" aria-label="language">{LANGS.map((l) => <button key={l.code} className={lang === l.code ? 'on' : ''} onClick={() => setLanguage(l.code)}>{l.label}</button>)}</div>;
}

export function ImageUploader({ kind, onUploaded, label, multiple, disabled }) {
  const t = useT(); const { notify } = useApp(); const [busy, setBusy] = useState(false); const ref = useRef();
  const onPick = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    setBusy(true);
    try { for (const f of files) onUploaded((await api.upload(kind, f)).url); }
    catch (err) { notify(err.code === 'storage_not_configured' ? t('err.storage') : err.message, 'bad'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple} hidden onChange={onPick} />
      <button type="button" className="btn outline sm" disabled={busy || disabled} onClick={() => ref.current.click()}>{busy ? <span className="spinner" style={{ margin: 0, width: 16, height: 16, borderWidth: 2 }} /> : <Icon name="upload" width="18" height="18" />} {label || t('upload_photo')}</button>
    </>
  );
}

export function TopBar({ title, back, right }) {
  return (
    <div className="topbar">
      {back && <Link to={typeof back === 'string' ? back : -1} className="icon-btn" aria-label="back" onClick={(e) => { if (back === true) { e.preventDefault(); history.back(); } }}><Icon name="back" /></Link>}
      <div className="title">{title}</div>{right}
    </div>
  );
}
