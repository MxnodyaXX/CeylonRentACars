import { useState } from 'react';
import { Icon } from './Icon';
import SectionHead from './SectionHead';
import { VEHICLES, VEHICLE_FILTERS } from '../data/site';
import { Price, useApp } from '../context/AppContext';

function VehicleCard({ vehicle, saved, onToggleSave, hidden }) {
  const [pop, setPop] = useState(false);
  return (
    <article className={`car${hidden ? ' is-hidden' : ''}`} data-reveal>
      <div className="car__media">
        <img src={vehicle.img} alt={vehicle.name} loading="lazy" />
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
          <span className="rating"><Icon name="star" size="sm" />{vehicle.rating.toFixed(1)} <small>({vehicle.reviews})</small></span>
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
          <a href="#" className="btn btn--dark btn--sm">View Details <Icon name="arrow" size="sm" /></a>
        </div>
      </div>
    </article>
  );
}

export default function PopularVehicles() {
  const { showToast } = useApp();
  const [filter, setFilter] = useState('all');
  const [saved, setSaved] = useState(() => new Set());

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
          <div className="chips" role="tablist" aria-label="Filter vehicles">
            {VEHICLE_FILTERS.map(f => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                className={`chip${filter === f.id ? ' is-active' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </SectionHead>

        <div className="cars">
          {VEHICLES.map(v => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              saved={saved.has(v.id)}
              onToggleSave={toggleSave}
              hidden={filter !== 'all' && v.cat !== filter}
            />
          ))}
        </div>

        <p className="fine-print" data-reveal>
          Prices shown are starting daily rates. Final price can vary by dates, owner, location and season — you’ll always see the full total before you pay.
        </p>
      </div>
    </section>
  );
}
