import { useEffect, useState } from 'react';

/*
 * Vehicles on the landing page come ONLY from the admin panel (admin/, the MRAC system).
 * Its "Website" page picks which vehicles are listed; they are read here from the
 * public `website_vehicles` view in the shared Supabase database (see
 * admin/supabase/website.sql). That view only exposes listing-safe columns.
 *
 * There is no sample fallback: if nothing is listed, or the database can't be
 * reached, the section shows an empty state instead of made-up cars.
 */
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// http is only accepted for a local Supabase (`supabase start` runs on 127.0.0.1:54321)
export const fleetEnabled =
  typeof URL === 'string' && /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(URL) && !!KEY;

const CATEGORY_LABELS = {
  economy: 'Economy', sedan: 'Sedan', hybrid: 'Hybrid', suv: 'SUV', luxury: 'Luxury', van: 'Van',
};
const LIGHT_BADGES = ['Premium'];

// Vehicles not set up on the admin's Website page have no category: infer one from the specs
function guessCategory(row) {
  if ((row.seats ?? 0) >= 8) return 'van';
  if (/hybrid|electric/i.test(row.fuel_type || '')) return 'hybrid';
  return 'economy';
}

const toNum = v => (v == null || v === '' ? null : Number(v));

function toCard(row) {
  const cat = row.category || guessCategory(row);
  const fuel = row.fuel_type || '';
  return {
    id: row.id,
    name: `${row.brand} ${row.model}`,
    year: row.year ?? null,
    cat,
    catLabel: CATEGORY_LABELS[cat] ?? cat,
    // Three image kinds from the admin: cut-out, hero photo, real photos
    cutoutImg: row.image_url || null,
    heroImg: row.hero_image_url || null,
    photos: Array.isArray(row.photo_urls) ? row.photo_urls.filter(Boolean) : [],
    // Card cover: first real photo, else the hero photo, else the cut-out
    img: (Array.isArray(row.photo_urls) && row.photo_urls[0]) || row.hero_image_url || row.image_url || null,
    location: row.location || 'Sri Lanka',
    transmission: row.transmission || 'Automatic',
    fuel: fuel || '—',
    fuelIcon: /hybrid|electric/i.test(fuel) ? 'leaf' : 'fuel',
    seats: row.seats ?? 5,
    price: Number(row.price) || 0,
    badge: row.badge || undefined,
    badgeLight: LIGHT_BADGES.includes(row.badge),
    hires: row.completed_hires ?? null,   // completed trips (counted in the DB)
    available: row.available ?? null,     // catalog only: status is 'Available' right now
    transKind: /auto|cvt/i.test(row.transmission || 'Automatic') ? 'automatic' : 'manual',
    // Details specs (admin: Vehicles → Edit) and review summary (admin: vehicle details → reviews)
    mileage: toNum(row.mileage),
    kmpl: toNum(row.fuel_efficiency),
    tank: toNum(row.tank_capacity),
    rating: toNum(row.rating),
    reviewCount: row.review_count ?? 0,
  };
}

