import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Price } from '../context/AppContext';
import { useCatalog } from '../lib/fleet';
import { openVehicle } from './VehicleModal';
import { track } from '../lib/analytics';
import { CONTACT } from '../data/site';
import Dropdown from './ui/Dropdown';

const TYPE_LABELS = { economy: 'Economy', sedan: 'Sedan', hybrid: 'Hybrid', suv: 'SUV', luxury: 'Luxury', van: 'Van' };
const SEAT_OPTIONS = [2, 4, 5, 7];
const SORTS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'trips', label: 'Most trips' },
];
const PRICE_STEP = 500;

const toggle = (set, value) => {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
};

/* Two-handle price slider built from two range inputs on one track */
function PriceRange({ min, max, value, onChange }) {
  const [lo, hi] = value;
  const pct = v => (max === min ? 0 : ((v - min) / (max - min)) * 100);
  return (
    <div className="range">
      <div className="range__labels">
        <span><Price lkr={lo} /> <small>/ day</small></span>
        <span><Price lkr={hi} />{hi >= max ? '+' : ''} <small>/ day</small></span>
      </div>
      <div className="range__track" style={{ '--lo': `${pct(lo)}%`, '--hi': `${pct(hi)}%` }}>
        <input type="range" min={min} max={max} step={PRICE_STEP} value={lo} aria-label="Minimum price per day"
               onChange={e => onChange([Math.min(Number(e.target.value), hi - PRICE_STEP), hi])} />
        <input type="range" min={min} max={max} step={PRICE_STEP} value={hi} aria-label="Maximum price per day"
               onChange={e => onChange([lo, Math.max(Number(e.target.value), lo + PRICE_STEP)])} />
      </div>
    </div>
  );
}

/** One vehicle row. bookQuery adds extra booking-page params (e.g. the customer's dates). */
export function VehicleRow({ v, bookQuery = '', action }) {
  const isCutout = v.img && v.img === v.cutoutImg && !v.photos.length && !v.heroImg;
  return (
    <article className="vrow" data-reveal>
      <button type="button" className={`vrow__media${isCutout ? ' is-cutout' : ''}`} onClick={() => openVehicle(v)} aria-label={`View ${v.name}`}>
        {v.img ? <img src={v.img} alt={v.name} loading="lazy" /> : <div className="car__noimg"><Icon name="car" /></div>}
      </button>

      <div className="vrow__info">
        <div className="vrow__tags">
          <span className="cat">{v.catLabel}</span>
          {v.badge && <span className="vmodal__badge">{v.badge}</span>}
        </div>
        <h3 className="vrow__name">{v.name}</h3>
        <ul className="vrow__specs">
          <li><Icon name="seat" size="sm" />{v.seats} Seats</li>
          <li><Icon name="gear" size="sm" />{v.transmission}</li>
          <li><Icon name={v.fuelIcon} size="sm" />{v.fuel}</li>
          <li><Icon name="pin" size="sm" />{v.location}</li>
        </ul>
        <div className="vrow__chips">
          {v.hires != null && (
            <span className={`hires${v.hires ? '' : ' hires--none'}`}><Icon name="check" size="sm" />{v.hires} {v.hires === 1 ? 'trip' : 'trips'}</span>
          )}
          {v.reviewCount > 0 && v.rating != null && (
            <span className="rating-tag"><Icon name="star" size="sm" />{v.rating.toFixed(1)} ({v.reviewCount})</span>
          )}
          {v.available === true && <span className="avail"><i />Available now</span>}
          {v.available === false && <span className="avail avail--busy"><i />Currently booked</span>}
        </div>
      </div>

      <div className="vrow__price">
        <small>From</small>
        <Price lkr={v.price} as="strong" />
        <span className="vrow__per">per day</span>
        <div className="vrow__btns">
          {action ?? <a href={`/book?v=${encodeURIComponent(v.id)}${bookQuery}`} className="btn btn--red btn--sm">Book <Icon name="arrow" size="sm" /></a>}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => openVehicle(v)}>Details</button>
        </div>
      </div>
    </article>
  );
}

