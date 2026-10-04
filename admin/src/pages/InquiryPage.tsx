import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Phone, MessageCircle, Mail, Copy, Flame, Snowflake, Thermometer, Sparkles, Timer, AlertTriangle, Info,
  CheckCircle2, Circle, MapPin, CalendarDays, User, Globe, Car, History, Repeat, XCircle, ArrowRight, ClipboardCheck,
  Receipt, MessagesSquare,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from '../store/useToast';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import Select from '../components/ui/Select';
import { ContactLog } from '../components/ui/InquiryContact';
import InquiryQuoteBuilder from '../components/ui/InquiryQuoteBuilder';
import { FollowUp, addFollowUp, intlDigits, loadFollowUps, parseRequest, stageOf } from '../lib/inquiryFollowups';
import {
  CHECKLIST, alternativesFor, customerHistory, daysBetween, flagsOf, mapIn, placeIn, prettyDate, responseInfo, rs,
  temperatureOf, templates, timeIn,
} from '../lib/inquiryReview';
import type { InquiryQuote } from '../types';

export const LOST_REASONS = ['No vehicle available', 'Dates not available', 'Budget mismatch', 'No response from customer', 'Customer cancelled', 'Found elsewhere', 'Other'];

const TEMP = {
  New: { icon: Sparkles, cls: 'bg-brand-500 text-white' },
  Hot: { icon: Flame, cls: 'bg-orange-100 text-orange-700' },
  Warm: { icon: Thermometer, cls: 'bg-amber-100 text-amber-800' },
  Cold: { icon: Snowflake, cls: 'bg-sky-100 text-sky-700' },
};

