import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { supabaseEnabled } from '../lib/supabase';
import Header from '../components/layout/Header';
import { Vehicle } from '../types';
import {
  Globe, Plus, X, ArrowUp, ArrowDown, Search, ExternalLink, ImageOff, AlertTriangle, Car,
} from 'lucide-react';

/* Categories used by the filter chips on the Ceylon Rent A Cars landing page */
const CATEGORIES = [
  { id: 'economy', label: 'Economy' },
  { id: 'sedan',   label: 'Sedan' },
  { id: 'hybrid',  label: 'Hybrid' },
  { id: 'suv',     label: 'SUV' },
  { id: 'luxury',  label: 'Luxury' },
  { id: 'van',     label: 'Van' },
];

const BADGES = ['', 'Most booked', 'Premium', 'New', 'Best value', 'Family pick'];

const WEBSITE_URL = (import.meta.env.VITE_WEBSITE_URL as string | undefined) ?? 'http://localhost:5173';

/** Sensible first guess so a vehicle lands in the right filter when added */
function guessCategory(v: Vehicle): string {
  if ((v.seats ?? 0) >= 8) return 'van';
  if ((v.seats ?? 0) === 7) return 'suv';
  if (/hybrid|electric/i.test(v.fuelType ?? '')) return 'hybrid';
  return 'economy';
}

const name = (v: Vehicle) => `${v.brand} ${v.model}`;

function Thumb({ v }: { v: Vehicle }) {
  return (
    <div className="w-20 h-14 rounded-xl bg-navy-50 flex items-center justify-center overflow-hidden flex-shrink-0">
      {v.imageUrl
        ? <img src={v.imageUrl} alt="" className="w-full h-full object-cover" />
        : <Car size={22} className="text-navy-300" />}
    </div>
  );
}

/* One listed vehicle: order controls + the fields the website card shows.
   Text fields save on blur so typing doesn't write to the DB on every keystroke. */
