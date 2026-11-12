import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { submitWeddingRequest, useWeddingCars } from '../lib/fleet';
import { CONTACT, waLink } from '../data/site';
import { DatePicker, TimePicker } from './ui/DateTime';
import WeddingShowcase from './WeddingShowcase';
import { track } from '../lib/analytics';

/*
 * /wedding-cars: the cars ticked on the admin's Website page and a quote request.
 * No prices here: the team quotes each event, so the request lands in the admin as an inquiry.
 */
const PERKS = [
  { icon: 'user', title: 'Professional driver', text: 'A driver comes with the car, so you can enjoy the day.' },
  { icon: 'spark', title: 'Decoration', text: 'Flowers and ribbons on the car — tell us what you have in mind.' },
  { icon: 'heart', title: 'Homecomings & events', text: 'Also for homecomings, photoshoots and other functions.' },
  { icon: 'map', title: 'Island-wide', text: 'We come to your venue, anywhere in Sri Lanka.' },
];

const EVENTS = ['Wedding', 'Homecoming', 'Photoshoot', 'Other event'];
const HOURS = ['A few hours', 'Half day', 'Full day', 'Not sure'];
const DECORATION = ['Yes please', 'No thanks', 'Not sure'];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const longDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function Chips({ label, options, value, onChange }) {
  return (
    <div className="fb-field wed-span">
      <span>{label}</span>
      <div className="chips wed-chips" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} className={`chip${value === o ? ' is-active' : ''}`} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
    </div>
  );
}