function Section({ icon: Icon, title, right, children }: { icon: typeof Car; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card !p-4 md:!p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy-800"><Icon size={16} className="text-brand-500" />{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Full-page review of one inquiry: contact, qualify, quote, convert */
export default function InquiryPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { inquiries, vehicles, bookings, patchInquiry, updateInquiry, isVehicleAvailable } = useStore();
  const staff = useAuthStore((s) => s.currentUser?.name) ?? 'Ceylon Rent A Cars';
  const inq = inquiries.find((i) => i.id === id);

  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [logReady, setLogReady] = useState(true);
  const [channel, setChannel] = useState<string>();
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  const [lostCustom, setLostCustom] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    loadFollowUps().then((l) => { setLogReady(l !== null); setFollowUps((l ?? []).filter((f) => f.inquiryId === id)); }).catch(() => {});
  }, [id]);
  // keep the "waiting" timer fresh
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const req = useMemo(() => parseRequest(inq?.notes), [inq?.notes]);
  const alt = useMemo(() => (inq ? alternativesFor(inq, vehicles, (vid, s, e) => isVehicleAvailable(vid, s, e)) : null), [inq, vehicles, isVehicleAvailable]);
  const history = useMemo(() => (inq ? customerHistory(inq, bookings) : null), [inq, bookings]);

  if (!inq || !alt || !history) {
    return (
      <div className="card text-center py-16">
        <p className="text-navy-500 mb-4">Inquiry not found.</p>
        <Link to="/inquiries" className="btn-secondary inline-flex items-center gap-1.5"><ArrowLeft size={14} /> Back to inquiries</Link>
      </div>
    );
  }

  const temp = temperatureOf(followUps, inq.quote);
  const resp = responseInfo(inq.createdAt, followUps);
  const stage = stageOf(inq, followUps);
  const flags = flagsOf(inq);
  const email = req.fields.Email;
  const days = daysBetween(inq.startDate, inq.endDate);
  const checklist = inq.checklist ?? {};
  const done = CHECKLIST.filter((c) => checklist[c.id]).length;
  const ready = done === CHECKLIST.length;
  const pending = inq.status === 'Pending';
  const TempIcon = TEMP[temp.level].icon;
  const tpl = templates(inq, staff, alt.list, alt.requested?.id);

  // Estimate on website requests: "9 · Estimate: Rs 65,000"
  const [dayCount, estimate] = (req.fields.Days ?? '').split(' · ');
  const estimateNum = Number((estimate ?? '').replace(/\D/g, '')) || 0;

  const tickItem = (key: string, value: boolean) => patchInquiry(inq.id, { checklist: { ...checklist, [key]: value } });

  const logAdded = (f: FollowUp) => setFollowUps((l) => [f, ...l]);

  const saveQuote = (q: InquiryQuote) => {
    patchInquiry(inq.id, { quote: q, ...(q.status === 'accepted' ? { checklist: { ...checklist, price: true } } : {}) });
    toast.success(q.status === 'accepted' ? 'Quote accepted' : 'Quote saved', `Total ${rs(q.total)}`);
  };
  const quoteSent = async (q: InquiryQuote, via: 'WhatsApp' | 'Email') => {
    patchInquiry(inq.id, { quote: q });
    if (!logReady) return;
    try { logAdded(await addFollowUp({ inquiryId: inq.id, channel: via, outcome: 'Quote sent', response: `Quote ${rs(q.total)} (deposit ${rs(q.deposit)}) sent via ${via}.`, staff })); }
    catch { /* the quote itself is saved; logging is best-effort */ }
  };

  const openWa = (text: string) => { setChannel('WhatsApp'); window.open(`https://wa.me/${intlDigits(inq.customerPhone)}?text=${encodeURIComponent(text)}`, '_blank'); };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`, ''); } catch { prompt(`Copy ${what.toLowerCase()}:`, text); }
  };

  const convert = () => {
    if (!ready && !confirm(`Only ${done} of ${CHECKLIST.length} checks are done. Convert to a booking anyway?`)) return;
    const st = timeIn(req.fields.Pickup), et = timeIn(req.fields.Return);
    const last = followUps.find((f) => f.response && f.outcome !== 'Quote sent');
    updateInquiry(inq.id, { status: 'Converted' });
    navigate('/bookings', {
      state: {
        fromInquiry: {
          customerName: inq.customerName,
          customerPhone: inq.customerPhone,
          customerEmail: email,
          startDate: inq.startDate,
          endDate: inq.endDate,
          vehicleId: alt.requested?.id,
          startTime: st ? `${pad2(st[0])}:${pad2(st[1])}` : undefined,
          endTime: et ? `${pad2(et[0])}:${pad2(et[1])}` : undefined,
          pickupLocation: req.fields.Pickup ? placeIn(req.fields.Pickup) : undefined,
          dropLocation: req.fields.Return ? placeIn(req.fields.Return) : undefined,
          totalAmount: inq.quote?.total,
          notes: [
            inq.requestedVehicle && `Requested: ${inq.requestedVehicle}`,
            req.reference && `Website request ${req.reference}`,
            req.fields.Type && `Type: ${req.fields.Type}`,
            inq.quote && `Quote: ${rs(inq.quote.total)} (deposit ${rs(inq.quote.deposit)})`,
            last?.response && `Customer: ${last.response}`,
          ].filter(Boolean).join('\n'),
        },
      },
    });
  };

  const confirmLost = () => {
    const reason = lostReason === 'Other' ? (lostCustom.trim() || 'Other') : lostReason;
    updateInquiry(inq.id, { status: 'Lost', lostReason: reason });
    setLostOpen(false);
  };

  const switchVehicle = (vid: string) => {
    const v = vehicles.find((x) => x.id === vid);
    if (!v) return;
    patchInquiry(inq.id, { vehicleId: v.id, requestedVehicle: `${v.brand} ${v.model}${v.vehicleNumber ? ` (${v.vehicleNumber})` : ''}`, checklist: { ...checklist, available: false } });
    toast.success('Vehicle changed', `${v.brand} ${v.model} is now the requested vehicle.`);
  };

  const card = 'rounded-xl bg-navy-50/60 p-3';

  return (
    <div className="pb-24 lg:pb-0">
      {/* ── Header ── */}
      <div className="card !p-4 md:!p-5 mb-4 lg:sticky lg:top-3 z-20">
        <Link to="/inquiries" className="text-xs font-semibold text-navy-400 hover:text-navy-700 inline-flex items-center gap-1 mb-2"><ArrowLeft size={13} /> Inquiries</Link>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-extrabold text-navy-800 truncate">{inq.customerName}</h1>
              <StatusBadge status={inq.status} />
              {req.reference && <span className="text-[11px] font-mono font-bold bg-navy-50 border border-navy-100 rounded-md px-2 py-0.5">{req.reference}</span>}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              {pending && <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${TEMP[temp.level].cls}`} title={temp.reason}><TempIcon size={12} />{temp.level}</span>}
              {pending && stage.stage !== 'New' && <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${stage.stage === 'Follow-up due' ? 'bg-amber-100 text-amber-800' : 'bg-navy-50 text-navy-600'}`}>{stage.stage}{stage.due ? ` · ${prettyDate(stage.due)}` : ''}</span>}
              {resp.contacted ? (
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${resp.late ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}><Timer size={12} />First reply in {resp.time}</span>
              ) : pending && (
                <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${resp.late ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-amber-50 text-amber-700'}`}><Timer size={12} />{resp.late ? '⚠ ' : ''}{resp.time} since request — not contacted</span>
              )}
              <span className="text-[11px] text-navy-400">Received {prettyDate(inq.createdAt)} · {inq.referral || 'Direct'}</span>
            </div>
          </div>
          {pending && (
            <div className="flex gap-2 w-full sm:w-auto">
              <button onClick={convert} className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${ready ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-[0_6px_16px_rgba(5,150,105,.3)]' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                <CheckCircle2 size={16} /> Convert to booking
              </button>
              <button onClick={() => { setLostReason(LOST_REASONS[0]); setLostCustom(''); setLostOpen(true); }} className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100">
                <XCircle size={16} /> Lost
              </button>
            </div>
          )}
        </div>
        {inq.status === 'Lost' && inq.lostReason && <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2 flex items-center gap-2"><AlertTriangle size={14} /> Lost: {inq.lostReason}</p>}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 items-start">
        {/* ── Left: customer & request ── */}
        <div className="space-y-4">
          <Section icon={Phone} title="Contact customer">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <a href={`tel:+${intlDigits(inq.customerPhone)}`} onClick={() => setChannel('Call')} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-navy-700 text-white hover:bg-navy-600"><Phone size={15} /> Call</a>
              <button type="button" onClick={() => openWa(tpl[0].text)} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"><MessageCircle size={15} /> WhatsApp</button>
              {email ? (
                <a href={`mailto:${email}?subject=${encodeURIComponent(`Your ${req.reference ? `booking request ${req.reference}` : 'inquiry'} — Ceylon Rent A Cars`)}&body=${encodeURIComponent(tpl[0].text.replace(/\*/g, ''))}`} onClick={() => setChannel('Email')}
                   className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700 hover:bg-navy-50"><Mail size={15} /> Email</a>
              ) : <span className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm bg-navy-50 text-navy-300"><Mail size={15} /> No email</span>}
              <button type="button" onClick={() => copy(inq.customerPhone, 'Phone number')} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700 hover:bg-navy-50 truncate"><Copy size={15} /> {inq.customerPhone}</button>
            </div>
            <p className="text-[11px] text-navy-400 mb-1.5">Quick WhatsApp replies</p>
            <div className="flex flex-wrap gap-1.5">
              {tpl.map((t) => (
                <button key={t.id} type="button" onClick={() => openWa(t.text)} title="Opens WhatsApp with this message"
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-navy-100 bg-white text-navy-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">
                  {t.label}
                </button>
              ))}
            </div>
          </Section>

          {flags.length > 0 && (
            <section className="rounded-xl2 border border-amber-200 bg-amber-50 p-4 space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-amber-800"><AlertTriangle size={16} /> Double-check with the customer</h2>
              {flags.map((f, i) => (
                <p key={i} className={`text-sm flex gap-2 ${f.level === 'warn' ? 'text-amber-800' : 'text-navy-600'}`}>
                  {f.level === 'warn' ? <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> : <Info size={14} className="mt-0.5 flex-shrink-0" />}{f.text}
                </p>
              ))}
            </section>
          )}

          <Section icon={ClipboardCheck} title="Request">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className={card}><p className="text-[11px] text-navy-400">Vehicle</p><p className="text-sm font-semibold text-navy-800">{inq.requestedVehicle}</p></div>
              <div className={card}><p className="text-[11px] text-navy-400">Type</p><p className="text-sm font-semibold text-navy-800">{req.fields.Type ?? '—'}</p></div>
              <div className={card}><p className="text-[11px] text-navy-400">Dates</p><p className="text-sm font-semibold text-navy-800">{inq.startDate ? `${prettyDate(inq.startDate)} – ${prettyDate(inq.endDate)}` : '—'}</p></div>
              <div className={card}><p className="text-[11px] text-navy-400">Length & estimate</p><p className="text-sm font-semibold text-navy-800">{dayCount ? `${dayCount} ${dayCount === '1' ? 'day' : 'days'}` : `${days} days`}{estimateNum ? ` · ${rs(estimateNum)}` : ''}</p></div>
            </div>
            <div className="space-y-2 text-sm">
              {(['Pickup', 'Return'] as const).map((k) => req.fields[k] && (
                <p key={k} className="flex gap-2 text-navy-700">
                  <MapPin size={15} className="mt-0.5 text-brand-500 flex-shrink-0" />
                  <span><b>{k}:</b> {placeIn(req.fields[k])}
                    {timeIn(req.fields[k]) && <span className="text-navy-400"> · {req.fields[k]!.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''} {(() => { const t = timeIn(req.fields[k])!; return `${((t[0] + 11) % 12) + 1}:${pad2(t[1])} ${t[0] >= 12 ? 'PM' : 'AM'}`; })()}</span>}
                    {mapIn(req.fields[k]) && <> · <a href={mapIn(req.fields[k])} target="_blank" rel="noreferrer" className="text-brand-500 font-semibold hover:underline">Open map</a></>}
                  </span>
                </p>
              ))}
              {(email || req.fields.Country) && <p className="flex gap-2 text-navy-700"><Globe size={15} className="mt-0.5 text-navy-400 flex-shrink-0" />{[email, req.fields.Country].filter(Boolean).join(' · ')}</p>}
              {req.fields.Message && <p className="text-navy-700 bg-white rounded-lg p-3 border border-navy-100">“{req.fields.Message}”</p>}
              {!req.reference && inq.notes && <p className="text-navy-600 whitespace-pre-line">{inq.notes}</p>}
            </div>
          </Section>

          <Section icon={History} title="Customer history">
            {history.bookings.length === 0 ? (
              <p className="text-sm text-navy-500 flex items-center gap-2"><User size={15} className="text-navy-300" /> New customer — no previous bookings.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-emerald-700 flex items-center gap-2"><Repeat size={15} /> Returning customer: {history.completed} previous {history.completed === 1 ? 'rental' : 'rentals'}{history.spent ? ` · ${rs(history.spent)} spent` : ''}</p>
                {history.outstanding > 0 && <p className="text-sm font-semibold text-red-700 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle size={14} /> Unpaid balance: {rs(history.outstanding)}</p>}
                {history.deductions.map((b) => (
                  <p key={b.id} className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Deposit deduction {rs(b.depositDeduction ?? 0)} on {prettyDate(b.startDate)}{b.depositNotes ? ` — ${b.depositNotes}` : ''}</p>
                ))}
                <ul className="divide-y divide-navy-50 text-sm">
                  {history.bookings.slice(0, 5).map((b) => {
                    const v = vehicles.find((x) => x.id === b.vehicleId);
                    return (
                      <li key={b.id} className="py-2 flex items-center justify-between gap-2">
                        <span className="text-navy-700 truncate">{v ? `${v.brand} ${v.model}` : 'Vehicle'} · {prettyDate(b.startDate)}</span>
                        <StatusBadge status={b.status} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Section>

          <Section icon={Car} title="Availability & alternatives">
            {alt.requestedFree === null ? (
              <p className="text-sm text-navy-500">Can't check — the requested vehicle or dates aren't set.</p>
            ) : alt.requestedFree ? (
              <p className="text-sm font-semibold text-emerald-700 flex items-center gap-2"><CheckCircle2 size={15} /> {alt.requested ? `${alt.requested.brand} ${alt.requested.model}` : 'Requested vehicle'} is free for these dates.</p>
            ) : (
              <p className="text-sm font-semibold text-red-700 flex items-center gap-2"><XCircle size={15} /> {alt.requested ? `${alt.requested.brand} ${alt.requested.model}` : 'Requested vehicle'} is already booked — offer an alternative.</p>
            )}
            {alt.list.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-navy-400">Similar vehicles free for these dates</p>
                {alt.list.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 rounded-xl border border-navy-100 p-2">
                    <div className="w-14 h-10 rounded-lg bg-navy-50 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {v.imageUrl ? <img src={v.imageUrl} alt="" className="w-full h-full object-contain" /> : <Car size={16} className="text-navy-300" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-navy-800 truncate">{v.brand} {v.model} <span className="text-navy-400 font-normal">{v.year}</span></p>
                      <p className="text-[11px] text-navy-400">{v.seats ?? '-'} seats · {v.transmission ?? '—'} · {rs(v.dailyRent)}/day</p>
                    </div>
                    <button type="button" onClick={() => switchVehicle(v.id)} className="text-xs font-semibold text-brand-500 hover:underline flex-shrink-0">Use this</button>
                  </div>
                ))}
                <button type="button" onClick={() => openWa(tpl.find((t) => t.id === 'alternatives')!.text)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
                  <MessageCircle size={13} /> Offer these on WhatsApp
                </button>
              </div>
            )}
          </Section>
        </div>

        {/* ── Right: qualify, quote, log ── */}
        <div className="space-y-4">
          <Section icon={ClipboardCheck} title="Can we serve this booking?"
                   right={<span className={`text-xs font-bold px-2 py-1 rounded-full ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-navy-50 text-navy-500'}`}>{done}/{CHECKLIST.length}</span>}>
            <div className="h-1.5 rounded-full bg-navy-50 overflow-hidden mb-3">
              <div className={`h-full rounded-full transition-all duration-500 ${ready ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${(done / CHECKLIST.length) * 100}%` }} />
            </div>
            <ul className="space-y-1.5">
              {CHECKLIST.map((c) => {
                const on = !!checklist[c.id];
                // live hints from the data
                const hint =
                  c.id === 'available' && alt.requestedFree !== null ? (alt.requestedFree ? '✓ Calendar shows it free' : '✗ Calendar shows it booked') :
                  c.id === 'fits' && alt.requested?.seats ? `${alt.requested.seats} seats` :
                  c.id === 'price' && inq.quote ? `Quote ${rs(inq.quote.total)} — ${inq.quote.status}` :
                  c.id === 'licence' && req.fields.Type && req.fields.Type !== 'Self drive' ? 'Not needed — driver included' : c.hint;
                return (
                  <li key={c.id}>
                    <button type="button" disabled={!pending} onClick={() => tickItem(c.id, !on)}
                            className={`w-full flex items-start gap-3 text-left rounded-xl px-3 py-2.5 border transition-colors ${on ? 'border-emerald-200 bg-emerald-50' : 'border-navy-100 hover:bg-navy-50'}`}>
                      {on ? <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" /> : <Circle size={18} className="text-navy-300 flex-shrink-0 mt-0.5" />}
                      <span className="min-w-0">
                        <span className={`block text-sm font-semibold ${on ? 'text-emerald-800' : 'text-navy-800'}`}>{c.label}</span>
                        <span className="block text-[11px] text-navy-400">{hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {ready && pending && (
              <button onClick={convert} className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700">
                All checks done — Convert to booking <ArrowRight size={15} />
              </button>
            )}
          </Section>

          <Section icon={Receipt} title="Quote">
            <InquiryQuoteBuilder
              inquiry={inq}
              staff={staff}
              defaultRate={alt.requested ? (alt.requested.webPrice ?? alt.requested.dailyRent) : (estimateNum ? Math.round(estimateNum / days) : 0)}
              defaultDays={days}
              onSave={saveQuote}
              onSent={quoteSent}
            />
          </Section>

          <Section icon={MessagesSquare} title="Contact log">
            <ContactLog
              inquiryId={inq.id}
              followUps={followUps}
              available={logReady}
              presetChannel={channel}
              onAdded={logAdded}
              onDeleted={(fid) => setFollowUps((l) => l.filter((x) => x.id !== fid))}
            />
          </Section>
        </div>
      </div>

      {/* Phones: key actions stay in reach */}
      {pending && (
        <div className="lg:hidden fixed left-3 right-3 bottom-[84px] md:bottom-4 z-30 flex gap-2 p-2 rounded-2xl bg-white/95 backdrop-blur border border-navy-100 shadow-card-hover">
          <a href={`tel:+${intlDigits(inq.customerPhone)}`} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold bg-navy-700 text-white"><Phone size={15} /> Call</a>
          <button type="button" onClick={() => openWa(tpl[0].text)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white"><MessageCircle size={15} /> WhatsApp</button>
          <button type="button" onClick={convert} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold ${ready ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}><CalendarDays size={15} /> Convert</button>
        </div>
      )}

      <Modal open={lostOpen} onClose={() => setLostOpen(false)} title="Mark as Lost">
        <div className="space-y-4">
          <p className="text-sm text-navy-600">Why was <span className="font-semibold text-navy-800">{inq.customerName}</span>'s inquiry lost?</p>
          <div>
            <p className="label">Reason *</p>
            <Select value={lostReason} onChange={(v) => { setLostReason(v); if (v !== 'Other') setLostCustom(''); }} options={LOST_REASONS.map((r) => ({ value: r, label: r }))} />
          </div>
          {lostReason === 'Other' && (
            <div>
              <p className="label">Custom reason</p>
              <input className="input" value={lostCustom} onChange={(e) => setLostCustom(e.target.value)} placeholder="Describe why this inquiry was lost…" autoFocus />
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setLostOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={confirmLost} disabled={lostReason === 'Other' && !lostCustom.trim()}
                    className="px-5 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Confirm lost</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
