import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { submitFeedback, useFeedbackVehicles } from '../lib/fleet';

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/* Large tappable star picker with hover preview */
function StarInput({ value, onChange, label }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="star-input" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      <div className="star-input__stars">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  className={n <= shown ? 'is-on' : ''} onMouseEnter={() => setHover(n)} onClick={() => onChange(n)}>
            <Icon name="star" />
          </button>
        ))}
      </div>
      <span className="star-input__label">{shown ? LABELS[shown] : 'Tap to rate'}</span>
    </div>
  );
}

/**
 * Public feedback form for past customers. Links can prefill it:
 *   /feedback?v=<vehicleId>&n=<name>   (the admin's Feedback page builds these per rental)
 * Submissions are stored unpublished and approved in the admin before they appear on the site.
 */
export default function FeedbackPage({ search = '' }) {
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const vehicles = useFeedbackVehicles();   // includes number plates

  const [form, setForm] = useState({
    name: params.get('n') || '',
    country: '',
    vehicleId: params.get('v') || '',
    serviceRating: 0,
    serviceComment: '',
    xq7: '',                // honeypot: meaningless name so browsers never autofill it
  });
  const openedAt = useRef(performance.now());
  const [status, setStatus] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    document.title = 'Share your feedback — Ceylon Rent A Cars';
    return () => { document.title = 'Ceylon Rent A Cars — Vehicle Rentals Across Sri Lanka'; };
  }, []);

  const vehicle = vehicles.find(v => v.id === form.vehicleId);
  const sorted = vehicles; // already sorted by name, then plate

  const submit = async e => {
    e.preventDefault();
    setError('');
    if (form.xq7 && performance.now() - openedAt.current < 4000) { setStatus('done'); return; } // bot
    if (form.name.trim().length < 2) { setError('Please tell us your name.'); return; }
    if (!form.serviceRating) { setError('Please choose a star rating.'); return; }
    setStatus('sending');
    try {
      // One rating + one comment for the whole trip: saved for our service and for the chosen vehicle
      await submitFeedback({
        ...form,
        vehicleId: vehicle ? form.vehicleId : '',
        vehicleRating: vehicle ? form.serviceRating : null,
        vehicleComment: form.serviceComment,
      });
      setStatus('done');
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
            <h1>Thank you{form.name ? `, ${form.name.trim().split(' ')[0]}` : ''}!</h1>
            <p>Your feedback means a lot to our small team. Once reviewed, it may appear on our website to help other travellers choose with confidence.</p>
            <div className="fleet-empty__ctas">
              <a href="/" className="btn btn--red">Back to home <Icon name="arrow" size="sm" /></a>
              <a href="/vehicles" className="btn btn--ghost">Browse vehicles</a>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="feedback-page">
      <div className="container">
        <header className="catalog-head feedback-head">
          <span className="eyebrow">Your feedback</span>
          <h1>How was your trip?</h1>
          <p>Rented with Ceylon Rent A Cars? Tell us about our service and your vehicle — it takes a minute and helps future travellers.</p>
        </header>

        <form className="feedback-form" onSubmit={submit} noValidate>
          {/* Honeypot — hidden from people, tempting to bots */}
          <div className="hp" aria-hidden="true">
            <input tabIndex={-1} autoComplete="off" value={form.xq7} onChange={e => set('xq7', e.target.value)} name="xq7" />
          </div>

          <section className="fb-card">
            <h2><span>1</span>Your trip</h2>
            <label className="fb-field">
              <span>Which vehicle did you rent?</span>
              <small>Find it by model or number plate.</small>
              <div className="fb-select">
                <select value={form.vehicleId} onChange={e => set('vehicleId', e.target.value)}>
                  <option value="">Choose a vehicle…</option>
                  {sorted.map(v => (
                    <option key={v.id} value={v.id}>
                      {[v.plate, v.name, v.year && `(${v.year})`].filter(Boolean).join(' — ').replace(' — (', ' (')}
                    </option>
                  ))}
                  <option value="other">I'm not sure / not listed</option>
                </select>
                <Icon name="down" size="sm" />
              </div>
            </label>
            {vehicle && (
              <div className="fb-vehicle">
                {vehicle.img && <img src={vehicle.img} alt="" />}
                <div><b>{vehicle.name}</b><small>{[vehicle.plate && <span key="p" className="plate">{vehicle.plate}</span>, vehicle.year].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && ' · '}{x}</span>)}</small></div>
              </div>
            )}

            <div className="fb-field">
              <span>Your rating *</span>
              <StarInput value={form.serviceRating} onChange={n => set('serviceRating', n)} label="Rate your experience" />
            </div>
            <label className="fb-field">
              <span>Your feedback <em>(optional)</em></span>
              <textarea rows={4} maxLength={1000} value={form.serviceComment} onChange={e => set('serviceComment', e.target.value)}
                        placeholder="How was the vehicle and our service? What went well, what could be better?" />
            </label>
          </section>

          <section className="fb-card">
            <h2><span>2</span>About you</h2>
            <div className="fb-grid">
              <label className="fb-field">
                <span>Your name *</span>
                <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Sarah Mitchell" maxLength={60} required />
                <small>Only your first name and last initial are shown publicly.</small>
              </label>
              <label className="fb-field">
                <span>Country <em>(optional)</em></span>
                <input value={form.country} onChange={e => set('country', e.target.value)} placeholder="e.g. United Kingdom" maxLength={40} />
              </label>
            </div>
          </section>

          {error && <p className="fb-error" role="alert">{error}</p>}

          <button type="submit" className="btn btn--red btn--lg fb-submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : <>Send feedback <Icon name="arrow" /></>}
          </button>
          <p className="fb-note">By sending, you agree that we may show your rating and comment (with your first name, last initial and country) on our website.</p>
        </form>
      </div>
    </main>
  );
}
