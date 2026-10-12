import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../Icon';
import { loadMine } from '../../lib/portal';
import { CONTACT, waLink } from '../../data/site';

/*
 * The signed-in customer portal: Overview · My trips (+ trip details) · Requests · Payments ·
 * Profile · Help. Sections are picked with ?tab=… (and ?trip=<id> for one trip), so the browser
 * back button and shared links work. All data comes from my_profile / my_bookings / my_requests.
 */

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'spark' },
  { id: 'trips', label: 'My trips', icon: 'car' },
  { id: 'requests', label: 'Requests', icon: 'file' },
  { id: 'payments', label: 'Payments', icon: 'tag' },
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'help', label: 'Help', icon: 'headset' },
];

const DAY = 864e5;
const todayStr = () => new Date().toLocaleDateString('en-CA');            // yyyy-mm-dd, local time
const d10 = (d) => String(d ?? '').slice(0, 10);
const asDate = (d) => new Date(d10(d) + 'T00:00');
const daysUntil = (d) => Math.round((asDate(d) - asDate(todayStr())) / DAY);
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!d) return '';
  const date = new Date(String(d).length === 10 ? d + 'T00:00' : d);
  return isNaN(date) ? String(d) : date.toLocaleDateString('en-GB', opts);
};
const shortDate = (d) => fmtDate(d, { day: 'numeric', month: 'short' });
const rs = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-LK')}`;
const link = (tab, extra = '') => `/my-bookings?tab=${tab}${extra}`;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/* ── Trips & requests: what state each one is in ─────────────────────────── */

