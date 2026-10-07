import { useEffect, useMemo, useState } from 'react';
import { Repeat, CheckCircle2, Send, CalendarCheck, Pencil, AlertTriangle, History, Wallet, Globe, User } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { rs, prettyDate } from '../../lib/inquiryReview';
import {
  BALANCE_DUE, CONFIRMED_VIA, PAYMENT_METHODS, agreementTotal, consultDates, consultDays, suitability, tripCost,
} from '../../lib/consultation';
import type { BookingAgreement, Consultation, Inquiry, Vehicle } from '../../types';

type Draft = Omit<BookingAgreement, 'confirmedAt' | 'confirmedBy' | 'total'>;

const num = (s: string) => Math.max(0, Number(s.replace(/[^\d.]/g, '')) || 0);
const when = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

/**
 * 15. Customer decision & booking:
 *  - every vehicle choice / change of mind (staff or website) on one timeline
 *  - the agreed terms: price, advance, payment method, balance due, deposit
 *  - send the booking confirmation, then create the booking with everything prefilled
 */
export default function BookingDecision({
  inq, c, chosen, onChangeVehicle, onConfirm, onEditTerms, onSendConfirmation, onCreateBooking,
}: {
  inq: Inquiry;
  c: Consultation;
  chosen?: Vehicle;                                   // the customer's current choice
  onChangeVehicle: (vehicleId: string, note: string) => void;
  onConfirm: (a: BookingAgreement) => void;
  onEditTerms: () => void;
  onSendConfirmation: (a: BookingAgreement) => void;
  onCreateBooking: (a: BookingAgreement) => void;
}) {
  const { vehicles, isVehicleAvailable } = useStore();
  const booked = inq.status === 'Converted';
  const [changeTo, setChangeTo] = useState('');
  const [changeNote, setChangeNote] = useState('');

  const days = consultDays(inq, c);
  const { start, end } = consultDates(inq, c);

  // Draft terms, prefilled from the confirmed requirement + the quote (if it was for this vehicle)
  const initial = useMemo<Draft | null>(() => {
    if (!chosen) return null;
    const t = tripCost(chosen, days, c.distanceKm);
    const q = inq.quote;
    return {
      vehicleId: chosen.id, vehicle: `${chosen.brand} ${chosen.model}`,
      pickupAt: c.pickupAt, returnAt: c.returnAt,
      pickupLocation: c.pickupLocation, returnLocation: c.differentReturn ? c.returnLocation : c.pickupLocation,
      mode: c.mode, distanceKm: c.distanceKm,
      dailyRate: q?.dailyRate || t.rate, days: q?.days || days, extraKmCost: t.extraCost,
      extras: (q?.extras ?? []).reduce((s, e) => s + e.amount, 0), discount: q?.discount ?? 0,
      advanceAmount: 0, paymentMethod: 'Bank transfer', balanceDue: 'At pickup',
      depositAmount: q?.deposit ?? 0, depositType: 'cash', confirmedVia: 'Call', notes: '',
    };
  }, [chosen?.id, days, c.distanceKm, c.pickupAt, c.returnAt, c.pickupLocation, c.returnLocation, c.differentReturn, c.mode, inq.quote]); // eslint-disable-line react-hooks/exhaustive-deps
  const [d, setD] = useState<Draft | null>(initial);
  useEffect(() => { if (!c.agreement) setD(initial); }, [initial, c.agreement]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));

  const total = d ? agreementTotal(d) : 0;
  const fit = chosen ? suitability(chosen, inq, c, (vid, s, e) => isVehicleAvailable(vid, s, e)) : undefined;
  const notFree = fit?.checks.find((k) => k.label === 'Availability' && k.ok === false);
  const blocking = fit?.checks.filter((k) => k.ok === false && k.label !== 'Availability') ?? [];

  /* ---------- choice timeline: staff picks + website picks, oldest first ---------- */
  const timeline = [
    ...(c.choiceLog ?? []).map((x) => ({ at: x.at, vehicle: x.vehicle, source: x.source, by: x.by, note: x.note })),
    ...(inq.vehicleHistory ?? []).filter((h) => !(c.choiceLog ?? []).some((x) => x.source === 'Website' && x.at === h.replacedAt))
      .map((h) => ({ at: h.replacedAt, vehicle: '(website) moved from ' + h.vehicle, source: 'Website' as const, by: 'Customer', note: h.reason })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const field = 'text-xs text-navy-500';
  const a = c.agreement;

  return (
    <div className="space-y-4">
      {/* Change of mind */}
      <div>
        <p className="label flex items-center gap-1.5"><Repeat size={13} /> Customer's vehicle choice</p>
        <div className="rounded-xl border border-navy-100 p-3">
          <p className="text-sm font-bold text-navy-800">{chosen ? `${chosen.brand} ${chosen.model}` : 'Not chosen yet'}</p>
          {fit && <p className="text-[11px] text-navy-500">{fit.verdict}{blocking.length ? ` — ${blocking.map((k) => k.label.toLowerCase()).join(', ')}` : ''}{notFree ? ' · NOT free for these dates' : ''}</p>}
          {timeline.length > 0 && (
            <ol className="mt-2 space-y-1 border-l-2 border-navy-100 ml-1">
              {timeline.map((t, i) => (
                <li key={i} className="ml-3 text-[11px] text-navy-500">
                  <span className="font-semibold text-navy-700">{t.vehicle}</span> · {t.source === 'Website' ? <Globe size={10} className="inline" /> : <User size={10} className="inline" />} {t.source} · {when(t.at)}
                  {t.note ? <span className="text-navy-400"> — {t.note}</span> : null}
                </li>
              ))}
            </ol>
          )}
          {!booked && (
            <div className="mt-3 grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
              <select className="input !py-2 text-sm" value={changeTo} onChange={(e) => setChangeTo(e.target.value)}>
                <option value="">{chosen ? 'Customer changed to…' : 'Customer chose…'}</option>
                {vehicles.filter((v) => v.id !== chosen?.id).sort((x, y) => `${x.brand}${x.model}`.localeCompare(`${y.brand}${y.model}`))
                  .map((v) => <option key={v.id} value={v.id}>{v.brand} {v.model} · {v.seats ?? '—'} seats · {rs(tripCost(v, days, c.distanceKm).total)}</option>)}
              </select>
              <input className="input !py-2 text-sm" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Why? e.g. wants a cheaper car" />
              <button type="button" disabled={!changeTo} onClick={() => { onChangeVehicle(changeTo, changeNote.trim()); setChangeTo(''); setChangeNote(''); }}
                      className="btn-secondary !py-2 text-xs disabled:opacity-40">Save change</button>
            </div>
          )}
          {a && !booked && <p className="text-[11px] text-amber-700 mt-2">Changing the vehicle sets the agreed terms aside — you'll confirm them again for the new vehicle.</p>}
        </div>
      </div>

      {/* Agreed terms */}
      {booked ? (
        <p className="text-sm font-semibold text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2.5 flex items-center gap-2"><CalendarCheck size={16} /> Booked — any further changes are made on the booking.</p>
      ) : a ? (
        <div className="rounded-xl border-2 border-teal-300 bg-teal-50/50 p-3 space-y-2">
          <p className="text-sm font-bold text-teal-800 flex items-center gap-1.5"><CheckCircle2 size={16} /> Customer confirmed · {a.confirmedVia}, {when(a.confirmedAt)} by {a.confirmedBy}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-navy-500">Vehicle</span><span className="font-semibold text-navy-800">{a.vehicle}{a.mode ? ` · ${a.mode}` : ''}</span>
            <span className="text-navy-500">Pickup</span><span className="text-navy-800">{a.pickupLocation || '—'} · {when(a.pickupAt)}</span>
            <span className="text-navy-500">Return</span><span className="text-navy-800">{a.returnLocation || a.pickupLocation || '—'} · {when(a.returnAt)}</span>
            <span className="text-navy-500">Price</span><span className="text-navy-800">{rs(a.dailyRate)} × {a.days}d{a.extraKmCost ? ` + km ${rs(a.extraKmCost)}` : ''}{a.extras ? ` + extras ${rs(a.extras)}` : ''}{a.discount ? ` − ${rs(a.discount)}` : ''}</span>
            <span className="text-navy-500 font-semibold">Total</span><span className="font-bold text-navy-900">{rs(a.total)}</span>
            <span className="text-navy-500">Advance</span><span className="text-navy-800">{rs(a.advanceAmount)} · {a.paymentMethod}</span>
            <span className="text-navy-500">Balance</span><span className="text-navy-800">{rs(Math.max(0, a.total - a.advanceAmount))} · {a.balanceDue.toLowerCase()}</span>
            <span className="text-navy-500">Deposit</span><span className="text-navy-800">{a.depositAmount ? `${rs(a.depositAmount)} (${a.depositType}, refundable)` : 'None'}</span>
          </div>
          {a.notes && <p className="text-xs text-navy-600">{a.notes}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => onSendConfirmation(a)} className="btn-secondary !py-2 text-xs flex items-center gap-1.5"><Send size={13} /> Send booking confirmation</button>
            <button type="button" onClick={onEditTerms} className="btn-secondary !py-2 text-xs flex items-center gap-1.5"><Pencil size={13} /> Change terms</button>
            <button type="button" onClick={() => onCreateBooking(a)} className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700"><CalendarCheck size={15} /> Create booking</button>
          </div>
        </div>
      ) : !d ? (
        <p className="text-sm text-navy-500">Record the customer's vehicle choice above first.</p>
      ) : (
        <div className="rounded-xl border border-navy-100 p-3 space-y-3">
          <p className="label flex items-center gap-1.5 !mb-0"><Wallet size={13} /> Agreed price & payment terms</p>
          {notFree && <p className="text-xs font-semibold text-red-700 bg-red-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} /> {d.vehicle} is booked for {start} → {end}. Change the vehicle or dates before confirming.</p>}
          {blocking.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} /> Doesn't fit: {blocking.map((k) => `${k.label} (${k.detail})`).join('; ')}. Make sure the customer accepts this.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <label className={field}>Daily rate<input className="input mt-1" inputMode="numeric" value={d.dailyRate} onChange={(e) => set('dailyRate', num(e.target.value))} /></label>
            <label className={field}>Days<input className="input mt-1" inputMode="numeric" value={d.days} onChange={(e) => set('days', Math.max(1, num(e.target.value)))} /></label>
            <label className={field}>Extra km (est.)<input className="input mt-1" inputMode="numeric" value={d.extraKmCost} onChange={(e) => set('extraKmCost', num(e.target.value))} /></label>
            <label className={field}>Extras<input className="input mt-1" inputMode="numeric" value={d.extras} onChange={(e) => set('extras', num(e.target.value))} /></label>
            <label className={field}>Discount<input className="input mt-1" inputMode="numeric" value={d.discount} onChange={(e) => set('discount', num(e.target.value))} /></label>
          </div>
          <p className="text-sm font-bold text-navy-900 flex justify-between rounded-lg bg-navy-50 px-3 py-2"><span>Total</span><span>{rs(total)}</span></p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className={field}>Advance now<input className="input mt-1" inputMode="numeric" value={d.advanceAmount} onChange={(e) => set('advanceAmount', Math.min(total, num(e.target.value)))} /></label>
            <label className={field}>Payment method
              <select className="input mt-1" value={d.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className={field}>Balance due
              <select className="input mt-1" value={d.balanceDue} onChange={(e) => set('balanceDue', e.target.value)}>{BALANCE_DUE.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className={field}>Refundable deposit<input className="input mt-1" inputMode="numeric" value={d.depositAmount} onChange={(e) => set('depositAmount', num(e.target.value))} /></label>
            <label className={field}>Deposit type
              <select className="input mt-1" value={d.depositType} onChange={(e) => set('depositType', e.target.value as Draft['depositType'])}>
                <option value="cash">Cash</option><option value="vehicle">Vehicle</option><option value="other">Other</option>
              </select>
            </label>
            <label className={field}>Confirmed via
              <select className="input mt-1" value={d.confirmedVia} onChange={(e) => set('confirmedVia', e.target.value)}>{CONFIRMED_VIA.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
          </div>
          <p className="text-xs text-navy-500">Balance after advance: <b className="text-navy-800">{rs(Math.max(0, total - d.advanceAmount))}</b> · due {d.balanceDue.toLowerCase()}</p>
          <input className="input text-sm" value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Anything else agreed (e.g. free child seat, pickup at 7 AM)" />
          <button type="button" disabled={!!notFree} onClick={() => onConfirm({ ...d, total, confirmedAt: new Date().toISOString(), confirmedBy: '' })}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40">
            <CheckCircle2 size={15} /> Customer confirmed — save agreed terms
          </button>
        </div>
      )}

      {(c.agreementHistory?.length ?? 0) > 0 && (
        <details className="text-xs text-navy-500">
          <summary className="cursor-pointer font-semibold flex items-center gap-1"><History size={12} /> Earlier terms the customer changed ({c.agreementHistory!.length})</summary>
          <ul className="mt-1 space-y-1">
            {c.agreementHistory!.map((h, i) => (
              <li key={i} className="rounded-lg bg-navy-50 px-2.5 py-1.5">
                <s>{h.vehicle} · {rs(h.total)}</s> — confirmed {prettyDate(h.confirmedAt)}, changed {h.supersededAt ? prettyDate(h.supersededAt) : ''}{h.supersededReason ? `: ${h.supersededReason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
