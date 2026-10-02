/**
 * LocationInput — drop-in replacement for location/address text inputs.
 *
 * Uses only Maps JavaScript API + Geocoding API (no Places Autocomplete,
 * which is blocked for API keys created after March 2025).
 *
 * Features:
 *   • Plain text input — user types the address manually
 *   • "Use current location" button (GPS → reverse-geocode)
 *   • Map picker — search by typing + Enter (geocoder), click/drag pin
 *
 * Requires these APIs enabled in Google Cloud Console:
 *   ✓ Maps JavaScript API
 *   ✓ Geocoding API  (for GPS reverse-geocode & map search)
 */

import { useEffect, useRef, useState } from 'react';
import {
  Crosshair, Map as MapIcon, Loader2, MapPin,
  Navigation, Search, AlertTriangle,
} from 'lucide-react';
import Modal from './Modal';
import { loadGoogleMaps, MAPS_KEY } from '../../lib/googleMaps';

// Detect whether a geocoder/service call returned a "not authorized" error.
const isAuthError = (status: string) =>
  status === 'REQUEST_DENIED' || status === 'UNKNOWN_ERROR';

// ── Map picker modal ───────────────────────────────────────────────────────────

interface MapModalProps {
  open: boolean;
  onClose: () => void;
  initialAddress: string;
  onConfirm: (address: string) => void;
}

