const BASE = import.meta.env.VITE_API_URL || '';
const KEY = 'mf_token';

export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || 'Request failed');
    this.status = status; this.code = body?.error; this.details = body?.details;
  }
}

async function request(method, path, body, isForm) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  } catch {
    throw new ApiError(0, { error: 'network', message: 'network' });
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && token && json?.error === 'unauthorized') window.dispatchEvent(new Event('mf:unauthorized'));
    throw new ApiError(res.status, json);
  }
  return json;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b ?? {}),
  del: (p) => request('DELETE', p),
  upload: (kind, file) => { const f = new FormData(); f.append('file', file); return request('POST', `/uploads/${kind}`, f, true); },
};

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const money = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const fmtDate = (d, lang = 'en') => new Date(d).toLocaleDateString(lang === 'en' ? 'en-IN' : lang === 'ta' ? 'ta-IN' : 'hi-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (d, lang = 'en') => new Date(d).toLocaleString(lang === 'en' ? 'en-IN' : lang === 'ta' ? 'ta-IN' : 'hi-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
