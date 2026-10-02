import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Approximate display rates (LKR per unit). Replace with live rates from your backend.
const RATES = { LKR: 1, USD: 300, EUR: 325, GBP: 385 };
const SYMBOL = { LKR: 'LKR ', USD: '$', EUR: '€', GBP: '£' };
export const CURRENCIES = [
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
];

const STORAGE_KEY = 'crc-currency';

function readStoredCurrency() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return RATES[saved] ? saved : 'LKR';
  } catch {
    return 'LKR';
  }
}

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [currency, setCurrencyState] = useState(readStoredCurrency);
  const [toast, setToast] = useState({ message: '', visible: false });
  const toastTimer = useRef();

  const showToast = useCallback(message => {
    setToast({ message, visible: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const setCurrency = useCallback(code => {
    setCurrencyState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage unavailable */ }
    if (code !== 'LKR') showToast(`Showing approximate prices in ${code}. You’ll be charged in LKR.`);
  }, [showToast]);

  const formatPrice = useCallback(lkr => {
    const v = lkr / RATES[currency];
    const n = currency === 'LKR'
      ? Math.round(v).toLocaleString('en-US')
      : (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 1 : 0 });
    return SYMBOL[currency] + n;
  }, [currency]);

  const value = useMemo(
    () => ({ currency, setCurrency, formatPrice, toast, showToast }),
    [currency, setCurrency, formatPrice, toast, showToast],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

/** Renders an LKR amount in the visitor's chosen currency. */
export function Price({ lkr, as: Tag = 'span', className }) {
  const { formatPrice } = useApp();
  return <Tag className={className}>{formatPrice(lkr)}</Tag>;
}
