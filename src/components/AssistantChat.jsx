import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Price } from '../context/AppContext';
import { fleetEnabled, useCatalog } from '../lib/fleet';
import { openVehicle } from './VehicleModal';
import { useRoute } from '../lib/router';
import { waLink } from '../data/site';

/*
 * "Find my car" — AI assistant (Supabase Edge Function `vehicle-assistant`, powered by Claude).
 * It asks about the trip, checks real availability and recommends vehicles from the real fleet,
 * shown as cards with Details / Book buttons. The conversation is kept for this browser tab only.
 */
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vehicle-assistant`;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const STORE = 'crc-assistant';
const GREETING = {
  role: 'assistant',
  content: "Hi! I'm the Ceylon Rent A Cars assistant. Tell me about your trip — how many people, when, and where you're heading — and I'll find the right vehicle for you.",
};
const STARTERS = [
  'Family of 5 touring the hill country',
  'Airport pickup for 2 people',
  'Cheapest car for a week in Colombo',
  'Van with a driver for 8 people',
];

const load = () => { try { return JSON.parse(sessionStorage.getItem(STORE)) || [GREETING]; } catch { return [GREETING]; } };
// `fresh` (animate this reply) is never stored, so restored chats don't replay their animations
const save = (m) => { try { sessionStorage.setItem(STORE, JSON.stringify(m.slice(-40).map(({ fresh, ...rest }) => rest))); } catch { /* private mode */ } };

const WORD_MS = 22;   // reveal speed: one word every 22 ms

/**
 * Splits the reply into rows: every line is its own paragraph (never merged into one block),
 * consecutive "- " / "1." lines become one list. **bold** inline. No HTML is injected.
 */
function parseBlocks(text) {
  const blocks = [];
  text.replace(/\r/g, '').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t) { const last = blocks[blocks.length - 1]; if (last) last.open = false; return; }
    const item = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (item) {
      if (last?.type === 'ul' && last.open) last.items.push(item[1]);
      else blocks.push({ type: 'ul', items: [item[1]], open: true });
    } else {
      if (last) last.open = false;
      blocks.push({ type: 'p', text: t, open: false });
    }
  });
  return blocks;
}

/** Row style: the first line is the headline, a closing question gets its own box */
const rowClass = (b, i, all) => {
  if (i === 0 && all.length > 1) return 'ai-lead';
  if (i === all.length - 1 && /\?\s*$/.test(b.text) && all.length > 1) return 'ai-ask';
  return undefined;
};

/**
 * Formatted reply; when `animate`, each word fades in one after another (counter shared across blocks).
 * A "- [[car:ID]] reason" line becomes that vehicle's card with the reason inside it.
 */
function Rich({ text, animate, byId, info, trip }) {
  const counter = { n: 0 };
  const words = (s) => s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).flatMap((part, pi) => {
    const bold = /^\*\*[^*]+\*\*$/.test(part);
    const body = bold ? part.slice(2, -2) : part;
    return body.split(/(\s+)/).map((w, wi) => {
      if (!w) return null;
      if (/^\s+$/.test(w)) return w;
      const key = `${pi}-${wi}`;
      const style = animate ? { animationDelay: `${counter.n++ * WORD_MS}ms` } : undefined;
      const span = <span key={key} className={animate ? 'ai-w' : undefined} style={style}>{w}</span>;
      return bold ? <strong key={key}>{span}</strong> : span;
    });
  });
  const item = (it, j) => {
    const car = it.match(CAR);
    const v = car && byId.get(car[1]);
    if (car && !v) return car[2] ? <li key={j}>{words(car[2])}</li> : null;   // fleet not loaded / vehicle removed
    if (!v) return <li key={j}>{words(it)}</li>;
    const delay = animate ? { animationDelay: `${counter.n * WORD_MS}ms` } : undefined;
    return (
      <li key={j} className="ai-rich__car">
        <VehicleCard v={v} info={info?.[v.id]} trip={trip} className={animate ? 'ai-card-in' : ''} style={delay}>{car[2] ? words(car[2]) : null}</VehicleCard>
      </li>
    );
  };
  const blocks = parseBlocks(text);
  // A list that only asks questions ("- Your dates?") is shown as a question box too
  const askList = (b) => b.type === 'ul' && b.items.every((it) => /\?\s*$/.test(it));
  return (
    <div className="ai-rich">
      {blocks.map((b, i) => (b.type === 'ul'
        ? <ul key={i} className={askList(b) ? 'ai-asklist' : undefined}>{b.items.map(item)}</ul>
        : <p key={i} className={rowClass(b, i, blocks)}>{words(b.text.replace(/\[\[car:[^\]]+\]\]\s*/g, ''))}</p>))}
    </div>
  );
}
const wordCount = (text) => text.replace(/\*\*|\[\[car:[^\]]+\]\]/g, '').split(/\s+/).filter(Boolean).length;

/** Status lines shown while the assistant works */
const THINKING = ['Reading your trip details…', 'Checking our fleet…', 'Comparing seats, fuel and prices…', 'Checking availability…', 'Picking the best match…'];

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((n) => Math.min(n + 1, THINKING.length - 1)), 1600); return () => clearInterval(t); }, []);
  return (
    <div className="ai-msg ai-msg--assistant ai-thinking" role="status" aria-live="polite">
      <span className="ai-thinking__orb"><Icon name="spark" /></span>
      <span key={i} className="ai-thinking__text">{THINKING[i]}</span>
    </div>
  );
}

const shortDay = (iso) => new Date(`${iso}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** /book link carrying everything the chat learned: vehicle, dates, rental mode */
function bookHref(id, trip = {}) {
  const q = new URLSearchParams({ v: id });
  if (trip.from) q.set('from', trip.from);
  if (trip.to) q.set('to', trip.to);
  if (trip.mode) q.set('mode', trip.mode);
  return `/book?${q}`;
}

