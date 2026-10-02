import { useState } from 'react';
import { Icon } from './Icon';
import { PICKUP_LOCATIONS, VEHICLE_TYPES } from '../data/site';
import { useApp } from '../context/AppContext';

const AIRPORT = PICKUP_LOCATIONS[0];

const MODES = [
  { id: 'self', label: 'Self Drive', icon: 'key', note: 'No sign-up needed to browse — free cancellation on most vehicles.' },
  { id: 'driver', label: 'With Driver', icon: 'wheel', note: 'English-speaking drivers. Driver meals and lodging shown upfront.' },
  { id: 'airport', label: 'Airport Pickup', icon: 'plane', note: 'Meet & greet at CMB arrivals, 24 hours a day.' },
];

const toISO = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export default function SearchPanel() {
  const { showToast } = useApp();
  const today = new Date();
  const [mode, setMode] = useState('self');
  const [form, setForm] = useState({
    pickup: 'Colombo',
    dropoff: '',
    pickupDate: toISO(addDays(today, 1)),
    pickupTime: '10:00',
    returnDate: toISO(addDays(today, 5)),
    returnTime: '10:00',
    type: VEHICLE_TYPES[0],
  });

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  const setPickupDate = e => {
    const pickupDate = e.target.value;
    setForm(f => ({
      ...f,
      pickupDate,
      returnDate: f.returnDate < pickupDate ? toISO(addDays(new Date(pickupDate), 3)) : f.returnDate,
    }));
  };

  const chooseMode = id => {
    setMode(id);
    setForm(f => ({
      ...f,
      pickup: id === 'airport' ? AIRPORT : (f.pickup === AIRPORT ? 'Colombo' : f.pickup),
    }));
  };

  const onSubmit = e => {
    e.preventDefault();
    const where = form.pickup.trim() || 'Sri Lanka';
    const days = Math.max(1, Math.round((new Date(form.returnDate) - new Date(form.pickupDate)) / 864e5));
    showToast(`Showing vehicles near ${where} for ${days} day${days > 1 ? 's' : ''}.`);
    document.getElementById('vehicles')?.scrollIntoView({ behavior: 'smooth' });
  };

  const note = MODES.find(m => m.id === mode).note;

  return (
    <div className="container search-wrap" id="search">
      <div className="search-tabs cr" role="tablist" aria-label="Booking type">
        {MODES.map(m => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={`search-tab${mode === m.id ? ' is-active' : ''}`}
            onClick={() => chooseMode(m.id)}
          >
            <Icon name={m.icon} size="sm" />{m.label}
          </button>
        ))}
      </div>

      <form className="search cr" autoComplete="off" onSubmit={onSubmit}>
        <div className="field field--loc">
          <label htmlFor="pickup">Pickup Location</label>
          <div className="field__ctl">
            <Icon name="pin" />
            <input id="pickup" list="locations" placeholder="City, airport or hotel" value={form.pickup} onChange={set('pickup')} />
          </div>
        </div>

        <div className="field field--loc">
          <label htmlFor="return">Return Location</label>
          <div className="field__ctl">
            <Icon name="pin" />
            <input id="return" list="locations" placeholder="Same as pickup" value={form.dropoff} onChange={set('dropoff')} />
          </div>
        </div>

        <div className="field field--dt">
          <label htmlFor="pdate">Pickup Date &amp; Time</label>
          <div className="field__pair">
            <div className="field__ctl">
              <Icon name="calendar" />
              <input type="date" id="pdate" aria-label="Pickup date" min={toISO(today)} value={form.pickupDate} onChange={setPickupDate} />
            </div>
            <div className="field__ctl field__ctl--time">
              <input type="time" aria-label="Pickup time" value={form.pickupTime} onChange={set('pickupTime')} />
            </div>
          </div>
        </div>

        <div className="field field--dt">
          <label htmlFor="rdate">Return Date &amp; Time</label>
          <div className="field__pair">
            <div className="field__ctl">
              <Icon name="calendar" />
              <input type="date" id="rdate" aria-label="Return date" min={form.pickupDate} value={form.returnDate} onChange={set('returnDate')} />
            </div>
            <div className="field__ctl field__ctl--time">
              <input type="time" aria-label="Return time" value={form.returnTime} onChange={set('returnTime')} />
            </div>
          </div>
        </div>

        <div className="field field--type">
          <label htmlFor="vtype">Vehicle Type</label>
          <div className="field__ctl">
            <Icon name="car" />
            <select id="vtype" value={form.type} onChange={set('type')}>
              {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <button type="submit" className="btn btn--red btn--search"><Icon name="search" />Search Vehicles</button>
        <p className="search__note"><Icon name="check" size="sm" />{note}</p>
      </form>

      <datalist id="locations">
        {PICKUP_LOCATIONS.map(l => <option key={l} value={l} />)}
      </datalist>
    </div>
  );
}
