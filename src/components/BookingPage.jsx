import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Price } from '../context/AppContext';
import { fetchBusyDates, submitBookingRequest, useCatalog } from '../lib/fleet';
import { CONTACT, PICKUP_LOCATIONS } from '../data/site';
import MapPicker, { MAPS_KEY } from './MapPicker';
import Dropdown from './ui/Dropdown';
import { DatePicker, TimePicker, label12 } from './ui/DateTime';
import { openVehicle } from './VehicleModal';

const LOCATION_OPTIONS = PICKUP_LOCATIONS.map(l => ({ value: l, label: l, icon: /airport/i.test(l) ? 'plane' : 'pin' }));

/* A location: one of our usual places from the list, or any spot picked on Google Maps */
function LocationField({ label, value, pos, onList, onMap, disabled, title }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fb-field">
      <span>{label}</span>
      {pos ? (
        <div className="loc-picked">
          <Icon name="pin" size="sm" />
          <a href={`https://www.google.com/maps?q=${pos.lat},${pos.lng}`} target="_blank" rel="noreferrer" title="Open in Google Maps">{value}</a>
          <button type="button" onClick={() => setOpen(true)}>Change</button>
          <button type="button" aria-label="Use the list instead" onClick={() => onList(PICKUP_LOCATIONS[0])}><Icon name="x" size="sm" /></button>
        </div>
      ) : (
        <div className="loc-row">
          <Dropdown value={value} onChange={onList} options={LOCATION_OPTIONS} disabled={disabled} ariaLabel={label} />
          {MAPS_KEY && !disabled && (
            <button type="button" className="loc-mapbtn" onClick={() => setOpen(true)} title="Choose on Google Maps">
              <Icon name="map" size="sm" /><span>Map</span>
            </button>
          )}
        </div>
      )}
      <MapPicker open={open} title={title} initial={pos ? { label: value, ...pos } : null}
                 onClose={() => setOpen(false)} onConfirm={p => onMap(p)} />
    </div>
  );
}

const MODES = [
  { id: 'Self drive', icon: 'key', hint: 'You drive — licence + IDP needed' },
  { id: 'With driver', icon: 'user', hint: 'English-speaking driver included' },
  { id: 'Airport pickup', icon: 'plane', hint: 'Meet & greet at arrivals (CMB)' },
];

const DAY = 86400000;
const withLink = (label, pos) => (pos ? `${label} — https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` : label);
const isoDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (iso, n) => isoDay(new Date(new Date(iso + 'T00:00').getTime() + n * DAY));
const shortDate = iso => new Date(iso + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmt = iso => new Date(iso + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/* Days charged: full 24h periods between pickup and return (minimum 1) */
function rentalDays(startDate, startTime, endDate, endTime) {
  if (!startDate || !endDate) return 0;
  const ms = new Date(`${endDate}T${endTime || '10:00'}`) - new Date(`${startDate}T${startTime || '10:00'}`);
  return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / DAY));
}

/**
 * Booking request page: /book?v=<vehicleId>
 * Sends a request that lands in the admin as a Pending inquiry (referral "Website").
 * Nothing is charged online — the team confirms availability and the final price.
 */
