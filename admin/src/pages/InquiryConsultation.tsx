import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Users, MapPin, Target, ShieldCheck, Car, Send, Wallet, Contact, Sparkles, StickyNote, Flag, ArrowRight,
  CheckCircle2, XCircle, AlertTriangle, ClipboardList, PhoneCall, Minus, Plus, Lock, FileText, Copy, Luggage,
  Mountain, Gauge, Trash2, CalendarCheck, Palmtree, Briefcase, ShoppingBag, Plane, PartyPopper, HeartHandshake, CalendarRange,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from '../store/useToast';
import StartInquiryModal from '../components/ui/StartInquiryModal';
import BookingDecision from '../components/ui/BookingDecision';
import { addFollowUp, intlDigits, parseRequest } from '../lib/inquiryFollowups';
import { alternativesFor, alternativesLink, placeIn, prettyDate, rs, vehicleLink } from '../lib/inquiryReview';
import {
  LEAD_QUALITY, LOST_REASONS, NEXT_ACTIONS, PRIORITIES, SPECIAL, STAGES, Suitability, advance, buildSummary,
  consultDates, consultDays, emptyConsultation, luggageOf, missing, passengerSeats, passengers, recommend, stageInfo,
  stageOf, suitability, tripCost, hillDetected, isHillTrip, TripCost, PURPOSES, purposeOf, currentChoice, bookingFromAgreement,
} from '../lib/consultation';

const PURPOSE_ICON: Record<string, typeof Car> = {
  'Holiday / tour': Palmtree, 'Business / company': Briefcase, 'Daily use (1 day)': ShoppingBag, 'Airport transfer': Plane,
  'Wedding / event': PartyPopper, 'Visiting family': HeartHandshake, 'Long-term (monthly)': CalendarRange,
};
import type { BookingAgreement, Consultation, InquiryStage, Vehicle } from '../types';

/* ---------- small building blocks ---------- */

function Section({ n, icon: Icon, title, hint, children }: { n: number; icon: typeof Car; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card !p-4 md:!p-5">
      <div className="flex items-start gap-3 mb-3">
        <span className="w-7 h-7 rounded-full bg-navy-700 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{n}</span>
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-navy-800"><Icon size={15} className="text-brand-500" />{title}</h2>
          {hint && <p className="text-[11px] text-navy-400">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Original (what the customer submitted, read-only) beside Confirmed (what staff found out) */
function Row({ label, original, children }: { label: string; original?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.3fr)] gap-x-3 gap-y-1 items-start py-2 border-b border-navy-50 last:border-0">
      <p className="text-xs font-semibold text-navy-500 pt-2">{label}</p>
      <div className="rounded-lg bg-navy-50/70 px-3 py-2 text-sm text-navy-500 min-h-[38px]">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-navy-300">Customer entered</span>
        {original || <span className="text-navy-300">—</span>}
      </div>
      <div>
        <span className="block text-[10px] font-bold uppercase tracking-wide text-emerald-600 mb-1">Confirmed</span>
        {children}
      </div>
    </div>
  );
}

function Stepper({ label, value, onChange, max = 30 }: { label: string; value?: number; onChange: (n: number) => void; max?: number }) {
  const v = value ?? 0;
  return (
    <div className="rounded-xl border border-navy-100 px-3 py-2">
      <p className="text-[11px] text-navy-400">{label}</p>
      <div className="flex items-center justify-between mt-1">
        <button type="button" onClick={() => onChange(Math.max(0, v - 1))} className="w-7 h-7 rounded-lg bg-navy-50 hover:bg-navy-100 flex items-center justify-center" aria-label={`Fewer ${label}`}><Minus size={14} /></button>
        <span className="text-lg font-bold text-navy-800 tabular-nums">{v}</span>
        <button type="button" onClick={() => onChange(Math.min(max, v + 1))} className="w-7 h-7 rounded-lg bg-navy-50 hover:bg-navy-100 flex items-center justify-center" aria-label={`More ${label}`}><Plus size={14} /></button>
      </div>
    </div>
  );
}

function Chips<T extends string>({ options, value, onChange, multi }: { options: readonly T[]; value?: T | T[]; onChange: (v: any) => void; multi?: boolean }) {
  const on = (o: T) => (multi ? ((value as T[]) ?? []).includes(o) : value === o);
  const click = (o: T) => {
    if (!multi) return onChange(value === o ? undefined : o);
    const cur = (value as T[]) ?? [];
    onChange(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => click(o)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${on(o) ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>
          {on(o) && multi ? '✓ ' : ''}{o}
        </button>
      ))}
    </div>
  );
}

const Toggle = ({ label, value, onChange }: { label: string; value?: boolean; onChange: (b: boolean) => void }) => (
  <label className="flex items-center justify-between gap-3 rounded-xl border border-navy-100 px-3 py-2 cursor-pointer">
    <span className="text-sm text-navy-700">{label}</span>
    <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
  </label>
);

const num = (s: string) => (s === '' ? undefined : Math.max(0, Number(s.replace(/[^\d.]/g, '')) || 0));
const VERDICT = {
  Recommended: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Suitable with notes': 'bg-amber-50 text-amber-800 border-amber-200',
  'Not recommended': 'bg-red-50 text-red-700 border-red-200',
};