async function fetchView(view, order, signal) {
  const res = await fetch(`${URL}/rest/v1/${view}?select=*&order=${order}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    signal,
  });
  if (!res.ok) throw new Error(`${view}: HTTP ${res.status}`);
  return (await res.json()).map(toCard);
}

/** Vehicles picked on the admin's Website page (hero). */
export const fetchFleet = signal => fetchView('website_vehicles', 'sort_order.asc', signal);

/*
 * "Popular Vehicles" section: the 10 vehicles with the most completed hires
 * (popular_vehicles view in admin/supabase/website.sql — counted inside the DB).
 */
let popularShared = null;
function getPopular() {
  if (!fleetEnabled) return Promise.resolve([]);
  if (!popularShared) {
    popularShared = fetchView('popular_vehicles', 'hire_rank.asc').catch(err => { popularShared = null; throw err; });
  }
  return popularShared;
}

/*
 * Whole MRAC fleet without the catalog view (website.sql not re-run yet): read the
 * vehicles table asking ONLY for listing-safe columns (no owner, plate, insurance,
 * revenue), and count completed bookings from just vehicle_id + status.
 */
const SAFE_VEHICLE_COLUMNS = 'id,brand,model,year,daily_rent,web_price,image_url,seats,fuel_type,transmission,' +
  'web_category,web_badge,web_location,hero_image_url,photo_urls,status,web_featured';

async function fetchFleetDirect() {
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const vehiclesWith = cols => fetch(`${URL}/rest/v1/vehicles?select=${cols}`, { headers });
  const [vFirst, bRes] = await Promise.all([
    vehiclesWith(SAFE_VEHICLE_COLUMNS + ',mileage,fuel_efficiency,tank_capacity'),
    fetch(`${URL}/rest/v1/bookings?select=vehicle_id&status=eq.Completed`, { headers }),
  ]);
  const vRes = vFirst.ok ? vFirst : await vehiclesWith(SAFE_VEHICLE_COLUMNS + ',mileage');
  if (!vRes.ok) throw new Error(`vehicles: HTTP ${vRes.status}`);
  const trips = {};
  if (bRes.ok) (await bRes.json()).forEach(b => { trips[b.vehicle_id] = (trips[b.vehicle_id] || 0) + 1; });
  return (await vRes.json())
    .map(v => toCard({
      ...v,
      price: v.web_price ?? v.daily_rent,
      category: v.web_category, badge: v.web_badge, location: v.web_location,
      completed_hires: bRes.ok ? trips[v.id] || 0 : null,
      available: v.status === 'Available',
    }))
    .sort((a, b) => (b.hires ?? 0) - (a.hires ?? 0) || a.name.localeCompare(b.name));
}

/*
 * "All Vehicles" page: the whole MRAC fleet (catalog_vehicles view). If the view
 * hasn't been created yet, reads the fleet directly; last resort, website vehicles.
 */
let catalogShared = null;
function getCatalog() {
  if (!fleetEnabled) return Promise.resolve([]);
  if (!catalogShared) {
    catalogShared = fetchView('catalog_vehicles', 'completed_hires.desc,brand.asc')
      .catch(err => {
        console.warn('[catalog] view missing, reading the MRAC fleet directly —', err.message);
        return fetchFleetDirect();
      })
      .catch(err => {
        console.warn('[catalog] falling back to website vehicles —', err.message);
        return getFleet();
      })
      .catch(err => { catalogShared = null; throw err; });
  }
  return catalogShared;
}

export function useCatalog() {
  const [state, setState] = useState(() =>
    fleetEnabled ? { vehicles: [], status: 'loading' } : { vehicles: [], status: 'offline' });
  const load = () => {
    let live = true;
    setState(s => ({ ...s, status: 'loading' }));
    getCatalog()
      .then(list => live && setState({ vehicles: list, status: 'ready' }))
      .catch(() => live && setState({ vehicles: [], status: 'error' }));
    return () => { live = false; };
  };
  useEffect(() => (fleetEnabled ? load() : undefined), []);
  return { ...state, retry: () => fleetEnabled && load() };
}

export function usePopular() {
  const [state, setState] = useState(() =>
    fleetEnabled ? { vehicles: [], status: 'loading' } : { vehicles: [], status: 'offline' });

  const load = () => {
    let live = true;
    setState(s => ({ ...s, status: 'loading' }));
    getPopular()
      .then(list => live && setState({ vehicles: list, status: 'ready' }))
      .catch(err => {
        // View not created yet (website.sql not re-run): show the admin-listed vehicles instead
        console.warn('[popular] falling back to website vehicles —', err.message);
        return getFleet()
          .then(list => live && setState({ vehicles: list, status: 'ready' }))
          .catch(() => live && setState({ vehicles: [], status: 'error' }));
      });
    return () => { live = false; };
  };

  useEffect(() => (fleetEnabled ? load() : undefined), []);

  return { ...state, retry: () => fleetEnabled && load() };
}

/*
 * Admins upload two kinds of photo: transparent cut-outs (car only) and full photos
 * with a background. The hero presents them differently, so look at each image once:
 *  - cutout: the border is mostly transparent
 *  - bright: average brightness is high (a daytime shot, graded darker in the hero)
 * Supabase Storage sends CORS headers, so the pixels can be read from a canvas.
 */
function analyzeImage(src) {
  const guess = { cutout: /\.png(\?|$)/i.test(src), bright: false }; // fallback if pixels can't be read
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(guess), 4000);
    img.onerror = () => { clearTimeout(timer); resolve(guess); };
    img.onload = () => {
      clearTimeout(timer);
      try {
        const S = 48;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        let edge = 0, clear = 0, lum = 0, solid = 0;
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const i = (y * S + x) * 4, a = d[i + 3];
            if (x === 0 || y === 0 || x === S - 1 || y === S - 1) { edge++; if (a < 200) clear++; }
            if (a > 200) { solid++; lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; }
          }
        }
        resolve({ cutout: clear / edge > 0.25, bright: solid > 0 && lum / solid > 0.42 });
      } catch {
        resolve(guess); // canvas tainted (no CORS) — fall back to the file-type guess
      }
    };
    img.src = src;
  });
}

// One request shared by the hero, the vehicles section and the page loader
let shared = null;
function getFleet() {
  if (!fleetEnabled) return Promise.resolve([]);
  if (!shared) {
    shared = fetchFleet()
      // The hero shows the hero photo if set, else the cut-out — classify whichever it is
      .then(list => Promise.all(list.map(v => {
        const heroSrc = v.heroImg || v.cutoutImg;
        if (!heroSrc) return v;
        // Phones show the admin cut-out instead of the wide hero photo — but only if it
        // really is a transparent cut-out (some admin images are full photos).
        const adminCheck = v.cutoutImg && v.cutoutImg !== heroSrc ? analyzeImage(v.cutoutImg) : null;
        return Promise.all([analyzeImage(heroSrc), adminCheck]).then(([info, admin]) => {
          const adminIsCutout = admin ? admin.cutout : v.cutoutImg === heroSrc && info.cutout;
          return { ...v, heroSrc, ...info, phoneSrc: adminIsCutout ? v.cutoutImg : null };
        });
      })))
      .catch(err => { shared = null; throw err; });
  }
  return shared;
}

export const PHONE_QUERY = '(max-width: 760px)';
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = img.onerror = resolve;
    img.src = src;
  });
}

/** For the page loader: resolves once the first hero image (a listed car, or the fallback art) is loaded. */
export function preloadHero(fallbackImg) {
  return getFleet()
    .catch(() => [])
    .then(list => {
      const first = list.find(v => v.heroSrc);
      const src = first && isPhone() ? first.phoneSrc || first.heroSrc : first?.heroSrc;
      return loadImage(src ?? fallbackImg);
    });
}

/**
 * Vehicles listed in the admin panel.
 * status: 'loading' | 'ready' (may be an empty list) | 'error' | 'offline' (no Supabase env vars)
 */
export function useFleet() {
  const [state, setState] = useState(() =>
    fleetEnabled ? { vehicles: [], status: 'loading' } : { vehicles: [], status: 'offline' });

  const load = () => {
    setState(s => ({ ...s, status: 'loading' }));
    return getFleet()
      .then(list => setState({ vehicles: list, status: 'ready' }))
      .catch(err => {
        console.warn('[fleet] could not load vehicles —', err.message);
        setState({ vehicles: [], status: 'error' });
      });
  };

  useEffect(() => {
    if (!fleetEnabled) {
      console.warn('[fleet] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — no vehicles to show');
      return;
    }
    let live = true;
    getFleet()
      .then(list => live && setState({ vehicles: list, status: 'ready' }))
      .catch(err => {
        if (!live) return;
        console.warn('[fleet] could not load vehicles —', err.message);
        setState({ vehicles: [], status: 'error' });
      });
    return () => { live = false; };
  }, []);

  return { ...state, retry: () => fleetEnabled && load() };
}

/** Published reviews for a vehicle, newest first. Empty if reviews aren't set up yet. */
export async function fetchReviews(vehicleId) {
  if (!fleetEnabled) return [];
  try {
    const res = await fetch(
      `${URL}/rest/v1/public_reviews?select=id,reviewer,rating,comment,created_at&vehicle_id=eq.${encodeURIComponent(vehicleId)}&order=created_at.desc`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
    );
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

/** Send a customer's feedback (stored unpublished until approved in the admin). */
export async function submitFeedback(data) {
  if (!fleetEnabled) throw new Error('Feedback is not available right now.');
  const res = await fetch(`${URL}/rest/v1/rpc/submit_feedback`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_name: data.name, p_country: data.country || null, p_vehicle_id: data.vehicleId || null,
      p_service_rating: data.serviceRating, p_service_comment: data.serviceComment || null,
      p_vehicle_rating: data.vehicleRating || null, p_vehicle_comment: data.vehicleComment || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Could not send feedback (HTTP ${res.status})`);
  }
}