export default function BookingPage({ search = '' }) {
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const { vehicles, status: fleetStatus } = useCatalog();
  const today = isoDay(new Date());

  const [form, setForm] = useState(() => {
    const start = params.get('from') || addDays(today, 1);
    return {
      vehicleId: params.get('v') || '',
      mode: MODES.some(m => m.id === params.get('mode')) ? params.get('mode') : 'Self drive',
      pickup: PICKUP_LOCATIONS[0],
      pickupPos: null,      // { lat, lng } when chosen on the map
      returnTo: '',
      returnPos: null,
      sameReturn: true,
      startDate: start,
      startTime: '10:00',
      endDate: params.get('to') || addDays(start, 3),
      endTime: '10:00',
      name: params.get('n') || '', phone: '', email: '', country: '', message: '',
      agree: false,
    };
  });
  const [busy, setBusy] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const vehicle = vehicles.find(v => v.id === form.vehicleId);
  const days = rentalDays(form.startDate, form.startTime, form.endDate, form.endTime);
  const estimate = vehicle ? vehicle.price * days : 0;

  // Booked from the /alternatives page: link this request to the customer's original inquiry
  const altOf = params.get('alt') || '';
  const altRef = params.get('ref') || '';

  // "Book Now" inside the details window points here with ?v=… — switch to that vehicle
  const urlVehicle = params.get('v');
  useEffect(() => { if (urlVehicle) set('vehicleId', urlVehicle); }, [urlVehicle]);

  // Airport pickup always starts at the airport
  useEffect(() => { if (form.mode === 'Airport pickup') setForm(f => ({ ...f, pickup: PICKUP_LOCATIONS[0], pickupPos: null })); }, [form.mode]);

  // Keep return after pickup
  useEffect(() => {
    if (form.endDate < form.startDate) set('endDate', addDays(form.startDate, 1));
  }, [form.startDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dates this vehicle is already taken
  useEffect(() => {
    let live = true;
    setBusy([]);
    fetchBusyDates(form.vehicleId).then(b => live && setBusy(b));
    return () => { live = false; };
  }, [form.vehicleId]);

  const clash = busy.find(b => b.start_date <= form.endDate && b.end_date >= form.startDate);

  // Phones/tablets: a bottom bar recaps the selection until the summary card scrolls into view
  const summaryRef = useRef(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  useEffect(() => {
    const el = summaryRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setSummaryVisible(e.isIntersecting || e.boundingClientRect.top < 0), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [status]);
  const scrollToSummary = () => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useEffect(() => {
    document.title = 'Book a vehicle — Ceylon Rent A Cars';
    return () => { document.title = 'Ceylon Rent A Cars — Vehicle Rentals Across Sri Lanka'; };
  }, []);

  const submit = async e => {
    e.preventDefault();
    setError('');
    const problem =
      !vehicle ? 'Please choose a vehicle.' :
      days < 1 ? 'Your return must be after your pickup.' :
      clash ? `This vehicle is already booked ${fmt(clash.start_date)} – ${fmt(clash.end_date)}. Please choose other dates.` :
      form.name.trim().length < 2 ? 'Please enter your full name.' :
      form.phone.replace(/\D/g, '').length < 7 ? 'Please enter a phone or WhatsApp number we can reach you on.' :
      form.email && !/^\S+@\S+\.\S+$/.test(form.email) ? 'That email address doesn’t look right.' :
      !form.agree ? 'Please confirm that the details are correct.' : '';
    if (problem) { setError(problem); return; }

    setStatus('sending');
    try {
      const ref = await submitBookingRequest({
        ...form,
        pickup: withLink(form.pickup, form.pickupPos),
        returnTo: form.sameReturn ? withLink(form.pickup, form.pickupPos) : withLink(form.returnTo || form.pickup, form.returnPos),
        alternativeOf: altOf,
        estimate,
      });
      setReference(ref);
      setStatus('done');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  /* ---------- Confirmation ---------- */
  if (status === 'done') {
    const wa = `https://wa.me/${CONTACT.tel.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, I just sent booking request ${reference} for the ${vehicle?.name}.`)}`;
    return (
      <main className="feedback-page">
        <div className="container">
          <div className="feedback-done">
            <span className="feedback-done__icon"><Icon name="check" /></span>
            <h1>Request received!</h1>
            <p>Thank you, {form.name.trim().split(' ')[0]}. Your booking reference is</p>
            <span className="book-ref">{reference}</span>
            <p>
              We’ll check availability for the <b>{vehicle?.name}</b> from <b>{fmt(form.startDate)}</b> to <b>{fmt(form.endDate)}</b> and
              confirm with you on <b>{form.phone}</b> shortly. Nothing has been charged.
            </p>
            <div className="fleet-empty__ctas">
              <a href={wa} target="_blank" rel="noreferrer" className="btn btn--red"><Icon name="chat" size="sm" />Message us on WhatsApp</a>
              <a href="/" className="btn btn--ghost">Back to home</a>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="feedback-page booking-page">
      <div className="container">
        <header className="catalog-head">
          <span className="eyebrow">Book your vehicle</span>
          <h1>Request a booking</h1>
          <p>Tell us your dates — we confirm availability and the final price before anything is charged.</p>
        </header>

        {altOf && (
          <div className="book-alt">
            <Icon name="check" size="sm" />
            <p>You’re choosing an <b>alternative vehicle</b>{altRef ? <> for request <b>{altRef}</b></> : ''}. Our team will continue with your original booking details — just confirm the dates and your contact number.</p>
          </div>
        )}

        <form className="booking" onSubmit={submit} noValidate>
          <div className="booking__main">
            {/* 1 · Vehicle */}
            <section className="fb-card">
              <h2><span>1</span>Vehicle</h2>
              <div className="fb-field">
                <span>Which vehicle would you like?</span>
                <Dropdown
                  searchable icon="car" ariaLabel="Vehicle"
                  placeholder={fleetStatus === 'loading' ? 'Loading vehicles…' : 'Choose a vehicle…'}
                  value={form.vehicleId} onChange={v => set('vehicleId', v)}
                  onInfo={o => openVehicle(vehicles.find(v => v.id === o.value))}
                  options={[...vehicles].sort((a, b) => a.name.localeCompare(b.name)).map(v => ({
                    value: v.id, icon: 'car', img: v.img || null,
                    label: `${v.name}${v.year ? ` (${v.year})` : ''}`,
                    sub: `From LKR ${v.price.toLocaleString()}/day · ${v.seats} seats · ${v.transmission}`,
                  }))}
                />
              </div>

              {vehicle && (
                <div className="book-pick">
                  <button type="button" className={`book-pick__img${vehicle.img === vehicle.cutoutImg && !vehicle.photos.length && !vehicle.heroImg ? ' is-cutout' : ''}`}
                          onClick={() => openVehicle(vehicle)} aria-label={`View ${vehicle.name}`}>
                    {vehicle.img ? <img src={vehicle.img} alt="" /> : <Icon name="car" />}
                  </button>
                  <div className="book-pick__info">
                    <b>{vehicle.name}{vehicle.year ? ` · ${vehicle.year}` : ''}</b>
                    <ul>
                      <li><Icon name="seat" size="sm" />{vehicle.seats} seats</li>
                      <li><Icon name="gear" size="sm" />{vehicle.transmission}</li>
                      <li><Icon name={vehicle.fuelIcon} size="sm" />{vehicle.fuel}</li>
                      {vehicle.rating != null && vehicle.reviewCount > 0 && <li className="is-star"><Icon name="star" size="sm" />{vehicle.rating.toFixed(1)}</li>}
                    </ul>
                  </div>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openVehicle(vehicle)}>
                    View details <Icon name="arrow" size="sm" />
                  </button>
                </div>
              )}

              <div className="book-modes" role="radiogroup" aria-label="Rental type">
                {MODES.map(m => (
                  <button key={m.id} type="button" role="radio" aria-checked={form.mode === m.id}
                          className={`book-mode${form.mode === m.id ? ' is-active' : ''}`} onClick={() => set('mode', m.id)}>
                    <Icon name={m.icon} />
                    <b>{m.id}</b>
                    <small>{m.hint}</small>
                  </button>
                ))}
              </div>
            </section>

            {/* 2 · Trip */}
            <section className="fb-card">
              <h2><span>2</span>Pickup &amp; return</h2>
              <div className="fb-grid">
                <LocationField
                  label="Pickup location" title="Choose pickup location"
                  value={form.pickup} pos={form.pickupPos} disabled={form.mode === 'Airport pickup'}
                  onList={v => setForm(f => ({ ...f, pickup: v, pickupPos: null }))}
                  onMap={p => setForm(f => ({ ...f, pickup: p.label, pickupPos: { lat: p.lat, lng: p.lng } }))}
                />
                {form.sameReturn ? (
                  <div className="fb-field">
                    <span>Return location</span>
                    <button type="button" className="book-same" onClick={() => setForm(f => ({ ...f, sameReturn: false, returnTo: f.pickup, returnPos: f.pickupPos }))}>
                      Same as pickup <em>Change</em>
                    </button>
                  </div>
                ) : (
                  <LocationField
                    label="Return location" title="Choose return location"
                    value={form.returnTo || form.pickup} pos={form.returnPos}
                    onList={v => setForm(f => ({ ...f, returnTo: v, returnPos: null }))}
                    onMap={p => setForm(f => ({ ...f, returnTo: p.label, returnPos: { lat: p.lat, lng: p.lng } }))}
                  />
                )}

                <div className="fb-field">
                  <span>Pickup date &amp; time</span>
                  <div className="book-dt">
                    <DatePicker value={form.startDate} min={today} busy={busy} rangeStart={form.startDate} rangeEnd={form.endDate}
                                onChange={d => set('startDate', d)} ariaLabel="Pickup date" />
                    <TimePicker value={form.startTime} onChange={t => set('startTime', t)} ariaLabel="Pickup time" />
                  </div>
                </div>
                <div className="fb-field">
                  <span>Return date &amp; time</span>
                  <div className="book-dt">
                    <DatePicker value={form.endDate} min={form.startDate || today} busy={busy} rangeStart={form.startDate} rangeEnd={form.endDate}
                                onChange={d => set('endDate', d)} ariaLabel="Return date" />
                    <TimePicker value={form.endTime} onChange={t => set('endTime', t)} ariaLabel="Return time" />
                  </div>
                </div>
              </div>

              {clash ? (
                <p className="book-warn"><Icon name="clock" size="sm" />Already booked {fmt(clash.start_date)} – {fmt(clash.end_date)}. Please pick different dates.</p>
              ) : vehicle && days > 0 ? (
                <p className="book-ok"><Icon name="check" size="sm" />Free for your dates — {days} {days === 1 ? 'day' : 'days'}</p>
              ) : null}
              {busy.length > 0 && !clash && (
                <p className="fb-hint">Already booked: {busy.slice(0, 4).map(b => `${fmt(b.start_date)} – ${fmt(b.end_date)}`).join(' · ')}</p>
              )}
            </section>

            {/* 3 · Contact */}
            <section className="fb-card">
              <h2><span>3</span>Your details</h2>
              <div className="fb-grid">
                <label className="fb-field">
                  <span>Full name *</span>
                  <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="As on your passport / licence" maxLength={80} autoComplete="name" />
                </label>
                <label className="fb-field">
                  <span>Phone / WhatsApp *</span>
                  <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+44 7700 900123" maxLength={30} inputMode="tel" autoComplete="tel" />
                </label>
                <label className="fb-field">
                  <span>Email <em>(optional)</em></span>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@example.com" maxLength={120} autoComplete="email" />
                </label>
                <label className="fb-field">
                  <span>Country <em>(optional)</em></span>
                  <input value={form.country} onChange={e => set('country', e.target.value)} placeholder="e.g. United Kingdom" maxLength={40} autoComplete="country-name" />
                </label>
              </div>
              <label className="fb-field">
                <span>Anything we should know? <em>(optional)</em></span>
                <textarea rows={3} maxLength={1000} value={form.message} onChange={e => set('message', e.target.value)}
                          placeholder="Flight number, child seat, route plans, number of passengers…" />
              </label>
            </section>
          </div>

          {/* Summary */}
          <aside className="booking__summary" ref={summaryRef}>
            <div className="book-sum">
              {vehicle ? (
                <>
                  <div className={`book-sum__img${vehicle.img === vehicle.cutoutImg && !vehicle.photos.length && !vehicle.heroImg ? ' is-cutout' : ''}`}>
                    {vehicle.img ? <img src={vehicle.img} alt={vehicle.name} /> : <Icon name="car" />}
                  </div>
                  <h3>{vehicle.name}</h3>
                  <p className="book-sum__specs">{vehicle.seats} seats · {vehicle.transmission} · {vehicle.fuel}</p>
                </>
              ) : (
                <div className="book-sum__img"><Icon name="car" /></div>
              )}

              <dl className="book-sum__rows">
                <div><dt>Type</dt><dd>{form.mode}</dd></div>
                <div><dt>Pickup</dt><dd>{fmt(form.startDate)} · {label12(form.startTime)}</dd></div>
                <div><dt>Return</dt><dd>{form.endDate ? `${fmt(form.endDate)} · ${label12(form.endTime)}` : '—'}</dd></div>
                <div><dt>Rate</dt><dd>{vehicle ? <><Price lkr={vehicle.price} /> / day</> : '—'}</dd></div>
                <div><dt>Days</dt><dd>{days || '—'}</dd></div>
              </dl>

              <div className="book-sum__total">
                <span>Estimated total</span>
                <strong>{vehicle && days ? <Price lkr={estimate} /> : '—'}</strong>
              </div>
              {form.mode !== 'Self drive' && <p className="book-sum__note">Driver / airport charges are confirmed by our team.</p>}

              <label className="book-agree">
                <input type="checkbox" checked={form.agree} onChange={e => set('agree', e.target.checked)} />
                <span>My details are correct and I’m happy to be contacted to confirm this booking.</span>
              </label>

              {error && <p className="fb-error" role="alert">{error}</p>}

              <button type="submit" className="btn btn--red btn--lg btn--block" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : <>Request booking <Icon name="arrow" /></>}
              </button>
              <ul className="book-sum__trust">
                <li><Icon name="shield" size="sm" />No payment now</li>
                <li><Icon name="chat" size="sm" />We confirm on WhatsApp</li>
                <li><Icon name="badge" size="sm" />Verified vehicles</li>
              </ul>
            </div>
          </aside>
        </form>
      </div>

      <div className={`book-bar${summaryVisible ? ' is-hidden' : ''}`} aria-hidden={summaryVisible}>
        <div className="book-bar__thumb">
          {vehicle?.img ? <img src={vehicle.img} alt="" /> : <Icon name="car" />}
        </div>
        <div className="book-bar__info">
          <b>{vehicle ? vehicle.name : 'No vehicle selected'}</b>
          <small>
            {vehicle
              ? <>{shortDate(form.startDate)} – {shortDate(form.endDate)} · {days || '—'} {days === 1 ? 'day' : 'days'}</>
              : 'Choose a vehicle to see the price'}
          </small>
          {vehicle && days > 0 && <strong><Price lkr={estimate} /> <em>total</em></strong>}
        </div>
        <button type="button" className="btn btn--red btn--sm" onClick={scrollToSummary} tabIndex={summaryVisible ? -1 : 0}>
          Review <Icon name="arrow" size="sm" />
        </button>
      </div>
    </main>
  );
}
