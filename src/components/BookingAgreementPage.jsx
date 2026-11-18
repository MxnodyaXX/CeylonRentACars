import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { SignIn } from './PortalPage';
import { agreementRpc, currentSession, downloadAgreementPdf, portalEnabled, signOut } from '../lib/portal';
import { CONTACT, waLink } from '../data/site';

/*
 * /booking-agreement/<link> — the customer reviews CRC-AGR-003 (Booking Acceptance & Advance Payment
 * e-Agreement) and accepts or declines it. Reading needs only the link; deciding needs the SMS code to the
 * agreement's own number (checked by the database: eag_open / eag_decide / eag_clarify / eag_report_payment).
 * Nothing is accepted by opening or scrolling — only by ticking the box and pressing Accept.
 */

const lk = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '');
const rs = (n) => `LKR ${Math.round(Number(n) || 0).toLocaleString('en-LK')}`;

const STATUS = {
  SENT: ['Waiting for your decision', 'info'], VIEWED: ['Waiting for your decision', 'info'],
  ACCEPTED: ['Accepted', 'ok'], DECLINED: ['Declined', 'bad'], EXPIRED: ['Expired', 'muted'],
  SUPERSEDED: ['Replaced by a newer version', 'muted'], REVOKED: ['Withdrawn by CRC', 'muted'],
};

const LINK_PROBLEM = {
  LINK_INVALID: ['This link isn’t valid', 'Please check you opened the whole link from our message, or ask us for a new one.'],
  LINK_REPLACED: ['This link has been replaced', 'We sent you a newer link (for example after the terms changed). Please use the latest message from Ceylon Rent A Cars.'],
  RATE_LIMITED: ['Too many attempts', 'Please wait a few minutes and try again.'],
};

function Row({ label, children }) {
  return <div className="agr-row"><dt>{label}</dt><dd>{children || '—'}</dd></div>;
}