/** Approved company/service reviews for the homepage. */
export function useServiceReviews() {
  const [state, setState] = useState({ reviews: [], status: fleetEnabled ? 'loading' : 'ready' });
  useEffect(() => {
    if (!fleetEnabled) return;
    let live = true;
    fetch(`${URL}/rest/v1/public_service_reviews?select=*&order=created_at.desc&limit=12`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
      .then(r => (r.ok ? r.json() : []))
      .catch(() => [])
      .then(reviews => live && setState({ reviews, status: 'ready' }));
    return () => { live = false; };
  }, []);
  return state;
}

/*
 * Vehicle picker for the feedback form, with number plates (feedback_vehicles view).
 * Falls back to reading just those columns from the vehicles table if the view isn't there yet.
 */
export function useFeedbackVehicles() {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!fleetEnabled) return;
    let live = true;
    const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
    const cols = 'id,brand,model,year,vehicle_number,image_url';
    fetch(`${URL}/rest/v1/feedback_vehicles?select=${cols}`, { headers })
      .then(r => (r.ok ? r : fetch(`${URL}/rest/v1/vehicles?select=${cols}`, { headers })))
      .then(r => (r.ok ? r.json() : []))
      .catch(() => [])
      .then(rows => live && setList(rows
        .map(v => ({
          id: v.id,
          name: `${v.brand} ${v.model}`.replace(/\s+/g, ' ').trim(),
          year: v.year ?? null,
          plate: (v.vehicle_number || '').trim(),
          img: v.image_url || null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.plate.localeCompare(b.plate))));
    return () => { live = false; };
  }, []);
  return list;
}