function Checks({ fit }: { fit: Suitability }) {
  if (!fit.checks.length) return <p className="text-xs text-navy-400">Enter passengers, luggage, budget or dates to run the check.</p>;
  return (
    <ul className="space-y-1">
      {fit.checks.map((c) => (
        <li key={c.label} className="flex items-start gap-2 text-sm">
          {c.ok === true ? <CheckCircle2 size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" />
            : c.ok === false ? <XCircle size={15} className="text-red-500 mt-0.5 flex-shrink-0" />
            : <AlertTriangle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />}
          <span><b className="text-navy-800">{c.label}</b> <span className="text-navy-500">— {c.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

/** Trip cost: daily rate × days + extra km beyond what is included */
function CostBox({ t, compact }: { t: TripCost; compact?: boolean }) {
  const row = 'flex items-center justify-between gap-3';
  return (
    <div className={`rounded-lg bg-navy-50/70 ${compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'} text-navy-600 space-y-0.5`}>
      <p className={row}><span>{rs(t.rate)} × {t.days} day{t.days === 1 ? '' : 's'}</span><span className="font-semibold text-navy-800">{rs(t.base)}</span></p>
      {t.km > 0 && (t.extraKm > 0
        ? <p className={row}><span>{t.extraKm.toLocaleString('en-LK')} extra km × {rs(t.extraRate)} <span className="text-navy-400">({t.km.toLocaleString('en-LK')} km, {t.includedKm.toLocaleString('en-LK')} included)</span></span><span className="font-semibold text-navy-800">{rs(t.extraCost)}</span></p>
        : <p className={row}><span>{t.km.toLocaleString('en-LK')} km — within {t.includedKm.toLocaleString('en-LK')} km included</span><span className="font-semibold text-emerald-700">Rs 0</span></p>)}
      <p className={`${row} border-t border-navy-100 pt-0.5`}><span className="font-semibold">Estimated total</span><span className="font-bold text-navy-900">{rs(t.total)}</span></p>
    </div>
  );
}

/* ---------- page ---------- */

/** Inquiry Consultation: discover the real requirement, check the vehicle, offer the right one */
export default function InquiryConsultation() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { inquiries, vehicles, patchInquiry, updateInquiry, isVehicleAvailable } = useStore();
  const staff = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const inq = inquiries.find((i) => i.id === id);

  const [c, setC] = useState<Consultation>(() => inq?.consultation ?? emptyConsultation(staff));
  const [stage, setStage] = useState<InquiryStage>(() => (inq ? stageOf(inq) : 'NEW'));
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  const [attemptOpen, setAttemptOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const first = useRef(true);

  // Auto-save (debounced) — the original inquiry columns are never touched
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!inq) return;
    setSaved(false);
    const t = setTimeout(() => { patchInquiry(inq.id, { consultation: c }); setSaved(true); }, 700);
    return () => clearTimeout(t);
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps
  // keep attempts logged from the modal
  useEffect(() => { if (inq?.consultation && inq.consultation.attempts.length !== c.attempts.length) setC((x) => ({ ...x, attempts: inq.consultation!.attempts })); }, [inq?.consultation?.attempts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Consultation>(k: K, v: Consultation[K]) => setC((x) => ({ ...x, [k]: v }));
  const avail = (vid: string, s: string, e: string) => isVehicleAvailable(vid, s, e);

  const req = useMemo(() => parseRequest(inq?.notes), [inq?.notes]);
  const original = useMemo(() => (inq ? alternativesFor(inq, vehicles, avail).requested : undefined), [inq, vehicles]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = useMemo(() => (inq && original ? suitability(original, inq, c, avail) : undefined), [inq, original, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const recs = useMemo(() => (inq ? recommend(inq, c, vehicles, avail, original?.id, 4) : []), [inq, c, vehicles, original]); // eslint-disable-line react-hooks/exhaustive-deps
  // Vehicles staff added by hand (any vehicle — e.g. one they know suits the hills), with their own check
  const manualFits = useMemo(() => (inq ? (c.manualIds ?? []).map((mid) => vehicles.find((x) => x.id === mid)).filter((x): x is Vehicle => !!x).map((x) => suitability(x, inq, c, avail)) : []), [inq, c, vehicles]); // eslint-disable-line react-hooks/exhaustive-deps
  const [addId, setAddId] = useState('');

  // The customer may change their mind on the website (/alternatives) after the call — pick that up
  const recordRef = useRef<(vehicleId: string, note: string, source?: 'Staff' | 'Website', at?: string) => void>();
  useEffect(() => {
    if (!inq) return;
    const cur = currentChoice({ ...inq, consultation: c });
    if (cur.source === 'Website' && cur.vehicleId && cur.at && !(c.choiceLog ?? []).some((x) => x.source === 'Website' && x.at === cur.at)) {
      recordRef.current?.(cur.vehicleId, 'Customer chose this on the website', 'Website', cur.at);
      const nv = vehicles.find((x) => x.id === cur.vehicleId);
      toast.info('The customer changed vehicle on the website', nv ? `${nv.brand} ${nv.model}` : '');
    }
  }, [inq?.vehicleHistory?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inq) {
    return (
      <div className="card text-center py-16">
        <p className="text-navy-500 mb-4">Inquiry not found.</p>
        <Link to="/inquiries" className="btn-secondary inline-flex items-center gap-1.5"><ArrowLeft size={14} /> Back to inquiries</Link>
      </div>
    );
  }

  const days = consultDays(inq, c);
  const { start, end } = consultDates(inq, c);
  const pax = passengers(c);
  const first_ = inq.customerName.trim().split(' ')[0];
  const ref = req.reference;
  const todo = missing(c);
  const summary = buildSummary(inq, c, vehicles, fit);
  const v = (vid?: string) => vehicles.find((x) => x.id === vid);
  const rateOf = (x: Vehicle) => x.webPrice ?? x.dailyRent ?? 0;
  // The customer's CURRENT choice — latest of staff picks and website picks (falls back to the original vehicle)
  const selected = v(currentChoice({ ...inq, consultation: c }).vehicleId ?? c.selectedVehicleId);
  const costOf = (x: Vehicle) => tripCost(x, days, c.distanceKm);
  const purpose = purposeOf(c);

  // Send list = system suggestions staff kept ticked + vehicles they added by hand
  const autoRecs = recs.filter((r) => !(c.manualIds ?? []).includes(r.vehicle.id));
  const isOn = (vid: string) => !(c.excludedIds ?? []).includes(vid);
  const toggleOn = (vid: string) => set('excludedIds', isOn(vid) ? [...(c.excludedIds ?? []), vid] : (c.excludedIds ?? []).filter((x) => x !== vid));
  const sendList = [...autoRecs.filter((r) => isOn(r.vehicle.id)), ...manualFits].map((r) => r.vehicle);
  const addable = vehicles
    .filter((x) => x.id !== original?.id && !(c.manualIds ?? []).includes(x.id) && !autoRecs.some((r) => r.vehicle.id === x.id))
    .sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`));
  const addManual = (vid: string) => { if (vid) { set('manualIds', [...(c.manualIds ?? []), vid]); setAddId(''); } };
  const removeManual = (vid: string) => set('manualIds', (c.manualIds ?? []).filter((x) => x !== vid));

  /* ---------- sending while on the call ---------- */
  const wa = (text: string) => window.open(`https://wa.me/${intlDigits(inq.customerPhone)}?text=${encodeURIComponent(text)}`, '_blank');
  const log = (outcome: string, response: string) => addFollowUp({ inquiryId: inq.id, channel: 'WhatsApp', outcome, response, staff }).catch(() => {});
  const vehicleLines = (x: Vehicle) => {
    const t = costOf(x);
    return [
      `*${x.brand} ${x.model}${x.year ? ` ${x.year}` : ''}*`,
      `• ${x.seats ?? '—'} seats · ${x.transmission ?? '—'} · ${x.fuelType ?? '—'} · luggage about ${luggageOf(x)} large bags`,
      `• ${rs(t.rate)} per day × ${days} day${days === 1 ? '' : 's'} = ${rs(t.base)}`,
      c.distanceKm
        ? (t.extraKm
          ? `• About ${t.km.toLocaleString('en-LK')} km: ${t.includedKm.toLocaleString('en-LK')} km included + ${t.extraKm.toLocaleString('en-LK')} extra km × ${rs(t.extraRate)} = ${rs(t.extraCost)}`
          : `• About ${t.km.toLocaleString('en-LK')} km — within the ${t.includedKm.toLocaleString('en-LK')} km included`)
        : `• ${(x.includedKmPerDay ?? 100).toLocaleString('en-LK')} km per day included, then ${rs(t.extraRate)} per extra km`,
      `• *Estimated total: ${rs(t.total)}*`,
      `• Details & photos: ${vehicleLink(x.id)}`,
    ].join('\n');
  };
  const sign = ['', 'Kind regards,', staff, '*Ceylon Rent A Cars*'].join('\n');

  const sendVehicle = (x: Vehicle) => {
    wa([`Dear ${first_},`, '', 'As discussed, here are the details of the vehicle:', '', vehicleLines(x), '', 'The final price, deposit and conditions will be confirmed in your quotation.', sign].join('\n'));
    log('Interested', `Vehicle details sent: ${x.brand} ${x.model}`);
  };
  const sendAlternatives = (list: Vehicle[]) => {
    if (!list.length) return;
    const ids = list.map((x) => x.id);
    const link = alternativesLink({ ...inq, startDate: start, endDate: end }, list, ref);
    patchInquiry(inq.id, { alternativesOffered: ids, consultation: { ...c, suggested: ids }, stage: advance(inq.stage, 'OPTIONS_SENT') });
    setC((x) => ({ ...x, suggested: ids }));
    setStage((s) => advance(s, 'OPTIONS_SENT'));
    const why = fit && fit.verdict === 'Not recommended'
      ? `Based on your requirement${pax ? ` (${pax} passengers${c.largeBags ? ` and ${c.largeBags} large bags` : ''})` : ''}, the ${original ? `${original.brand} ${original.model}` : 'vehicle you selected'} would not be the most suitable choice. These options fit your trip better:`
      : 'As discussed, here are the vehicles that suit your trip:';
    wa([`Dear ${first_},`, '', why, '', ...list.map((x, i) => `${i + 1}. ${vehicleLines(x)}`).flatMap((s) => [s, '']), `You can compare them and choose one here:\n${link}`, sign].join('\n'));
    log('Interested', `Alternatives sent: ${list.map((x) => `${x.brand} ${x.model}`).join(', ')}`);
    toast.success('Alternatives sent', 'The customer can choose one from the link.');
  };
  const sendQuotation = () => {
    if (!inq.quote) { toast.warning('No quotation yet', 'Build the quote on the inquiry page first.'); navigate(`/inquiries/${inq.id}`); return; }
    const q = inq.quote;
    wa([`Dear ${first_},`, '', 'Here is your quotation:', '',
      `*Vehicle:* ${selected ? `${selected.brand} ${selected.model}` : inq.requestedVehicle}`,
      `*Period:* ${q.days} day${q.days === 1 ? '' : 's'} × ${rs(q.dailyRate)}`,
      ...q.extras.map((e) => `*${e.label}:* ${rs(e.amount)}`),
      ...(q.discount ? [`*Discount:* −${rs(q.discount)}`] : []),
      `*Total:* ${rs(q.total)}`, `*Refundable deposit:* ${rs(q.deposit)}`, '',
      'Please reply to confirm, or let us know if you have any questions.', sign].join('\n'));
    patchInquiry(inq.id, { stage: advance(inq.stage, 'QUOTATION_SENT') });
    setStage((s) => advance(s, 'QUOTATION_SENT'));
    log('Quote sent', `Quotation ${rs(q.total)} sent from the consultation`);
  };
  const sendLocation = () => {
    wa([`Dear ${first_},`, '', 'Please confirm your pickup and return details:', '',
      `*Pickup:* ${c.pickupLocation || placeIn(req.fields.Pickup) || '—'}${c.pickupAt ? ` · ${new Date(c.pickupAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`,
      `*Return:* ${(c.differentReturn ? c.returnLocation : c.pickupLocation) || placeIn(req.fields.Return) || '—'}${c.returnAt ? ` · ${new Date(c.returnAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`,
      '', 'Reply *Yes* if these are correct, or tell us what to change.', sign].join('\n'));
    log('Interested', 'Pickup / return confirmation sent');
  };

  /* ---------- decision: every choice / change of mind is recorded ---------- */
  const recordChoice = (vehicleId: string, note: string, source: 'Staff' | 'Website' = 'Staff', at = new Date().toISOString()) => {
    const x = v(vehicleId);
    if (!x) return;
    const now = new Date().toISOString();
    const next: Consultation = {
      ...c, selectedVehicleId: vehicleId,
      choiceLog: [...(c.choiceLog ?? []), { vehicleId, vehicle: `${x.brand} ${x.model}`, at, by: source === 'Website' ? 'Customer' : staff, source, note: note || undefined }],
    };
    // A change of mind sets the agreed terms aside — they must be confirmed again for the new vehicle
    const changedAfterAgreement = !!c.agreement && c.agreement.vehicleId !== vehicleId;
    if (changedAfterAgreement) {
      next.agreementHistory = [...(c.agreementHistory ?? []), { ...c.agreement!, supersededAt: now, supersededReason: note || `Changed to ${x.brand} ${x.model}` }];
      next.agreement = undefined;
    }
    const nextStage = changedAfterAgreement ? 'CUSTOMER_DECISION' : advance(stage, 'CUSTOMER_DECISION');
    setC(next);
    setStage(nextStage);
    patchInquiry(inq.id, { consultation: next, stage: nextStage });
    if (source === 'Staff') toast.success('Customer choice saved', `${x.brand} ${x.model}`);
  };
  const choose = (x: Vehicle) => recordChoice(x.id, 'Chosen during the consultation');

  const confirmTerms = (a: BookingAgreement) => {
    const agreement = { ...a, confirmedBy: staff };
    const next = { ...c, agreement };
    setC(next);
    setStage('CONFIRMED');
    patchInquiry(inq.id, { consultation: next, stage: 'CONFIRMED' });
    addFollowUp({ inquiryId: inq.id, channel: a.confirmedVia === 'In person' ? 'In person' : a.confirmedVia === 'Email' ? 'Email' : a.confirmedVia === 'WhatsApp' ? 'WhatsApp' : 'Call',
      outcome: 'Confirmed — ready to book', response: `Agreed: ${a.vehicle} · ${rs(a.total)} · advance ${rs(a.advanceAmount)} by ${a.paymentMethod}, balance ${a.balanceDue.toLowerCase()}`, staff }).catch(() => {});
    toast.success('Terms confirmed', 'Send the booking confirmation, then create the booking.');
  };
  const editTerms = () => {
    if (!c.agreement) return;
    const next = { ...c, agreementHistory: [...(c.agreementHistory ?? []), { ...c.agreement, supersededAt: new Date().toISOString(), supersededReason: 'Terms changed' }], agreement: undefined };
    setC(next);
    setStage('CUSTOMER_DECISION');
    patchInquiry(inq.id, { consultation: next, stage: 'CUSTOMER_DECISION' });
  };
  const sendConfirmation = (a: BookingAgreement) => {
    const fmtDt = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
    wa([`Dear ${first_},`, '', 'Thank you for confirming your booking with Ceylon Rent A Cars. Here are the agreed details:', '',
      `*Vehicle:* ${a.vehicle}${a.mode ? ` (${a.mode})` : ''}`,
      `*Pickup:* ${a.pickupLocation || '—'} · ${fmtDt(a.pickupAt)}`,
      `*Return:* ${a.returnLocation || a.pickupLocation || '—'} · ${fmtDt(a.returnAt)}`,
      `*Rental:* ${rs(a.dailyRate)} × ${a.days} day${a.days === 1 ? '' : 's'}${a.extraKmCost ? ` + estimated extra km ${rs(a.extraKmCost)}` : ''}${a.extras ? ` + extras ${rs(a.extras)}` : ''}${a.discount ? ` − discount ${rs(a.discount)}` : ''}`,
      `*Total:* ${rs(a.total)}`,
      `*Advance:* ${rs(a.advanceAmount)} by ${a.paymentMethod.toLowerCase()}`,
      `*Balance:* ${rs(Math.max(0, a.total - a.advanceAmount))} — due ${a.balanceDue.toLowerCase()}`,
      ...(a.depositAmount ? [`*Refundable deposit:* ${rs(a.depositAmount)}`] : []),
      ...(a.distanceKm ? ['', `Extra km is charged on the actual distance driven (estimate based on about ${a.distanceKm.toLocaleString('en-LK')} km).`] : []),
      ...(a.mode === 'Self drive' ? ['', 'Please bring your driving licence and NIC / passport at pickup.'] : []),
      '', 'Reply to this message if anything needs to change.', sign].join('\n'));
    log('Confirmed — ready to book', `Booking confirmation sent: ${a.vehicle} · ${rs(a.total)}`);
  };
  const createBooking = (a: BookingAgreement) => {
    const done: Consultation = { ...c, completedAt: c.completedAt ?? new Date().toISOString() };
    done.summary = buildSummary(inq, done, vehicles, fit);
    updateInquiry(inq.id, { consultation: done, status: 'Converted', stage: 'BOOKED' });
    navigate('/bookings', { state: { fromInquiry: bookingFromAgreement({ ...inq, consultation: done }, a, req.fields.Email) } });
  };

  recordRef.current = recordChoice;

  /* ---------- finish ---------- */
  const finish = () => {
    if (todo.length && !confirm(`Still missing: ${todo.join(', ')}.\n\nFinish the consultation anyway?`)) return;
    const done: Consultation = { ...c, completedAt: new Date().toISOString() };
    done.summary = buildSummary(inq, done, vehicles, fit);
    const lost = stage === 'LOST' || stage === 'CANCELLED' || stage === 'NO_RESPONSE';
    updateInquiry(inq.id, {
      consultation: done, stage,
      ...(lost ? { status: 'Lost', lostReason: stage === 'LOST' ? lostReason : stageInfo(stage).label } : {}),
    });
    addFollowUp({
      inquiryId: inq.id, channel: 'Call', outcome: c.leadQuality === 'Hot' ? 'Confirmed — ready to book' : c.leadQuality === 'Not interested' ? 'Not interested' : 'Interested',
      response: `Consultation finished — ${c.leadQuality ?? 'no lead quality'}. Next: ${c.nextAction ?? '—'}`, staff,
      nextFollowUp: c.nextFollowUpAt?.slice(0, 10),
    }).catch(() => {});
    toast.success('Consultation saved', 'The summary is attached to the inquiry.');
    navigate(`/inquiries/${inq.id}`);
  };

  const card = 'rounded-xl border border-navy-100 p-3';
  const lastAttempt = c.attempts[c.attempts.length - 1];

  return (
    <div className="pb-24 lg:pb-6">
      {/* ── Header ── */}
      <div className="card !p-4 md:!p-5 mb-4 lg:sticky lg:top-3 z-20">
        <Link to={`/inquiries/${inq.id}`} className="text-xs font-semibold text-navy-400 hover:text-navy-700 inline-flex items-center gap-1 mb-2"><ArrowLeft size={13} /> Inquiry</Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-500">Inquiry consultation</p>
            <h1 className="text-xl md:text-2xl font-extrabold text-navy-800 truncate">{inq.customerName}</h1>
            <p className="text-xs text-navy-400 mt-0.5">
              {inq.customerPhone}{ref ? ` · ${ref}` : ''} · started {prettyDate(c.startedAt)} by {c.startedBy}
              {lastAttempt ? ` · ${c.attempts.length} attempt${c.attempts.length === 1 ? '' : 's'} (last: ${lastAttempt.status}, ${lastAttempt.method})` : ''}
            </p>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${stageInfo(stage).cls}`}>{stageInfo(stage).label}</span>
          <span className={`text-[11px] ${saved ? 'text-emerald-600' : 'text-navy-400'}`}>{saved ? '✓ Saved' : 'Saving…'}</span>
          <button type="button" onClick={() => { patchInquiry(inq.id, { consultation: c }); setAttemptOpen(true); }} className="btn-secondary !py-2 text-xs flex items-center gap-1.5"><PhoneCall size={14} /> Log attempt</button>
          <button type="button" onClick={finish} className="btn-primary !py-2 text-xs flex items-center gap-1.5"><CheckCircle2 size={14} /> Finish consultation</button>
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-4 items-start">
        {/* ── Left: discover the requirement ── */}
        <div className="space-y-4">
          <Section n={1} icon={ClipboardList} title="Customer requirement confirmation" hint="Left: what the customer entered (kept as is). Right: what you confirmed on the call.">
            <Row label="Vehicle" original={inq.requestedVehicle}>
              <input className="input" value={c.requirement ?? ''} onChange={(e) => set('requirement', e.target.value)} placeholder="e.g. Vehicle for 7 passengers + luggage" />
            </Row>
            <Row label="Rental period" original={inq.startDate ? `${prettyDate(inq.startDate)} → ${prettyDate(inq.endDate)}` : undefined}>
              <div className="grid grid-cols-2 gap-2">
                <input type="datetime-local" className="input" value={c.pickupAt ?? ''} onChange={(e) => set('pickupAt', e.target.value || undefined)} aria-label="Pickup date and time" />
                <input type="datetime-local" className="input" value={c.returnAt ?? ''} onChange={(e) => set('returnAt', e.target.value || undefined)} aria-label="Return date and time" />
              </div>
              {(c.pickupAt || c.returnAt) && <p className="text-[11px] text-navy-400 mt-1">{days} day{days === 1 ? '' : 's'}</p>}
            </Row>
            <Row label="Rental type" original={req.fields.Type}>
              <Chips options={['Self drive', 'With driver', 'Airport pickup'] as const} value={c.mode} onChange={(m) => set('mode', m)} />
            </Row>
          </Section>

          <Section n={2} icon={Users} title="Travel purpose & passengers" hint="Why they're renting changes what the right vehicle is.">
            <p className="label">Travel purpose</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PURPOSES.map((p) => {
                const I = PURPOSE_ICON[p.id] ?? Car;
                const on = c.purpose === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => set('purpose', on ? undefined : p.id)} title={p.hint}
                          className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${on ? 'border-navy-700 bg-navy-700 text-white' : 'border-navy-100 hover:bg-navy-50'}`}>
                    <I size={16} className={on ? 'text-white' : 'text-brand-500'} />
                    <span className="block text-xs font-bold mt-1">{p.id}</span>
                    <span className={`block text-[10px] leading-snug mt-0.5 ${on ? 'text-white/70' : 'text-navy-400'}`}>{p.hint}</span>
                  </button>
                );
              })}
            </div>
            {purpose && (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm">
                <p className="font-semibold text-sky-900">Ask the customer</p>
                <ul className="list-disc ml-5 text-sky-900/90 text-[13px]">{purpose.ask.map((q) => <li key={q}>{q}</li>)}</ul>
                <p className="mt-1.5 text-[13px] text-sky-900"><b>Recommend:</b> {purpose.recommend}</p>
              </div>
            )}
            {c.purpose === 'Business / company' && (
              <div className="grid sm:grid-cols-2 gap-2 mt-2">
                <input className="input" value={c.companyName ?? ''} onChange={(e) => set('companyName', e.target.value)} placeholder="Company name" />
                <Toggle label="Company invoice required" value={c.invoiceRequired} onChange={(b) => set('invoiceRequired', b)} />
              </div>
            )}

            <p className="label mt-4">Passengers</p>
            <div className="grid grid-cols-3 gap-2 max-w-md">
              <Stepper label="Adults" value={c.adults} onChange={(n) => set('adults', n)} />
              <Stepper label="Children" value={c.children} onChange={(n) => set('children', n)} />
              <Stepper label="Infants" value={c.infants} onChange={(n) => set('infants', n)} />
            </div>
            <p className="text-sm font-semibold text-navy-800 mt-3">Total passengers: {pax || '—'}{c.mode === 'With driver' && pax ? <span className="text-navy-400 font-normal"> + driver</span> : null}</p>
            <input className="input mt-3" value={c.areas ?? ''} onChange={(e) => set('areas', e.target.value)} placeholder="Areas / route, e.g. Colombo → Kandy → Nuwara Eliya → Ella" />
            <div className="mt-2">
              <Toggle label="Includes hill country (Kandy, Nuwara Eliya, Ella…)" value={isHillTrip(c)} onChange={(b) => set('hillCountry', b)} />
              {hillDetected(c) && c.hillCountry === undefined && (
                <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1"><Mountain size={11} /> Detected from the route — vehicles not suited to hill roads are flagged.</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <Chips options={['City', 'Long distance', 'Mixed'] as const} value={c.usage} onChange={(u) => set('usage', u)} />
              <div className="flex-1 min-w-[180px]"><Toggle label="Highway / expressway use" value={c.highway} onChange={(b) => set('highway', b)} /></div>
            </div>
          </Section>

          <Section n={3} icon={MapPin} title="Pickup & return details" hint="The exact point — hotel, landmark or address — not just the city.">
            <Row label="Pickup" original={placeIn(req.fields.Pickup)}>
              <input className="input" value={c.pickupLocation ?? ''} onChange={(e) => set('pickupLocation', e.target.value)} placeholder="e.g. Cinnamon Grand Hotel, Colombo 03" />
            </Row>
            <Row label="Return" original={placeIn(req.fields.Return)}>
              <Toggle label="Different return location" value={c.differentReturn} onChange={(b) => set('differentReturn', b)} />
              {c.differentReturn && <input className="input mt-2" value={c.returnLocation ?? ''} onChange={(e) => set('returnLocation', e.target.value)} placeholder="Exact return point" />}
            </Row>
            <div className="mt-2"><Toggle label="Airport delivery required (CMB)" value={c.airportDelivery} onChange={(b) => set('airportDelivery', b)} /></div>
          </Section>

          <Section n={4} icon={Target} title="Customer priorities" hint="What matters most — used to rank the suggested vehicles.">
            <Chips multi options={PRIORITIES} value={c.priorities as any} onChange={(p) => set('priorities', p)} />
          </Section>

          <Section n={8} icon={Wallet} title="Distance & budget" hint="Ask the expected kilometres FIRST — the extra-km cost changes what fits the budget.">
            <p className="label flex items-center gap-1.5"><Gauge size={13} /> Expected total distance for the whole rental (customer's estimate)</p>
            {purpose && (() => {
              const lo = Math.round((purpose.kmPerDay[0] * days) / 50) * 50, hi = Math.round((purpose.kmPerDay[1] * days) / 50) * 50;
              const mid = Math.round((lo + hi) / 2 / 50) * 50;
              return (
                <p className="text-[11px] text-sky-800 bg-sky-50 rounded-lg px-2.5 py-1.5 mb-2 flex flex-wrap items-center gap-2">
                  <span>{purpose.id}: usually {purpose.kmPerDay[0]}–{purpose.kmPerDay[1]} km/day ≈ <b>{lo.toLocaleString('en-LK')}–{hi.toLocaleString('en-LK')} km</b> for {days} day{days === 1 ? '' : 's'}.</span>
                  {!c.distanceKm && <button type="button" onClick={() => set('distanceKm', mid)} className="font-semibold underline">Use {mid.toLocaleString('en-LK')} km</button>}
                </p>
              );
            })()}
            <div className="flex flex-wrap items-center gap-1.5">
              {[300, 500, 750, 1000, 1500, 2000].map((km) => (
                <button key={km} type="button" onClick={() => set('distanceKm', c.distanceKm === km ? undefined : km)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${c.distanceKm === km ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>
                  {km.toLocaleString('en-LK')} km
                </button>
              ))}
              <input className="input !py-1.5 !w-32" inputMode="numeric" value={c.distanceKm ?? ''} onChange={(e) => set('distanceKm', num(e.target.value))} placeholder="Other (km)" />
            </div>
            {original && (
              <div className="mt-3">
                <p className="text-[11px] text-navy-400 mb-1">Customer's selected vehicle — {original.brand} {original.model} ({(original.includedKmPerDay ?? 100)} km/day included, {rs(original.extraKmRate ?? 50)}/extra km)</p>
                <CostBox t={costOf(original)} />
              </div>
            )}
            <p className="label mt-4">Budget</p>
            <div className="grid sm:grid-cols-3 gap-2">
              <input className="input" inputMode="numeric" value={c.budgetPerDay ?? ''} onChange={(e) => set('budgetPerDay', num(e.target.value))} placeholder="Estimated budget / day (Rs)" />
              <input className="input" inputMode="numeric" value={c.budgetMaxPerDay ?? ''} onChange={(e) => set('budgetMaxPerDay', num(e.target.value))} placeholder="Maximum / day (Rs)" />
              <Toggle label="Budget flexible" value={c.budgetFlexible} onChange={(b) => set('budgetFlexible', b)} />
            </div>
          </Section>

          <Section n={9} icon={Contact} title="Driving requirement" hint="Find out now — not at the counter — if the customer can't self-drive.">
            {c.mode !== 'Self drive' ? (
              <p className="text-sm text-navy-500">{c.mode ? `${c.mode} — no driving licence needed.` : 'Choose the rental type in section 1.'}</p>
            ) : (
              <div className="space-y-2">
                <div className="grid sm:grid-cols-2 gap-2">
                  <input className="input" value={c.nationality ?? ''} onChange={(e) => set('nationality', e.target.value)} placeholder="Nationality" />
                  <input className="input" inputMode="numeric" value={c.driverAge ?? ''} onChange={(e) => set('driverAge', num(e.target.value))} placeholder="Driver age" />
                </div>
                <Chips options={['Sri Lankan', 'Foreign', 'None'] as const} value={c.licence} onChange={(l) => set('licence', l)} />
                {c.licence === 'Foreign' && <Toggle label="Has an International Driving Permit (IDP)" value={c.idp} onChange={(b) => set('idp', b)} />}
                {c.licence === 'None' && <p className="text-sm font-semibold text-red-700 bg-red-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={15} className="mt-0.5" /> No licence — offer the vehicle with a driver instead.</p>}
                {c.licence === 'Foreign' && !c.idp && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={15} className="mt-0.5" /> Foreign licence without an IDP can't self-drive in Sri Lanka — confirm the IDP or offer a driver.</p>}
                {c.driverAge != null && c.driverAge > 0 && c.driverAge < 21 && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Driver under 21 — check the owner's age policy.</p>}
              </div>
            )}
          </Section>

          <Section n={10} icon={Sparkles} title="Special requirements">
            <Chips multi options={SPECIAL} value={c.special as any} onChange={(s) => set('special', s)} />
            <input className="input mt-2" value={c.specialNotes ?? ''} onChange={(e) => set('specialNotes', e.target.value)} placeholder="Other requests" />
          </Section>

          <Section n={11} icon={StickyNote} title="Inquiry notes">
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-navy-500">Customer notes <span className="text-navy-300">(shared with the operations team)</span>
                <textarea className="input mt-1 min-h-[90px]" value={c.customerNotes ?? ''} onChange={(e) => set('customerNotes', e.target.value)} placeholder="e.g. Travelling with parents — comfort matters more than price." />
              </label>
              <label className="text-xs text-navy-500 flex flex-col"><span className="flex items-center gap-1"><Lock size={11} /> Internal notes <span className="text-navy-300">(staff only)</span></span>
                <textarea className="input mt-1 min-h-[90px]" value={c.internalNotes ?? ''} onChange={(e) => set('internalNotes', e.target.value)} placeholder="e.g. Suggested Noah instead of Yaris." />
              </label>
            </div>
          </Section>
        </div>

        {/* ── Right: system analysis, proposal, outcome ── */}
        <div className="space-y-4 xl:sticky xl:top-[150px]">
          <Section n={5} icon={ShieldCheck} title="Vehicle suitability check" hint="System-generated from the confirmed requirement.">
            {!original ? <p className="text-sm text-navy-500">The requested vehicle isn't in the fleet list — see the suggestions below.</p> : fit && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-16 h-11 rounded-lg bg-navy-50 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {original.imageUrl ? <img src={original.imageUrl} alt="" className="w-full h-full object-contain" /> : <Car size={16} className="text-navy-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-navy-800 truncate">{original.brand} {original.model} <span className="text-navy-400 font-normal">· original choice</span></p>
                    <p className="text-[11px] text-navy-400">{original.seats ?? '—'} seats ({passengerSeats(original, c)} for passengers) · ~{luggageOf(original)} large bags · {rs(rateOf(original))}/day</p>
                  </div>
                </div>
                <Checks fit={fit} />
                <div className="mt-3"><CostBox t={fit.cost} /></div>
                <p className={`mt-3 text-sm font-bold rounded-xl border px-3 py-2 ${VERDICT[fit.verdict]}`}>Suitability: {fit.verdict}</p>
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => sendVehicle(original)} className="btn-secondary !py-1.5 text-xs flex items-center gap-1"><Send size={12} /> Send vehicle</button>
                </div>
              </>
            )}
          </Section>

          <Section n={6} icon={Car} title="Alternative vehicle suggestions" hint={`Free for ${start || '—'} → ${end || '—'}, ranked by the customer's priorities.`}>
            {(() => {
              const cardFor = (r: Suitability, label: string, manual: boolean) => {
                const x = r.vehicle;
                const chosen = selected?.id === x.id;
                const on = manual || isOn(x.id);
                const issues = r.checks.filter((k) => k.ok !== true).map((k) => k.label);
                return (
                  <div key={x.id} className={`${card} ${chosen ? 'border-emerald-400 bg-emerald-50/50' : ''} ${on ? '' : 'opacity-50'}`}>
                    <div className="flex items-center gap-3">
                      {!manual && (
                        <input type="checkbox" className="w-4 h-4 accent-emerald-600 flex-shrink-0" checked={on} onChange={() => toggleOn(x.id)} title="Include in the message to the customer" />
                      )}
                      <div className="w-16 h-11 rounded-lg bg-navy-50 overflow-hidden flex items-center justify-center flex-shrink-0">
                        {x.imageUrl ? <img src={x.imageUrl} alt="" className="w-full h-full object-contain" /> : <Car size={16} className="text-navy-300" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-navy-400">{label}</p>
                        <p className="text-sm font-bold text-navy-800 truncate">{x.brand} {x.model} <span className="text-navy-400 font-normal">{x.year}</span></p>
                        <p className="text-[11px] text-navy-500 flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-0.5"><Users size={11} /> {x.seats ?? '—'}</span>
                          <span className="inline-flex items-center gap-0.5"><Luggage size={11} /> ~{luggageOf(x)}</span>
                          <span>{x.transmission ?? '—'}</span>
                          {x.hillSuitable === true && <span className="inline-flex items-center gap-0.5 text-emerald-700"><Mountain size={11} /> Hills OK</span>}
                          {x.hillSuitable === false && <span className="inline-flex items-center gap-0.5 text-red-600"><Mountain size={11} /> Not for hills</span>}
                        </p>
                      </div>
                      {manual && <button type="button" onClick={() => removeManual(x.id)} className="p-1 rounded-lg text-navy-400 hover:text-red-600 hover:bg-red-50" aria-label="Remove"><Trash2 size={14} /></button>}
                    </div>
                    <div className="mt-2"><CostBox t={r.cost} compact /></div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${VERDICT[r.verdict]}`} title={issues.join(', ')}>{r.verdict}{issues.length && r.verdict !== 'Recommended' ? ` · ${issues.join(', ').toLowerCase()}` : ''}</span>
                      <span className="flex-1" />
                      <button type="button" onClick={() => sendVehicle(x)} className="text-[11px] font-semibold text-emerald-700 hover:underline flex items-center gap-1"><Send size={11} /> Send</button>
                      <button type="button" onClick={() => choose(x)} className={`text-[11px] font-semibold px-2 py-1 rounded-lg ${chosen ? 'bg-emerald-600 text-white' : 'bg-navy-50 text-navy-700 hover:bg-navy-100'}`}>
                        {chosen ? '✓ Customer selected' : 'Customer chose this'}
                      </button>
                    </div>
                  </div>
                );
              };
              return (
                <div className="space-y-2">
                  {autoRecs.length === 0 && <p className="text-sm text-navy-500">No other vehicle fits these requirements and dates automatically — add one by hand below.</p>}
                  {autoRecs.map((r, i) => cardFor(r, `System suggestion ${i + 1}`, false))}
                  {manualFits.map((r) => cardFor(r, 'Added by staff', true))}

                  <div className="flex gap-2 pt-1">
                    <select className="input !py-2 flex-1 text-sm" value={addId} onChange={(e) => setAddId(e.target.value)}>
                      <option value="">+ Add a vehicle manually…</option>
                      {addable.map((x) => {
                        const t = costOf(x);
                        return <option key={x.id} value={x.id}>{x.brand} {x.model} · {x.seats ?? '—'} seats · {rs(t.total)}{x.hillSuitable === false ? ' · not for hills' : ''}</option>;
                      })}
                    </select>
                    <button type="button" disabled={!addId} onClick={() => addManual(addId)} className="btn-secondary !py-2 text-xs disabled:opacity-40">Add</button>
                  </div>

                  <button type="button" disabled={!sendList.length} onClick={() => sendAlternatives(sendList)}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                    <Send size={15} /> Send {sendList.length === 1 ? '1 alternative' : `${sendList.length} alternatives`} to customer
                  </button>
                </div>
              );
            })()}
          </Section>

          <Section n={7} icon={Send} title="Send while calling" hint="Opens WhatsApp with a ready message — the call stays active.">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={!(selected ?? original)} onClick={() => sendVehicle((selected ?? original)!)} className="btn-secondary !py-2 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"><Car size={13} /> Send vehicle</button>
              <button type="button" disabled={!sendList.length} onClick={() => sendAlternatives(sendList)} className="btn-secondary !py-2 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"><Sparkles size={13} /> Send alternatives</button>
              <button type="button" onClick={sendQuotation} className="btn-secondary !py-2 text-xs flex items-center justify-center gap-1.5"><FileText size={13} /> Send quotation</button>
              <button type="button" onClick={sendLocation} className="btn-secondary !py-2 text-xs flex items-center justify-center gap-1.5"><MapPin size={13} /> Confirm location</button>
            </div>
          </Section>

          <Section n={15} icon={CalendarCheck} title="Customer decision & booking"
                   hint="Record changes of mind, confirm the agreed price and payment terms, then create the booking.">
            <BookingDecision
              inq={inq}
              c={c}
              chosen={selected ?? original}
              onChangeVehicle={(vid, note) => recordChoice(vid, note || 'Customer changed their mind')}
              onConfirm={confirmTerms}
              onEditTerms={editTerms}
              onSendConfirmation={sendConfirmation}
              onCreateBooking={createBooking}
            />
          </Section>

          <Section n={12} icon={Flag} title="Lead quality, next action & outcome">
            <p className="label">Customer intent</p>
            <Chips options={LEAD_QUALITY} value={c.leadQuality} onChange={(l) => set('leadQuality', l)} />
            <div className="grid sm:grid-cols-2 gap-2 mt-3">
              <label className="text-xs text-navy-500">Next action
                <select className="input mt-1" value={c.nextAction ?? ''} onChange={(e) => set('nextAction', e.target.value || undefined)}>
                  <option value="">Choose…</option>
                  {NEXT_ACTIONS.map((a) => <option key={a}>{a}</option>)}
                </select>
              </label>
              <label className="text-xs text-navy-500">Next follow-up
                <input type="datetime-local" className="input mt-1" value={c.nextFollowUpAt ?? ''} onChange={(e) => set('nextFollowUpAt', e.target.value || undefined)} />
              </label>
            </div>
            <label className="text-xs text-navy-500 block mt-3">Inquiry stage
              <select className="input mt-1" value={stage} onChange={(e) => setStage(e.target.value as InquiryStage)}>
                {STAGES.filter((s) => s.id !== 'BOOKED').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            {stage === 'LOST' && (
              <label className="text-xs text-navy-500 block mt-2">Lost reason
                <select className="input mt-1" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
                  {LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
            )}
          </Section>

          <Section n={13} icon={ClipboardList} title="Consultation summary" hint="Generated automatically — saved to the inquiry when you finish.">
            <pre className="text-xs text-navy-700 bg-navy-50/70 rounded-xl p-3 whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-y-auto">{summary}</pre>
            {todo.length > 0 && <p className="text-[11px] text-amber-700 mt-2">Still missing: {todo.join(' · ')}</p>}
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => navigator.clipboard.writeText(summary).then(() => toast.success('Summary copied', ''))} className="btn-secondary !py-2 text-xs flex items-center gap-1.5"><Copy size={13} /> Copy</button>
              <button type="button" onClick={finish} className="btn-primary !py-2 text-xs flex-1 flex items-center justify-center gap-1.5">Finish consultation <ArrowRight size={14} /></button>
            </div>
          </Section>
        </div>
      </div>

      <StartInquiryModal inquiry={inq} open={attemptOpen} onClose={() => setAttemptOpen(false)} />
    </div>
  );
}
