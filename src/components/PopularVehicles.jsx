import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from './Icon';
import SectionHead from './SectionHead';
import { CONTACT, VEHICLE_FILTERS } from '../data/site';
import { usePopular } from '../lib/fleet';
import { openVehicle } from './VehicleModal';
import { Price, useApp } from '../context/AppContext';

/* ---------- Visitor-chosen cards per row (2–5), limited to what fits the screen ---------- */
const PER_ROW_OPTIONS = [2, 3, 4, 5];
const PER_ROW_KEY = 'crac-cars-per-row';

// Most columns that still give readable cards at this width (phones use the swipe carousel)
const maxColsFor = w => (w >= 1440 ? 5 : w >= 1200 ? 4 : w >= 900 ? 3 : 2);

function usePerRow() {
  const [chosen, setChosen] = useState(() => {
    try { return Number(localStorage.getItem(PER_ROW_KEY)) || 3; } catch { return 3; }
  });
  const [max, setMax] = useState(() => maxColsFor(window.innerWidth));

  useEffect(() => {
    const onResize = () => setMax(maxColsFor(window.innerWidth));
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const choose = n => {
    try { localStorage.setItem(PER_ROW_KEY, String(n)); } catch { /* private mode etc. */ }
    // Animate cards into their new grid positions where the browser supports it
    if (document.startViewTransition) document.startViewTransition(() => flushSync(() => setChosen(n)));
    else setChosen(n);
  };

  const options = PER_ROW_OPTIONS.filter(n => n <= max);
  return { cols: Math.min(chosen, max), options, choose };
}

function VehicleCard({ vehicle, saved, onToggleSave, hidden }) {
  const [pop, setPop] = useState(false);
  return (
    <article
      className={`car${hidden ? ' is-hidden' : ''}`}
      data-reveal
      // Unique name lets the per-row switch animate each card to its new spot
      style={{ viewTransitionName: `car-${String(vehicle.id).replace(/[^\w-]/g, '')}` }}
    >
      <div className="car__media">
        {vehicle.img
          ? <img src={vehicle.img} alt={vehicle.name} loading="lazy" />
          : <div className="car__noimg"><Icon name="car" /></div>}
        <span className="verified"><Icon name="badge" size="xs" />Verified</span>
        {vehicle.badge && <span className={`hot${vehicle.badgeLight ? ' hot--light' : ''}`}>{vehicle.badge}</span>}
        <button
          className={`fav${pop ? ' pop' : ''}`}
          aria-label={`Save ${vehicle.name}`}
          aria-pressed={saved}
          onClick={() => { onToggleSave(vehicle); setPop(true); }}
          onAnimationEnd={() => setPop(false)}
        >
          <Icon name="heart" />
        </button>
      </div>
      <div className="car__body">
        <div className="car__row">
          <span className="cat">{vehicle.catLabel}</span>
          {vehicle.hires != null && (
            <span className={`hires${vehicle.hires ? '' : ' hires--none'}`} title="Completed trips">
              <Icon name="check" size="sm" />{vehicle.hires} {vehicle.hires === 1 ? 'trip' : 'trips'}
            </span>
          )}
        </div>
        <h3>{vehicle.name}</h3>
        <p className="loc"><Icon name="pin" size="sm" />{vehicle.location}</p>
        <ul className="specs">
          <li><Icon name="gear" size="sm" />{vehicle.transmission}</li>
          <li><Icon name={vehicle.fuelIcon} size="sm" />{vehicle.fuel}</li>
          <li><Icon name="seat" size="sm" />{vehicle.seats} Seats</li>
        </ul>
        <div className="car__foot">
          <div className="from"><small>From</small><Price lkr={vehicle.price} as="strong" /><span>/day</span></div>
          <button type="button" className="btn btn--dark btn--sm" onClick={() => openVehicle(vehicle)}>View Details <Icon name="arrow" size="sm" /></button>
        </div>
      </div>
    </article>
  );
}

export default function PopularVehicles() {
  const { showToast } = useApp();
  const [filter, setFilter] = useState('all');
  const perRow = usePerRow();
  const [saved, setSaved] = useState(() => new Set());
  // Top 10 vehicles by completed hires (counted in the database)
  const { vehicles, status, retry } = usePopular();
  const hasVehicles = vehicles.length > 0;

  // Only offer filters for categories that are actually listed
  const filters = VEHICLE_FILTERS.filter(f => f.id === 'all' || vehicles.some(v => v.cat === f.id));
  const extraCats = [...new Set(vehicles.map(v => v.cat))]
    .filter(c => !VEHICLE_FILTERS.some(f => f.id === c))
    .map(c => ({ id: c, label: vehicles.find(v => v.cat === c).catLabel }));
  const chips = [...filters, ...extraCats];
  const activeFilter = chips.some(f => f.id === filter) ? filter : 'all';

  const toggleSave = vehicle => {
    const wasSaved = saved.has(vehicle.id);
    setSaved(prev => {
      const next = new Set(prev);
      if (wasSaved) next.delete(vehicle.id);
      else next.add(vehicle.id);
      return next;
    });
    if (!wasSaved) showToast('Saved to your shortlist — no account needed.');
  };

  return (
    <section className="section section--first" id="vehicles">
      <div className="container">
        <SectionHead
          row
          eyebrow="Most booked"
          title="Popular Vehicles & Starting Prices"
          text="Our most-hired vehicles, ranked by completed trips — with starting prices for your Sri Lanka trip."
        >
          {hasVehicles && (
            <div className="vehicles-tools">
              {chips.length > 2 && (
                <div className="chips" role="tablist" aria-label="Filter vehicles">
                  {chips.map(f => (
                    <button
                      key={f.id}
                      role="tab"
                      aria-selected={activeFilter === f.id}
                      className={`chip${activeFilter === f.id ? ' is-active' : ''}`}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              {perRow.options.length > 1 && (
                <div className="chips per-row" role="radiogroup" aria-label="Vehicles per row">
                  <span className="per-row__label">Per row</span>
                  {perRow.options.map(n => (
                    <button
                      key={n}
                      role="radio"
                      aria-checked={perRow.cols === n}
                      aria-label={`${n} per row`}
                      title={`${n} per row`}
                      className={`chip per-row__btn${perRow.cols === n ? ' is-active' : ''}`}
                      onClick={() => perRow.choose(n)}
                    >
                      <span className="per-row__glyph" aria-hidden="true">
                        {Array.from({ length: n }, (_, i) => <i key={i} />)}
                      </span>
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </SectionHead>

        {status === 'loading' && (
          <div className="cars" style={{ '--cols': perRow.cols }} aria-busy="true" aria-label="Loading vehicles">
            {Array.from({ length: perRow.cols }, (_, i) => i).map(i => <div key={i} className="car car--skeleton" />)}
          </div>
        )}

        {hasVehicles && (
          <div className={`cars${perRow.cols >= 4 ? ' cars--dense' : ''}`} data-cols={perRow.cols} style={{ '--cols': perRow.cols }}>
            {vehicles.map(v => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                saved={saved.has(v.id)}
                onToggleSave={toggleSave}
                hidden={activeFilter !== 'all' && v.cat !== activeFilter}
              />
            ))}
          </div>
        )}

        {!hasVehicles && status !== 'loading' && (
          <div className="fleet-empty" data-reveal>
            <span className="fleet-empty__icon"><Icon name="car" /></span>
            {status === 'error' ? (
              <>
                <h3>We couldn’t load our vehicles right now</h3>
                <p>Please check your connection and try again — or contact us and we’ll find you a car.</p>
                <div className="fleet-empty__ctas">
                  <button className="btn btn--red" onClick={retry}>Try again</button>
                  <a href={`tel:${CONTACT.tel}`} className="btn btn--ghost"><Icon name="phone" size="sm" />{CONTACT.phone}</a>
                </div>
              </>
            ) : (
              <>
                <h3>New vehicles are being added</h3>
                <p>Our fleet list is being updated. Tell us your dates and we’ll match you with a verified vehicle.</p>
                <div className="fleet-empty__ctas">
                  <a href={`tel:${CONTACT.tel}`} className="btn btn--red"><Icon name="phone" size="sm" />{CONTACT.phone}</a>
                  <a href={`mailto:${CONTACT.email}`} className="btn btn--ghost"><Icon name="mail" size="sm" />Email us</a>
                </div>
              </>
            )}
          </div>
        )}

        {hasVehicles && (
          <p className="fine-print" data-reveal>
            Prices shown are starting daily rates. Final price can vary by dates, owner, location and season — you’ll always see the full total before you pay.
          </p>
        )}
      </div>
    </section>
  );
}
