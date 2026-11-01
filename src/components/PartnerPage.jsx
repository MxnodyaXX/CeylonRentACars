import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import Dropdown from './ui/Dropdown';
import { DatePicker } from './ui/DateTime';
import { SignIn } from './PortalPage';
import { currentSession, portalEnabled, rpc, signOut, uploadFile } from '../lib/portal';
import { CATEGORIES, waLink } from '../data/site';
import { AGREEMENT_SECTIONS, AGREEMENT_TITLE, AGREEMENT_VERSION, agreementText } from '../data/partnerAgreement';

/*
 * /list-your-vehicle — vehicle owners apply to list a car with us.
 *   1. individual or company (only individuals for now)
 *   2. verify their phone with an SMS code (same sign-in as "My bookings")
 *   3. details, vehicle, asking price, photos, documents, signed partner agreement
 * Applications wait for the admin (Partner applications page); nothing goes on the site until then.
 * Database: admin/supabase/security/13_partner_applications.sql
 */

const BUCKET = 'partner-files';
const MAX_PHOTOS = 12;
const STEPS = ['Your details', 'The vehicle', 'Your price', 'Photos & documents', 'Agreement'];

const PERKS = [
  ['tag', 'Earn from your car', 'We find the customers, you get paid for every rental'],
  ['shield', 'Verified renters', 'Every customer\'s ID and licence is checked before handover'],
  ['file', 'Everything recorded', 'Mileage, fuel and condition noted at every handover'],
  ['chat', 'Your own owner account', 'See your bookings and payouts any time'],
];

const DOCS = [
  ['cr', 'Registration book (CR)', false],
  ['nicFront', 'NIC — front', false],
  ['nicBack', 'NIC — back', false],
  ['revenueLicence', 'Revenue licence', false],
  ['insurance', 'Insurance certificate', false],
];

const STATUS = {
  Pending: ['Waiting for review', 'info'],
  'Under review': ['Under review', 'info'],
  'Needs info': ['We need something from you', 'warn'],
  Approved: ['Approved', 'ok'],
  Rejected: ['Not accepted', 'bad'],
  Withdrawn: ['Withdrawn', 'muted'],
};

const opts = (list) => list.map((v) => ({ value: v, label: v }));
const CATEGORY_OPTIONS = opts([...CATEGORIES.map((c) => c.name), 'Other']);
const TRANSMISSION_OPTIONS = opts(['Automatic', 'Manual']);
const FUEL_OPTIONS = opts(['Petrol', 'Diesel', 'Hybrid', 'Electric']);
const SEAT_OPTIONS = opts(['2', '4', '5', '7', '8', '9', '10', '12', '14', '15+']);
const thisYear = new Date().getFullYear();
const YEAR_OPTIONS = opts(Array.from({ length: 30 }, (_, i) => String(thisYear - i)));

/* "Available from" quick picks — local dates as YYYY-MM-DD; Anytime = no date */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const QUICK_DATES = [
  ['Today', () => ymd(new Date())],
  ['Next week', () => { const d = new Date(); d.setDate(d.getDate() + 7); return ymd(d); }],
  ['Next month', () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return ymd(d); }],
  ['Anytime', () => ''],
];

const rs = (n) => `Rs ${Math.round(Number(n)).toLocaleString('en-LK')}`;
const nicOk = (v) => /^(\d{9}[VvXx]|\d{12})$/.test(v.replace(/\s/g, ''));
const phoneKey = (session) => String(session?.phone ?? '').replace(/\D/g, '');

/* Phone photos are often 5–10 MB: resize to at most 2000 px as JPEG (PDF / HEIC are sent as they are) */
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000) return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