/**
 * One recommended vehicle, shown once inline: photo + specs + price, availability and trip total
 * for the customer's dates, the assistant's reason, and Details / Book (Book pre-fills the form).
 */
function VehicleCard({ v, info, trip, children, className = '', style }) {
  const dates = trip?.from && trip?.to ? `${shortDay(trip.from)} – ${shortDay(trip.to)}` : '';
  const booked = info?.available === false;
  return (
    <div className={`ai-car ${booked ? 'is-booked' : ''} ${className}`} style={style}>
      <button type="button" className="ai-car__img" onClick={() => openVehicle(v)} aria-label={`View ${v.name}`}>
        {v.img ? <img src={v.img} alt="" loading="lazy" /> : <Icon name="car" />}
      </button>
      <div className="ai-car__info">
        <strong>{v.name}{v.year ? <small> {v.year}</small> : null}</strong>
        <span className="ai-car__meta"><Icon name="seat" /> {v.seats} · {v.transKind === 'automatic' ? 'Auto' : 'Manual'} · {v.fuel}</span>
        <span className="ai-car__price"><Price lkr={v.price} /> <small>/ day</small></span>
      </div>
      {info && dates && (
        <div className="ai-car__trip">
          {info.available === true && <span className="ai-car__badge is-free"><Icon name="check" /> Free {dates}</span>}
          {booked && <span className="ai-car__badge is-busy">Booked {dates}</span>}
          {info.available == null && <span className="ai-car__badge">{dates}</span>}
          {info.total > 0 && !booked && (
            <span className="ai-car__total">Total <Price lkr={info.total} /> <small>· {info.days} {info.days === 1 ? 'day' : 'days'}</small></span>
          )}
        </div>
      )}
      {children && <div className="ai-car__why">{children}</div>}
      <div className="ai-car__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => openVehicle(v)}>Details</button>
        {booked
          ? <span className="btn btn--ghost btn--sm is-disabled" aria-disabled="true">Not free</span>
          : <a className="btn btn--red btn--sm" href={bookHref(v.id, trip)}>{trip?.from ? 'Book these dates' : 'Book'}</a>}
      </div>
    </div>
  );
}

const CAR = /^\[\[car:([A-Za-z0-9_-]+)\]\]\s*[:\-–—]?\s*(.*)$/;

