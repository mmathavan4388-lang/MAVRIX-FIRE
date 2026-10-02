import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DICT } from './i18n/dict.js';

export const LANGS = [{ code: 'ta', label: 'தமிழ்' }, { code: 'hi', label: 'हिन्दी' }, { code: 'en', label: 'English' }];
const IDX = { en: 0, ta: 1, hi: 2 };
const KEY = 'mf_lang';

export const storedLang = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const I18nCtx = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(storedLang() || 'en');
  const setLang = useCallback((l) => { setLangState(l); try { localStorage.setItem(KEY, l); } catch { /* ignore */ } document.documentElement.lang = l; }, []);
  const t = useCallback((key, vars) => {
    const entry = DICT[key];
    let s = entry ? (entry[IDX[lang]] || entry[0]) : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}
export const useI18n = () => useContext(I18nCtx);
export const useT = () => useContext(I18nCtx).t;
export const catName = (c, lang) => c?.[`name_${lang}`] || c?.name_en;