/* Each file goes in the applicant's own folder: <phone>/<time>-<kind>.<ext> */
async function upload(session, file, kind) {
  const f = await shrink(file);
  const ext = (f.name.match(/\.([A-Za-z0-9]{2,5})$/)?.[1] ?? (f.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase();
  const path = `${phoneKey(session)}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${kind}.${ext}`;
  return uploadFile(BUCKET, path, f);
}

/* Typed signature: the name written in a handwriting-style font, saved as a PNG like a drawn one */
const SIGN_FONT = '"Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive';
function typedSignature(name) {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 220;
  const ctx = c.getContext('2d');
  let size = 84;
  do { ctx.font = `italic ${size}px ${SIGN_FONT}`; size -= 4; } while (ctx.measureText(name).width > c.width - 60 && size > 28);
  ctx.fillStyle = '#111114'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, c.width / 2, c.height / 2);
  return c.toDataURL('image/png');
}

/* Finger / mouse signature box → PNG data URL (undefined when cleared) */
function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = 150 * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    Object.assign(ctx, { lineWidth: 2.4, lineCap: 'round', lineJoin: 'round', strokeStyle: '#111114' });
  }, []);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { ref.current.setPointerCapture(e.pointerId); drawing.current = true; const ctx = ref.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...pos(e)); };
  const move = (e) => { if (!drawing.current) return; const ctx = ref.current.getContext('2d'); ctx.lineTo(...pos(e)); ctx.stroke(); if (empty) setEmpty(false); };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (!empty) onChange(ref.current.toDataURL('image/png')); };
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setEmpty(true); onChange(undefined); };
  return (
    <div className="pa-sign">
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Sign here" />
      {empty ? <p>Sign here with your finger or mouse</p> : <button type="button" onClick={clear}>Clear</button>}
    </div>
  );
}

/* A file box: pick a photo / PDF, shows its name */
function FileBox({ label, required, file, onPick }) {
  return (
    <label className={`pa-file${file ? ' is-set' : ''}`}>
      <input type="file" accept="image/*,application/pdf" onChange={(e) => onPick(e.target.files?.[0])} />
      <Icon name={file ? 'check' : 'file'} />
      <span><b>{label}{required && ' *'}</b><small>{file ? file.name : 'Photo or PDF'}</small></span>
    </label>
  );
}

const EMPTY = {
  name: '', email: '', nic: '', address: '', city: '',
  vehicleNumber: '', brand: '', model: '', year: '', category: '', color: '', seats: '', transmission: '', fuelType: '', mileage: '',
  askingDaily: '', askingMonthly: '', priceNotes: '', availableFrom: '', notes: '',
};