export default function BookingAgreementPage({ token }) {
  const [state, setState] = useState({ loading: true });
  const [session, setSession] = useState(() => currentSession());
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);                  // { tone, text }
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [question, setQuestion] = useState('');
  const [pay, setPay] = useState({ amount: '', reference: '', date: '' });

  const load = useCallback(async () => {
    try { setState({ loading: false, data: await agreementRpc('eag_open', { p_token: token }, 'We couldn’t open this agreement — please try again.') }); }
    catch (err) { setState({ loading: false, error: err }); }
  }, [token]);
  useEffect(() => { load(); }, [load, session]);
  useEffect(() => {
    // the link must not travel to other sites in the Referer header
    const m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer';
    document.head.appendChild(m);
    return () => m.remove();
  }, []);

  const run = async (label, fn, okText) => {
    setBusy(label); setMsg(null);
    try { await fn(); if (okText) setMsg({ tone: 'ok', text: okText }); await load(); }
    catch (err) {
      if (err.code === 'SIGN_IN_REQUIRED') { signOut(); setSession(null); }
      setMsg({ tone: 'bad', text: err.message });
    } finally { setBusy(''); }
  };

  if (!portalEnabled) {
    return <main className="agr-page"><div className="agr-wrap"><p className="agr-alert agr-alert--bad">Booking agreements aren’t available right now — please message us on WhatsApp.</p></div></main>;
  }
  if (state.loading) {
    return <main className="agr-page"><div className="agr-wrap"><p className="agr-loading" role="status"><span className="agr-spinner" /> Opening your agreement…</p></div></main>;
  }
  if (state.error) {
    const [title, text] = LINK_PROBLEM[state.error.code] ?? ['We couldn’t open this agreement', state.error.message];
    return (
      <main className="agr-page">
        <div className="agr-wrap agr-wrap--narrow">
          <div className="agr-card agr-center">
            <span className="agr-bigicon"><Icon name="lock" /></span>
            <h1>{title}</h1>
            <p>{text}</p>
            <a className="btn btn--red" href={waLink('Hi, I need a new link for my booking agreement.')} target="_blank" rel="noreferrer">Message us on WhatsApp</a>
          </div>
        </div>
      </main>
    );
  }

  const d = state.data;
  const doc = d.document ?? {};
  const [statusLabel, statusTone] = STATUS[d.status] ?? [d.status, 'muted'];
  const mine = d.signed_in_as_customer;
  const decided = d.decision;

  return (
    <main className="agr-page">
      <div className="agr-wrap">
        {/* ── Header ── */}
        <header className="agr-head">
          <p className="agr-brand">Ceylon Rent A Cars</p>
          <h1>Booking e-Agreement</h1>
          <p className="agr-sub">{doc.agreement?.title}</p>
          <div className="agr-meta">
            <span className={`agr-pill agr-pill--${statusTone}`}>{statusLabel}</span>
            <span><b>{d.reference}</b> · version {d.version}</span>
            {d.can_decide && <span><Icon name="clock" size="sm" /> Open until {lk(d.expires_at)}</span>}
          </div>
        </header>

        {msg && <p className={`agr-alert agr-alert--${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</p>}

        {decided?.decision === 'ACCEPTED' && (
          <div className="agr-alert agr-alert--ok">
            <b>You accepted this agreement on {lk(decided.at)}.</b> Your booking is <b>not confirmed yet</b>: it is confirmed only after we verify your advance payment and allocate the vehicle.
          </div>
        )}
        {decided?.decision === 'DECLINED' && <div className="agr-alert agr-alert--muted">You declined this agreement on {lk(decided.at)}. Nothing is booked and no payment is due.</div>}
        {d.status === 'EXPIRED' && <div className="agr-alert agr-alert--muted">This agreement has expired. If you still want the booking, message us and we’ll check availability again.</div>}

        <div className="agr-grid">
          <div className="agr-main">
            {/* ── 1. Booking summary ── */}
            <section className="agr-card" aria-labelledby="agr-s1">
              <h2 id="agr-s1"><span>1</span> Booking summary</h2>
              <dl className="agr-rows">
                <Row label="Customer">{doc.customer?.name}</Row>
                <Row label="Vehicle">{[doc.vehicle?.make_model, doc.vehicle?.category].filter(Boolean).join(' · ')}<small>{doc.vehicle?.registration}</small></Row>
                <Row label="Pickup">{doc.rental?.pickup}<small>{doc.rental?.pickup_location}</small></Row>
                <Row label="Return">{doc.rental?.return}<small>{doc.rental?.return_location}</small></Row>
                <Row label="Rental">{[doc.rental?.duration, doc.rental?.package, doc.rental?.included_km && `${doc.rental.included_km} included`].filter(Boolean).join(' · ')}</Row>
              </dl>
              <div className="agr-money">
                <div><span>Agreed rental price</span><b>{doc.payment?.total}</b></div>
                <div className="is-key"><span>Advance required</span><b>{doc.payment?.advance}</b></div>
                <div><span>Balance later</span><b>{doc.payment?.balance}</b></div>
                <div><span>Security deposit</span><b>{doc.payment?.deposit}</b></div>
              </div>
            </section>

            {/* ── 2. The agreement ── */}
            <section className="agr-card" aria-labelledby="agr-s2">
              <div className="agr-card__head">
                <h2 id="agr-s2"><span>2</span> Agreement terms</h2>
                <button type="button" className="agr-link" disabled={busy === 'pdf'}
                        onClick={() => run('pdf', () => downloadAgreementPdf(token, d.reference))}>
                  <Icon name="file" size="sm" /> {busy === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
                </button>
              </div>
              {/* written by the server from the approved wording; every value in it is escaped there */}
              <div className="agr-doc" dangerouslySetInnerHTML={{ __html: d.html }} />
              <p className="agr-fine">Document fingerprint (SHA-256): <code>{d.document_hash}</code></p>
            </section>

            {/* ── 3. Important conditions ── */}
            <section className="agr-card agr-card--key" aria-labelledby="agr-s3">
              <h2 id="agr-s3"><span>3</span> Before you decide</h2>
              <ul className="agr-points">
                <li><Icon name="clock" size="sm" /><div><b>Advance payment deadline</b><p>{doc.payment?.advance_deadline}. Payment details are shown here only after you accept and we request the advance.</p></div></li>
                <li><Icon name="shield" size="sm" /><div><b>When your booking is confirmed</b><p>Only after we verify that your advance has reached our account and the vehicle is allocated. Accepting this agreement alone does not confirm the booking.</p></div></li>
                <li><Icon name="tag" size="sm" /><div><b>Cancellation and refunds</b><p>{doc.policy?.cancellation} <small>(policy {doc.policy?.cancellation_version})</small></p></div></li>
                <li><Icon name="car" size="sm" /><div><b>Vehicle conditions</b><p>{doc.rental?.conditions && doc.rental.conditions !== 'None' ? doc.rental.conditions : 'No special conditions for this vehicle.'} Alternatives: {doc.vehicle?.alternatives}.</p></div></li>
              </ul>
            </section>
          </div>

          <aside className="agr-side">
            {/* ── 4. Decision ── */}
            {d.can_decide && (
              <section className="agr-card agr-decide" aria-labelledby="agr-s4">
                <h2 id="agr-s4"><span>4</span> Your decision</h2>
                {!mine ? (
                  <>
                    {d.signed_in_other_number && (
                      <p className="agr-alert agr-alert--warn">You’re signed in with a different number. This agreement is for <b>{d.phone_hint}</b>.
                        <button type="button" className="agr-link" onClick={() => { signOut(); setSession(null); }}>Sign out</button></p>
                    )}
                    {!d.signed_in_other_number && (
                      <SignIn onSignedIn={setSession} cta="Continue to my decision"
                              intro={`To accept or decline, first confirm it’s you. We’ll text a 6-digit code to the number on this booking (${d.phone_hint}).`}
                              waText="Hi, I can't confirm my number for my booking agreement." />
                    )}
                  </>
                ) : declining ? (
                  <form className="agr-form" onSubmit={(e) => { e.preventDefault(); run('decline', () => agreementRpc('eag_decide', { p_token: token, p_decision: 'DECLINED', p_statement_version: d.statement_version, p_reason: reason }), 'Thank you — we’ve recorded that you declined.'); }}>
                    <label className="agr-field"><span>Why are you declining? <em>(optional)</em></span>
                      <textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. found another option, dates changed…" />
                    </label>
                    <button type="submit" className="btn btn--ink" disabled={!!busy}>{busy === 'decline' ? 'Saving…' : 'Decline this agreement'}</button>
                    <button type="button" className="agr-link" onClick={() => setDeclining(false)}>Go back</button>
                  </form>
                ) : (
                  <form className="agr-form" onSubmit={(e) => { e.preventDefault(); if (agree) run('accept', () => agreementRpc('eag_decide', { p_token: token, p_decision: 'ACCEPTED', p_statement_version: d.statement_version }), 'Thank you — your acceptance is recorded.'); }}>
                    <p className="agr-verified"><Icon name="check" size="sm" /> Number confirmed ({d.phone_hint})</p>
                    <label className="agr-check">
                      <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                      <span>{d.statement}</span>
                    </label>
                    <button type="submit" className="btn btn--red btn--lg" disabled={!agree || !!busy}>{busy === 'accept' ? 'Recording…' : 'Accept agreement'}</button>
                    <button type="button" className="agr-link" onClick={() => setDeclining(true)}>Decline instead</button>
                    <p className="agr-fine">Version {d.statement_version}. Your decision, the time and your confirmed number are recorded with this exact document.</p>
                  </form>
                )}
              </section>
            )}

            {/* ── Advance payment (only after acceptance + CRC's request) ── */}
            {d.payment && (
              <section className="agr-card agr-pay" aria-labelledby="agr-pay">
                <h2 id="agr-pay"><Icon name="tag" size="sm" /> Advance payment</h2>
                <dl className="agr-rows agr-rows--tight">
                  <Row label="Amount">{rs(d.payment.amount)}</Row>
                  <Row label="Pay by">{lk(d.payment.deadline)}</Row>
                  <Row label="Account name">{d.payment.account_name}</Row>
                  <Row label="Bank">{d.payment.bank}</Row>
                  <Row label="Account no.">{d.payment.account_no}</Row>
                  <Row label="Reference">{d.payment.reference}</Row>
                </dl>
                {d.payment.status === 'REPORTED' ? (
                  <p className="agr-alert agr-alert--info">Thank you — we’re checking your payment. We’ll confirm the booking once it reaches our account.</p>
                ) : mine ? (
                  <form className="agr-form" onSubmit={(e) => { e.preventDefault(); run('pay', () => agreementRpc('eag_report_payment', { p_token: token, p_amount: Number(pay.amount), p_reference: pay.reference, p_paid_at: pay.date ? new Date(pay.date).toISOString() : null }), 'Thank you — we’ll check the payment and confirm.'); }}>
                    <p className="agr-fine">Paid already? Tell us so we can match it. A screenshot alone isn’t enough — we confirm once the money is in our account.</p>
                    <label className="agr-field"><span>Amount paid (LKR)</span><input inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^\d.]/g, '') })} required /></label>
                    <label className="agr-field"><span>Bank / transfer reference</span><input value={pay.reference} maxLength={80} onChange={(e) => setPay({ ...pay, reference: e.target.value })} required /></label>
                    <label className="agr-field"><span>When did you pay? <em>(optional)</em></span><input type="datetime-local" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></label>
                    <button type="submit" className="btn btn--ink" disabled={!!busy || !pay.amount || pay.reference.trim().length < 3}>{busy === 'pay' ? 'Sending…' : 'I have paid'}</button>
                  </form>
                ) : <p className="agr-fine">Sign in above with your number to tell us you’ve paid.</p>}
              </section>
            )}

            {/* ── Questions ── */}
            <section className="agr-card" aria-labelledby="agr-q">
              <h2 id="agr-q"><Icon name="chat" size="sm" /> Questions or changes?</h2>
              <form className="agr-form" onSubmit={(e) => { e.preventDefault(); run('ask', async () => { await agreementRpc('eag_clarify', { p_token: token, p_message: question }); setQuestion(''); }, 'Sent — our team will get back to you.'); }}>
                <label className="agr-field"><span className="sr-only">Your question</span>
                  <textarea rows={3} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about the terms, or ask for a change…" />
                </label>
                <button type="submit" className="btn btn--ghost-ink" disabled={!!busy || question.trim().length < 2}>{busy === 'ask' ? 'Sending…' : 'Send to Ceylon Rent A Cars'}</button>
              </form>
              <p className="agr-fine">Or call {CONTACT.phone} · WhatsApp {CONTACT.whatsapp}. We will never ask you for your SMS code.</p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
