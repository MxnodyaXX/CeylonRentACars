import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import PortalApp from './portal/PortalApp';
import { currentSession, portalEnabled, requestCode, signOut, verifyCode } from '../lib/portal';
import { waLink } from '../data/site';

const RESEND_AFTER = 60;   // seconds

const PERKS = [
  ['car', 'All your trips in one place', 'Upcoming, current and past bookings'],
  ['tag', 'Payments at a glance', 'What you paid and what is left to pay'],
  ['file', 'Track your requests', 'See where each booking request stands'],
];

function SignIn({ onSignedIn }) {
  const [step, setStep] = useState('phone');           // phone | code
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);           // { message, notFound }
  const [wait, setWait] = useState(0);
  const codeRef = useRef(null);

  useEffect(() => {
    if (!wait) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (e) => {
    e?.preventDefault();
    setError(null);
    if (phone.replace(/\D/g, '').length < 9) { setError({ message: 'Please enter your mobile number.' }); return; }
    setBusy(true);
    try {
      const to = await requestCode(phone);
      setSentTo(to); setCode(''); setStep('code'); setWait(RESEND_AFTER);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) { setError({ message: err.message, notFound: err.notFound }); }
    finally { setBusy(false); }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) { setError({ message: 'Enter the 6-digit code from the SMS.' }); return; }
    setBusy(true);
    try { onSignedIn(await verifyCode(sentTo, code)); }
    catch (err) { setError({ message: err.message }); setBusy(false); }
  };

  return (
    <div className="portal-signin fb-card">
      <span className="portal-signin__icon"><Icon name={step === 'phone' ? 'phone' : 'lock'} /></span>
      {step === 'phone' ? (
        <form onSubmit={send} className="portal-form" noValidate>
          <h2>Sign in with your phone</h2>
          <p className="portal-muted">Use the number you booked with. We'll text you a 6-digit code — no password needed.</p>
          <label className="fb-field">
            <span>Mobile number</span>
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="077 123 4567" value={phone}
                   onChange={(e) => setPhone(e.target.value)} maxLength={24} autoFocus />
            <small>Outside Sri Lanka? Include your country code, e.g. +44 7700 900123.</small>
          </label>
          {error && (
            <p className="fb-error" role="alert">
              {error.message}
              {error.notFound && <> <a href={waLink('Hi, I would like to check my booking.')} target="_blank" rel="noreferrer">Open WhatsApp</a></>}
            </p>
          )}
          <button type="submit" className="btn btn--red btn--lg fb-submit" disabled={busy}>
            {busy ? 'Sending code…' : <>Send code <Icon name="arrow" /></>}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="portal-form" noValidate>
          <h2>Enter your code</h2>
          <p className="portal-muted">We sent a 6-digit code to <b>{sentTo}</b>.</p>
          <label className="fb-field">
            <span>Code</span>
            <input ref={codeRef} className="portal-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
                   placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </label>
          {error && <p className="fb-error" role="alert">{error.message}</p>}
          <button type="submit" className="btn btn--red btn--lg fb-submit" disabled={busy}>
            {busy ? 'Checking…' : <>View my bookings <Icon name="arrow" /></>}
          </button>
          <div className="portal-links">
            <button type="button" onClick={() => { setStep('phone'); setError(null); }}>Change number</button>
            <button type="button" onClick={send} disabled={wait > 0 || busy}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** /my-bookings — the customer portal; sign in with phone + SMS code */
export default function PortalPage({ search = '' }) {
  const [session, setSession] = useState(() => currentSession());
  const out = useCallback(() => { signOut(); setSession(null); }, []);

  if (portalEnabled && session) {
    return (
      <main className="feedback-page portal-page portal-page--in">
        <div className="container"><PortalApp session={session} search={search} onSignOut={out} /></div>
      </main>
    );
  }

  return (
    <main className="feedback-page portal-page">
      <div className="container">
        <div className="portal-login">
          <header className="portal-login__intro">
            <span className="eyebrow">My account</span>
            <h1>Your trips, payments and requests</h1>
            <p>Sign in with the phone number you booked with — no password needed.</p>
            <ul className="portal-perks">
              {PERKS.map(([icon, title, text]) => (
                <li key={title}><span><Icon name={icon} /></span><div><b>{title}</b><small>{text}</small></div></li>
              ))}
            </ul>
          </header>
          {portalEnabled
            ? <SignIn onSignedIn={setSession} />
            : <p className="fb-error">The booking portal isn't available right now — please message us on WhatsApp.</p>}
        </div>
      </div>
    </main>
  );
}