export default function AssistantChat() {
  const { path } = useRoute();
  const { vehicles } = useCatalog();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(load);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => save(messages), [messages]);
  // Scroll to the newest message; a long reply is shown from its first line, not its end
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll('.ai-msg');
    const last = items[items.length - 1];
    const top = last && last.offsetHeight > list.clientHeight - 40 ? last.offsetTop - 12 : list.scrollHeight;
    list.scrollTo({ top, behavior: 'smooth' });
  }, [messages, busy, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 250); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!fleetEnabled || path === '/book') return null;

  const byId = new Map(vehicles.map((v) => [String(v.id), v]));
  // Trip details learned so far (dates, mode, people) — from the latest reply that had them
  const trip = [...messages].reverse().find((m) => m.trip)?.trip ?? {};
  const lastMsg = messages[messages.length - 1];

  const send = async (content) => {
    const msg = content.trim();
    if (!msg || busy) return;
    const next = [...messages, { role: 'user', content: msg }];
    setMessages(next); setText(''); setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ messages: next.map(({ role, content: c }) => ({ role, content: c })), trip }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The assistant is unavailable right now.');
      setMessages((m) => [...m, {
        role: 'assistant', content: data.reply, vehicles: data.vehicles ?? [], fresh: true,
        trip: data.trip && Object.keys(data.trip).length ? data.trip : undefined, info: data.info, suggestions: data.suggestions,
      }]);
    } catch (e) {
      // "Failed to fetch" = offline, or the assistant isn't reachable — don't show browser jargon to customers
      const why = e instanceof TypeError ? "Sorry, I can't connect right now." : e.message;
      setMessages((m) => [...m, { role: 'assistant', content: `${why} You can also chat with our team on WhatsApp.`, error: true }]);
    } finally { setBusy(false); }
  };

  const reset = () => { setMessages([GREETING]); setText(''); };
  const wa = waLink('Hi, I need help choosing a vehicle.');

  return (
    <>
      <button type="button" className={`ai-launch${open ? ' is-hidden' : ''}`} onClick={() => setOpen(true)} aria-label="Open the vehicle assistant">
        <Icon name="spark" /> <span>Find my car</span>
      </button>

      <section className={`ai-panel${open ? ' is-open' : ''}`} role="dialog" aria-label="Vehicle assistant" aria-hidden={!open}>
        <header className="ai-panel__head">
          <span className="ai-panel__avatar"><Icon name="spark" /></span>
          <div>
            <strong>Vehicle assistant</strong>
            <small>AI · recommends from our real fleet</small>
          </div>
          <button type="button" className="ai-panel__icon" onClick={reset} title="Start over" aria-label="Start over"><Icon name="plus" /></button>
          <button type="button" className="ai-panel__icon" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" /></button>
        </header>

        <div className="ai-panel__list" ref={listRef}>
          {messages.map((m, i) => {
            const animate = !!m.fresh && m.role === 'assistant';
            const after = animate ? wordCount(m.content) * WORD_MS + 150 : 0;
            // Older replies listed vehicles separately: show only those not already inline as cards
            const extra = (m.vehicles ?? []).filter((id) => !m.content.includes(`[[car:${id}]]`)).map((id) => byId.get(String(id))).filter(Boolean);
            return (
              <div key={i} className={`ai-msg ai-msg--${m.role}${m.error ? ' is-error' : ''}${animate ? ' is-fresh' : ''}`}>
                {m.role === 'assistant' ? <Rich text={m.content} animate={animate} byId={byId} info={m.info} trip={m.trip} /> : <p>{m.content}</p>}
                {extra.length > 0 && (
                  <div className="ai-cars">
                    {extra.map((v, j) => (
                      <VehicleCard key={v.id} v={v} info={m.info?.[v.id]} trip={m.trip} className={animate ? 'ai-card-in' : ''} style={animate ? { animationDelay: `${after + j * 110}ms` } : undefined} />
                    ))}
                  </div>
                )}
                {m === lastMsg && !busy && m.role === 'assistant' && m.suggestions?.length > 0 && (
                  <div className={`ai-quick${animate ? ' ai-card-in' : ''}`} style={animate ? { animationDelay: `${after + 250}ms` } : undefined}>
                    {m.suggestions.map((q) => <button key={q} type="button" onClick={() => send(q)}>{q}</button>)}
                  </div>
                )}
                {m.error && <a className="ai-msg__wa" href={wa} target="_blank" rel="noreferrer"><Icon name="chat" /> WhatsApp us</a>}
              </div>
            );
          })}
          {busy && <Thinking />}
          {messages.length === 1 && !busy && (
            <div className="ai-starters">
              {STARTERS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
            </div>
          )}
        </div>

        <form className="ai-panel__form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500}
                 placeholder="e.g. 4 adults, Kandy & Ella, 12–18 Dec" aria-label="Message" disabled={busy} />
          <button type="submit" className="ai-panel__send" disabled={busy || !text.trim()} aria-label="Send"><Icon name="arrow" /></button>
        </form>
        <p className="ai-panel__note">AI suggestions — our team confirms every booking.</p>
      </section>
    </>
  );
}