/* ---------------- Booking page ---------------- */

/** Date ranges a vehicle is already booked (live bookings only, no customer data). */
export async function fetchBusyDates(vehicleId) {
  if (!fleetEnabled || !vehicleId) return [];
  try {
    const res = await fetch(
      `${URL}/rest/v1/vehicle_busy_dates?select=start_date,end_date&vehicle_id=eq.${encodeURIComponent(vehicleId)}&order=start_date.asc`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
    );
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

/** Send a booking request (becomes a Pending inquiry in the admin). Returns the reference number. */
export async function submitBookingRequest(d) {
  if (!fleetEnabled) throw new Error('Online booking is not available right now — please call us.');
  const res = await fetch(`${URL}/rest/v1/rpc/submit_booking_request`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_vehicle_id: d.vehicleId, p_name: d.name, p_phone: d.phone, p_email: d.email || null, p_country: d.country || null,
      p_start_date: d.startDate, p_start_time: d.startTime || null, p_end_date: d.endDate, p_end_time: d.endTime || null,
      p_pickup: d.pickup, p_return: d.returnTo || d.pickup, p_mode: d.mode, p_message: d.message || null,
      p_estimate: d.estimate ?? null,
      p_alternative_of: d.alternativeOf || null,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `Could not send your request (HTTP ${res.status})`);
  return body; // reference, e.g. "CRC-4F9A2C"
}

/** Customer picks one of the offered alternatives — reuses the original request's details. Returns the new reference. */
export async function chooseAlternative(inquiryId, vehicleId) {
  if (!fleetEnabled) throw new Error('Please contact us to choose this vehicle.');
  const res = await fetch(`${URL}/rest/v1/rpc/choose_alternative`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_inquiry_id: inquiryId, p_vehicle_id: vehicleId }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `Could not confirm your choice (HTTP ${res.status})`);
  return body;
}
