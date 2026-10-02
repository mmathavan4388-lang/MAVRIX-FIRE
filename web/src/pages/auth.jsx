import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { useI18n, useT, LANGS } from '../i18n.jsx';
import { Field, fieldErr, Btn, Logo, TopBar, Icon } from '../ui.jsx';

export function LanguageSelect({ onDone }) {
  const { setLang } = useI18n(); const t = useT();
  return (
    <div className="splash" style={{ padding: 24 }}>
      <Logo className="logo" text={false} /><h1 className="wordmark">MAVRIX FIRE</h1>
      <p className="muted center" style={{ marginBottom: 6 }}>தமிழ் · हिन्दी · English<br />{t('choose_language')}</p>
      <div className="col" style={{ width: '100%', maxWidth: 360 }}>
        {LANGS.map((l) => <button key={l.code} className="langcard" onClick={() => { setLang(l.code); onDone(); }}>{l.label}<Icon name="chevron" /></button>)}
      </div>
      <div className="from small muted" style={{ marginTop: 18, whiteSpace: 'nowrap' }}>from SAYRIX MATHAV</div>
    </div>
  );
}

function GoogleButton({ onToken }) {
  const { config } = useApp(); const ref = useRef(); const { lang } = useI18n();
  useEffect(() => {
    if (!config?.features.google || !config.googleClientId) return undefined;
    const init = () => { window.google?.accounts.id.initialize({ client_id: config.googleClientId, callback: (r) => onToken(r.credential) }); window.google?.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', width: 280, locale: lang }); };
    if (window.google?.accounts) { init(); return undefined; }
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init; document.head.appendChild(s);
    return undefined;
  }, [config, lang]); // eslint-disable-line
  return config?.features.google ? <div ref={ref} style={{ display: 'flex', justifyContent: 'center' }} /> : null;
}

const home = (u) => (u.role === 'seller' ? '/seller' : u.role === 'admin' ? '/admin' : '/');

export function LoginPage() {
  const t = useT(); const { signIn, user, config, notify } = useApp(); const nav = useNavigate(); const loc = useLocation(); const from = loc.state?.from;
  const [mode, setMode] = useState('password'); const [f, setF] = useState({ identifier: '', password: '', phone: '', code: '', name: '' });
  const [otpSent, setOtpSent] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const { lang } = useI18n();
  if (user) return <Navigate to={from || home(user)} replace />;
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const run = async (fn) => { setBusy(true); setErr(null); try { const r = await fn(); signIn(r); nav(from || home(r.user), { replace: true }); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const sendOtp = async () => { setBusy(true); setErr(null); try { await api.post('/auth/otp/send', { phone: f.phone }); setOtpSent(true); notify(t('otp_sent')); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const msg = err && (err.status === 0 ? t('err.network') : err.code === 'sms_not_configured' ? t('err.sms_off') : err.code === 'name_required' ? t('err.name_required') : err.message);
  return (
    <div className="app-shell" style={{ paddingBottom: 24 }}><TopBar title={t('login')} back="/" />
      <div className="page col gap-l" style={{ maxWidth: 440, margin: '0 auto' }}>
        <div className="center"><Logo className="logo-sm" /></div><h1 className="center">{t('welcome_back')}</h1>
        {config?.features.sms && <div className="tabs"><button className={mode === 'password' ? 'active' : ''} onClick={() => setMode('password')}>{t('password')}</button><button className={mode === 'otp' ? 'active' : ''} onClick={() => setMode('otp')}>OTP</button></div>}
        {mode === 'password' ? (
          <form className="col" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/auth/login', { identifier: f.identifier, password: f.password })); }}>
            <Field label={t('email_or_mobile')}><input className="input" value={f.identifier} onChange={(e) => up('identifier', e.target.value)} autoComplete="username" required /></Field>
            <Field label={t('password')}><input className="input" type="password" value={f.password} onChange={(e) => up('password', e.target.value)} autoComplete="current-password" required /></Field>
            {msg && <div className="notice bad" role="alert">{msg}</div>}
            <Btn className="primary" busy={busy} type="submit">{t('login')}</Btn>
          </form>
        ) : (
          <div className="col">
            <Field label={t('mobile')}><input className="input" inputMode="tel" value={f.phone} onChange={(e) => up('phone', e.target.value)} /></Field>
            {otpSent && <><Field label="OTP"><input className="input" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => up('code', e.target.value.replace(/\D/g, ''))} /></Field><Field label={`${t('name')} (${t('new_users')})`}><input className="input" value={f.name} onChange={(e) => up('name', e.target.value)} /></Field></>}
            {msg && <div className="notice bad" role="alert">{msg}</div>}
            {!otpSent ? <Btn className="primary" busy={busy} onClick={sendOtp}>{t('send_otp')}</Btn> : <Btn className="primary" busy={busy} onClick={() => run(() => api.post('/auth/otp/verify', { phone: f.phone, code: f.code, language: lang, ...(f.name ? { name: f.name } : {}) }))}>{t('verify')}</Btn>}
          </div>
        )}
        <GoogleButton onToken={(idToken) => run(() => api.post('/auth/google', { idToken, language: lang }))} />
        <p className="center small muted">{t('no_account')} <Link to="/register" state={{ from }} style={{ color: 'var(--purple)', fontWeight: 700 }}>{t('register')}</Link></p>
        <p className="center small muted"><Link to="/seller/register" style={{ textDecoration: 'underline' }}>{t('become_seller')}</Link></p>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const t = useT(); const { signIn, user } = useApp(); const nav = useNavigate(); const loc = useLocation(); const { lang } = useI18n();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  if (user) return <Navigate to="/" replace />;
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await api.post('/auth/register', { name: f.name, password: f.password, language: lang, ...(f.email ? { email: f.email } : {}), ...(f.phone ? { phone: f.phone } : {}) }); signIn(r); nav(loc.state?.from || '/', { replace: true }); } catch (e2) { setErr(e2); } finally { setBusy(false); } };
  return (
    <div className="app-shell" style={{ paddingBottom: 24 }}><TopBar title={t('register')} back="/login" />
      <form className="page col" style={{ maxWidth: 440, margin: '0 auto' }} onSubmit={submit}>
        <Field label={t('name')} error={fieldErr(err, 'name')}><input className="input" value={f.name} onChange={(e) => up('name', e.target.value)} autoComplete="name" required /></Field>
        <Field label={t('email')} error={fieldErr(err, 'email')}><input className="input" type="email" value={f.email} onChange={(e) => up('email', e.target.value)} autoComplete="email" /></Field>
        <Field label={t('mobile')} error={fieldErr(err, 'phone')}><input className="input" inputMode="tel" value={f.phone} onChange={(e) => up('phone', e.target.value)} autoComplete="tel" /></Field>
        <Field label={t('password')} error={fieldErr(err, 'password')} hint={t('password_hint')}><input className="input" type="password" value={f.password} onChange={(e) => up('password', e.target.value)} autoComplete="new-password" required minLength={8} /></Field>
        {err && !err.details && <div className="notice bad" role="alert">{err.status === 0 ? t('err.network') : err.code === 'duplicate' ? t('err.duplicate') : err.message}</div>}
        {err?.details && !err.details.some((d) => ['name', 'email', 'phone', 'password'].includes(d.path)) && <div className="notice bad">{err.details[0].message}</div>}
        <Btn className="primary" busy={busy} type="submit" disabled={!f.email && !f.phone}>{t('register')}</Btn>
        <p className="tiny muted center">{t('email_or_mobile_required')}</p>
      </form>
    </div>
  );
}