function ListedRow({
  v, index, total, onMove, onRemove, onChange,
}: {
  v: Vehicle; index: number; total: number;
  onMove: (dir: -1 | 1) => void; onRemove: () => void;
  onChange: (u: Partial<Vehicle>) => void;
}) {
  const [location, setLocation] = useState(v.webLocation ?? '');
  const [price, setPrice] = useState(v.webPrice != null ? String(v.webPrice) : '');

  const commitPrice = () => {
    const n = Number(price);
    const next = price.trim() === '' || !Number.isFinite(n) || n <= 0 ? undefined : n;
    if (next !== v.webPrice) onChange({ webPrice: next });
    if (next === undefined) setPrice('');
  };

  return (
    <div className="card !p-3 md:!p-4">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-lg bg-navy-700 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
          {index + 1}
        </span>
        <Thumb v={v} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy-800 truncate">{name(v)} <span className="text-navy-400 font-normal">{v.year}</span></p>
          <p className="text-xs text-navy-400 truncate">
            {v.vehicleNumber} · {v.transmission ?? '—'} · {v.fuelType ?? '—'} · {v.seats ?? '—'} seats
          </p>
          {!v.imageUrl && (
            <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
              <ImageOff size={12} /> No photo — add one on the Vehicles page
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button className="p-2 rounded-lg hover:bg-navy-50 disabled:opacity-30" disabled={index === 0}
                  onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp size={16} /></button>
          <button className="p-2 rounded-lg hover:bg-navy-50 disabled:opacity-30" disabled={index === total - 1}
                  onClick={() => onMove(1)} aria-label="Move down"><ArrowDown size={16} /></button>
          <button className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                  onClick={onRemove} aria-label="Remove from website"><X size={16} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <label className="block">
          <span className="label">Category</span>
          <select className="input" value={v.webCategory ?? ''} onChange={(e) => onChange({ webCategory: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Badge</span>
          <select className="input" value={v.webBadge ?? ''} onChange={(e) => onChange({ webBadge: e.target.value })}>
            {BADGES.map((b) => <option key={b} value={b}>{b || 'None'}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Pickup location</span>
          <input className="input" value={location} placeholder="e.g. Colombo"
                 onChange={(e) => setLocation(e.target.value)}
                 onBlur={() => location !== (v.webLocation ?? '') && onChange({ webLocation: location.trim() })} />
        </label>
        <label className="block">
          <span className="label">“From” price / day</span>
          <input className="input" inputMode="numeric" value={price} placeholder={`Rs ${v.dailyRent.toLocaleString()}`}
                 onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
                 onBlur={commitPrice} />
        </label>
      </div>
    </div>
  );
}

export default function Website() {
  const vehicles = useStore((s) => s.vehicles);
  const updateWebsiteListing = useStore((s) => s.updateWebsiteListing);
  const [query, setQuery] = useState('');

  const listed = useMemo(
    () => vehicles.filter((v) => v.webFeatured)
      .sort((a, b) => (a.webOrder ?? 9999) - (b.webOrder ?? 9999) || name(a).localeCompare(name(b))),
    [vehicles],
  );

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles
      .filter((v) => !v.webFeatured)
      .filter((v) => !q || `${name(v)} ${v.vehicleNumber}`.toLowerCase().includes(q))
      .sort((a, b) => name(a).localeCompare(name(b)));
  }, [vehicles, query]);

  // Renumber 1..n so the order is always tidy after any change
  const saveOrder = (ordered: Vehicle[]) => {
    ordered.forEach((v, i) => {
      if (v.webOrder !== i + 1) updateWebsiteListing(v.id, { webOrder: i + 1 });
    });
  };

  const add = (v: Vehicle) => {
    updateWebsiteListing(v.id, {
      webFeatured: true,
      webOrder: listed.length + 1,
      webCategory: v.webCategory ?? guessCategory(v),
    });
  };

  const remove = (v: Vehicle) => {
    updateWebsiteListing(v.id, { webFeatured: false, webOrder: undefined });
    saveOrder(listed.filter((x) => x.id !== v.id));
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...listed];
    [next[index], next[index + dir]] = [next[index + dir], next[index]];
    saveOrder(next);
  };

  return (
    <div>
      <Header title="Website" subtitle="Choose the vehicles shown on the Ceylon Rent A Cars landing page" />

      {!supabaseEnabled && (
        <div className="card !p-4 mb-4 border border-amber-200 bg-amber-50 flex gap-3 text-sm text-amber-800">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
          <p>Supabase is not connected, so these choices only exist on this device and the website can't see them.
            Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code>.</p>
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 items-start">
        {/* ── Listed on the website ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-navy-800 flex items-center gap-2">
              <Globe size={18} /> On the website <span className="text-navy-400 font-normal">({listed.length})</span>
            </h2>
            <a href={WEBSITE_URL} target="_blank" rel="noreferrer"
               className="text-sm text-navy-500 hover:text-navy-700 flex items-center gap-1">
              View site <ExternalLink size={14} />
            </a>
          </div>

          {listed.length === 0 ? (
            <div className="card text-center py-10 text-navy-400 text-sm">
              Nothing listed yet — add vehicles from your fleet.<br />
              Until then the website shows its built-in sample cars.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {listed.map((v, i) => (
                <ListedRow
                  key={v.id}
                  v={v}
                  index={i}
                  total={listed.length}
                  onMove={(dir) => move(i, dir)}
                  onRemove={() => remove(v)}
                  onChange={(u) => updateWebsiteListing(v.id, u)}
                />
              ))}
            </div>
          )}
          <p className="text-xs text-navy-400 mt-3">
            The order here is the order on the landing page. Prices default to the vehicle's daily rent
            and are shown to visitors in their chosen currency.
          </p>
        </section>

        {/* ── Rest of the fleet ── */}
        <section className="card !p-4">
          <h2 className="font-semibold text-navy-800 mb-3">Fleet</h2>
          <div className="flex items-center gap-2 bg-navy-50 rounded-xl px-3 py-2 mb-3">
            <Search size={16} className="text-navy-400" />
            <input className="bg-transparent outline-none text-sm flex-1" placeholder="Search by name or number"
                   value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex flex-col divide-y divide-navy-50 max-h-[70vh] overflow-auto">
            {available.length === 0 && (
              <p className="text-sm text-navy-400 py-6 text-center">
                {vehicles.length === 0 ? 'No vehicles in the fleet yet.' : 'Every vehicle is already listed.'}
              </p>
            )}
            {available.map((v) => (
              <div key={v.id} className="flex items-center gap-3 py-2.5">
                <Thumb v={v} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-navy-800 truncate">{name(v)}</p>
                  <p className="text-xs text-navy-400 truncate">{v.vehicleNumber} · Rs {v.dailyRent.toLocaleString()}/day</p>
                </div>
                <button className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1 flex-shrink-0" onClick={() => add(v)}>
                  <Plus size={14} /> Add
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
