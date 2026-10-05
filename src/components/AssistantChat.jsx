import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Price } from '../context/AppContext';
import { fleetEnabled, useCatalog } from '../lib/fleet';
import { openVehicle } from './VehicleModal';
import { useRoute } from '../lib/router';
import { CONTACT } from '../data/site';

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
const save = (m) => { try { sessionStorage.setItem(STORE, JSON.stringify(m.slice(-40))); } catch { /* private mode */ } };

function VehicleCard({ v }) {
  return (
    <div className="ai-car">
      <button type="button" className="ai-car__img" onClick={() => openVehicle(v)} aria-label={`View ${v.name}`}>
        {v.img ? <img src={v.img} alt="" loading="lazy" /> : <Icon name="car" />}
      </button>
      <div className="ai-car__info">
        <strong>{v.name}</strong>
        <span className="ai-car__meta"><Icon name="seat" /> {v.seats} · {v.transKind === 'automatic' ? 'Auto' : 'Manual'} · {v.fuel}</span>
        <span className="ai-car__price"><Price lkr={v.price} /> <small>/ day</small></span>
      </div>
      <div className="ai-car__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => openVehicle(v)}>Details</button>
        <a className="btn btn--red btn--sm" href={`/book?v=${encodeURIComponent(v.id)}`}>Book</a>
      </div>
    </div>
  );
}

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
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 250); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!fleetEnabled || path === '/book') return null;

  const byId = new Map(vehicles.map((v) => [String(v.id), v]));

  const send = async (content) => {
    const msg = content.trim();
    if (!msg || busy) return;
    const next = [...messages, { role: 'user', content: msg }];
    setMessages(next); setText(''); setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ messages: next.map(({ role, content: c }) => ({ role, content: c })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The assistant is unavailable right now.');
      setMessages((m) => [...m, { role: 'assistant', content: data.reply, vehicles: data.vehicles ?? [] }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `${e.message} You can also chat with our team on WhatsApp.`, error: true }]);
    } finally { setBusy(false); }
  };

  const reset = () => { setMessages([GREETING]); setText(''); };
  const wa = `https://wa.me/${CONTACT.tel.replace(/\D/g, '')}?text=${encodeURIComponent('Hi, I need help choosing a vehicle.')}`;

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
          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ai-msg--${m.role}${m.error ? ' is-error' : ''}`}>
              <p>{m.content}</p>
              {m.vehicles?.length > 0 && (
                <div className="ai-cars">
                  {m.vehicles.map((id) => byId.get(String(id))).filter(Boolean).map((v) => <VehicleCard key={v.id} v={v} />)}
                </div>
              )}
              {m.error && <a className="ai-msg__wa" href={wa} target="_blank" rel="noreferrer"><Icon name="chat" /> WhatsApp us</a>}
            </div>
          ))}
          {busy && <div className="ai-msg ai-msg--assistant ai-typing" aria-label="Assistant is typing"><i /><i /><i /></div>}
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
