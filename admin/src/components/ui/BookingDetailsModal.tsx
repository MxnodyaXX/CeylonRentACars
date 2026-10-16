import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, CalendarPlus, Camera, CheckCircle, ClipboardList, Copy, CreditCard, ExternalLink, FileSignature,
  FileText, History, Loader2, MessageCircle, Pencil, Phone, PlayCircle, Plus, Printer, ShieldCheck, Star, Trash2, Upload, Wallet, XCircle,
} from 'lucide-react';
import Modal from './Modal';
import VehicleImage from './VehicleImage';
import { vehicleBodyColor } from './CarSVG';
import HandoverModal from './HandoverModal';
import ExtendRentalModal from './ExtendRentalModal';
import SwapVehicleModal from './SwapVehicleModal';
import ExchangeVehicleModal from './ExchangeVehicleModal';
import { earlierKm, legsOf, mainCommission } from '../../lib/exchange';
import { bookingTiming, StatusPill } from './BookingCard';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import {
  CHECK_ITEMS, missingInfo, parseChanges, bookingNo, deleteBookingFile, depositHeld, fileUrl, historyOf, ledgerOf, plainNotes, priceBreakdown, rs, uploadBookingFile, newId,
} from '../../lib/bookingRecord';
import { durationLabel, UNIT, RentalType } from '../../lib/rentalPeriod';
import { bookingBill, bookingDue } from '../../lib/credit';
import { buildBookingWhatsAppMsg, openWhatsApp } from '../../lib/whatsapp';
import { printBookingConfirmation } from '../../lib/printReceipt';
import { DEFAULT_POLICIES, printRentalAgreement } from '../../lib/printAgreement';
import { feedbackMessage, linkFor } from '../../pages/Feedback';
import type {
  ActivityEntry, Booking, BookingDocument, ChargeKind, CustomerInfo, DocumentKind, HandoverChecklist, PaymentKind, RentalAgreement,
} from '../../types';

type Tab = 'overview' | 'payments' | 'vehicle' | 'documents' | 'history';
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'vehicle', label: 'Vehicle & handover', icon: ShieldCheck },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'history', label: 'History', icon: History },
];
const PAYMENT_KINDS: PaymentKind[] = ['Payment', 'Advance', 'Refund', 'Deposit received', 'Deposit returned'];
const METHODS = ['Cash', 'Bank transfer', 'Card', 'Online'];
const CHARGE_KINDS: ChargeKind[] = ['Traffic fine', 'Toll', 'Parking', 'Damage', 'Fuel', 'Late return', 'Cleaning', 'Other'];
const DOC_KINDS: DocumentKind[] = ['Driving licence', 'NIC / Passport', 'Signed agreement', 'Proof of address', 'Payment proof', 'Damage photo', 'Other'];

const fmtDate = (d?: string) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtTime = (t?: string) => {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- small pieces ---------- */

function Card({ title, icon: Icon, action, children, className = '' }: { title: string; icon?: typeof FileText; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-navy-100 bg-white p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-navy-500 flex items-center gap-1.5">{Icon && <Icon size={13} />}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function KV({ k, v, warn }: { k: string; v?: ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-navy-400 flex-shrink-0">{k}</span>
      <span className={`text-right font-medium min-w-0 break-words ${warn ? 'text-red-600' : 'text-navy-800'}`}>{v || v === 0 ? v : '—'}</span>
    </div>
  );
}
const smallBtn = 'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors';

/** A stored photo (private bucket) — loads a short-lived link */
function StoredImage({ path, className = '' }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { let on = true; fileUrl(path).then((u) => on && setUrl(u)).catch(() => undefined); return () => { on = false; }; }, [path]);
  return url
    ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className={`object-cover rounded-lg bg-navy-50 ${className}`} /></a>
    : <div className={`rounded-lg bg-navy-50 flex items-center justify-center ${className}`}><Loader2 size={14} className="animate-spin text-navy-300" /></div>;
}

/* =====================================================================
   Booking details
   ===================================================================== */

