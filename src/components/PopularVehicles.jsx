import { useState } from 'react';
import { Icon } from './Icon';
import SectionHead from './SectionHead';
import { CONTACT, VEHICLE_FILTERS } from '../data/site';
import { useFleet } from '../lib/fleet';
import { openVehicle } from './VehicleModal';
import { Price, useApp } from '../context/AppContext';

function VehicleCard({ vehicle, saved, onToggleSave, hidden }) {
  const [pop, setPop] = useState(false);
  return (
    <article className={`car${hidden ? ' is-hidden' : ''}`} data-reveal>
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
          {vehicle.rating != null && (
            <span className="rating"><Icon name="star" size="sm" />{vehicle.rating.toFixed(1)} <small>({vehicle.reviews})</small></span>
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
          <button type="button" className="btn btn--dark btn--sm" onClick={() => openVehicle(vehicle.id)}>View Details <Icon name="arrow" size="sm" /></button>
        </div>
      </div>
    </article>
  );
}

export default function PopularVehicles() {
  const { showToast } = useApp();
  const [filter, setFilter] = useState('all');
  const [saved, setSaved] = useState(() => new Set());
  const { vehicles, status, retry } = useFleet();
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
          eyebrow="Live availability"
          title="Popular Vehicles & Starting Prices"
          text="Get an idea of what your Sri Lanka trip could cost."
        >
          {hasVehicles && chips.length > 2 && (
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
        </SectionHead>

        {status === 'loading' && (
          <div className="cars" aria-busy="true" aria-label="Loading vehicles">
            {[0, 1, 2].map(i => <div key={i} className="car car--skeleton" />)}
          </div>
        )}

        {hasVehicles && (
          <div className="cars">
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
