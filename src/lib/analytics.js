import { useEffect } from 'react';

/*
 * Google Analytics 4 — consent first, no personal data.
 *
 *  - Runs only on the production site (ceylonrentacars.com). Locally it stays off unless
 *    VITE_GA_DEBUG=true is set, so testing never pollutes the real reports.
 *  - Nothing loads and nothing is sent until the visitor accepts in the cookie banner.
 *    Declining (or never answering) means Google's script is never downloaded.
 *  - The tag is injected once; page views are sent by hand on every in-app navigation
 *    (the automatic first page view is switched off so nothing is counted twice).
 *  - Page addresses are cleaned before sending: personal pages carry names and booking
 *    references in the link (?n=…, ?ref=…), so only harmless parameters are kept.
 *  - Events never include names, phone numbers, emails, ID numbers or booking references.
 */

export const GA_ID = 'G-RT9GFSQY57';
const PRODUCTION_HOSTS = ['ceylonrentacars.com', 'www.ceylonrentacars.com'];
const CONSENT_KEY = 'crc-analytics-consent';          // 'granted' | 'denied'
const CONSENT_EVENT = 'crc:consent-open';             // reopen the banner (footer link)
const SAFE_PARAMS = ['type', 'vehicle', 'v'];         // query keys allowed into reports

/** Analytics can run on this site at all (production, or local testing switched on) */
export const analyticsEnabled = () =>
  typeof window !== 'undefined' &&
  (PRODUCTION_HOSTS.includes(window.location.hostname) || import.meta.env.VITE_GA_DEBUG === 'true');

export function getConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}
function saveConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* private mode — asked again next visit */ }
}

/** The page address with personal query parameters removed */
function cleanLocation(path = window.location.pathname, search = window.location.search) {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  SAFE_PARAMS.forEach((k) => { if (params.has(k)) kept.set(k, params.get(k)); });
  const q = kept.toString();
  return `${window.location.origin}${path}${q ? `?${q}` : ''}`;
}

let loaded = false;

/** Inject the Google tag once (only ever called after consent) */
function loadTag() {
  if (loaded || !analyticsEnabled()) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window[`ga-disable-${GA_ID}`] = false;
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',   // no advertising use
  });
  window.gtag('js', new Date());
  window.gtag('set', { page_location: cleanLocation(), page_referrer: document.referrer.split('?')[0] });
  window.gtag('config', GA_ID, {
    send_page_view: false,              // page views are sent by trackPageView (once per page)
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    ...(import.meta.env.VITE_GA_DEBUG === 'true' ? { debug_mode: true } : {}),
  });
  if (!document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${GA_ID}"]`)) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
  }
}

/** Start analytics on page load if the visitor already accepted on an earlier visit */
export function initAnalytics() {
  if (analyticsEnabled() && getConsent() === 'granted') loadTag();
}

/** Visitor accepted in the banner */
export function grantConsent() {
  saveConsent('granted');
  loadTag();
  window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
  trackPageView();
}

/** Visitor declined (or withdrew consent) — stop sending anything */
export function denyConsent() {
  saveConsent('denied');
  if (loaded) {
    window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
    window[`ga-disable-${GA_ID}`] = true;
  }
}

/** Reopen the cookie banner (e.g. "Cookie settings" in the footer) */
export const openConsentSettings = () => window.dispatchEvent(new Event(CONSENT_EVENT));
export const CONSENT_OPEN_EVENT = CONSENT_EVENT;

const isActive = () => loaded && getConsent() === 'granted' && typeof window.gtag === 'function';

/** Send one GA4 event. Undefined / empty values are dropped. */
export function track(name, params = {}) {
  if (!isActive()) return;
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  window.gtag('event', name, clean);
}

/** Page view for the current page (cleaned address, current title) */
export function trackPageView() {
  if (!isActive()) return;
  const page_location = cleanLocation();
  window.gtag('set', { page_location });
  window.gtag('event', 'page_view', { page_location, page_title: document.title });
}

/**
 * One page view per page: on first load (after consent) and whenever the visitor moves to
 * another page. Query changes on the same page (filters, opening a vehicle) are not new pages.
 */
export function usePageViews(path) {
  useEffect(() => {
    // wait a tick so the page's title (set by usePageSeo) is in place
    const t = setTimeout(trackPageView, 0);
    return () => clearTimeout(t);
  }, [path]);
}

/* ---------- Customer actions ---------- */

/** GA4 item for a vehicle — id, model and category only */
export const vehicleItem = (v) => (v ? {
  item_id: String(v.id),
  item_name: v.name,
  item_category: v.cat || v.type || undefined,
  price: typeof v.price === 'number' ? v.price : undefined,
} : undefined);

/**
 * Clicks that don't need code in every component:
 *  - any WhatsApp link (wa.me / api.whatsapp.com) → contact_whatsapp
 *  - any "Book" link to /book?v=<vehicle> → select_item
 */
export function useClickTracking() {
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const section = a.closest('section[id], footer, header, [data-analytics-area]');
      const area = section?.getAttribute('data-analytics-area') || section?.id || section?.tagName.toLowerCase();
      if (/(^https?:\/\/)?(wa\.me|api\.whatsapp\.com)\//i.test(href)) {
        track('contact_whatsapp', { link_area: area, page_path: window.location.pathname });
      } else if (href.startsWith('/book?')) {
        const id = new URLSearchParams(href.split('?')[1]).get('v');
        if (id) track('select_item', { item_list_name: window.location.pathname === '/' ? 'home' : window.location.pathname.slice(1), link_area: area, items: [{ item_id: id }] });
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}