function tripPhase(b) {
  const t = todayStr();
  if (b.status === 'Cancelled') return 'cancelled';
  if (b.status === 'Completed') return 'past';
  if (b.status === 'Ongoing' || (d10(b.start_date) <= t && d10(b.end_date) >= t)) return 'current';
  if (d10(b.end_date) < t) return 'past';
  return 'upcoming';
}
const PHASE = {
  upcoming: { label: 'Upcoming', tone: 'ok' },
  current: { label: 'On your trip', tone: 'info' },
  past: { label: 'Completed', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

const REQUEST_STEPS = ['Received', 'Working on it', 'Options & quote', 'Booked'];
function requestInfo(r, hasBookings) {
  const t = todayStr();
  if (r.status === 'Converted' || r.stage === 'BOOKED') {
    return { group: 'done', step: 3, label: 'Booked', tone: 'ok',
      note: hasBookings ? 'Booked — you can find it under My trips.' : 'Booked — the trip details will appear under My trips once our team adds them.' };
  }
  if (r.status === 'Lost' || ['LOST', 'CANCELLED', 'NO_RESPONSE'].includes(r.stage)) {
    return { group: 'closed', step: -1, label: 'Closed', tone: 'muted', note: 'This request is closed. Message us if you would still like to book.' };
  }
  if (r.end_date && d10(r.end_date) < t) {
    return { group: 'closed', step: -1, label: 'Expired', tone: 'muted', note: 'The dates of this request have passed. Send a new request for another trip.' };
  }
  switch (r.stage) {
    case 'OPTIONS_SENT': return { group: 'open', step: 2, label: 'Options sent', tone: 'info', note: 'We sent you vehicle options — check WhatsApp or SMS and pick one.' };
    case 'QUOTATION_SENT': return { group: 'open', step: 2, label: 'Quote sent', tone: 'info', note: 'We sent you a price quote — reply to confirm and we will book it.' };
    case 'CUSTOMER_DECISION': return { group: 'open', step: 2, label: 'Waiting for you', tone: 'warn', note: 'We are waiting for your reply to go ahead.' };
    case 'CONFIRMED': return { group: 'open', step: 3, label: 'Being booked', tone: 'ok', note: 'All agreed — we are finalising your booking.' };
    case 'CONTACTING': case 'CONSULTATION': case 'FOLLOW_UP_REQUIRED':
      return { group: 'open', step: 1, label: 'In progress', tone: 'info', note: 'Our team is working on your request and will contact you.' };
    default: return { group: 'open', step: 0, label: 'Received', tone: 'info', note: 'We received your request and will contact you shortly.' };
  }
}

const PAY_KIND = {
  Payment: { label: 'Payment', sign: 1 },
  Advance: { label: 'Advance payment', sign: 1 },
  Refund: { label: 'Refund to you', sign: -1 },
  'Deposit received': { label: 'Security deposit', sign: 0 },
  'Deposit returned': { label: 'Deposit returned', sign: 0 },
};

/* ── Small pieces ─────────────────────────────────────────────────────────── */

function Badge({ tone, children }) {
  return <span className={`portal-badge portal-badge--${tone}`}>{children}</span>;
}

function CarImage({ src, className = '' }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className={`pt-img pt-img--empty ${className}`}><Icon name="car" /></span>;
  return <img src={src} alt="" className={`pt-img ${className}`} loading="lazy" onError={() => setBroken(true)} />;
}

function Empty({ icon, title, text, action }) {
  return (
    <div className="pt-empty">
      <span className="pt-empty__icon"><Icon name={icon} /></span>
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

function SectionHead({ title, text, action }) {
  return (
    <div className="pt-head">
      <div><h2>{title}</h2>{text && <p>{text}</p>}</div>
      {action}
    </div>
  );
}

const when = (d, t) => `${fmtDate(d)}${t ? ` · ${t}` : ''}`;

function TripCard({ b }) {
  const phase = tripPhase(b);
  const st = PHASE[phase];
  const balance = Number(b.balance) || 0;
  return (
    <a href={link('trips', `&trip=${encodeURIComponent(b.id)}`)} className="pt-trip">
      <CarImage src={b.image_url} />
      <div className="pt-trip__body">
        <div className="pt-trip__top">
          <div className="pt-trip__title"><b>{b.vehicle || 'Vehicle'}</b><small>{[b.vehicle_number, b.reference].filter(Boolean).join(' · ')}</small></div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <div className="pt-trip__meta">
          <span><Icon name="calendar" size="sm" /> {shortDate(b.start_date)} – {fmtDate(b.end_date)}</span>
          {b.pickup_location && <span><Icon name="pin" size="sm" /> {b.pickup_location}</span>}
        </div>
        {phase !== 'cancelled' && (
          <div className="pt-trip__money">
            <span>{rs(b.total_amount)}</span>
            {balance > 0 ? <em className="is-due">{rs(balance)} to pay</em> : <em className="is-clear">Paid in full</em>}
          </div>
        )}
      </div>
      <Icon name="right" className="pt-trip__go" />
    </a>
  );
}

function RequestCard({ r, hasBookings }) {
  const info = requestInfo(r, hasBookings);
  return (
    <article className="pt-request">
      <div className="pt-request__top">
        <span className="pt-request__icon"><Icon name="file" /></span>
        <div className="pt-trip__title">
          <b>{r.vehicle || 'Booking request'}</b>
          <small>{[r.reference, r.start_date && r.end_date ? `${shortDate(r.start_date)} – ${fmtDate(r.end_date)}` : ''].filter(Boolean).join(' · ')}</small>
        </div>
        <Badge tone={info.tone}>{info.label}</Badge>
      </div>
      {info.step >= 0 && (
        <ol className="pt-steps" aria-label="Progress">
          {REQUEST_STEPS.map((s, i) => (
            <li key={s} className={i < info.step || (i === info.step && info.step === 3 && info.group === 'done') ? 'is-done' : i === info.step ? 'is-now' : ''}>
              <span>{i < info.step || (info.group === 'done') ? <Icon name="check" size="sm" /> : i + 1}</span>{s}
            </li>
          ))}
        </ol>
      )}
      <p className="pt-request__note">{info.note}</p>
    </article>
  );
}

/* ── Sections ─────────────────────────────────────────────────────────────── */

function Overview({ data, name }) {
  const { bookings, requests } = data;
  const active = bookings.filter((b) => ['current', 'upcoming'].includes(tripPhase(b)))
    .sort((a, b) => d10(a.start_date).localeCompare(d10(b.start_date)));
  const next = active.find((b) => tripPhase(b) === 'current') ?? active[0];
  const done = bookings.filter((b) => tripPhase(b) === 'past');
  const openReq = requests.filter((r) => requestInfo(r, bookings.length > 0).group === 'open');
  const due = bookings.filter((b) => b.status !== 'Cancelled').reduce((s, b) => s + (Number(b.balance) || 0), 0);
  const lastDone = done[0];

  let countdown = '';
  if (next) {
    const phase = tripPhase(next);
    const n = daysUntil(next.start_date);
    countdown = phase === 'current' ? `Return on ${fmtDate(next.end_date)}${next.end_time ? ` at ${next.end_time}` : ''}`
      : n === 0 ? 'Pickup today' : n === 1 ? 'Pickup tomorrow' : `Pickup in ${n} days`;
  }

  return (
    <>
      <div className="pt-hello">
        <h1>{name ? `Welcome back, ${firstName(name)}` : 'Welcome back'}</h1>
        <p>{next ? 'Here is your next trip.' : openReq.length ? 'We are working on your booking request.' : 'Ready for your next trip in Sri Lanka?'}</p>
      </div>

      {next ? (
        <a href={link('trips', `&trip=${encodeURIComponent(next.id)}`)} className="pt-next">
          <CarImage src={next.image_url} className="pt-next__img" />
          <div className="pt-next__body">
            <span className="pt-next__count"><Icon name="clock" size="sm" /> {countdown}</span>
            <b className="pt-next__car">{next.vehicle}</b>
            <small>{[next.vehicle_number, next.reference].filter(Boolean).join(' · ')}</small>
            <div className="pt-next__legs">
              <div><span>Pickup</span><b>{when(next.start_date, next.start_time)}</b>{next.pickup_location && <small>{next.pickup_location}</small>}</div>
              <div><span>Return</span><b>{when(next.end_date, next.end_time)}</b>{next.drop_location && <small>{next.drop_location}</small>}</div>
            </div>
            <span className="pt-next__more">View trip details <Icon name="arrow" size="sm" /></span>
          </div>
        </a>
      ) : (
        <div className="pt-next pt-next--empty">
          <Empty icon="car" title="No upcoming trips" text="Browse our fleet and send a booking request — it only takes a minute."
                 action={<a href="/vehicles" className="btn btn--red">Find a vehicle <Icon name="arrow" size="sm" /></a>} />
        </div>
      )}

      <div className="pt-stats">
        <a href={link('trips')} className="pt-stat"><Icon name="car" /><b>{active.length}</b><span>Upcoming trips</span></a>
        <a href={link('requests')} className="pt-stat"><Icon name="file" /><b>{openReq.length}</b><span>Open requests</span></a>
        <a href={link('trips')} className="pt-stat"><Icon name="check" /><b>{done.length}</b><span>Trips completed</span></a>
        <a href={link('payments')} className={`pt-stat${due > 0 ? ' pt-stat--due' : ''}`}><Icon name="tag" /><b>{due > 0 ? rs(due) : 'Rs 0'}</b><span>Balance to pay</span></a>
      </div>

      {openReq.length > 0 && (
        <section className="pt-block">
          <SectionHead title="Your booking requests" action={<a href={link('requests')} className="pt-more">All requests <Icon name="right" size="sm" /></a>} />
          {openReq.slice(0, 2).map((r) => <RequestCard key={r.id} r={r} hasBookings={bookings.length > 0} />)}
        </section>
      )}

      <section className="pt-block">
        <SectionHead title="Quick actions" />
        <div className="pt-actions">
          <a href="/vehicles" className="pt-action"><Icon name="car" /><b>Book another car</b><small>Browse the fleet</small></a>
          <a href={waLink(`Hi, this is ${name || 'a customer'} (${data.profile.phone || ''}). I have a question about my booking.`)} target="_blank" rel="noreferrer" className="pt-action">
            <Icon name="chat" /><b>Message us</b><small>WhatsApp {CONTACT.whatsapp}</small>
          </a>
          {lastDone ? (
            <a href={`/feedback?v=${encodeURIComponent(lastDone.vehicle_id || '')}&n=${encodeURIComponent(name || '')}`} className="pt-action">
              <Icon name="star" /><b>Rate your last trip</b><small>{lastDone.vehicle}</small>
            </a>
          ) : (
            <a href={`tel:${CONTACT.tel}`} className="pt-action"><Icon name="phone" /><b>Call us</b><small>{CONTACT.phone}</small></a>
          )}
        </div>
      </section>
    </>
  );
}

function Trips({ data }) {
  const [filter, setFilter] = useState('upcoming');
  const groups = useMemo(() => {
    const g = { upcoming: [], past: [], cancelled: [] };
    for (const b of data.bookings) {
      const p = tripPhase(b);
      (p === 'current' || p === 'upcoming' ? g.upcoming : g[p]).push(b);
    }
    g.upcoming.sort((a, b) => d10(a.start_date).localeCompare(d10(b.start_date)));
    return g;
  }, [data.bookings]);
  useEffect(() => { if (!groups.upcoming.length && groups.past.length) setFilter('past'); }, [groups]);
  const list = groups[filter];
  return (
    <>
      <SectionHead title="My trips" text="Every booking with us — tap one for the full details." />
      <div className="pt-filter" role="tablist">
        {[['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? 'is-on' : ''} onClick={() => setFilter(id)}>
            {label} <span>{groups[id].length}</span>
          </button>
        ))}
      </div>
      {list.length ? <div className="pt-list">{list.map((b) => <TripCard key={b.id} b={b} />)}</div> : (
        <Empty icon="car" title={filter === 'upcoming' ? 'No upcoming trips' : filter === 'past' ? 'No past trips yet' : 'No cancelled trips'}
               text={filter === 'upcoming' ? 'When we confirm a booking it will appear here.' : ''}
               action={filter === 'upcoming' ? <a href="/vehicles" className="btn btn--red btn--sm">Find a vehicle</a> : null} />
      )}
    </>
  );
}

function TripDetail({ b, name }) {
  const phase = tripPhase(b);
  const st = PHASE[phase];
  const balance = Number(b.balance) || 0;
  const steps = [
    { label: 'Booking confirmed', at: fmtDate(b.created_at), done: true },
    { label: 'Pickup', at: when(b.start_date, b.start_time), done: ['current', 'past'].includes(phase) },
    { label: 'On the road', at: `${b.total_days || ''} ${b.rental_type === 'Hourly' ? 'hours' : b.rental_type === 'Monthly' ? 'months' : 'days'}`.trim(), done: phase === 'past', now: phase === 'current' },
    { label: 'Returned', at: when(b.end_date, b.end_time), done: phase === 'past' },
  ];
  const payments = Array.isArray(b.payments) ? b.payments : [];
  return (
    <>
      <a href={link('trips')} className="pt-back"><Icon name="left" size="sm" /> All trips</a>
      <div className="pt-detail-hero">
        <CarImage src={b.image_url} className="pt-detail-hero__img" />
        <div>
          <Badge tone={st.tone}>{st.label}</Badge>
          <h1>{b.vehicle || 'Your trip'}</h1>
          <p>{[b.vehicle_number, `Booking ${b.reference}`].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      {phase !== 'cancelled' && (
        <ol className="pt-timeline">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? 'is-done' : s.now ? 'is-now' : ''}>
              <span className="pt-timeline__dot">{s.done ? <Icon name="check" size="sm" /> : null}</span>
              <b>{s.label}</b><small>{s.at}</small>
            </li>
          ))}
        </ol>
      )}

      <div className="pt-grid2">
        <section className="pt-card">
          <h3><Icon name="pin" size="sm" /> Pickup &amp; return</h3>
          <div className="pt-legs">
            <div><span>Pickup</span><b>{when(b.start_date, b.start_time)}</b><small>{b.pickup_location || 'To be confirmed'}</small></div>
            <div><span>Return</span><b>{when(b.end_date, b.end_time)}</b><small>{b.drop_location || b.pickup_location || 'To be confirmed'}</small></div>
          </div>
        </section>
        <section className="pt-card">
          <h3><Icon name="tag" size="sm" /> Payment</h3>
          {phase === 'cancelled' ? <p className="portal-muted">This booking was cancelled.</p> : (
            <dl className="pt-sum">
              <div><dt>Trip total</dt><dd>{rs(b.total_amount)}</dd></div>
              <div><dt>Paid</dt><dd>{rs(b.paid_amount)}</dd></div>
              {Number(b.deposit_amount) > 0 && <div><dt>Security deposit (refundable)</dt><dd>{rs(b.deposit_amount)}</dd></div>}
              <div className="pt-sum__total"><dt>Balance to pay</dt><dd className={balance > 0 ? 'is-due' : 'is-clear'}>{balance > 0 ? rs(balance) : 'Paid in full'}</dd></div>
            </dl>
          )}
        </section>
      </div>

      {payments.length > 0 && (
        <section className="pt-card">
          <h3><Icon name="file" size="sm" /> Payments for this trip</h3>
          <PaymentRows rows={payments.map((p) => ({ ...p, booking: b }))} hideTrip />
        </section>
      )}

      <div className="pt-detail-actions">
        <a href={waLink(`Hi, this is ${name || 'a customer'}. About my booking ${b.reference} (${b.vehicle}, ${fmtDate(b.start_date)}):`)} target="_blank" rel="noreferrer" className="btn btn--red">
          <Icon name="chat" size="sm" /> Message us about this trip
        </a>
        {phase === 'past' && (
          <a href={`/feedback?v=${encodeURIComponent(b.vehicle_id || '')}&n=${encodeURIComponent(name || '')}`} className="btn btn--ghost"><Icon name="star" size="sm" /> Rate this trip</a>
        )}
      </div>
    </>
  );
}

function Requests({ data }) {
  const hasBookings = data.bookings.length > 0;
  const withInfo = data.requests.map((r) => ({ r, info: requestInfo(r, hasBookings) }));
  const open = withInfo.filter((x) => x.info.group === 'open');
  const rest = withInfo.filter((x) => x.info.group !== 'open');
  return (
    <>
      <SectionHead title="Booking requests" text="Requests you sent from our website and where each one stands."
                   action={<a href="/vehicles" className="btn btn--ghost btn--sm"><Icon name="plus" size="sm" /> New request</a>} />
      {open.length ? <div className="pt-list">{open.map(({ r }) => <RequestCard key={r.id} r={r} hasBookings={hasBookings} />)}</div>
        : <Empty icon="file" title="No open requests" text="Found a car you like? Send a booking request and track it here." />}
      {rest.length > 0 && (
        <>
          <h3 className="pt-subhead">Earlier requests</h3>
          <div className="pt-list">{rest.map(({ r }) => <RequestCard key={r.id} r={r} hasBookings={hasBookings} />)}</div>
        </>
      )}
    </>
  );
}

function PaymentRows({ rows, hideTrip }) {
  return (
    <ul className="pt-payments">
      {rows.map((p, i) => {
        const k = PAY_KIND[p.kind] ?? { label: p.kind || 'Payment', sign: 1 };
        return (
          <li key={i}>
            <span className={`pt-payments__icon pt-payments__icon--${k.sign < 0 ? 'out' : k.sign > 0 ? 'in' : 'dep'}`}><Icon name={k.sign < 0 ? 'left' : k.sign > 0 ? 'check' : 'shield'} size="sm" /></span>
            <div className="pt-payments__what">
              <b>{k.label}</b>
              <small>{[fmtDate(p.at), p.method, p.receipt_no && `Receipt ${p.receipt_no}`, !hideTrip && p.booking?.reference].filter(Boolean).join(' · ')}</small>
            </div>
            <span className={`pt-payments__amt${k.sign < 0 ? ' is-out' : ''}`}>{k.sign < 0 ? '−' : ''}{rs(p.amount)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Payments({ data }) {
  const live = data.bookings.filter((b) => b.status !== 'Cancelled');
  const total = live.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  const paid = live.reduce((s, b) => s + (Number(b.paid_amount) || 0), 0);
  const due = live.reduce((s, b) => s + (Number(b.balance) || 0), 0);
  const rows = data.bookings.flatMap((b) => (Array.isArray(b.payments) ? b.payments : []).map((p) => ({ ...p, booking: b })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const owing = live.filter((b) => Number(b.balance) > 0);
  return (
    <>
      <SectionHead title="Payments" text="What you have paid and what is still to pay." />
      <div className="pt-stats pt-stats--3">
        <div className="pt-stat"><Icon name="car" /><b>{rs(total)}</b><span>Total of your trips</span></div>
        <div className="pt-stat"><Icon name="check" /><b>{rs(paid)}</b><span>Paid</span></div>
        <div className={`pt-stat${due > 0 ? ' pt-stat--due' : ''}`}><Icon name="tag" /><b>{rs(due)}</b><span>Balance to pay</span></div>
      </div>
      {owing.length > 0 && (
        <section className="pt-card">
          <h3><Icon name="clock" size="sm" /> Still to pay</h3>
          <ul className="pt-owing">
            {owing.map((b) => (
              <li key={b.id}>
                <a href={link('trips', `&trip=${encodeURIComponent(b.id)}`)}><b>{b.vehicle}</b><small>{b.reference} · {shortDate(b.start_date)} – {fmtDate(b.end_date)}</small></a>
                <span className="is-due">{rs(b.balance)}</span>
              </li>
            ))}
          </ul>
          <p className="portal-muted pt-note">Pay the balance at pickup or by bank transfer — message us for the bank details.</p>
        </section>
      )}
      <section className="pt-card">
        <h3><Icon name="file" size="sm" /> Payment history</h3>
        {rows.length ? <PaymentRows rows={rows} /> : <p className="portal-muted">No payments recorded yet.</p>}
      </section>
    </>
  );
}

function Profile({ data, onSignOut }) {
  const p = data.profile || {};
  return (
    <>
      <SectionHead title="Profile" text="The details we have on your bookings." />
      <section className="pt-card pt-profile">
        <span className="pt-avatar pt-avatar--lg">{(firstName(p.name) || '?').slice(0, 1).toUpperCase()}</span>
        <dl className="pt-sum">
          <div><dt>Name</dt><dd>{p.name || '—'}</dd></div>
          <div><dt>Mobile</dt><dd>{p.phone || '—'}</dd></div>
          <div><dt>Email</dt><dd>{p.email || '—'}</dd></div>
          <div><dt>Customer since</dt><dd>{p.customer_since ? fmtDate(p.customer_since, { month: 'long', year: 'numeric' }) : '—'}</dd></div>
        </dl>
      </section>
      <p className="portal-muted pt-note">
        Need to change your details? <a href={waLink(`Hi, please update my details (${p.phone || ''}):`)} target="_blank" rel="noreferrer">Message us on WhatsApp</a>.
      </p>
      <button type="button" className="btn btn--ghost" onClick={onSignOut}>Sign out</button>
    </>
  );
}

function Help({ name }) {
  return (
    <>
      <SectionHead title="Help" text="We are here for you before, during and after your trip." />
      <div className="pt-actions">
        <a href={waLink(`Hi, this is ${name || 'a customer'}. I need help with my booking.`)} target="_blank" rel="noreferrer" className="pt-action"><Icon name="chat" /><b>WhatsApp</b><small>{CONTACT.whatsapp} · fastest reply</small></a>
        <a href={`tel:${CONTACT.tel}`} className="pt-action"><Icon name="phone" /><b>Call us</b><small>{CONTACT.phone}</small></a>
        <a href={`mailto:${CONTACT.email}`} className="pt-action"><Icon name="mail" /><b>Email</b><small>{CONTACT.email}</small></a>
      </div>
      <section className="pt-card">
        <h3><Icon name="shield" size="sm" /> On the road</h3>
        <ul className="pt-tips">
          <li>Breakdown or accident? Call <a href={`tel:${CONTACT.tel}`}>{CONTACT.phone}</a> right away — keep your booking reference handy.</li>
          <li>Running late for the return? Message us before the return time so we can plan.</li>
          <li>Want to extend your trip? Ask early — we will check the car is free for the extra days.</li>
        </ul>
      </section>
      <a href="/#faq" className="pt-more">Frequently asked questions <Icon name="right" size="sm" /></a>
    </>
  );
}

/* ── Shell ─────────────────────────────────────────────────────────────────── */

export default function PortalApp({ session, search, onSignOut }) {
  const params = new URLSearchParams(search);
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const tripId = params.get('trip');
  const [state, setState] = useState({ loading: true });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try { setState({ loading: false, data: await loadMine() }); }
    catch (err) { if (err.signedOut) onSignOut(); else setState({ loading: false, error: err.message }); }
  }, [onSignOut]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab, tripId]);

  const data = state.data;
  const name = data?.profile?.name || '';
  const trip = tripId && data ? data.bookings.find((b) => b.id === tripId) : null;
  const counts = data ? {
    trips: data.bookings.filter((b) => ['current', 'upcoming'].includes(tripPhase(b))).length,
    requests: data.requests.filter((r) => requestInfo(r, data.bookings.length > 0).group === 'open').length,
  } : {};

  let body;
  if (state.loading && !data) body = <div className="pt-loading"><span className="pt-spinner" /> Loading your account…</div>;
  else if (state.error) body = <div className="fb-error" role="alert">{state.error} <button type="button" className="portal-retry" onClick={load}>Try again</button></div>;
  else if (tab === 'trips' && trip) body = <TripDetail b={trip} name={name} />;
  else if (tab === 'trips') body = <Trips data={data} />;
  else if (tab === 'requests') body = <Requests data={data} />;
  else if (tab === 'payments') body = <Payments data={data} />;
  else if (tab === 'profile') body = <Profile data={data} onSignOut={onSignOut} />;
  else if (tab === 'help') body = <Help name={name} />;
  else body = <Overview data={data} name={name} />;

  return (
    <div className="pt">
      <aside className="pt-side">
        <div className="pt-me">
          <span className="pt-avatar">{(firstName(name) || '?').slice(0, 1).toUpperCase()}</span>
          <div><b>{name || 'Your account'}</b><small>{session.phone}</small></div>
        </div>
        <nav className="pt-nav" aria-label="My account">
          {TABS.map((t) => (
            <a key={t.id} href={link(t.id)} className={tab === t.id ? 'is-active' : undefined} aria-current={tab === t.id ? 'page' : undefined}>
              <Icon name={t.icon} /> <span>{t.label}</span>
              {counts[t.id] > 0 && <em>{counts[t.id]}</em>}
            </a>
          ))}
        </nav>
        <button type="button" className="pt-signout" onClick={onSignOut}><Icon name="x" size="sm" /> Sign out</button>
      </aside>
      <div className="pt-main">{body}</div>
    </div>
  );
}