export default function AllVehicles({ search = '' }) {
  const { vehicles, status, retry } = useCatalog();

  // Options come from the fleet itself, so filters never offer something that doesn't exist
  const types = useMemo(() => [...new Set(vehicles.map(v => v.cat))], [vehicles]);
  const fuels = useMemo(() => [...new Set(vehicles.map(v => v.fuel).filter(f => f && f !== '—'))].sort(), [vehicles]);
  const bounds = useMemo(() => {
    const prices = vehicles.map(v => v.price).filter(Boolean);
    if (!prices.length) return [0, 0];
    return [Math.floor(Math.min(...prices) / PRICE_STEP) * PRICE_STEP, Math.ceil(Math.max(...prices) / PRICE_STEP) * PRICE_STEP];
  }, [vehicles]);

  const initialType = new URLSearchParams(search).get('type');
  const [typeSel, setTypeSel] = useState(() => new Set(initialType ? [initialType] : []));
  const [fuelSel, setFuelSel] = useState(() => new Set());
  const [minSeats, setMinSeats] = useState(0);
  const [trans, setTrans] = useState('all');
  const [price, setPrice] = useState(null); // null = full range
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sort, setSort] = useState('recommended');
  const [query, setQuery] = useState(() => new URLSearchParams(search).get('q') || '');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Category links ("/vehicles?type=suv") pre-select a type
  useEffect(() => { if (initialType) setTypeSel(new Set([initialType])); }, [initialType]);

  const range = price ?? bounds;
  const hasAvailability = vehicles.some(v => v.available != null);

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => {
    const list = vehicles.filter(v =>
      words.every(w => `${v.name} ${v.year ?? ''} ${v.catLabel}`.toLowerCase().includes(w)) &&
      (!typeSel.size || typeSel.has(v.cat)) &&
      (!fuelSel.size || fuelSel.has(v.fuel)) &&
      v.seats >= minSeats &&
      (trans === 'all' || v.transKind === trans) &&
      v.price >= range[0] && (range[1] >= bounds[1] || v.price <= range[1]) &&
      (!availableOnly || v.available)
    );
    const by = {
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      trips: (a, b) => (b.hires ?? 0) - (a.hires ?? 0),
      // Recommended: available first, then most trips, then cheapest
      recommended: (a, b) => (b.available === true) - (a.available === true) || (b.hires ?? 0) - (a.hires ?? 0) || a.price - b.price,
    }[sort];
    return [...list].sort(by);
  }, [vehicles, words, typeSel, fuelSel, minSeats, trans, range, bounds, availableOnly, sort]);

  const activeCount = typeSel.size + fuelSel.size + (minSeats ? 1 : 0) + (trans !== 'all' ? 1 : 0) + (price ? 1 : 0) + (availableOnly ? 1 : 0);
  const clearAll = () => {
    setTypeSel(new Set()); setFuelSel(new Set()); setMinSeats(0); setTrans('all'); setPrice(null); setAvailableOnly(false); setQuery('');
  };

  // A typed search is sent to analytics once the visitor stops typing (the words only)
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return undefined;
    const t = setTimeout(() => track('search', { search_term: term.slice(0, 60), results: results.length }), 1200);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.body.style.overflow = sheetOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sheetOpen]);

  // Filters used on the fleet page count as a search — sent once the visitor stops changing them
  const filterKey = [[...typeSel].sort().join(','), [...fuelSel].sort().join(','), minSeats, trans, price?.join('-') ?? '', availableOnly].join('|');
  // the filters the page opened with (e.g. a category link) are not a search by the visitor
  const firstFilters = useRef(filterKey);
  useEffect(() => {
    if (!activeCount || filterKey === firstFilters.current) return;
    firstFilters.current = null;
    const t = setTimeout(() => track('search', {
      search_term: 'Fleet filters',
      vehicle_type: [...typeSel].join(', '), fuel_type: [...fuelSel].join(', '),
      min_seats: minSeats || undefined, transmission: trans !== 'all' ? trans : undefined,
      price_min: price?.[0], price_max: price?.[1], available_only: availableOnly || undefined,
      results: results.length,
    }), 1500);
    return () => clearTimeout(t);
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = (
    <>
      <div className="filters__head">
        <h2>Filters</h2>
        {activeCount > 0 && <button type="button" className="filters__clear" onClick={clearAll}>Clear all</button>}
        <button type="button" className="icon-btn filters__close" aria-label="Close filters" onClick={() => setSheetOpen(false)}><Icon name="x" /></button>
      </div>

      {types.length > 1 && (
        <fieldset className="filters__group">
          <legend>Vehicle type</legend>
          <div className="type-tiles">
            <button type="button" className={`type-tile${!typeSel.size ? ' is-active' : ''}`} onClick={() => setTypeSel(new Set())}>
              <Icon name="car" /><span>All</span>
            </button>
            {types.map(t => (
              <button key={t} type="button" aria-pressed={typeSel.has(t)}
                      className={`type-tile${typeSel.has(t) ? ' is-active' : ''}`} onClick={() => setTypeSel(s => toggle(s, t))}>
                <Icon name="car" /><span>{TYPE_LABELS[t] ?? t}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {fuels.length > 1 && (
        <fieldset className="filters__group">
          <legend>Fuel type</legend>
          <div className="seg seg--wrap">
            {fuels.map(f => (
              <button key={f} type="button" aria-pressed={fuelSel.has(f)}
                      className={`seg__btn${fuelSel.has(f) ? ' is-active' : ''}`} onClick={() => setFuelSel(s => toggle(s, f))}>
                <Icon name={/hybrid|electric/i.test(f) ? 'leaf' : 'fuel'} size="sm" />{f}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="filters__group">
        <legend>Seats</legend>
        <div className="seg">
          {SEAT_OPTIONS.map(n => (
            <button key={n} type="button" aria-pressed={minSeats === n}
                    className={`seg__btn${minSeats === n ? ' is-active' : ''}`} onClick={() => setMinSeats(m => (m === n ? 0 : n))}>
              {n}+
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="filters__group">
        <legend>Transmission</legend>
        <div className="seg">
          {[['all', 'All'], ['automatic', 'Automatic'], ['manual', 'Manual']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={trans === id}
                    className={`seg__btn${trans === id ? ' is-active' : ''}`} onClick={() => setTrans(id)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {bounds[1] > bounds[0] && (
        <fieldset className="filters__group">
          <legend>Price range</legend>
          <PriceRange min={bounds[0]} max={bounds[1]} value={range}
                      onChange={r => setPrice(r[0] <= bounds[0] && r[1] >= bounds[1] ? null : r)} />
        </fieldset>
      )}

      {hasAvailability && (
        <label className="switch-row">
          <input type="checkbox" checked={availableOnly} onChange={e => setAvailableOnly(e.target.checked)} />
          <span className="switch" aria-hidden="true" />
          <span><b>Available now</b><small>Hide vehicles that are currently booked</small></span>
        </label>
      )}

      <button type="button" className="btn btn--red btn--block filters__apply" onClick={() => setSheetOpen(false)}>
        Show {results.length} {results.length === 1 ? 'vehicle' : 'vehicles'}
      </button>
    </>
  );

  return (
    <main className="catalog-page">
      <div className="container">
        <header className="catalog-head">
          <span className="eyebrow">Our fleet</span>
          <h1>All Vehicles</h1>
          <p>Every verified vehicle in one place — filter by type, fuel, seats and budget.</p>
        </header>

        <div className="catalog">
          <aside className={`filters${sheetOpen ? ' is-open' : ''}`} aria-label="Filters">
            {filters}
          </aside>
          {sheetOpen && <div className="filters__scrim" onClick={() => setSheetOpen(false)} />}

          <section className="catalog__results">
            <div className="catalog__search" role="search">
              <Icon name="search" />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by vehicle name — e.g. Toyota Aqua, Prius, Wagon R"
                     aria-label="Search vehicles by name" autoComplete="off" enterKeyHint="search" maxLength={60} />
              {query && <button type="button" className="catalog__search-clear" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="x" size="sm" /></button>}
            </div>
            <div className="catalog__bar" aria-live="polite">
              <p className="catalog__count">
                <strong>{status === 'loading' ? '…' : results.length}</strong> {results.length === 1 ? 'vehicle' : 'vehicles'} found
                <span className="live"><i />Live availability</span>
              </p>
              <div className="catalog__actions">
                <button type="button" className="btn btn--ghost btn--sm filters__toggle" onClick={() => setSheetOpen(true)}>
                  <Icon name="menu" size="sm" />Filters{activeCount ? ` (${activeCount})` : ''}
                </button>
                <div className="sort">
                  <span>Sort by</span>
                  <Dropdown value={sort} onChange={setSort} ariaLabel="Sort by" className="dd--compact"
                            options={SORTS.map(o => ({ value: o.id, label: o.label }))} />
                </div>
              </div>
            </div>

            {status === 'loading' && [0, 1, 2].map(i => <div key={i} className="vrow vrow--skeleton" />)}

            {status !== 'loading' && results.map(v => <VehicleRow key={v.id} v={v} />)}

            {status !== 'loading' && !results.length && (
              <div className="fleet-empty">
                <span className="fleet-empty__icon"><Icon name="car" /></span>
                {status === 'error' ? (
                  <>
                    <h3>We couldn’t load the fleet right now</h3>
                    <p>Please check your connection and try again.</p>
                    <div className="fleet-empty__ctas"><button className="btn btn--red" onClick={retry}>Try again</button></div>
                  </>
                ) : vehicles.length && words.length ? (
                  <>
                    <h3>No vehicles named “{query.trim()}”</h3>
                    <p>Check the spelling, try just the model (e.g. “Aqua”){activeCount ? ', or clear the filters' : ''}.</p>
                    <div className="fleet-empty__ctas">
                      <button className="btn btn--red" onClick={() => setQuery('')}>Clear search</button>
                      {activeCount > 0 && <button className="btn btn--ghost" onClick={clearAll}>Clear all filters</button>}
                    </div>
                  </>
                ) : vehicles.length ? (
                  <>
                    <h3>No vehicles match these filters</h3>
                    <p>Try widening the price range or removing a filter.</p>
                    <div className="fleet-empty__ctas"><button className="btn btn--red" onClick={clearAll}>Clear all filters</button></div>
                  </>
                ) : (
                  <>
                    <h3>New vehicles are being added</h3>
                    <p>Tell us your dates and we’ll match you with a verified vehicle.</p>
                    <div className="fleet-empty__ctas">
                      <a href={`tel:${CONTACT.tel}`} className="btn btn--red"><Icon name="phone" size="sm" />{CONTACT.phone}</a>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