export default function WeddingPage() {
  const { vehicles, status: carsStatus } = useWeddingCars();
  const [form, setForm] = useState({
    event: 'Wedding', date: '', time: '09:00', venue: '', hours: 'Full day', decoration: 'Yes please',
    vehicleId: '', name: '', phone: '', email: '', message: '', agree: false,
  });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const formRef = useRef(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const chosen = vehicles.find((v) => v.id === form.vehicleId);
  const cover = vehicles.find((v) => v.heroImg)?.heroImg || vehicles.find((v) => v.img && v.img !== v.cutoutImg)?.img || '/img/eclass.jpg';

  const pick = (id) => { set('vehicleId', id); toForm(); };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const problem =
      !form.date ? 'Please choose the date of your event.' :
      form.venue.trim().length < 2 ? 'Please tell us the venue or area.' :
      form.name.trim().length < 2 ? 'Please enter your full name.' :
      form.phone.replace(/\D/g, '').length < 7 ? 'Please enter a phone or WhatsApp number we can reach you on.' :
      form.email && !/^\S+@\S+\.\S+$/.test(form.email) ? 'That email address doesn’t look right.' :
      !form.agree ? 'Please confirm that we can contact you about this request.' : '';
    if (problem) { setError(problem); return; }

    setStatus('sending');
    try {
      setReference(await submitWeddingRequest(form));
      setStatus('done');
      // Counted only once the request is saved — no name, phone, email or reference is sent
      track('generate_lead', { inquiry_type: 'wedding_request', event_type: form.event });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  if (status === 'done') {
    return (
      <main className="feedback-page">
        <div className="container">
          <div className="feedback-done">
            <span className="feedback-done__icon"><Icon name="check" /></span>
            <h1>Request received!</h1>
            <p>Thank you, {form.name.trim().split(' ')[0]}. Your reference is</p>
            <span className="book-ref">{reference}</span>
            <p>
              We’ll check {chosen ? <>the <b>{chosen.name}</b></> : 'our wedding cars'} for <b>{longDate(form.date)}</b> and
              send your quote to <b>{form.phone}</b>. Nothing has been charged.
            </p>
            <div className="fleet-empty__ctas">
              <a href={waLink(`Hi, I just sent wedding car request ${reference}.`)} target="_blank" rel="noreferrer" className="btn btn--red"><Icon name="chat" size="sm" />Message us on WhatsApp</a>
              <a href="/" className="btn btn--ghost">Back to home</a>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="wedding-page">
      <section className="wed-hero">
        <img src={cover} alt="" className="wed-hero__bg" />
        <div className="container wed-hero__inner">
          <span className="pill pill--light"><Icon name="heart" size="sm" />Wedding Cars</span>
          <h1>Arrive beautifully on your big day</h1>
          <p>A decorated car and a professional driver for your wedding, homecoming or photoshoot, anywhere in Sri Lanka. Tell us your date and we’ll send you a quote.</p>
          <button type="button" className="btn btn--red btn--lg" onClick={toForm}>Get a quote <Icon name="arrow" /></button>
        </div>
      </section>

      <div className="container">
        <ul className="wed-perks">
          {PERKS.map((p) => (
            <li key={p.title}>
              <span className="wed-perks__ic"><Icon name={p.icon} /></span>
              <div><h2>{p.title}</h2><p>{p.text}</p></div>
            </li>
          ))}
        </ul>

        <section className={`wed-section wed-section--centre${vehicles.length > 0 ? ' wed-section--screen' : ''}`} aria-labelledby="wed-cars">
          <span className="eyebrow">Our fleet</span>
          <h2 id="wed-cars">Choose your wedding car</h2>
          {carsStatus === 'loading' && <p className="wed-note">Loading our wedding cars…</p>}
          {carsStatus !== 'loading' && vehicles.length === 0 && (
            <p className="wed-note">
              Tell us about your day below and we’ll suggest the right car
              {carsStatus === 'ready' ? '.' : <>, or call us on <a href={`tel:${CONTACT.tel}`}>{CONTACT.phone}</a>.</>}
            </p>
          )}
          {vehicles.length > 0 && (
            <WeddingShowcase cars={vehicles} pickedId={form.vehicleId} onPick={pick} />
          )}
        </section>

        <form className="wed-form" onSubmit={submit} noValidate ref={formRef}>
          <section className="fb-card">
            <h2><span>1</span>Your event</h2>
            <div className="fb-grid">
              <Chips label="What’s the occasion?" options={EVENTS} value={form.event} onChange={(v) => set('event', v)} />
              <div className="fb-field">
                <span>Date *</span>
                <DatePicker value={form.date} onChange={(v) => set('date', v)} min={ymd(new Date())} ariaLabel="Event date" />
              </div>
              <div className="fb-field">
                <span>Start time (roughly)</span>
                <TimePicker value={form.time} onChange={(v) => set('time', v)} ariaLabel="Start time" />
              </div>
              <label className="fb-field wed-span">
                <span>Venue or area *</span>
                <input value={form.venue} onChange={(e) => set('venue', e.target.value)} maxLength={300} placeholder="e.g. Galle Face Hotel, Colombo" />
              </label>
              <Chips label="How long do you need the car?" options={HOURS} value={form.hours} onChange={(v) => set('hours', v)} />
              <Chips label="Would you like decoration?" options={DECORATION} value={form.decoration} onChange={(v) => set('decoration', v)} />
              {vehicles.length > 0 && (
                <div className="fb-field wed-span">
                  <span>Car</span>
                  <p className="wed-pick">
                    {chosen ? <><b>{chosen.name}</b><button type="button" onClick={() => set('vehicleId', '')}>Change</button></> : 'None chosen — we’ll suggest the best one for you.'}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="fb-card">
            <h2><span>2</span>Your details</h2>
            <div className="fb-grid">
              <label className="fb-field"><span>Full name *</span><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} autoComplete="name" /></label>
              <label className="fb-field"><span>Phone or WhatsApp *</span><input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} autoComplete="tel" placeholder="07X XXX XXXX" /></label>
              <label className="fb-field wed-span"><span>Email <em>(optional)</em></span><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={120} autoComplete="email" /></label>
              <label className="fb-field wed-span"><span>Anything else? <em>(optional)</em></span><textarea value={form.message} onChange={(e) => set('message', e.target.value)} maxLength={1000} rows={3} placeholder="e.g. Colour you prefer, number of stops, a second car for the family" /></label>
            </div>

            <label className="book-agree">
              <input type="checkbox" checked={form.agree} onChange={(e) => set('agree', e.target.checked)} />
              <span>I’m happy to be contacted about this request.</span>
            </label>

            {error && <p className="fb-error" role="alert">{error}</p>}

            <button type="submit" className="btn btn--red btn--lg btn--block" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending…' : <>Request a quote <Icon name="arrow" /></>}
            </button>
            <p className="wed-trust"><Icon name="shield" size="sm" />No payment now. We’ll confirm the car and price with you first.</p>
          </section>
        </form>
      </div>
    </main>
  );
}
