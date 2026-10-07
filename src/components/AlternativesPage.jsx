import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { chooseAlternative, useCatalog } from '../lib/fleet';
import { VehicleRow } from './AllVehicles';
import { CONTACT, waLink } from '../data/site';

const pretty = d => (d ? new Date(d + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

/**
 * Personal "alternatives" page sent from the admin when the requested vehicle is unavailable:
 *   /alternatives?ids=a,b,c&req=Toyota%20Yaris%20X&from=2026-10-07&to=2026-10-16&n=Brian&ref=CRC-452013
 * Apologises, then lists the suggested vehicles; "Book" carries the customer's dates.
 */
export default function AlternativesPage({ search = '' }) {
  const p = useMemo(() => new URLSearchParams(search), [search]);
  const ids = (p.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean);
  const requested = p.get('req') || 'the vehicle you requested';
  const name = (p.get('n') || '').trim().split(' ')[0];
  const from = isDate(p.get('from')) ? p.get('from') : '';
  const to = isDate(p.get('to')) ? p.get('to') : '';
  const ref = p.get('ref');
  const original = p.get('i');   // original inquiry id — links the new request to it

  const { vehicles, status } = useCatalog();
  // Keep the order the team chose
  const list = ids.map(id => vehicles.find(v => v.id === id)).filter(Boolean);
  const bookQuery = `${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`
    + `${original ? `&alt=${encodeURIComponent(original)}` : ''}${name ? `&n=${encodeURIComponent(name)}` : ''}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
  const wa = waLink(`Hi, about my booking request${ref ? ` ${ref}` : ''} — I'd like one of the alternative vehicles.`);

  // One-tap choice (no form): the original request's dates, locations and contact details are reused
  const [confirming, setConfirming] = useState(null);   // vehicle id awaiting "Yes, choose it"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(null);            // { vehicle, reference }

  const choose = async v => {
    setBusy(true); setError('');
    try {
      const reference = await chooseAlternative(original, v.id);
      setChosen({ vehicle: v, reference });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const actionFor = v => {
    if (!original) return undefined;   // older links without the inquiry: fall back to the booking form
    if (confirming !== v.id) {
      return <button type="button" className="btn btn--red btn--sm" onClick={() => { setConfirming(v.id); setError(''); }}>Choose this vehicle <Icon name="arrow" size="sm" /></button>;
    }
    return (
      <span className="alt-confirm">
        <button type="button" className="btn btn--red btn--sm" disabled={busy} onClick={() => choose(v)}>{busy ? 'Confirming…' : 'Yes, choose it'}</button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
      </span>
    );
  };

  useEffect(() => {
    document.title = 'Alternative vehicles for you — Ceylon Rent A Cars';
    return () => { document.title = 'Ceylon Rent A Cars — Vehicle Rentals Across Sri Lanka'; };
  }, []);

  if (chosen) {
    return (
      <main className="feedback-page">
        <div className="container">
          <div className="feedback-done">
            <span className="feedback-done__icon"><Icon name="check" /></span>
            <h1>Great choice{name ? `, ${name}` : ''}!</h1>
            <p>We’ve switched your booking request to the <b>{chosen.vehicle.name}</b>{from && to ? <> for <b>{pretty(from)} – {pretty(to)}</b></> : ''}. Your pickup, return and contact details stay the same.</p>
            <span className="book-ref">{chosen.reference}</span>
            <p>Our team will confirm the final price and details with you shortly. Nothing has been charged.</p>
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
    <main className="catalog-page alt-page">
      <div className="container">
        <header className="alt-hero">
          <span className="alt-hero__icon"><Icon name="car" /></span>
          <span className="eyebrow">{ref ? `Booking request ${ref}` : 'Your booking request'}</span>
          <h1>{name ? `Sorry, ${name} — ` : 'We’re sorry — '}<span className="text-red">{requested}</span> isn’t available{from && to ? ' for your dates' : ''}.</h1>
          <p>
            We know you had your heart set on it. Our team has hand-picked the vehicles below as the closest match —
            similar size, comfort and price{from && to ? ', and every one of them is free for your trip' : ''}.
            {original && ' Just tap “Choose this vehicle” — we’ll keep your dates, pickup and contact details.'}
          </p>
          {from && to && (
            <div className="alt-hero__trip">
              <Icon name="calendar" size="sm" />
              <b>{pretty(from)}</b><span>→</span><b>{pretty(to)}</b>
            </div>
          )}
        </header>

        <section className="catalog__results">
          {status === 'loading' && [0, 1, 2].map(i => <div key={i} className="vrow vrow--skeleton" />)}
          {status !== 'loading' && list.map((v, i) => (
            <div key={v.id} className="alt-item">
              <span className="alt-item__n">Option {i + 1}</span>
              <VehicleRow v={v} bookQuery={bookQuery} action={actionFor(v)} />
              {confirming === v.id && error && <p className="fb-error alt-item__err">{error}</p>}
            </div>
          ))}
          {status !== 'loading' && list.length === 0 && (
            <div className="fleet-empty">
              <span className="fleet-empty__icon"><Icon name="car" /></span>
              <h3>These suggestions are no longer available</h3>
              <p>Please message us and we’ll find you another great option right away.</p>
              <div className="fleet-empty__ctas">
                <a href={wa} target="_blank" rel="noreferrer" className="btn btn--red"><Icon name="chat" size="sm" />WhatsApp us</a>
                <a href="/vehicles" className="btn btn--ghost">Browse all vehicles</a>
              </div>
            </div>
          )}
        </section>

        {list.length > 0 && (
          <div className="alt-help">
            <div>
              <b>Not quite right?</b>
              <p>Tell us what matters most — seats, budget or style — and we’ll suggest more.</p>
            </div>
            <div className="fleet-empty__ctas">
              <a href={wa} target="_blank" rel="noreferrer" className="btn btn--red"><Icon name="chat" size="sm" />WhatsApp us</a>
              <a href={`tel:${CONTACT.tel}`} className="btn btn--ghost"><Icon name="phone" size="sm" />{CONTACT.phone}</a>
              <a href="/vehicles" className="btn btn--ghost">See all vehicles</a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