function LocationMapModal({ open, onClose, initialAddress, onConfirm }: MapModalProps) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef    = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [pickedAddress, setPickedAddress] = useState(initialAddress);
  const [pinnedPos,  setPinnedPos]  = useState<{ lat: number; lng: number } | null>(null);
  const [locating,   setLocating]   = useState(false);
  const [geocoding,  setGeocoding]  = useState(false);
  const [searching,  setSearching]  = useState(false);
  const [geoError,   setGeoError]   = useState('');

  // Confirm is active as soon as a pin is placed — even if geocoding fails
  const canConfirm = !!pickedAddress || !!pinnedPos;
  const doConfirm  = () => {
    const addr =
      pickedAddress ||
      (pinnedPos ? `${pinnedPos.lat.toFixed(5)}, ${pinnedPos.lng.toFixed(5)}` : '');
    if (addr) onConfirm(addr);
  };

  // Reset state when modal re-opens
  useEffect(() => {
    if (open) {
      setPickedAddress(initialAddress);
      setPinnedPos(null);
      setGeoError('');
      setGeocoding(false);
      setSearching(false);
    }
  }, [open, initialAddress]);

  // Build the map after the modal DOM is visible
  useEffect(() => {
    if (!open || !MAPS_KEY) return;

    const timer = setTimeout(async () => {
      if (!mapDivRef.current) return;
      const gm = (window as any).google?.maps;
      if (!gm) return;

      const COLOMBO = { lat: 6.9271, lng: 79.8612 };

      const map = new gm.Map(mapDivRef.current, {
        center: COLOMBO,
        zoom: 10,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapId: 'DEMO_MAP_ID',
      });
      mapRef.current = map;

      // Use AdvancedMarkerElement if available, fall back to deprecated Marker
      let marker: any;
      try {
        const { AdvancedMarkerElement } = await gm.importLibrary('marker');
        marker = new AdvancedMarkerElement({ map, position: COLOMBO });
        marker.position = null; // hide initially
      } catch {
        marker = new gm.Marker({ map, draggable: true, visible: false });
      }
      markerRef.current = marker;

      // Place pin + best-effort reverse-geocode
      const placePin = (latLng: any) => {
        const pos = { lat: latLng.lat(), lng: latLng.lng() };
        if (marker.position !== undefined) {
          marker.position = latLng; // AdvancedMarkerElement
        } else {
          marker.setPosition(latLng); // legacy Marker
          marker.setVisible(true);
        }
        setPinnedPos(pos); // enables confirm immediately
        setGeocoding(true);
        new gm.Geocoder().geocode({ location: pos }, (res: any[], status: string) => {
          setGeocoding(false);
          if (status === 'OK' && res[0]) {
            setPickedAddress(res[0].formatted_address);
          } else if (isAuthError(status)) {
            setGeoError('Geocoding API not enabled on this key — address lookup unavailable. You can still confirm with the pin coordinates.');
          }
        });
      };

      map.addListener('click', (e: any) => { if (e.latLng) placePin(e.latLng); });

      // Drag for legacy Marker
      if (marker.addListener) {
        marker.addListener('dragend', () => {
          const pos = marker.getPosition?.();
          if (pos) placePin(pos);
        });
      }

      // Centre on initial address if provided
      if (initialAddress) {
        new gm.Geocoder().geocode({ address: initialAddress }, (res: any[], status: string) => {
          if (status === 'OK' && res[0]) {
            const loc = res[0].geometry.location;
            map.setCenter(loc);
            map.setZoom(15);
            const ll = { lat: loc.lat(), lng: loc.lng() };
            if (marker.position !== undefined) marker.position = ll;
            else { marker.setPosition(loc); marker.setVisible(true); }
            setPinnedPos(ll);
          }
        });
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geocoder-based text search — type address, press Enter
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchRef.current?.value?.trim();
    if (!query) return;
    const gm = (window as any).google?.maps;
    if (!gm) return;
    setSearching(true);
    setGeoError('');
    new gm.Geocoder().geocode({ address: query }, (res: any[], status: string) => {
      setSearching(false);
      if (status === 'OK' && res[0]) {
        const loc = res[0].geometry.location;
        mapRef.current?.setCenter(loc);
        mapRef.current?.setZoom(15);
        const ll = { lat: loc.lat(), lng: loc.lng() };
        if (markerRef.current?.position !== undefined) markerRef.current.position = ll;
        else { markerRef.current?.setPosition(loc); markerRef.current?.setVisible(true); }
        setPinnedPos(ll);
        setPickedAddress(res[0].formatted_address);
      } else if (isAuthError(status)) {
        setGeoError('Geocoding API not enabled — enable it in Google Cloud Console to search by address.');
      } else {
        setGeoError('No results found. Try a more specific address.');
      }
    });
  };

  // GPS → pin + reverse-geocode
  const handleGPS = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const gm = (window as any).google?.maps;
        if (!gm) { setLocating(false); return; }
        const pos = { lat: coords.latitude, lng: coords.longitude };
        mapRef.current?.setCenter(pos);
        mapRef.current?.setZoom(16);
        if (markerRef.current?.position !== undefined) markerRef.current.position = pos;
        else { markerRef.current?.setPosition(new gm.LatLng(pos.lat, pos.lng)); markerRef.current?.setVisible(true); }
        setPinnedPos(pos);
        setGeocoding(true);
        new gm.Geocoder().geocode({ location: pos }, (res: any[], status: string) => {
          setLocating(false);
          setGeocoding(false);
          if (status === 'OK' && res[0]) setPickedAddress(res[0].formatted_address);
          else if (isAuthError(status)) setGeoError('Geocoding API not enabled — coordinates saved. Enable the API in Google Cloud Console for address names.');
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Pick a Location" width="max-w-2xl">
      {/* Geocoding API warning */}
      {geoError && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-3">
          <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">{geoError}</p>
        </div>
      )}

      {/* Search (Enter to search) + GPS */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300 pointer-events-none" />
          <input
            ref={searchRef}
            key={open ? 'open' : 'closed'}
            className="input pl-8 w-full"
            placeholder="Type a place and press Enter to search…"
            defaultValue={initialAddress}
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-1.5 px-3 rounded-xl bg-navy-50 hover:bg-navy-100 text-navy-600 text-xs font-semibold transition-all flex-shrink-0"
        >
          {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Search
        </button>
        <button
          type="button"
          onClick={handleGPS}
          title="Use my current location"
          className="flex items-center gap-1.5 px-3 rounded-xl bg-navy-50 hover:bg-navy-100 text-navy-600 text-xs font-semibold transition-all flex-shrink-0"
        >
          {locating ? <Loader2 size={13} className="animate-spin" /> : <Navigation size={13} />}
          My Location
        </button>
      </form>

      {/* Map canvas */}
      <div
        ref={mapDivRef}
        className="w-full rounded-xl overflow-hidden border border-navy-100"
        style={{ height: 360 }}
      />

      {/* Resolved address / pin coords */}
      <div className="mt-3 min-h-8 flex items-center gap-2">
        {geocoding ? (
          <span className="flex items-center gap-1.5 text-xs text-navy-400">
            <Loader2 size={12} className="animate-spin" /> Finding address…
          </span>
        ) : pickedAddress ? (
          <span className="flex items-start gap-1.5 text-sm text-navy-700 break-words">
            <MapPin size={13} className="text-navy-400 flex-shrink-0 mt-0.5" />
            {pickedAddress}
          </span>
        ) : pinnedPos ? (
          <span className="flex items-center gap-1.5 text-xs text-navy-500">
            <MapPin size={12} className="text-navy-400 flex-shrink-0" />
            {pinnedPos.lat.toFixed(5)}, {pinnedPos.lng.toFixed(5)}
          </span>
        ) : (
          <span className="text-xs text-navy-300">Click the map, search, or use My Location</span>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between mt-4 pt-4 border-t border-navy-50">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button
          type="button"
          onClick={doConfirm}
          disabled={!canConfirm}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Confirm Location
        </button>
      </div>
    </Modal>
  );
}

// ── LocationInput ──────────────────────────────────────────────────────────────

export interface LocationInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export default function LocationInput({ value, onChange, placeholder, className }: LocationInputProps) {
  const inputRef   = useRef<HTMLInputElement>(null);
  const [mapsReady,  setMapsReady]  = useState(() => !!(window as any).google?.maps);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [mapOpen,    setMapOpen]    = useState(false);

  // Load the Maps API once
  useEffect(() => {
    if (mapsReady || !MAPS_KEY) return;
    loadGoogleMaps().then(() => setMapsReady(true)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external value changes (GPS / map modal) → DOM input
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = value;
    }
  }, [value]);

  // GPS: current position → reverse-geocode → fill input
  const handleGPS = () => {
    if (!mapsReady || !navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const gm = (window as any).google?.maps;
        if (!gm) { setGpsLoading(false); return; }
        new gm.Geocoder().geocode(
          { location: { lat: coords.latitude, lng: coords.longitude } },
          (res: any[], status: string) => {
            setGpsLoading(false);
            if (status === 'OK' && res[0]) {
              onChange(res[0].formatted_address);
            } else {
              // Geocoding API not authorized — fall back to raw coordinates
              onChange(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
            }
          },
        );
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <>
      <div className="relative">
        <input
          ref={inputRef}
          className={`input pr-16 ${className ?? ''}`}
          defaultValue={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'Enter location…'}
        />
        {mapsReady && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
            <button
              type="button"
              onClick={handleGPS}
              title="Use current location"
              className="p-1.5 rounded-lg hover:bg-navy-50 text-navy-400 hover:text-navy-700 transition-colors"
            >
              {gpsLoading
                ? <Loader2 size={13} className="animate-spin" />
                : <Crosshair size={13} />
              }
            </button>
            <button
              type="button"
              onClick={() => setMapOpen(true)}
              title="Pick on map"
              className="p-1.5 rounded-lg hover:bg-navy-50 text-navy-400 hover:text-navy-700 transition-colors"
            >
              <MapIcon size={13} />
            </button>
          </div>
        )}
      </div>

      {mapOpen && (
        <LocationMapModal
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          initialAddress={value}
          onConfirm={(addr) => { onChange(addr); setMapOpen(false); }}
        />
      )}
    </>
  );
}