export default function BookingDetailsModal({ bookingId, onClose, onEdit, onCancel }: {
  bookingId: string;
  onClose: () => void;
  onEdit: (b: Booking) => void;
  onCancel: (b: Booking) => void;
}) {
  const store = useStore();
  const { bookings, vehicles, owners, drivers, customers, commissions, handovers } = store;
  const { currentUser, isAdmin } = useAuthStore();
  const by = currentUser?.name ?? 'Staff';
  const b = bookings.find((x) => x.id === bookingId);
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<null | 'pickup' | 'return' | 'extend' | 'swap' | 'exchange'>(null);

  if (!b) return null;
  const vehicle = vehicles.find((v) => v.id === b.vehicleId);
  const owner = owners.find((o) => o.id === vehicle?.ownerId);
  const driver = drivers.find((d) => d.id === b.driverId);
  const customer = customers.find((c) => c.phone === b.customerPhone);
  const others = bookings.filter((x) => x.id !== b.id && x.customerPhone === b.customerPhone);
  const othersDue = others.filter((x) => x.status !== 'Cancelled').reduce((s, x) => s + bookingDue(x), 0);
  const price = priceBreakdown(b, vehicle);
  const no = bookingNo(b);

  const sendWhatsApp = (text: string, what: string) => {
    openWhatsApp(b.customerPhone, text);
    store.logBookingActivity(b.id, { by, type: 'Message', text: `WhatsApp: ${what}` });
  };
  const copyNo = () => navigator.clipboard?.writeText(no).then(() => toast.success('Copied', no)).catch(() => undefined);

  return (
    <>
      <Modal open onClose={onClose} title="Booking details" width="max-w-4xl">
        <div className="space-y-4 -mt-1">
          {/* ── Header ── */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={copyNo} className="font-mono text-sm font-bold text-navy-800 hover:text-navy-600 inline-flex items-center gap-1" title="Copy booking number">
                  {no} <Copy size={12} className="text-navy-300" />
                </button>
                <StatusPill status={b.status} />
                {b.rentalType && b.rentalType !== 'Daily' && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">{b.rentalType}</span>}
                {b.insertedByAdmin && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Owner entry</span>}
              </div>
              <p className="text-xl font-bold text-navy-900 mt-1">{b.customerName}</p>
              <p className="text-xs text-navy-400">Created {fmtDateTime(b.createdAt)} · {b.referral || 'Direct'}</p>
            </div>
            <div className="flex gap-1.5">
              <a href={`tel:${b.customerPhone}`} className={`${smallBtn} bg-navy-50 text-navy-700 hover:bg-navy-100`}><Phone size={12} /> {b.customerPhone}</a>
              <button type="button" onClick={() => sendWhatsApp(buildBookingWhatsAppMsg(b, vehicle), 'booking details')} className={`${smallBtn} bg-emerald-500 text-white hover:bg-emerald-600`}><MessageCircle size={12} /> WhatsApp</button>
            </div>
          </div>

          {customer?.doNotRent && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span><b>Do not rent:</b> this customer is flagged{customer.doNotRentReason ? ` — ${customer.doNotRentReason}` : ''}.</span>
            </p>
          )}
          {(() => {
            const miss = missingInfo(b);
            if (!miss.length) return null;
            const critical = miss.some((i) => i.critical);
            return (
              <div className={`rounded-xl border px-3 py-2.5 ${critical ? 'border-red-200 bg-red-50/70' : 'border-amber-200 bg-amber-50/70'}`}>
                <p className={`text-xs font-bold flex items-center gap-1.5 mb-1.5 ${critical ? 'text-red-700' : 'text-amber-800'}`}>
                  <AlertTriangle size={13} /> To complete ({miss.length}){critical && b.status === 'Confirmed' ? ' — needed before handing over the vehicle' : ''}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {miss.map((i) => (
                    <button key={i.label} type="button" onClick={() => (i.tab === 'edit' ? (isAdmin() ? onEdit(b) : setTab('overview')) : setTab(i.tab))}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${i.critical ? 'bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100' : 'bg-white text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100'}`}>
                      {i.label} →
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          {others.length > 0 && (
            <p className="text-xs text-navy-500 bg-navy-50/70 rounded-xl px-3 py-2">
              Returning customer · {others.length} other booking{others.length === 1 ? '' : 's'} · Rs {others.filter((x) => x.status !== 'Cancelled').reduce((s, x) => s + bookingBill(x), 0).toLocaleString()} billed
              {othersDue > 0 && <span className="text-red-600 font-semibold"> · Rs {othersDue.toLocaleString()} still due on other bookings</span>}
            </p>
          )}

          {/* ── Tabs ── */}
          <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-navy-100 -mx-1 px-1">
            {TABS.map(({ id, label, icon: I }) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === id ? 'border-navy-800 text-navy-900' : 'border-transparent text-navy-400 hover:text-navy-700'}`}>
                <I size={14} /> {label}
              </button>
            ))}
          </div>

          <div className="min-h-[320px]">
            {tab === 'overview' && <Overview b={b} vehicleName={vehicle ? `${vehicle.brand} ${vehicle.model}` : '—'} by={by} price={price}
              extra={{ vehicle, owner, driver }} />}
            {tab === 'payments' && <Payments b={b} by={by} price={price} commissionPayout={b.exchanges?.length ? legsOf(b).reduce((sum, l) => sum + l.payout, 0) : mainCommission(commissions, b)?.ownerPayout} includedKm={(vehicle?.includedKmPerDay ?? 100) * (b.totalDays || 1)} extraKmRate={vehicle?.extraKmRate ?? 50} />}
            {tab === 'vehicle' && <VehicleTab b={b} vehicle={vehicle} legacy={handovers.filter((h) => h.bookingId === b.id)} onPickup={() => setDialog('pickup')} onReturn={() => setDialog('return')} />}
            {tab === 'documents' && <Documents b={b} by={by} canDelete={isAdmin()} onPrintAgreement={() => {
              printRentalAgreement(b, vehicle, by);
              store.logBookingActivity(b.id, { by, type: 'Agreement', text: 'Rental agreement printed' }, { agreement: { ...(b.agreement ?? {}), printedAt: new Date().toISOString() } });
            }} />}
            {tab === 'history' && <HistoryTab b={b} by={by} legacy={handovers.filter((h) => h.bookingId === b.id)} />}
          </div>

          {/* ── Actions (change with the status) ── */}
          <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-3 bg-white/95 backdrop-blur border-t border-navy-100 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => printBookingConfirmation(b, vehicle, driver)} className={`${smallBtn} bg-navy-50 text-navy-700 hover:bg-navy-100`}><Printer size={13} /> Receipt</button>
            <button type="button" onClick={() => { setTab('documents'); }} className={`${smallBtn} bg-navy-50 text-navy-700 hover:bg-navy-100`}><FileSignature size={13} /> Agreement</button>
            <button type="button" onClick={() => setTab('payments')} className={`${smallBtn} bg-navy-50 text-navy-700 hover:bg-navy-100`}><CreditCard size={13} /> Record payment</button>
            {isAdmin() && <button type="button" onClick={() => onEdit(b)} className={`${smallBtn} bg-amber-100 text-amber-800 hover:bg-amber-200`}><Pencil size={13} /> Edit</button>}
            <span className="flex-1" />
            {b.status === 'Confirmed' && (
              <button type="button" onClick={() => setDialog('swap')} className={`${smallBtn} bg-navy-50 text-navy-700 hover:bg-navy-100`}><ArrowLeftRight size={13} /> Swap vehicle</button>
            )}
            {b.status === 'Ongoing' && (
              <button type="button" onClick={() => setDialog('exchange')} className={`${smallBtn} bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200`}><ArrowLeftRight size={13} /> Exchange vehicle</button>
            )}
            {b.status === 'Ongoing' && (
              <button type="button" onClick={() => setDialog('extend')} className={`${smallBtn} bg-navy-50 text-navy-700 hover:bg-navy-100`}><CalendarPlus size={13} /> Extend</button>
            )}
            {b.status === 'Confirmed' && (
              <>
                <button type="button" onClick={() => onCancel(b)} className={`${smallBtn} text-red-600 hover:bg-red-50 border border-red-200`}><XCircle size={13} /> Cancel</button>
                <button type="button" onClick={() => setDialog('pickup')} className="inline-flex items-center gap-1.5 rounded-xl bg-navy-800 hover:bg-navy-700 px-4 py-2 text-sm font-semibold text-white"><PlayCircle size={15} /> Start rental</button>
              </>
            )}
            {b.status === 'Ongoing' && (
              <button type="button" onClick={() => setDialog('return')} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><CheckCircle size={15} /> Complete rental</button>
            )}
            {b.status === 'Completed' && (
              <button type="button" onClick={() => sendWhatsApp(feedbackMessage(b.customerName.trim().split(' ')[0], vehicle ? `${vehicle.brand} ${vehicle.model}` : 'your vehicle', b.startDate, b.endDate, linkFor(b.vehicleId, b.customerName)), 'review request')}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-navy-800 hover:bg-navy-700 px-4 py-2 text-sm font-semibold text-white"><Star size={15} /> Ask for a review</button>
            )}
          </div>
        </div>
      </Modal>

      {(dialog === 'pickup' || dialog === 'return') && <HandoverModal booking={b} kind={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'extend' && <ExtendRentalModal booking={b} onClose={() => setDialog(null)} />}
      {dialog === 'swap' && <SwapVehicleModal booking={b} onClose={() => setDialog(null)} />}
      {dialog === 'exchange' && <ExchangeVehicleModal booking={b} onClose={() => setDialog(null)} />}
    </>
  );
}

/* =====================================================================
   Overview
   ===================================================================== */

function Overview({ b, by, price, extra }: {
  b: Booking; vehicleName: string; by: string; price: ReturnType<typeof priceBreakdown>;
  extra: { vehicle?: import('../../types').Vehicle; owner?: import('../../types').Owner; driver?: import('../../types').Driver };
}) {
  const { logBookingActivity, vehicles: allVehicles } = useStore();
  const { vehicle, owner, driver } = extra;
  const t = bookingTiming(b);
  const type = (b.rentalType ?? 'Daily') as RentalType;
  const ci = b.customerInfo ?? {};
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CustomerInfo & { nic: string; email: string }>({ ...ci, nic: b.customerNIC ?? '', email: b.customerEmail ?? '' });
  const [internal, setInternal] = useState(b.internalNotes ?? '');
  const licenceExpired = ci.licenceExpiry && ci.licenceExpiry < b.endDate;

  const saveCustomer = () => {
    const { nic, email, ...info } = form;
    const clean = Object.fromEntries(Object.entries(info).filter(([, v]) => v !== '' && v !== undefined)) as CustomerInfo;
    logBookingActivity(b.id, { by, type: 'Edited', text: 'Customer details updated' }, { customerInfo: clean, customerNIC: nic.trim() || undefined, customerEmail: email.trim() || undefined });
    setEditing(false);
    toast.success('Customer details saved', '');
  };
  const f = (k: keyof typeof form) => ({ value: (form[k] as string) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((x) => ({ ...x, [k]: e.target.value })) });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card title="Rental" icon={ClipboardList}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-16 h-11 rounded-lg overflow-hidden bg-navy-50 flex-shrink-0">
            <VehicleImage brand={vehicle?.brand ?? ''} model={vehicle?.model ?? ''} color={vehicle?.color} imageUrl={vehicle?.imageUrl} bodyColor={vehicleBodyColor(vehicle?.color)} className="w-full h-full" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-navy-900 truncate">{vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Vehicle removed'}</p>
            <span className="font-mono text-[11px] text-navy-500 bg-navy-50 rounded px-1.5 py-0.5">{vehicle?.vehicleNumber ?? '—'}</span>
          </div>
        </div>
        <KV k="Owner" v={owner ? `${owner.name} · ${owner.phone}` : undefined} />
        <KV k="Driver" v={driver ? `${driver.name} · ${driver.phone}` : 'Self drive'} />
        <KV k="Pickup" v={<>{fmtDate(b.startDate)} {fmtTime(b.startTime)}<br /><span className="text-navy-400 font-normal">{b.pickupLocation || 'Location not set'}</span></>} />
        <KV k="Return" v={<>{fmtDate(b.endDate)} {fmtTime(b.endTime)}<br /><span className="text-navy-400 font-normal">{b.dropLocation || b.pickupLocation || 'Location not set'}</span></>} />
        <KV k="Length" v={`${durationLabel(b)}${type !== 'Daily' && b.unitRate ? ` × ${rs(b.unitRate)} ${UNIT[type].rate}` : ''}`} />
        {(b.checklists?.pickup || b.checklists?.return) && (() => {
          // after a mid-trip exchange the booking's pickup is the replacement's — the trip began with the first car
          const out = b.exchanges?.[0]?.pickup ?? b.checklists?.pickup;
          return <KV k="Actual" v={`${out ? `out ${fmtDateTime(out.at)}` : ''}${b.checklists?.return ? ` · back ${fmtDateTime(b.checklists.return.at)}` : ''}`} />;
        })()}
        {!!b.exchanges?.length && (
          <KV k="Exchanged" v={<span className="text-amber-700">{b.exchanges.map((e) => {
            const v = allVehicles.find((x) => x.id === e.fromVehicleId);
            return `from ${v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : 'previous car'} on ${fmtDateTime(e.at)}`;
          }).join('; ')}</span>} />
        )}
        <p className={`text-xs font-semibold mt-2 ${t.tone === 'warn' ? 'text-red-600' : t.tone === 'live' ? 'text-emerald-700' : t.tone === 'soon' ? 'text-sky-700' : 'text-navy-400'}`}>{t.text}</p>
      </Card>

      <Card title="Price" icon={Wallet}>
        <div className="space-y-1">
          {price.lines.map((l) => (
            <p key={l.label} className="flex justify-between gap-3 text-sm">
              <span className="text-navy-500">{l.label}</span>
              <span className={`font-medium ${l.tone === 'minus' ? 'text-emerald-700' : 'text-navy-800'}`}>{l.amount < 0 ? '−' : ''}{rs(Math.abs(l.amount))}</span>
            </p>
          ))}
          <p className="flex justify-between text-sm font-bold border-t border-navy-100 pt-1.5 mt-1.5"><span>Bill</span><span>{rs(price.bill)}</span></p>
          <p className="flex justify-between text-sm"><span className="text-navy-500">Paid (incl. advance)</span><span className="font-medium text-emerald-700">{rs(price.paid)}</span></p>
          <p className={`flex justify-between text-sm font-bold ${price.due > 0 ? 'text-red-600' : 'text-emerald-700'}`}><span>Balance due</span><span>{price.due > 0 ? rs(price.due) : 'Paid in full'}</span></p>
          {(b.creditAmount ?? 0) > 0 && <KV k={`Credit due (${b.creditResponsibility ?? '—'})`} v={b.creditSettled ? 'Settled' : rs(b.creditAmount ?? 0)} warn={!b.creditSettled} />}
          {b.depositType && <KV k={`Deposit (${b.depositType})`} v={b.depositType === 'cash' ? `${rs(depositHeld(b))} held` : b.depositAssetDescription} />}
        </div>
      </Card>

      <Card title="Customer" icon={FileText} action={!editing && <button type="button" onClick={() => setEditing(true)} className={`${smallBtn} bg-navy-50 text-navy-700 hover:bg-navy-100`}><Pencil size={11} /> Edit</button>}>
        {editing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className="input !py-1.5 text-sm" placeholder="NIC" {...f('nic')} />
              <input className="input !py-1.5 text-sm" placeholder="Email" {...f('email')} />
              <input className="input !py-1.5 text-sm" placeholder="Passport no." {...f('passportNumber')} />
              <input className="input !py-1.5 text-sm" placeholder="Nationality" {...f('nationality')} />
              <input className="input !py-1.5 text-sm" placeholder="Licence number" {...f('licenceNumber')} />
              <label className="text-[11px] text-navy-400">Licence expiry<input type="date" className="input !py-1.5 text-sm mt-0.5" {...f('licenceExpiry')} /></label>
              <select className="input !py-1.5 text-sm" value={form.licenceType ?? ''} onChange={(e) => setForm((x) => ({ ...x, licenceType: (e.target.value || undefined) as CustomerInfo['licenceType'] }))}>
                <option value="">Licence type…</option><option>Sri Lankan</option><option>Foreign</option>
              </select>
              {form.licenceType === 'Foreign' && (
                <label className="flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" checked={!!form.idp} onChange={(e) => setForm((x) => ({ ...x, idp: e.target.checked }))} /> Has IDP</label>
              )}
            </div>
            <input className="input !py-1.5 text-sm" placeholder="Address" {...f('address')} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input !py-1.5 text-sm" placeholder="Emergency contact name" {...f('emergencyName')} />
              <input className="input !py-1.5 text-sm" placeholder="Emergency phone" {...f('emergencyPhone')} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className={`${smallBtn} bg-navy-50 text-navy-600`}>Cancel</button>
              <button type="button" onClick={saveCustomer} className={`${smallBtn} bg-navy-800 text-white`}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <KV k="NIC" v={b.customerNIC} />
            <KV k="Passport" v={ci.passportNumber} />
            <KV k="Email" v={b.customerEmail} />
            <KV k="Nationality" v={ci.nationality} />
            <KV k="Licence" v={[ci.licenceNumber, ci.licenceType].filter(Boolean).join(' · ') || undefined} />
            <KV k="Licence expiry" v={ci.licenceExpiry ? `${fmtDate(ci.licenceExpiry)}${licenceExpired ? ' — expires before the return!' : ''}` : undefined} warn={!!licenceExpired} />
            {ci.licenceType === 'Foreign' && <KV k="IDP" v={ci.idp ? 'Yes' : 'Not provided'} warn={!ci.idp} />}
            <KV k="Address" v={ci.address} />
            <KV k="Emergency" v={[ci.emergencyName, ci.emergencyPhone].filter(Boolean).join(' · ') || undefined} />
            {!ci.licenceNumber && !b.driverId && <p className="text-[11px] text-amber-700 mt-1">Self drive — add the driving licence before handing over the vehicle.</p>}
          </>
        )}
      </Card>

      <Card title="Notes" icon={FileText}>
        <p className="text-[11px] font-semibold text-navy-400 mb-1">Booking notes</p>
        <p className="text-sm text-navy-700 whitespace-pre-wrap">{plainNotes(b.notes) || <span className="text-navy-300">No notes</span>}</p>
        <p className="text-[11px] font-semibold text-navy-400 mt-3 mb-1">Internal notes (staff only)</p>
        <textarea className="input min-h-[70px] text-sm" value={internal} onChange={(e) => setInternal(e.target.value)} placeholder="Only staff can see this" />
        {internal !== (b.internalNotes ?? '') && (
          <div className="flex justify-end mt-1.5">
            <button type="button" className={`${smallBtn} bg-navy-800 text-white`} onClick={() => {
              logBookingActivity(b.id, { by, type: 'Note', text: 'Internal notes updated' }, { internalNotes: internal.trim() || undefined });
              toast.success('Internal notes saved', '');
            }}>Save notes</button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* =====================================================================
   Payments
   ===================================================================== */

function Payments({ b, by, price, commissionPayout, includedKm, extraKmRate }: {
  b: Booking; by: string; price: ReturnType<typeof priceBreakdown>; commissionPayout?: number; includedKm: number; extraKmRate: number;
}) {
  const { recordPayment, settleDeposit, addCharge, waiveCharge } = useStore();
  const ledger = ledgerOf(b);
  const held = depositHeld(b);
  const [pay, setPay] = useState({ kind: 'Payment' as PaymentKind, amount: price.due || 0, method: 'Cash', receiptNo: '', note: '' });
  const [dep, setDep] = useState({ returned: held, deduction: 0, method: 'Cash', notes: '' });
  const [charge, setCharge] = useState({ kind: 'Traffic fine' as ChargeKind, amount: 0, date: today(), note: '' });
  const pickupKm = b.checklists?.pickup?.odometer, returnKm = b.checklists?.return?.odometer;
  const extraKm = pickupKm !== undefined && returnKm !== undefined ? Math.max(0, returnKm - pickupKm + earlierKm(b) - includedKm) : 0;
  const extraKmCharged = (b.charges ?? []).some((c) => c.kind === 'Other' && /extra km/i.test(c.note ?? ''));

  const sign = (k: PaymentKind) => (k === 'Refund' || k === 'Deposit returned' ? -1 : 1);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ['Bill', rs(price.bill), 'bg-navy-800 text-white'],
          ['Paid', rs(price.paid), 'bg-emerald-50 text-emerald-800'],
          ['Balance due', price.due > 0 ? rs(price.due) : 'Paid', price.due > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'],
          ['Deposit held', b.depositType === 'cash' ? rs(held) : b.depositType ? b.depositType : '—', 'bg-amber-50 text-amber-800'],
        ].map(([k, v, cls]) => (
          <div key={k} className={`rounded-xl px-3 py-2 ${cls}`}><p className="text-[11px] opacity-70">{k}</p><p className="font-bold">{v}</p></div>
        ))}
      </div>

      <Card title="Payment log" icon={CreditCard}>
        {ledger.length === 0 ? <p className="text-sm text-navy-400">No payments yet.</p> : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-navy-400 text-left"><th className="px-1 py-1 font-medium">Date</th><th className="px-1 font-medium">Type</th><th className="px-1 font-medium">Method</th><th className="px-1 font-medium">Receipt / note</th><th className="px-1 font-medium">By</th><th className="px-1 font-medium text-right">Amount</th></tr></thead>
              <tbody>
                {ledger.map((p) => (
                  <tr key={p.id} className="border-t border-navy-50">
                    <td className="px-1 py-1.5 whitespace-nowrap text-navy-600">{fmtDate(p.at)}</td>
                    <td className="px-1 text-navy-800 font-medium whitespace-nowrap">{p.kind}</td>
                    <td className="px-1 text-navy-600">{p.method}</td>
                    <td className="px-1 text-navy-500 text-xs">{[p.receiptNo, p.note].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-1 text-navy-500 text-xs">{p.by}</td>
                    <td className={`px-1 text-right font-semibold whitespace-nowrap ${sign(p.kind) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{sign(p.kind) < 0 ? '−' : '+'}{rs(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-navy-100 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
          <label className="text-[11px] text-navy-400 col-span-2 sm:col-span-1">Type
            <select className="input !py-1.5 text-sm mt-0.5" value={pay.kind} onChange={(e) => setPay((x) => ({ ...x, kind: e.target.value as PaymentKind, amount: e.target.value === 'Payment' ? price.due : e.target.value === 'Deposit returned' ? held : 0 }))}>
              {PAYMENT_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-navy-400">Amount (Rs)<input className="input !py-1.5 text-sm mt-0.5" type="number" min="0" value={pay.amount || ''} onChange={(e) => setPay((x) => ({ ...x, amount: Math.max(0, Number(e.target.value) || 0) }))} /></label>
          <label className="text-[11px] text-navy-400">Method
            <select className="input !py-1.5 text-sm mt-0.5" value={pay.method} onChange={(e) => setPay((x) => ({ ...x, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="text-[11px] text-navy-400">Receipt no.<input className="input !py-1.5 text-sm mt-0.5" value={pay.receiptNo} onChange={(e) => setPay((x) => ({ ...x, receiptNo: e.target.value }))} /></label>
          <label className="text-[11px] text-navy-400">Note<input className="input !py-1.5 text-sm mt-0.5" value={pay.note} onChange={(e) => setPay((x) => ({ ...x, note: e.target.value }))} /></label>
          <button type="button" disabled={pay.amount <= 0} className="btn-primary !py-2 text-sm inline-flex items-center justify-center gap-1 disabled:opacity-40"
                  onClick={() => { recordPayment(b.id, { kind: pay.kind, amount: pay.amount, method: pay.method, receiptNo: pay.receiptNo.trim() || undefined, note: pay.note.trim() || undefined, by }); setPay((x) => ({ ...x, amount: 0, receiptNo: '', note: '' })); }}>
            <Plus size={14} /> Record
          </button>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Security deposit" icon={ShieldCheck}>
          {!b.depositType ? <p className="text-sm text-navy-400">No deposit recorded. Use the payment form with "Deposit received" to add one.</p> : (
            <>
              <KV k="Type" v={b.depositType === 'cash' ? 'Cash' : b.depositType === 'vehicle' ? 'Vehicle' : 'Other'} />
              {b.depositType === 'cash' ? (
                <>
                  <KV k="Collected" v={rs(b.depositAmount ?? 0)} />
                  <KV k="Returned" v={rs(b.depositReturned ?? 0)} />
                  <KV k="Kept (deducted)" v={rs(b.depositDeduction ?? 0)} />
                  <KV k="Still held" v={rs(held)} warn={held > 0 && b.status === 'Completed'} />
                </>
              ) : <KV k="Held item" v={b.depositAssetDescription} />}
              {b.depositNotes && <p className="text-xs text-navy-500 mt-1">{b.depositNotes}</p>}
              {b.depositType === 'cash' && held > 0 && (
                <div className="mt-3 pt-3 border-t border-navy-100 space-y-2">
                  <p className="text-[11px] font-semibold text-navy-500">Settle the deposit</p>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-[11px] text-navy-400">Return<input className="input !py-1.5 text-sm mt-0.5" type="number" value={dep.returned || ''} onChange={(e) => { const r = Math.min(held, Math.max(0, Number(e.target.value) || 0)); setDep((x) => ({ ...x, returned: r, deduction: held - r })); }} /></label>
                    <label className="text-[11px] text-navy-400">Keep<input className="input !py-1.5 text-sm mt-0.5" type="number" value={dep.deduction || ''} onChange={(e) => { const d = Math.min(held, Math.max(0, Number(e.target.value) || 0)); setDep((x) => ({ ...x, deduction: d, returned: held - d })); }} /></label>
                    <label className="text-[11px] text-navy-400">Method<select className="input !py-1.5 text-sm mt-0.5" value={dep.method} onChange={(e) => setDep((x) => ({ ...x, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
                  </div>
                  <input className="input !py-1.5 text-sm" value={dep.notes} onChange={(e) => setDep((x) => ({ ...x, notes: e.target.value }))} placeholder={dep.deduction ? 'Why is part kept? (required)' : 'Note (optional)'} />
                  <button type="button" disabled={dep.deduction > 0 && !dep.notes.trim()} className={`${smallBtn} bg-navy-800 text-white disabled:opacity-40`}
                          onClick={() => settleDeposit(b.id, { returned: dep.returned, deduction: dep.deduction, method: dep.method, notes: dep.notes.trim() || undefined }, by)}>
                    Settle deposit
                  </button>
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Fines, damage & other charges" icon={AlertTriangle}>
          {(b.charges ?? []).length === 0 ? <p className="text-sm text-navy-400 mb-2">No extra charges.</p> : (
            <ul className="space-y-1 mb-2">
              {(b.charges ?? []).map((c) => (
                <li key={c.id} className={`flex items-center justify-between gap-2 text-sm ${c.status === 'Waived' ? 'text-navy-300 line-through' : 'text-navy-700'}`}>
                  <span className="min-w-0 truncate">{c.kind}{c.note ? ` — ${c.note}` : ''} <span className="text-[11px] text-navy-400 no-underline">{fmtDate(c.date)}</span></span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <b>{rs(c.amount)}</b>
                    {c.status === 'Charged' && <button type="button" onClick={() => waiveCharge(b.id, c.id, by)} className="text-[11px] text-navy-400 hover:text-red-600">Waive</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {extraKm > 0 && !extraKmCharged && (
            <button type="button" onClick={() => addCharge(b.id, { kind: 'Other', amount: extraKm * extraKmRate, date: today(), note: `Extra km: ${extraKm.toLocaleString()} km × Rs ${extraKmRate}`, by })}
                    className="w-full mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-900 text-left">
              Handover shows <b>{extraKm.toLocaleString()} extra km</b> — add {rs(extraKm * extraKmRate)} to the bill
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <select className="input !py-1.5 text-sm" value={charge.kind} onChange={(e) => setCharge((x) => ({ ...x, kind: e.target.value as ChargeKind }))}>{CHARGE_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <input className="input !py-1.5 text-sm" type="number" min="0" placeholder="Amount (Rs)" value={charge.amount || ''} onChange={(e) => setCharge((x) => ({ ...x, amount: Math.max(0, Number(e.target.value) || 0) }))} />
            <input className="input !py-1.5 text-sm" type="date" value={charge.date} onChange={(e) => setCharge((x) => ({ ...x, date: e.target.value }))} />
            <input className="input !py-1.5 text-sm" placeholder="Details, e.g. Speeding fine Kandy" value={charge.note} onChange={(e) => setCharge((x) => ({ ...x, note: e.target.value }))} />
          </div>
          <button type="button" disabled={charge.amount <= 0} className={`${smallBtn} bg-navy-800 text-white mt-2 disabled:opacity-40`}
                  onClick={() => { addCharge(b.id, { kind: charge.kind, amount: charge.amount, date: charge.date, note: charge.note.trim() || undefined, by }); setCharge((x) => ({ ...x, amount: 0, note: '' })); }}>
            <Plus size={12} /> Add to bill
          </button>
        </Card>
      </div>

      <Card title="Referral & owner" icon={Wallet}>
        <div className="grid sm:grid-cols-2 gap-x-6">
          <KV k="Referral" v={b.referral || 'Direct'} />
          <KV k="Referral fee" v={(b.referralFee ?? 0) > 0 ? `${rs(b.referralFee ?? 0)} · ${b.referralPaid ? 'paid' : 'not paid yet'}` : 'None'} />
          <KV k={b.exchanges?.length ? 'Owner payouts (all cars)' : 'Owner payout'} v={commissionPayout !== undefined ? rs(commissionPayout) : undefined} />
          <KV k="Payment method" v={b.paymentMethod} />
        </div>
      </Card>
    </div>
  );
}

/* =====================================================================
   Vehicle & handover
   ===================================================================== */

function ChecklistCard({ title, list, onRecord, recordLabel, canRecord }: { title: string; list?: HandoverChecklist; onRecord: () => void; recordLabel: string; canRecord: boolean }) {
  if (!list) {
    return (
      <Card title={title} icon={ClipboardList}>
        <p className="text-sm text-navy-400 mb-2">Not recorded yet.</p>
        {canRecord && <button type="button" onClick={onRecord} className={`${smallBtn} bg-navy-800 text-white`}>{recordLabel}</button>}
      </Card>
    );
  }
  const missing = CHECK_ITEMS.filter((i) => list.items && list.items[i] === false);
  return (
    <Card title={title} icon={ClipboardList}>
      <KV k="When" v={fmtDateTime(list.at)} />
      <KV k="By" v={list.by} />
      <KV k="Odometer" v={`${list.odometer.toLocaleString()} km`} />
      <KV k="Fuel" v={list.fuel} />
      <KV k="Checklist" v={missing.length ? `Not OK: ${missing.join(', ')}` : 'All OK'} warn={missing.length > 0} />
      {list.damage && <KV k="Damage" v={list.damage} warn />}
      {list.notes && <KV k="Notes" v={list.notes} />}
      {list.photos?.length ? (
        <div className="flex flex-wrap gap-1.5 mt-2">{list.photos.map((p) => <StoredImage key={p} path={p} className="w-16 h-12" />)}</div>
      ) : null}
      {list.signature && <div className="mt-2"><p className="text-[11px] text-navy-400">Customer signature</p><img src={list.signature} alt="Customer signature" className="h-14 bg-white" /></div>}
    </Card>
  );
}

function VehicleTab({ b, vehicle, legacy, onPickup, onReturn }: {
  b: Booking; vehicle?: import('../../types').Vehicle; legacy: import('../../types').VehicleHandover[]; onPickup: () => void; onReturn: () => void;
}) {
  const included = (vehicle?.includedKmPerDay ?? 100) * (b.totalDays || 1);
  const out = b.checklists?.pickup?.odometer, back = b.checklists?.return?.odometer;
  const driven = out !== undefined && back !== undefined ? back - out + earlierKm(b) : undefined;
  const ins = vehicle?.insurance;
  const insExpiresSoon = ins?.expiryDate && ins.expiryDate < b.endDate;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <ChecklistCard title="Pickup (handover)" list={b.checklists?.pickup} onRecord={onPickup} recordLabel="Hand over & start" canRecord={b.status === 'Confirmed'} />
        <ChecklistCard title="Return" list={b.checklists?.return} onRecord={onReturn} recordLabel="Receive & complete" canRecord={b.status === 'Ongoing'} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Mileage" icon={ShieldCheck}>
          <KV k="Included" v={`${included.toLocaleString()} km`} />
          <KV k="Driven" v={driven !== undefined ? `${driven.toLocaleString()} km` : 'After return'} />
          <KV k="Extra km" v={driven !== undefined ? `${Math.max(0, driven - included).toLocaleString()} km × ${rs(vehicle?.extraKmRate ?? 50)}` : '—'} warn={driven !== undefined && driven > included} />
          {b.quotation?.totalKm ? <KV k="Quoted distance" v={`${b.quotation.totalKm.toLocaleString()} km`} /> : null}
        </Card>
        <Card title="Insurance" icon={ShieldCheck}>
          <KV k="Provider" v={ins?.provider} />
          <KV k="Policy" v={ins?.policyNumber} />
          <KV k="Expires" v={ins?.expiryDate ? `${fmtDate(ins.expiryDate)}${insExpiresSoon ? ' — before the return!' : ''}` : undefined} warn={!!insExpiresSoon} />
          <KV k="Customer excess" v={b.agreement?.insuranceExcess ? rs(b.agreement.insuranceExcess) : 'Not set (Documents → Agreement)'} />
        </Card>
      </div>
      {!!b.exchanges?.length && <ExchangeHistory b={b} />}
      {legacy.length > 0 && !b.checklists?.pickup && !b.checklists?.return && (
        <Card title="Handover records" icon={History}>
          {legacy.map((h) => (
            <p key={h.id} className="text-sm text-navy-700 py-0.5">{h.type === 'delivery' ? 'Delivered' : 'Returned'} · {fmtDateTime(h.dateTime)} · {h.location} · {h.mileage.toLocaleString()} km · fuel {h.fuelLevel}{h.notes ? ` · ${h.notes}` : ''}</p>
          ))}
        </Card>
      )}
    </div>
  );
}

/** Every car this booking used, with each exchange's details and owner split */
function ExchangeHistory({ b }: { b: Booking }) {
  const { vehicles, owners } = useStore();
  const car = (id: string) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : '—'; };
  const ownerOf = (id: string) => owners.find((o) => o.id === vehicles.find((v) => v.id === id)?.ownerId)?.name ?? '—';
  const legs = legsOf(b);
  return (
    <Card title="Vehicle exchanges" icon={ArrowLeftRight}>
      <div className="space-y-3">
        {b.exchanges!.map((e) => (
          <div key={e.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm space-y-1">
            <p className="font-semibold text-navy-800">{fmtDateTime(e.at)} · {car(e.fromVehicleId)} → {car(e.toVehicleId)}</p>
            <p className="text-navy-600">{e.reason}{e.details ? ` — ${e.details}` : ''}</p>
            <p className="text-xs text-navy-500">
              Returned {e.returned.odometer.toLocaleString()} km{e.kmDriven !== undefined ? ` (${e.kmDriven.toLocaleString()} km driven)` : ''} · fuel {e.returned.fuel}
              {' · '}replacement out at {e.delivered.odometer.toLocaleString()} km · fuel {e.delivered.fuel}
            </p>
            {(e.returned.damage || e.damage) && (
              <p className="text-xs text-red-700">Damage: {e.returned.damage || e.damage?.description}{e.damage ? ` — paid by ${e.damage.payer === 'Undecided' ? 'not decided yet' : e.damage.payer.toLowerCase()}${e.damage.amount ? ` (${rs(e.damage.amount)})` : ''}` : ''}</p>
            )}
            {e.compensation && <p className="text-xs text-navy-500">Compensation to {ownerOf(e.fromVehicleId)}: {rs(e.compensation.amount)} (paid by {e.compensation.paidBy.toLowerCase()})</p>}
            <p className="text-[11px] text-navy-400">by {e.by}</p>
          </div>
        ))}
        <div className="rounded-lg bg-navy-50/60 divide-y divide-navy-100 text-sm">
          {legs.map((l, i) => (
            <div key={i} className="flex justify-between gap-3 px-3 py-2">
              <span>{car(l.vehicleId)} · {ownerOf(l.vehicleId)} · {l.days} day{l.days === 1 ? '' : 's'}{i === legs.length - 1 ? ' (now)' : ''}</span>
              <b>{rs(l.payout)}</b>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* =====================================================================
   Documents & agreement
   ===================================================================== */

function Documents({ b, by, canDelete, onPrintAgreement }: { b: Booking; by: string; canDelete: boolean; onPrintAgreement: () => void }) {
  const { logBookingActivity } = useStore();
  const [kind, setKind] = useState<DocumentKind>('Driving licence');
  const [busy, setBusy] = useState(false);
  const a: RentalAgreement = useMemo(() => ({ ...DEFAULT_POLICIES, ...(b.agreement ?? {}) }), [b.agreement]);
  const [pol, setPol] = useState(a);
  const docs = b.documents ?? [];
  const changedPolicies = JSON.stringify(pol) !== JSON.stringify(a);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: BookingDocument[] = [];
      for (const file of Array.from(files)) {
        const path = await uploadBookingFile(b.id, file);
        added.push({ id: newId(), kind, name: file.name, path, uploadedAt: new Date().toISOString(), by });
      }
      logBookingActivity(b.id, { by, type: 'Document', text: `${kind} uploaded (${added.map((d) => d.name).join(', ')})` },
        { documents: [...docs, ...added], ...(kind === 'Signed agreement' ? { agreement: { ...(b.agreement ?? {}), signedAt: new Date().toISOString(), signedBy: by } } : {}) });
      toast.success('Uploaded', `${added.length} file${added.length === 1 ? '' : 's'} saved to this booking.`);
    } catch (e) {
      toast.error('Upload failed', `${(e as Error).message}. If this keeps happening, run admin/supabase/fix-missing-columns.sql (it creates the private "booking-files" storage).`);
    } finally { setBusy(false); }
  };
  const open = async (d: BookingDocument) => {
    try { window.open(await fileUrl(d.path), '_blank'); } catch (e) { toast.error('Could not open the file', (e as Error).message); }
  };
  const remove = (d: BookingDocument) => {
    if (!confirm(`Delete "${d.name}"?`)) return;
    deleteBookingFile(d.path);
    logBookingActivity(b.id, { by, type: 'Document', text: `${d.kind} deleted (${d.name})` }, { documents: docs.filter((x) => x.id !== d.id) });
  };
  const has = (k: DocumentKind) => docs.some((d) => d.kind === k);
  const status = b.agreement?.signedAt ? `Signed ${fmtDate(b.agreement.signedAt)}` : b.agreement?.printedAt ? `Printed ${fmtDate(b.agreement.printedAt)} — not signed yet` : 'Not printed yet';

  return (
    <div className="space-y-3">
      <Card title="Documents" icon={FileText}>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(['Driving licence', 'NIC / Passport', 'Signed agreement'] as DocumentKind[]).map((k) => (
            <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${has(k) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{has(k) ? '✓' : '•'} {k}</span>
          ))}
        </div>
        {docs.length === 0 ? <p className="text-sm text-navy-400 mb-3">Nothing uploaded yet.</p> : (
          <ul className="divide-y divide-navy-50 mb-3">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                {/\.(jpe?g|png|webp)$/i.test(d.path) || d.path.startsWith('data:image') ? <StoredImage path={d.path} className="w-12 h-9 flex-shrink-0" /> : <FileText size={18} className="text-navy-300 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy-800 truncate">{d.kind} <span className="text-navy-400 font-normal">· {d.name}</span></p>
                  <p className="text-[11px] text-navy-400">{fmtDateTime(d.uploadedAt)} · {d.by}</p>
                </div>
                <button type="button" onClick={() => open(d)} className={`${smallBtn} bg-navy-50 text-navy-700`}><ExternalLink size={12} /> Open</button>
                {canDelete && <button type="button" onClick={() => remove(d)} className="p-1 text-navy-300 hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select className="input !py-1.5 !w-auto text-sm" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>{DOC_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <label className={`${smallBtn} bg-navy-800 text-white cursor-pointer !py-2 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {busy ? 'Uploading…' : 'Upload'}
            <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          </label>
          <label className={`${smallBtn} bg-navy-50 text-navy-700 cursor-pointer !py-2 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            <Camera size={13} /> Take photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        <p className="text-[11px] text-navy-400 mt-2">Stored privately — files open through a short-lived link, not a public URL.</p>
      </Card>

      <Card title="Rental agreement" icon={FileSignature} action={<span className={`text-[11px] font-semibold ${b.agreement?.signedAt ? 'text-emerald-700' : 'text-amber-700'}`}>{status}</span>}>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-[11px] text-navy-400 sm:col-span-2">Allowed use / area<input className="input !py-1.5 text-sm mt-0.5" value={pol.allowedArea ?? ''} onChange={(e) => setPol((x) => ({ ...x, allowedArea: e.target.value }))} /></label>
          <label className="text-[11px] text-navy-400 sm:col-span-2">Fuel policy<input className="input !py-1.5 text-sm mt-0.5" value={pol.fuelPolicy ?? ''} onChange={(e) => setPol((x) => ({ ...x, fuelPolicy: e.target.value }))} /></label>
          <label className="text-[11px] text-navy-400">Late return policy<input className="input !py-1.5 text-sm mt-0.5" value={pol.lateReturnPolicy ?? ''} onChange={(e) => setPol((x) => ({ ...x, lateReturnPolicy: e.target.value }))} /></label>
          <label className="text-[11px] text-navy-400">Insurance excess the customer pays (Rs)<input className="input !py-1.5 text-sm mt-0.5" type="number" min="0" value={pol.insuranceExcess ?? ''} onChange={(e) => setPol((x) => ({ ...x, insuranceExcess: Number(e.target.value) || undefined }))} /></label>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {changedPolicies && (
            <button type="button" className={`${smallBtn} bg-navy-800 text-white`} onClick={() => logBookingActivity(b.id, { by, type: 'Agreement', text: 'Agreement terms updated' }, { agreement: { ...(b.agreement ?? {}), ...pol } })}>Save terms</button>
          )}
          <button type="button" onClick={onPrintAgreement} className={`${smallBtn} bg-navy-50 text-navy-700`}><Printer size={12} /> Print agreement</button>
          {!b.agreement?.signedAt && (
            <button type="button" className={`${smallBtn} bg-emerald-50 text-emerald-700`}
                    onClick={() => logBookingActivity(b.id, { by, type: 'Agreement', text: 'Agreement signed by the customer' }, { agreement: { ...(b.agreement ?? {}), ...pol, signedAt: new Date().toISOString(), signedBy: by } })}>
              <CheckCircle size={12} /> Mark as signed
            </button>
          )}
        </div>
        <p className="text-[11px] text-navy-400 mt-2">Tip: upload a photo of the signed copy as "Signed agreement" above. The printed terms are a starting template — have them checked before relying on them.</p>
      </Card>
    </div>
  );
}

/** An edit shows as before → after rows; anything else as plain text */
function EntryText({ text }: { text: string }) {
  const parsed = parseChanges(text);
  if (!parsed) return <p className="text-sm text-navy-700 mt-0.5">{text}</p>;
  return (
    <div className="mt-1.5 max-w-xl">
      <div className="rounded-xl border border-navy-100 bg-white divide-y divide-navy-50 overflow-hidden">
        {parsed.changes.map((c) => (
          <div key={c.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
            <span className="text-xs font-medium text-navy-400 pt-0.5">{c.label}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <span className="text-navy-400 line-through decoration-navy-300">{c.from}</span>
              <ArrowRight size={13} className="text-navy-300 flex-shrink-0" />
              <span className="font-semibold text-navy-900">{c.to}</span>
              {c.delta !== undefined && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${(c.delta > 0) !== /discount|deduct|refund|kept/i.test(c.label) ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {c.delta > 0 ? '+' : '−'}{rs(Math.abs(c.delta))}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {parsed.reason && <p className="text-xs text-navy-500 mt-1.5">Reason: {parsed.reason}</p>}
    </div>
  );
}

/* =====================================================================
   History
   ===================================================================== */

const TYPE_TONE: Record<ActivityEntry['type'], string> = {
  Created: 'bg-navy-100 text-navy-600', Edited: 'bg-amber-100 text-amber-800', Status: 'bg-sky-100 text-sky-700', Payment: 'bg-emerald-100 text-emerald-700',
  Handover: 'bg-indigo-100 text-indigo-700', Extended: 'bg-violet-100 text-violet-700', Swapped: 'bg-violet-100 text-violet-700', Charge: 'bg-red-100 text-red-700',
  Document: 'bg-navy-100 text-navy-600', Message: 'bg-emerald-50 text-emerald-700', Agreement: 'bg-teal-100 text-teal-700', Cancelled: 'bg-red-100 text-red-700',
  Deposit: 'bg-amber-100 text-amber-800', Note: 'bg-navy-100 text-navy-600',
};

function HistoryTab({ b, by, legacy }: { b: Booking; by: string; legacy: import('../../types').VehicleHandover[] }) {
  const { logBookingActivity } = useStore();
  const [note, setNote] = useState('');
  const entries = useMemo(() => {
    const list = historyOf(b);
    // handovers recorded on the Handovers page (before the checklist existed)
    legacy.forEach((h) => {
      if (!list.some((a) => a.type === 'Handover' && Math.abs(new Date(a.at).getTime() - new Date(h.dateTime).getTime()) < 60_000)) {
        list.push({ at: h.dateTime || h.createdAt, by: '—', type: 'Handover', text: `${h.type === 'delivery' ? 'Vehicle delivered' : 'Vehicle returned'} — ${h.mileage.toLocaleString()} km, fuel ${h.fuelLevel}` });
      }
    });
    return list.sort((x, y) => y.at.localeCompare(x.at));
  }, [b, legacy]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className="input flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the history, e.g. Customer called — will be 1 hour late"
               onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) { logBookingActivity(b.id, { by, type: 'Note', text: note.trim() }); setNote(''); } }} />
        <button type="button" disabled={!note.trim()} className="btn-primary !py-2 text-sm disabled:opacity-40" onClick={() => { logBookingActivity(b.id, { by, type: 'Note', text: note.trim() }); setNote(''); }}>Add</button>
      </div>
      <ol className="relative border-l border-navy-100 ml-2 space-y-3">
        {entries.map((e, i) => (
          <li key={`${e.at}-${i}`} className="ml-4">
            <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-navy-200 ring-2 ring-white" />
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TYPE_TONE[e.type]}`}>{e.type}</span>
              <span className="text-[11px] text-navy-400">{fmtDateTime(e.at)} · {e.by}</span>
            </div>
            <EntryText text={e.text} />
          </li>
        ))}
      </ol>
      {!b.activity?.length && <p className="text-[11px] text-navy-400">Older bookings only have the events recorded before the history log existed.</p>}
    </div>
  );
}
