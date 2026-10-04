import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/*
 * Google Maps location picker (same approach as the admin's LocationInput):
 * Maps JavaScript API + Geocoding API only — no Places Autocomplete, which is
 * unavailable for API keys created after March 2025.
 * Key: VITE_GOOGLE_MAPS_API_KEY (same key as admin/.env.local).
 */
export const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

let loader = null;
function loadMaps() {
  if (!MAPS_KEY) return Promise.reject(new Error('no-key'));
  if (window.google?.maps?.Geocoder) return Promise.resolve();
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&v=weekly&callback=__crcMapsReady`;
      s.async = true;
      window.__crcMapsReady = () => resolve();
      s.onerror = () => { loader = null; reject(new Error('load-failed')); };
      document.head.appendChild(s);
    });
  }
  return loader;
}

const SRI_LANKA = { lat: 7.8731, lng: 80.7718 };
const LK_BOUNDS = { north: 9.95, south: 5.85, west: 79.4, east: 82.0 };

// Dark map that matches the site
const DARK = [
  { elementType: 'geometry', stylers: [{ color: '#16161a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a1a1aa' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0b0d' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a31' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a1d22' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1c1c21' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#14201a' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

const shortAddress = r => (r?.formatted_address || '').replace(/,\s*Sri Lanka$/i, '');

// Results that only name a country / province / district are too vague to drive to
const COARSE = ['country', 'administrative_area_level_1', 'administrative_area_level_2', 'colloquial_area'];
const isCoarse = r => !r || (r.types || []).some(t => COARSE.includes(t));
const pinLabel = pos => `Pinned location (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})`;

/**
 * Modal map: search, click / drag the pin, or use current location.
 * onConfirm({ label, lat, lng })
 */
export default function MapPicker({ open, title = 'Choose location', initial, onClose, onConfirm }) {
  const mapEl = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const [pick, setPick] = useState(null);          // { label, lat, lng }
  const [query, setQuery] = useState('');
  const [state, setState] = useState('loading');   // loading | ready | error
  const [busy, setBusy] = useState('');            // '' | 'search' | 'gps' | 'geocode'
  const [msg, setMsg] = useState('');

  const geocoder = () => new window.google.maps.Geocoder();

  const place = (latLng, label) => {
    setMsg('');
    const pos = { lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat, lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng };
    marker.current.setPosition(pos);
    marker.current.setVisible(true);
    if (label) { setPick({ label, ...pos }); return; }
    setPick({ label: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`, ...pos });
    setBusy('geocode');
    geocoder().geocode({ location: pos }, (res, status) => {
      setBusy('');
      if (status !== 'OK' || !res?.length) return;
      // Most specific address; if Google only knows the region, keep the exact coordinates instead
      const best = res.find(r => !isCoarse(r));
      setPick({ label: best ? shortAddress(best) : pinLabel(pos), ...pos });
    });
  };

  // Build the map when opened
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setMsg(''); setQuery(''); setPick(initial?.lat ? initial : null);
    loadMaps().then(() => {
      if (!alive || !mapEl.current) return;
      const g = window.google.maps;
      const start = initial?.lat ? { lat: initial.lat, lng: initial.lng } : SRI_LANKA;
      map.current = new g.Map(mapEl.current, {
        center: start, zoom: initial?.lat ? 15 : 7, styles: DARK,
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false,
        restriction: { latLngBounds: LK_BOUNDS, strictBounds: false },
      });
      marker.current = new g.Marker({ map: map.current, draggable: true, visible: !!initial?.lat, position: start });
      map.current.addListener('click', e => place(e.latLng));
      marker.current.addListener('dragend', e => place(e.latLng));
      setState('ready');
    }).catch(err => {
      if (!alive) return;
      setState('error');
      setMsg(err.message === 'no-key' ? 'Map is not configured yet.' : 'Google Maps could not be loaded.');
    });
    // Google Maps reports a bad / restricted key through this global hook
    window.gm_authFailure = () => { setState('error'); setMsg('Google Maps rejected the API key for this website address.'); };
    return () => { alive = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const search = e => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!query.trim() || state !== 'ready') return;
    setBusy('search'); setMsg('');
    geocoder().geocode({ address: query, region: 'lk', bounds: LK_BOUNDS, componentRestrictions: { country: 'LK' } }, (res, status) => {
      setBusy('');
      if (status !== 'OK' || !res[0]) { setMsg('No place found — try another name, or tap the map.'); return; }
      const loc = res[0].geometry.location;
      if (isCoarse(res[0])) {
        // e.g. "Sri Lanka" or a whole province: show the area, but have the customer drop the pin
        if (res[0].geometry.viewport) map.current.fitBounds(res[0].geometry.viewport); else map.current.setCenter(loc);
        marker.current.setVisible(false);
        setPick(null);
        setMsg(`"${shortAddress(res[0]) || query}" is a large area — search a town, hotel or address, or tap the map at the exact spot.`);
        return;
      }
      map.current.setZoom(15); map.current.setCenter(loc);
      place(loc, shortAddress(res[0]));
    });
  };

  const gps = () => {
    if (!navigator.geolocation) { setMsg('Your browser cannot share its location.'); return; }
    setBusy('gps'); setMsg('');
    navigator.geolocation.getCurrentPosition(
      p => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        map.current.setZoom(16); map.current.setCenter(pos);
        place(pos);
      },
      () => { setBusy(''); setMsg('Location permission was denied — search or tap the map instead.'); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  if (!open) return null;

  return createPortal(
    <div className="mapmodal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mapmodal__panel">
        <div className="mapmodal__head">
          <h3><Icon name="pin" />{title}</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>

        {/* Not a <form>: this sits inside the booking form, and forms can't be nested */}
        <div className="mapmodal__search">
          <Icon name="search" size="sm" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a hotel, address or town in Sri Lanka…" autoFocus
                 onKeyDown={e => { if (e.key === 'Enter') search(e); }} />
          <button type="button" onClick={search} className="btn btn--dark btn--sm" disabled={state !== 'ready' || busy === 'search'}>
            {busy === 'search' ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="mapmodal__map">
          <div ref={mapEl} className="mapmodal__canvas" />
          {state === 'loading' && <div className="mapmodal__overlay">Loading map…</div>}
          {state === 'error' && <div className="mapmodal__overlay mapmodal__overlay--err"><Icon name="pin" />{msg}<small>Choose from the list instead.</small></div>}
          {state === 'ready' && (
            <button type="button" className="mapmodal__gps" onClick={gps} disabled={busy === 'gps'}>
              <Icon name="compass" size="sm" />{busy === 'gps' ? 'Locating…' : 'Use my location'}
            </button>
          )}
        </div>

        {msg && state === 'ready' && <p className="mapmodal__msg">{msg}</p>}

        <div className="mapmodal__foot">
          <div className="mapmodal__pick">
            <small>Selected location</small>
            <b>{pick ? pick.label : 'Tap the map or search to drop a pin'}{busy === 'geocode' && ' …'}</b>
          </div>
          <button type="button" className="btn btn--red" disabled={!pick} onClick={() => { onConfirm(pick); onClose(); }}>
            Use this location <Icon name="arrow" size="sm" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
