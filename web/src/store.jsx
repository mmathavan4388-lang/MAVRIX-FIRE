import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { useI18n } from './i18n.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const { lang, setLang } = useI18n();
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [toast, setToast] = useState(null);
  const [unread, setUnread] = useState(0);
  const [cartCount, setCartCount] = useState(0);

  const loadConfig = useCallback(async () => {
    setConfigError(false);
    try { setConfig(await api.get('/public/config')); } catch { setConfigError(true); }
  }, []);

  useEffect(() => {
    loadConfig();
    (async () => {
      if (getToken()) {
        // Only an explicit 401 ends the session; network errors, 429 and 5xx must never log the user out.
        for (let attempt = 0; attempt < 4; attempt++) {
          try { const r = await api.get('/me'); setUser(r.user); break; }
          catch (e) { if (e.status === 401) { setToken(null); break; } await new Promise((res) => setTimeout(res, 800 * (attempt + 1))); }
        }
      }
      setBooting(false);
    })();
    const onUnauth = () => { setToken(null); setUser(null); };
    window.addEventListener('mf:unauthorized', onUnauth);
    return () => window.removeEventListener('mf:unauthorized', onUnauth);
  }, [loadConfig]);

  const signIn = useCallback((r) => { setToken(r.token); setUser(r.user); if (r.user.language && r.user.language !== lang && !localStorage.getItem('mf_lang')) setLang(r.user.language); }, [lang, setLang]);
  const signOut = useCallback(async () => { try { await api.post('/auth/logout'); } catch { /* already invalid */ } setToken(null); setUser(null); setUnread(0); setCartCount(0); }, []);

  const notify = useCallback((msg, kind = 'ok') => { setToast({ msg, kind, id: Date.now() }); }, []);
  useEffect(() => { if (!toast) return undefined; const id = setTimeout(() => setToast(null), 3500); return () => clearTimeout(id); }, [toast]);

  const refreshCounts = useCallback(async () => {
    if (!getToken()) return;
    try { setUnread((await api.get('/notifications/unread-count')).unread); } catch { /* offline */ }
    if (user?.role === 'customer') { try { setCartCount((await api.get('/cart')).items.reduce((a, i) => a + i.qty, 0)); } catch { /* offline */ } }
  }, [user]);
  useEffect(() => { if (!user) return undefined; refreshCounts(); const id = setInterval(refreshCounts, 30000); return () => clearInterval(id); }, [user, refreshCounts]);

  const setLanguage = useCallback(async (l) => { setLang(l); if (getToken()) { try { await api.patch('/me', { language: l }); } catch { /* non-fatal */ } } }, [setLang]);

  const value = useMemo(() => ({ config, configError, loadConfig, user, booting, signIn, signOut, toast, notify, unread, cartCount, refreshCounts, setLanguage, setUser }),
    [config, configError, loadConfig, user, booting, signIn, signOut, toast, notify, unread, cartCount, refreshCounts, setLanguage]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
