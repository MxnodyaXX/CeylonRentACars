/*
 * Customer portal ("My bookings"): sign in with phone + SMS code, then read your own bookings.
 *   1. portal-login (Edge Function) checks the number has bookings with us and has a code sent
 *   2. Supabase Auth verifies the code and returns a session (kept in this browser only)
 *   3. my_bookings() / my_requests() return only rows whose phone matches the signed-in number
 *      (admin/supabase/security/05_customer_portal.sql) — no other data is reachable.
 */
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const STORE = 'crc-portal-session';

export const portalEnabled = typeof URL === 'string' && /^https?:\/\//.test(URL) && !!KEY;

const base = { apikey: KEY, 'Content-Type': 'application/json' };

function load() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
}
function save(s) {
  try { s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch { /* private mode */ }
}
const fromAuth = (d) => ({
  access_token: d.access_token,
  refresh_token: d.refresh_token,
  expires_at: d.expires_at ?? Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600),
  phone: d.user?.phone ? '+' + String(d.user.phone).replace(/^\+/, '') : undefined,
});

/** The saved session (phone shown on the page), or null */
export const currentSession = () => load();

/** A valid access token — refreshed when it has expired; null when signed out */
async function token() {
  const s = load();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  const res = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: base, body: JSON.stringify({ refresh_token: s.refresh_token }),
  }).catch(() => null);
  if (!res?.ok) { save(null); return null; }
  const next = { ...fromAuth(await res.json()), phone: s.phone };
  save(next);
  return next.access_token;
}

/** Step 1 — send a code. Returns the number in international form (+94…). */
export async function requestCode(phone) {
  const res = await fetch(`${URL}/functions/v1/portal-login`, {
    method: 'POST', headers: { ...base, Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ phone }),
  }).catch(() => null);
  if (!res) throw new Error('No connection — please check your internet and try again.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || 'We couldn’t send the code — please try again.');
    err.notFound = !!data.notFound;
    throw err;
  }
  return data.phone;
}

/** Step 2 — check the code; keeps the session in this browser */
export async function verifyCode(phone, code) {
  const res = await fetch(`${URL}/auth/v1/verify`, {
    method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone, token: code.trim() }),
  }).catch(() => null);
  if (!res) throw new Error('No connection — please check your internet and try again.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const msg = String(data.msg || data.error_description || '');
    throw new Error(/expired|invalid/i.test(msg) ? 'That code is wrong or has expired — check the SMS or ask for a new code.' : 'We couldn’t check the code — please try again.');
  }
  const s = { ...fromAuth(data), phone };
  save(s);
  return s;
}

export async function signOut() {
  const t = load()?.access_token;
  save(null);
  if (t) await fetch(`${URL}/auth/v1/logout`, { method: 'POST', headers: { ...base, Authorization: `Bearer ${t}` } }).catch(() => {});
}

async function rpc(name) {
  const t = await token();
  if (!t) { const e = new Error('Please sign in again.'); e.signedOut = true; throw e; }
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...base, Authorization: `Bearer ${t}` }, body: '{}' });
  if (res.status === 401) { save(null); const e = new Error('Please sign in again.'); e.signedOut = true; throw e; }
  if (!res.ok) throw new Error('We couldn’t load your bookings — please try again.');
  return res.json();
}

/** Your profile, bookings and booking requests */
export async function loadMine() {
  const [profile, bookings, requests] = await Promise.all([
    rpc('my_profile').catch(() => []),          // older database without my_profile: still show bookings
    rpc('my_bookings'),
    rpc('my_requests'),
  ]);
  return { profile: profile?.[0] ?? {}, bookings: bookings ?? [], requests: requests ?? [] };
}
