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

function toCard(row) {
  const cat = row.category || 'economy';
  const fuel = row.fuel_type || '';
  return {
    id: row.id,
    name: `${row.brand} ${row.model}`,
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
  };
}

export async function fetchFleet(signal) {
  const res = await fetch(`${URL}/rest/v1/website_vehicles?select=*&order=sort_order.asc`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    signal,
  });
  if (!res.ok) throw new Error(`website_vehicles: HTTP ${res.status}`);
  return (await res.json()).map(toCard);
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