function PartnerForm({ session, onDone, onSignedOut }) {
  const [f, setF] = useState(EMPTY);
  const [photos, setPhotos] = useState([]);          // [{ file, url }]
  const [docs, setDocs] = useState({});              // { cr: File, … }
  const [agree, setAgree] = useState(false);
  const [signName, setSignName] = useState('');
  const [signature, setSignature] = useState();   // only when drawn
  const [drawSign, setDrawSign] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const addPhotos = (files) => {
    const next = Array.from(files ?? []).filter((x) => x.type.startsWith('image/')).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...next].slice(0, MAX_PHOTOS));
  };

  // one screen per step; each is checked before moving on
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState('fwd');      // which way the step slides in
  const top = useRef(null);
  const checks = [
    () => {
      if (f.name.trim().length < 3) return 'Enter your full name.';
      if (!nicOk(f.nic)) return 'Enter your NIC number (e.g. 199012345678 or 901234567V).';
      if (f.address.trim().length < 5) return 'Enter your address.';
      if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) return 'Check your email address.';
      return '';
    },
    () => {
      if (f.vehicleNumber.trim().length < 4) return 'Enter the vehicle number (e.g. CAB-1234).';
      if (!f.brand.trim() || !f.model.trim()) return 'Enter the make and model.';
      if (!f.year) return 'Choose the year of manufacture.';
      if (!f.transmission || !f.fuelType || !f.seats) return 'Choose the transmission, fuel and seats.';
      return '';
    },
    () => (!(Number(f.askingDaily) > 0) && !(Number(f.askingMonthly) > 0) ? 'Enter the price you ask — per day, per month or both.' : ''),
    () => '',   // photos & documents are optional here — our team collects them during the review
    () => {
      if (!agree) return 'Read and accept the partner agreement.';
      if (signName.trim().length < 3) return 'Type your full name under the agreement.';
      if (drawSign && !signature) return 'Draw your signature, or type it instead.';
      return '';
    },
  ];
  const last = STEPS.length - 1;
  const go = (i) => {
    // the signature box is redrawn empty when the agreement step opens again
    if (step === last && i !== last) setSignature(undefined);
    setError(''); setDir(i < step ? 'back' : 'fwd'); setStep(i);
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const next = () => {
    const problem = checks[step]();
    setError(problem);
    if (!problem) go(step + 1);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (step < last) { next(); return; }
    // every step again, in case something was changed after going back
    const bad = checks.findIndex((c) => c());
    if (bad >= 0) { go(bad); setError(checks[bad]()); return; }
    try {
      const paths = [];
      for (let i = 0; i < photos.length; i++) {
        setBusy(`Uploading photo ${i + 1} of ${photos.length}…`);
        paths.push(await upload(session, photos[i].file, `photo${i + 1}`));
      }
      const documents = {};
      for (const [k, label] of DOCS) {
        if (!docs[k]) continue;
        setBusy(`Uploading ${label.toLowerCase()}…`);
        documents[k] = await upload(session, docs[k], k);
      }
      setBusy('Sending your application…');
      const id = await rpc('submit_partner_application', {
        p: {
          applicantType: 'individual', ...f, photos: paths, documents,
          agreement: { version: AGREEMENT_VERSION, text: agreementText(), name: signName.trim(), signature: drawSign ? signature : typedSignature(signName.trim()) },
        },
      }, 'We couldn’t send your application — please try again.');
      onDone(id);
    } catch (err) {
      if (err.signedOut) onSignedOut();
      setError(err.message);
      setBusy('');
    }
  };

  return (
    <form className="pa-form" onSubmit={submit} noValidate ref={top}>
      <ol className="pa-stepper" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'is-now' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
            <button type="button" disabled={i >= step || !!busy} onClick={() => go(i)}>
              <span>{i < step ? <Icon name="check" size="sm" /> : i + 1}</span><small>{label}</small>
            </button>
          </li>
        ))}
      </ol>
      <p className="pa-count">Step {step + 1} of {STEPS.length}</p>

      {/* keyed by step: each new step mounts fresh and plays its slide-in */}
      <div key={step} className={`pa-stage pa-stage--${dir}`}>
      {step === 0 && (
        <section className="fb-card">
          <h2><span>1</span> Your details</h2>
          <p className="fb-hint">Verified number: <b>{session.phone}</b></p>
          <div className="fb-grid">
            <label className="fb-field"><span>Full name *</span><input value={f.name} onChange={set('name')} autoComplete="name" maxLength={120} /></label>
            <label className="fb-field"><span>NIC number *</span><input value={f.nic} onChange={set('nic')} maxLength={14} placeholder="199012345678" /></label>
            <label className="fb-field"><span>Email <em>(optional)</em></span><input type="email" value={f.email} onChange={set('email')} autoComplete="email" maxLength={160} /></label>
            <label className="fb-field"><span>City / town</span><input value={f.city} onChange={set('city')} maxLength={80} placeholder="e.g. Kandy" /></label>
          </div>
          <label className="fb-field"><span>Address *</span><input value={f.address} onChange={set('address')} autoComplete="street-address" maxLength={300} /></label>
        </section>
      )}

      {step === 1 && (
        <section className="fb-card">
          <h2><span>2</span> The vehicle</h2>
          <div className="fb-grid">
            <label className="fb-field"><span>Vehicle number *</span><input value={f.vehicleNumber} onChange={set('vehicleNumber')} maxLength={20} placeholder="CAB-1234" /></label>
            <div className="fb-field"><span>Category</span><Dropdown value={f.category} onChange={set('category')} options={CATEGORY_OPTIONS} placeholder="Choose…" ariaLabel="Category" /></div>
            <label className="fb-field"><span>Make *</span><input value={f.brand} onChange={set('brand')} maxLength={60} placeholder="Toyota" /></label>
            <label className="fb-field"><span>Model *</span><input value={f.model} onChange={set('model')} maxLength={60} placeholder="Axio" /></label>
            <div className="fb-field"><span>Year *</span><Dropdown value={f.year} onChange={set('year')} options={YEAR_OPTIONS} placeholder="Choose…" ariaLabel="Year" /></div>
            <div className="fb-field"><span>Seats *</span><Dropdown value={f.seats} onChange={set('seats')} options={SEAT_OPTIONS} placeholder="Choose…" ariaLabel="Seats" /></div>
            <div className="fb-field"><span>Transmission *</span><Dropdown value={f.transmission} onChange={set('transmission')} options={TRANSMISSION_OPTIONS} placeholder="Choose…" ariaLabel="Transmission" /></div>
            <div className="fb-field"><span>Fuel *</span><Dropdown value={f.fuelType} onChange={set('fuelType')} options={FUEL_OPTIONS} placeholder="Choose…" ariaLabel="Fuel" /></div>
            <label className="fb-field"><span>Colour</span><input value={f.color} onChange={set('color')} maxLength={40} /></label>
            <label className="fb-field"><span>Mileage (km)</span><input inputMode="numeric" value={f.mileage} onChange={(e) => set('mileage')(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="e.g. 85000" /></label>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="fb-card">
          <h2><span>3</span> Your price</h2>
          <p className="fb-hint">The price you would like. We'll talk it through with you during the review and agree the final price and our commission before the car is listed.</p>
          <div className="fb-grid">
            <label className="fb-field"><span>Per day (Rs)</span><input inputMode="numeric" value={f.askingDaily} onChange={(e) => set('askingDaily')(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="e.g. 9000" /></label>
            <label className="fb-field"><span>Per month (Rs)</span><input inputMode="numeric" value={f.askingMonthly} onChange={(e) => set('askingMonthly')(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="e.g. 140000" /></label>
            <div className="fb-field pa-span"><span>Available from</span>
              <div className="chips pa-quick" role="group" aria-label="Quick dates">
                {QUICK_DATES.map(([label, date]) => (
                  <button key={label} type="button" className={`chip${f.availableFrom === date() ? ' is-active' : ''}`} onClick={() => set('availableFrom')(date())}>{label}</button>
                ))}
              </div>
              <DatePicker value={f.availableFrom} onChange={set('availableFrom')} min={ymd(new Date())} ariaLabel="Available from — pick a date" />
              <small>{f.availableFrom ? `From ${new Date(`${f.availableFrom}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` : 'Anytime — whenever we find a customer'}</small>
            </div>
          </div>
          <label className="fb-field"><span>Anything about the price or availability <em>(optional)</em></span>
            <textarea value={f.priceNotes} onChange={set('priceNotes')} maxLength={500} placeholder="e.g. Weekdays only, or long-term rentals preferred" /></label>
        </section>
      )}

      {step === 3 && (
        <section className="fb-card">
          <h2><span>4</span> Photos and documents <em>(optional)</em></h2>
            <div className="pa-optional">
              <Icon name="chat" />
              <p><b>You can skip this step.</b> Have them handy? Add them now and we'll review your car faster. If not, just continue — our team will contact you to collect the photos and documents we need.</p>
            </div>
          <div className="fb-field">
            <span>Vehicle photos <em>(front, back, sides, inside)</em></span>
            <div className="pa-photos">
              {photos.map((p, i) => (
                <div key={p.url} className="pa-photo">
                  <img src={p.url} alt={`Photo ${i + 1}`} />
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}><Icon name="x" size="sm" /></button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <label className="pa-photo pa-photo--add">
                  <input type="file" accept="image/*" multiple onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
                  <Icon name="plus" /><small>Add photos</small>
                </label>
              )}
            </div>
          </div>
          <div className="pa-files">
            {DOCS.map(([k, label, req]) => <FileBox key={k} label={label} required={req} file={docs[k]} onPick={(file) => setDocs((d) => ({ ...d, [k]: file }))} />)}
          </div>
          <p className="fb-hint">Documents are kept private — only our team can see them.</p>
        </section>
      )}

      {step === 4 && (
        <section className="fb-card">
          <h2><span>5</span> Partner agreement</h2>
          <div className="pa-terms" tabIndex={0}>
            <h3>{AGREEMENT_TITLE}</h3>
            {AGREEMENT_SECTIONS.map(([title, items], i) => (
              <div key={title}>
                <h4>{i + 1}. {title}</h4>
                <ol>{items.map((t) => <li key={t}>{t}</li>)}</ol>
              </div>
            ))}
          </div>
          <label className="pa-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I have read the agreement and I agree to it. The information and documents I gave are true.</span></label>
          <label className="fb-field"><span>Type your full name to sign *</span><input value={signName} onChange={(e) => setSignName(e.target.value)} maxLength={120} placeholder="As on your NIC" autoComplete="name" /></label>
          {drawSign ? (
            <div className="fb-field"><span>Your signature</span><SignaturePad onChange={setSignature} />
              <button type="button" className="pa-sign-switch" onClick={() => { setDrawSign(false); setSignature(undefined); }}>Use my typed name instead</button></div>
          ) : (
            <div className="fb-field"><span>Your signature</span>
              <div className="pa-typed" aria-live="polite"><span style={{ fontFamily: SIGN_FONT }}>{signName.trim() || 'Your name'}</span></div>
              <small>Typing your name and ticking the box signs the agreement. <button type="button" className="pa-sign-switch" onClick={() => setDrawSign(true)}>Draw it instead</button></small></div>
          )}
        </section>
      )}
      </div>

      {error && <p key={error} className="fb-error" role="alert">{error}</p>}
      <div className="pa-nav">
        {step > 0 && <button type="button" className="btn btn--ghost btn--lg" disabled={!!busy} onClick={() => go(step - 1)}>Back</button>}
        <button type="submit" className="btn btn--red btn--lg fb-submit" disabled={!!busy}>
          {busy || (step < last ? <>{step === 3 && !photos.length && !Object.keys(docs).length ? 'Skip for now' : 'Next'}: {STEPS[step + 1]} <Icon name="arrow" /></> : <>Send application <Icon name="arrow" /></>)}
        </button>
      </div>
      {step === last && <p className="fb-note">We'll review your application and contact you on {session.phone}. Nothing is listed until we both agree.</p>}
    </form>
  );
}

/* The applicant's applications, and a reply box when we asked for something */
function MyApplications({ apps, session, onChanged, onNew, onSignedOut }) {
  const [reply, setReply] = useState({});      // id → text
  const [files, setFiles] = useState({});      // id → File[]
  const [busy, setBusy] = useState('');
  const [error, setError] = useState({});

  const send = async (a) => {
    setError((x) => ({ ...x, [a.id]: '' }));
    try {
      setBusy(a.id);
      const photos = [];
      for (const [i, file] of (files[a.id] ?? []).entries()) photos.push(await upload(session, file, `reply${i + 1}`));
      await rpc('reply_partner_application', { p_id: a.id, p_reply: reply[a.id] ?? '', p_photos: photos, p_documents: {} },
        'We couldn’t send your reply — please try again.');
      setReply((x) => ({ ...x, [a.id]: '' })); setFiles((x) => ({ ...x, [a.id]: [] }));
      onChanged();
    } catch (err) {
      if (err.signedOut) onSignedOut();
      setError((x) => ({ ...x, [a.id]: err.message }));
    } finally { setBusy(''); }
  };

  return (
    <div className="pa-apps">
      {apps.map((a) => {
        const [label, tone] = STATUS[a.status] ?? [a.status, 'muted'];
        return (
          <article key={a.id} className="fb-card pa-app">
            <header>
              <div><b>{a.vehicle}</b><small>{a.vehicle_number} · {a.id} · sent {new Date(a.created_at).toLocaleDateString('en-GB')}</small></div>
              <span className={`portal-badge portal-badge--${tone}`}>{label}</span>
            </header>
            <p className="portal-muted">
              You asked {[a.asking_daily && `${rs(a.asking_daily)} a day`, a.asking_monthly && `${rs(a.asking_monthly)} a month`].filter(Boolean).join(' · ')}
              {a.status === 'Approved' && (a.agreed_daily || a.agreed_monthly) && <> — agreed: <b>{[a.agreed_daily && `${rs(a.agreed_daily)} a day`, a.agreed_monthly && `${rs(a.agreed_monthly)} a month`].filter(Boolean).join(' · ')}</b></>}
            </p>
            {a.status === 'Approved' && <p className="pt-note">Welcome aboard! We'll send your owner account login by SMS.</p>}
            {a.status === 'Rejected' && a.decision_reason && <p className="pt-note">{a.decision_reason}</p>}
            {a.status === 'Needs info' && (
              <div className="pa-reply">
                <p><b>We asked:</b> {a.info_request}</p>
                <label className="fb-field"><span>Your reply</span>
                  <textarea value={reply[a.id] ?? ''} onChange={(e) => setReply((x) => ({ ...x, [a.id]: e.target.value }))} maxLength={2000} /></label>
                <label className="pa-attach">
                  <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles((x) => ({ ...x, [a.id]: Array.from(e.target.files ?? []).slice(0, 8) }))} />
                  <Icon name="plus" size="sm" /> {(files[a.id]?.length ?? 0) ? `${files[a.id].length} file(s) added` : 'Add photos or documents'}
                </label>
                {error[a.id] && <p className="fb-error" role="alert">{error[a.id]}</p>}
                <button type="button" className="btn btn--red" disabled={busy === a.id} onClick={() => send(a)}>{busy === a.id ? 'Sending…' : 'Send reply'}</button>
              </div>
            )}
          </article>
        );
      })}
      <button type="button" className="btn btn--ghost btn--lg" onClick={onNew}><Icon name="plus" /> Add another vehicle</button>
    </div>
  );
}

export default function PartnerPage() {
  const [type, setType] = useState('');
  const [session, setSession] = useState(() => currentSession());
  const [apps, setApps] = useState(null);       // null = loading / not loaded
  const [view, setView] = useState('auto');     // auto | form | done
  const [doneId, setDoneId] = useState('');
  const [loadError, setLoadError] = useState('');

  const out = useCallback(() => { signOut(); setSession(null); setApps(null); setView('auto'); }, []);
  const load = useCallback(async () => {
    setLoadError('');
    try { setApps(await rpc('my_partner_applications', {}, 'We couldn’t load your applications.') ?? []); }
    catch (err) { if (err.signedOut) out(); else { setLoadError(err.message); setApps([]); } }
  }, [out]);
  useEffect(() => { if (session && type === 'individual') load(); }, [session, type, load]);

  let card;
  if (!portalEnabled) {
    card = <p className="fb-error">Applications aren't open right now — please message us on WhatsApp.</p>;
  } else if (!type) {
    card = (
      <div className="fb-card pa-type">
        <h2>Who is applying?</h2>
        <button type="button" onClick={() => setType('individual')}><Icon name="user" /><span><b>An individual</b><small>I own the vehicle(s) myself</small></span><Icon name="arrow" /></button>
        <button type="button" onClick={() => setType('company')}><Icon name="badge" /><span><b>A company</b><small>A business or rental company with vehicles</small></span><Icon name="arrow" /></button>
      </div>
    );
  } else if (type === 'company') {
    card = (
      <div className="fb-card pa-type">
        <h2>Company applications</h2>
        <p className="portal-muted">Online applications for companies are coming soon. Message us on WhatsApp and our team will set you up.</p>
        <a className="btn btn--red btn--lg fb-submit" href={waLink('Hi, our company would like to list vehicles with Ceylon Rent A Cars.')} target="_blank" rel="noreferrer">Message us on WhatsApp</a>
        <button type="button" className="pa-back" onClick={() => setType('')}>← Back</button>
      </div>
    );
  } else if (!session) {
    card = <SignIn purpose="partner" onSignedIn={setSession} cta="Continue"
                   intro="Verify your mobile number — we'll text you a 6-digit code. We'll use this number to contact you about your application."
                   waText="Hi, I would like to list my vehicle with Ceylon Rent A Cars." />;
  }

  // signed in as an individual: the form, the thank-you, or their applications (full width)
  if (portalEnabled && type === 'individual' && session) {
    const showForm = view === 'form' || (view === 'auto' && apps?.length === 0 && !loadError);
    return (
      <main className="feedback-page portal-page portal-page--in">
        <div className="container pa-wrap">
          <header className="pa-head">
            <div><span className="eyebrow">List your vehicle</span>
              <h1>{view === 'done' ? 'Application sent' : showForm ? 'Tell us about your vehicle' : 'Your applications'}</h1></div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={out}>Sign out</button>
          </header>
          {view === 'done' ? (
            <div className="fb-card pa-done">
              <span className="portal-signin__icon"><Icon name="check" /></span>
              <h2>Thank you — we've got it</h2>
              <p className="portal-muted">Your reference is <b>{doneId}</b>. Our team will review your vehicle and contact you on {session.phone} to talk about the price and an inspection.</p>
              <button type="button" className="btn btn--ghost" onClick={() => { setView('auto'); load(); }}>See my applications</button>
            </div>
          ) : apps === null ? (
            <p className="portal-muted">Loading…</p>
          ) : showForm ? (
            <>
              {apps.length > 0 && <button type="button" className="pa-back" onClick={() => setView('auto')}>← My applications</button>}
              <PartnerForm session={session} onSignedOut={out} onDone={(id) => { setDoneId(id); setView('done'); window.scrollTo({ top: 0 }); }} />
            </>
          ) : (
            <>
              {loadError && <p className="fb-error">{loadError} <button type="button" className="portal-retry" onClick={load}>Try again</button></p>}
              <MyApplications apps={apps} session={session} onChanged={load} onNew={() => setView('form')} onSignedOut={out} />
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="feedback-page portal-page">
      <div className="container">
        <div className="portal-login">
          <header className="portal-login__intro">
            <span className="eyebrow">Become a partner</span>
            <h1>List your vehicle with us</h1>
            <p>Own a car, SUV or van in Sri Lanka? Rent it out through Ceylon Rent A Cars — we handle the customers, the bookings and the paperwork.</p>
            <ul className="portal-perks">
              {PERKS.map(([icon, title, text]) => (
                <li key={title}><span><Icon name={icon} /></span><div><b>{title}</b><small>{text}</small></div></li>
              ))}
            </ul>
            <ol className="pa-steps">
              <li><b>Apply online</b> — your details, the car, your price, photos and documents</li>
              <li><b>Review and inspection</b> — we check the car and agree the price with you</li>
              <li><b>Go live</b> — you get your owner account and the car starts earning</li>
            </ol>
          </header>
          {card}
        </div>
      </div>
    </main>
  );
}
