import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { sendRentalSummary } from '../utils/email';
import { resolveReferralFee } from '../lib/referral';
import Header from '../components/layout/Header';
import Modal from '../components/ui/Modal';
import Select from '../components/ui/Select';
import DateTimeInput from '../components/ui/DateTimeInput';
import LocationInput from '../components/ui/LocationInput';
import StatusBadge from '../components/ui/StatusBadge';
import InvoiceModal from '../components/ui/InvoiceModal';
import {
  Truck, RotateCcw, CheckCircle2, MapPin, Gauge, Fuel,
  Clock, FileText, AlertTriangle, Car, CreditCard, Receipt, BookMarked,
} from 'lucide-react';
import { Booking, VehicleHandover } from '../types';

const FUEL_LEVELS = ['Full', '3/4', '1/2', '1/4', 'Empty'] as const;
type FuelLevel = typeof FUEL_LEVELS[number];

const FUEL_COLOR: Record<FuelLevel, string> = {
  Full:    'text-emerald-600 bg-emerald-50',
  '3/4':   'text-blue-600   bg-blue-50',
  '1/2':   'text-amber-600  bg-amber-50',
  '1/4':   'text-orange-600 bg-orange-50',
  Empty:   'text-red-600    bg-red-50',
};

function StepBadge({ n, active, variant = 'default' }: {
  n: number;
  active?: boolean;
  variant?: 'default' | 'red' | 'purple' | 'amber';
}) {
  const cls = {
    default: 'bg-navy-200 text-navy-700',
    red:     'bg-red-100 text-red-700',
    purple:  'bg-purple-100 text-purple-700',
    amber:   'bg-amber-200 text-amber-800',
  }[variant];
  return (
    <span className={`inline-flex w-4 h-4 rounded-full items-center justify-center font-bold flex-shrink-0 text-[9px] ${active ? 'bg-navy-700 text-white' : cls}`}>
      {n}
    </span>
  );
}

const emptyHandover = (type: 'delivery' | 'return', bookingId: string, vehicleId: string) => ({
  bookingId,
  vehicleId,
  type,
  location:  '',
  dateTime:  new Date().toISOString().slice(0, 16),
  mileage:   0,
  fuelLevel: 'Full' as FuelLevel,
  notes:     '',
  extraKm:        0,
  extraKmCharge:  0,
  finalAmount:    0,
});

export default function Handovers() {
  const { bookings, vehicles, owners, commissions, handovers, addHandover, updateBooking, updateCommission, saveDraft, discardDraft, drafts } = useStore();
  const { currentUser, isAdmin, can } = useAuthStore();

  const [tab,              setTab]              = useState<'active' | 'records'>('active');
  const [modal,            setModal]            = useState<'delivery' | 'return' | 'view' | 'payment' | null>(null);
  const [form,             setForm]             = useState(emptyHandover('delivery', '', ''));
  const [viewItem,         setViewItem]         = useState<VehicleHandover | null>(null);
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [invoiceBookingId, setInvoiceBookingId] = useState<string | null>(null);
  const [payAmountPaid,    setPayAmountPaid]    = useState(0);
  const [payDiscount,      setPayDiscount]      = useState(0);
  const [payBadDebt,       setPayBadDebt]       = useState(0);
  const [referralConfirmed, setReferralConfirmed] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Resume an incomplete process when navigated here with ?resume=draftId
  useEffect(() => {
    const resumeId = searchParams.get('resume');
    if (!resumeId) return;
    const draft = drafts.find((d) => d.id === resumeId);
    if (!draft) { setSearchParams({}, { replace: true }); return; }

    if (draft.type === 'return') {
      const data = draft.formData as ReturnType<typeof emptyHandover>;
      setForm(data);
      setModal('return');
    } else if (draft.type === 'payment') {
      const data = draft.formData as { bookingId: string; payAmountPaid: number; payDiscount: number; payBadDebt: number };
      setPaymentBookingId(data.bookingId);
      setPayAmountPaid(data.payAmountPaid ?? 0);
      setPayDiscount(data.payDiscount ?? 0);
      setPayBadDebt(data.payBadDebt ?? 0);
      setReferralConfirmed(false);
      setModal('payment');
    }
    discardDraft(resumeId);
    setSearchParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Owner sees only their vehicle bookings
  const isOwnerRole   = !isAdmin() && currentUser?.role === 'owner';
  const myVehicleIds  = isOwnerRole
    ? vehicles.filter((v) => v.ownerId === currentUser?.ownerId).map((v) => v.id)
    : null;

  const relevantBookings = (myVehicleIds
    ? bookings.filter((b) => myVehicleIds.includes(b.vehicleId))
    : bookings
  ).filter((b) => b.status === 'Confirmed' || b.status === 'Ongoing' || b.status === 'Completed');

  const activeBookings = relevantBookings.filter((b) => b.status === 'Confirmed' || b.status === 'Ongoing');

  const getHandovers = (bookingId: string) => ({
    delivery: handovers.find((h) => h.bookingId === bookingId && h.type === 'delivery'),
    return:   handovers.find((h) => h.bookingId === bookingId && h.type === 'return'),
  });

  const set = (field: string, value: unknown) => setForm((f) => ({ ...f, [field]: value }));

  const openDelivery = (b: Booking) => {
    setForm(emptyHandover('delivery', b.id, b.vehicleId));
    setModal('delivery');
  };

  const openReturn = (b: Booking) => {
    const delivery = handovers.find((h) => h.bookingId === b.id && h.type === 'delivery');
    const vehicle  = vehicles.find((v) => v.id === b.vehicleId);
    const base     = { ...emptyHandover('return', b.id, b.vehicleId) };
    base.finalAmount = b.totalAmount;
    setForm(base);
    setModal('return');
  };

  const recalcReturn = (f: typeof form) => {
    const delivery = handovers.find((h) => h.bookingId === f.bookingId && h.type === 'delivery');
    const vehicle  = vehicles.find((v) => v.id === f.vehicleId);
    const booking  = bookings.find((b) => b.id === f.bookingId);
    if (!delivery || !vehicle || !booking) return f;

    // Correct formula: base + extra km charge only above the free allowance
    const totalKmDriven = Math.max(0, f.mileage - delivery.mileage);
    const includedKm    = (vehicle.includedKmPerDay ?? 100) * booking.totalDays;
    const extraKm       = Math.max(0, totalKmDriven - includedKm);
    const extraCharge   = extraKm * (vehicle.extraKmRate ?? 50);
    const baseAmount    = vehicle.dailyRent * booking.totalDays;
    const finalAmount   = baseAmount + extraCharge;

    return { ...f, extraKm, extraKmCharge: extraCharge, finalAmount };
  };

  const setReturn = (field: string, value: unknown) => {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      if (field === 'mileage') return recalcReturn(updated);
      return updated;
    });
  };

  const handleReturnClose = () => {
    if (form.type === 'return' && (form.location !== '' || form.mileage !== 0)) {
      const bk  = bookings.find((b) => b.id === form.bookingId);
      const veh = vehicles.find((v) => v.id === form.vehicleId);
      saveDraft({
        type: 'return',
        label: veh ? `Return: ${veh.brand} ${veh.model}` : 'Incomplete Return',
        sublabel: bk ? `${bk.customerName} · ${bk.startDate} → ${bk.endDate}` : '',
        bookingId: form.bookingId || undefined,
        vehicleId: form.vehicleId || undefined,
        formData: { ...form },
      });
    }
    setModal(null);
  };

  const handleSaveDelivery = () => {
    if (!form.location || !form.dateTime || !form.mileage) return;
    addHandover(form);
    // Move booking to Ongoing when vehicle is delivered
    updateBooking(form.bookingId, { status: 'Ongoing' });
    setModal(null);
  };

  const handleSaveReturn = () => {
    if (!form.location || !form.dateTime || !form.mileage) return;
    addHandover(form);
    updateBooking(form.bookingId, { status: 'Completed' });
    const bk  = bookings.find((b) => b.id === form.bookingId);
    const bal = Math.max(0, form.finalAmount - (bk?.paidAmount ?? 0));
    setPayAmountPaid(bal);
    setPayDiscount(0);
    setPayBadDebt(0);
    setReferralConfirmed(false);
    setPaymentBookingId(form.bookingId);
    setModal('payment');
  };

  const allRecords = [...handovers]
    .filter((h) => !myVehicleIds || myVehicleIds.includes(h.vehicleId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      <Header title="Vehicle Handovers" subtitle="Record delivery and return conditions for every booking" />

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['active', 'records'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-colors capitalize ${
              tab === t ? 'bg-navy-700 text-white' : 'bg-white text-navy-500 hover:bg-navy-50 shadow-card'
            }`}
          >
            {t === 'active' ? `Active Bookings (${activeBookings.length})` : 'Handover Records'}
          </button>
        ))}
      </div>

      {/* ── Active Bookings ── */}
      {tab === 'active' && (
        <div className="space-y-4">
          {activeBookings.length === 0 && (
            <div className="card text-center py-16 text-navy-400 text-sm">
              No active bookings requiring handover.
            </div>
          )}
          {activeBookings.map((b) => {
            const vehicle  = vehicles.find((v) => v.id === b.vehicleId);
            const { delivery, return: ret } = getHandovers(b.id);
            const balance  = b.totalAmount - (b.discount ?? 0) - b.paidAmount;

            return (
              <div key={b.id} className="card">
                {/* Booking header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-navy-50 flex items-center justify-center flex-shrink-0">
                      <Car size={18} className="text-navy-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-navy-800">{b.customerName}</p>
                      <p className="text-xs text-navy-400">{b.customerPhone}</p>
                    </div>
                  </div>
                  <StatusBadge status={b.status} size="md" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <InfoChip label="Vehicle" value={`${vehicle?.brand} ${vehicle?.model}`} />
                  <InfoChip label="Reg No." value={vehicle?.vehicleNumber ?? '—'} />
                  <InfoChip label="From"    value={b.startDate} />
                  <InfoChip label="To"      value={b.endDate} />
                </div>

                {/* Handover timeline */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Delivery */}
                  <div className={`rounded-xl p-4 border-2 ${delivery ? 'border-emerald-200 bg-emerald-50/50' : 'border-dashed border-navy-200 bg-navy-50/40'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <Truck size={15} className={delivery ? 'text-emerald-600' : 'text-navy-400'} />
                      <p className={`text-xs font-semibold uppercase tracking-wide ${delivery ? 'text-emerald-700' : 'text-navy-500'}`}>
                        Vehicle Delivery
                      </p>
                      {delivery && <CheckCircle2 size={14} className="text-emerald-500 ml-auto" />}
                    </div>

                    {delivery ? (
                      <div className="space-y-1.5">
                        <HandoverDetail icon={MapPin}  value={delivery.location} />
                        <HandoverDetail icon={Clock}   value={delivery.dateTime.replace('T', ' ')} />
                        <HandoverDetail icon={Gauge}   value={`${delivery.mileage.toLocaleString()} km`} />
                        <HandoverDetail icon={Fuel}    value={delivery.fuelLevel}
                          className={FUEL_COLOR[delivery.fuelLevel as FuelLevel] ?? ''} />
                        {delivery.notes && (
                          <HandoverDetail icon={FileText} value={delivery.notes} />
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs text-navy-400 mb-3">Not recorded yet</p>
                        {(isAdmin() || can('canBook')) && (
                          <button
                            onClick={() => openDelivery(b)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-navy-700 text-white hover:bg-navy-800 transition-colors"
                          >
                            <Truck size={13} />
                            Record Delivery
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Return */}
                  <div className={`rounded-xl p-4 border-2 ${ret ? 'border-blue-200 bg-blue-50/50' : delivery ? 'border-dashed border-amber-300 bg-amber-50/30' : 'border-dashed border-navy-100 bg-navy-50/20 opacity-50'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <RotateCcw size={15} className={ret ? 'text-blue-600' : delivery ? 'text-amber-500' : 'text-navy-300'} />
                      <p className={`text-xs font-semibold uppercase tracking-wide ${ret ? 'text-blue-700' : delivery ? 'text-amber-600' : 'text-navy-300'}`}>
                        Vehicle Return
                      </p>
                      {ret && <CheckCircle2 size={14} className="text-blue-500 ml-auto" />}
                    </div>

                    {ret ? (
                      <div className="space-y-1.5">
                        <HandoverDetail icon={MapPin}  value={ret.location} />
                        <HandoverDetail icon={Clock}   value={ret.dateTime.replace('T', ' ')} />
                        <HandoverDetail icon={Gauge}   value={`${ret.mileage.toLocaleString()} km`} />
                        <HandoverDetail icon={Fuel}    value={ret.fuelLevel}
                          className={FUEL_COLOR[ret.fuelLevel as FuelLevel] ?? ''} />
                        {(ret.extraKm ?? 0) > 0 && (
                          <div className="flex items-center gap-2 bg-amber-50 rounded-lg px-2.5 py-1.5 mt-2">
                            <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                            <p className="text-xs text-amber-700">
                              +{ret.extraKm} km · Rs {ret.extraKmCharge?.toLocaleString()}
                            </p>
                          </div>
                        )}
                        {ret.finalAmount && (
                          <div className="mt-2 pt-2 border-t border-blue-100 flex justify-between">
                            <span className="text-xs text-blue-600">Final Amount</span>
                            <span className="text-xs font-bold text-blue-800">Rs {ret.finalAmount.toLocaleString()}</span>
                          </div>
                        )}
                        {ret.notes && <HandoverDetail icon={FileText} value={ret.notes} />}
                      </div>
                    ) : delivery ? (
                      <div>
                        <p className="text-xs text-navy-400 mb-3">Awaiting customer return</p>
                        {(isAdmin() || can('canBook')) && (
                          <button
                            onClick={() => openReturn(b)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                          >
                            <RotateCcw size={13} />
                            Record Return
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-navy-300">Record delivery first</p>
                    )}
                  </div>
                </div>

                {/* Amount footer */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-navy-50 text-xs">
                  <div className="flex gap-4">
                    <span className="text-navy-400">Total: <span className="font-semibold text-navy-700">Rs {b.totalAmount.toLocaleString()}</span></span>
                    <span className="text-navy-400">Paid: <span className="font-semibold text-emerald-700">Rs {b.paidAmount.toLocaleString()}</span></span>
                    {balance > 0 && <span className="text-red-600">Balance: <span className="font-semibold">Rs {balance.toLocaleString()}</span></span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── All Records ── */}
      {tab === 'records' && (
        <div className="space-y-3">
          {allRecords.length === 0 && (
            <div className="card text-center py-16 text-navy-400 text-sm">No handover records yet.</div>
          )}
          {allRecords.map((h) => {
            const booking = bookings.find((b) => b.id === h.bookingId);
            const vehicle = vehicles.find((v) => v.id === h.vehicleId);
            return (
              <div
                key={h.id}
                className="card hover:shadow-card-hover transition-shadow cursor-pointer"
                onClick={() => { setViewItem(h); setModal('view'); }}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    h.type === 'delivery' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                  }`}>
                    {h.type === 'delivery' ? <Truck size={18} /> : <RotateCcw size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-navy-800 truncate">
                        {booking?.customerName ?? '—'}
                      </p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${
                        h.type === 'delivery' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {h.type}
                      </span>
                    </div>
                    <p className="text-xs text-navy-400 truncate">
                      {vehicle?.brand} {vehicle?.model} · {vehicle?.vehicleNumber}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-semibold text-navy-700">{h.location}</p>
                    <p className="text-xs text-navy-400">{h.dateTime.replace('T', ' ')}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="text-xs font-bold text-navy-700">{h.mileage.toLocaleString()} km</p>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${FUEL_COLOR[h.fuelLevel as FuelLevel] ?? 'bg-navy-50 text-navy-500'}`}>
                      {h.fuelLevel}
                    </span>
                  </div>
                </div>

                {h.type === 'return' && (h.extraKm ?? 0) > 0 && (
                  <div className="mt-3 flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2">
                    <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                    <span className="text-xs text-amber-700">
                      +{h.extraKm} extra km · Rs {h.extraKmCharge?.toLocaleString()} charge ·
                      Final: <span className="font-bold">Rs {h.finalAmount?.toLocaleString()}</span>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Delivery Modal ── */}
      <Modal open={modal === 'delivery'} onClose={() => setModal(null)} title="Record Vehicle Delivery">
        {(() => {
          const booking = bookings.find((b) => b.id === form.bookingId);
          const vehicle = vehicles.find((v) => v.id === form.vehicleId);
          return (
            <div className="space-y-5">
              {/* Booking info banner */}
              <div className="bg-navy-50/80 rounded-xl p-4 flex items-center gap-3">
                <Truck size={18} className="text-navy-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-navy-800">{booking?.customerName}</p>
                  <p className="text-xs text-navy-500">
                    {vehicle?.brand} {vehicle?.model} · {vehicle?.vehicleNumber} · {booking?.startDate} → {booking?.endDate}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <p className="label">Handover Location *</p>
                  <LocationInput value={form.location} onChange={(v) => set('location', v)} placeholder="e.g. Colombo 03, Galle Road" />
                </div>
                <div>
                  <p className="label">Date & Time *</p>
                  <DateTimeInput value={form.dateTime} onChange={(v) => set('dateTime', v)} />
                </div>
                <div>
                  <p className="label">Odometer Reading (km) *</p>
                  <div className="relative">
                    <Gauge size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
                    <input className="input pl-8" type="number" value={form.mileage || ''}
                      onChange={(e) => set('mileage', +e.target.value)} placeholder="85000" />
                  </div>
                </div>
                <div>
                  <p className="label">Fuel Level</p>
                  <Select value={form.fuelLevel} onChange={(v) => set('fuelLevel', v)}
                    options={FUEL_LEVELS.map((f) => ({ value: f, label: f }))} />
                </div>
                <div>
                  <p className="label">Condition / Notes</p>
                  <input className="input" value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                    placeholder="Any scratches, remarks..." />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
                <button
                  onClick={handleSaveDelivery}
                  disabled={!form.location || !form.dateTime || !form.mileage}
                  className="flex items-center gap-2 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Truck size={14} />
                  Save Delivery
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Return Modal ── */}
      <Modal open={modal === 'return'} onClose={handleReturnClose} title="Record Vehicle Return">
        {(() => {
          const booking  = bookings.find((b) => b.id === form.bookingId);
          const vehicle  = vehicles.find((v) => v.id === form.vehicleId);
          const delivery = handovers.find((h) => h.bookingId === form.bookingId && h.type === 'delivery');

          return (
            <div className="space-y-5">
              {/* Booking info banner */}
              <div className="bg-navy-50/80 rounded-xl p-4 flex items-center gap-3">
                <RotateCcw size={18} className="text-navy-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-navy-800">{booking?.customerName}</p>
                  <p className="text-xs text-navy-500">
                    {vehicle?.brand} {vehicle?.model} · {vehicle?.vehicleNumber} · {booking?.startDate} → {booking?.endDate}
                  </p>
                </div>
              </div>

              {/* Delivery reference */}
              {delivery && (
                <div className="flex items-center gap-3 bg-emerald-50 rounded-xl px-4 py-3">
                  <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                  <p className="text-xs text-emerald-700">
                    Delivered at <span className="font-semibold">{delivery.mileage.toLocaleString()} km</span> from {delivery.location}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <p className="label">Return Location *</p>
                  <LocationInput value={form.location} onChange={(v) => setReturn('location', v)} placeholder="e.g. Kandy, Temple Road" />
                </div>
                <div>
                  <p className="label">Date & Time *</p>
                  <DateTimeInput value={form.dateTime} onChange={(v) => setReturn('dateTime', v)} />
                </div>
                <div>
                  <p className="label">Odometer Reading (km) *</p>
                  <div className="relative">
                    <Gauge size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
                    <input className="input pl-8" type="number" value={form.mileage || ''}
                      onChange={(e) => setReturn('mileage', +e.target.value)} placeholder="86500" />
                  </div>
                </div>
                <div>
                  <p className="label">Fuel Level at Return</p>
                  <Select value={form.fuelLevel} onChange={(v) => setReturn('fuelLevel', v)}
                    options={FUEL_LEVELS.map((f) => ({ value: f, label: f }))} />
                </div>
                <div>
                  <p className="label">Condition / Notes</p>
                  <input className="input" value={form.notes}
                    onChange={(e) => setReturn('notes', e.target.value)}
                    placeholder="Any damage, remarks..." />
                </div>
              </div>

              {/* Trip summary */}
              {form.mileage > 0 && delivery && (() => {
                const totalKmDriven = Math.max(0, form.mileage - delivery.mileage);
                const includedKm    = (vehicle?.includedKmPerDay ?? 100) * (booking?.totalDays ?? 1);
                const baseAmount    = (vehicle?.dailyRent ?? 0) * (booking?.totalDays ?? 1);
                return (
                  <div className="bg-navy-50/80 rounded-xl p-4 space-y-2 text-xs">
                    <p className="font-semibold text-navy-600 uppercase tracking-wide mb-3">Trip Summary</p>
                    <div className="flex justify-between text-navy-600">
                      <span>Odometer at delivery</span>
                      <span className="font-semibold">{delivery.mileage.toLocaleString()} km</span>
                    </div>
                    <div className="flex justify-between text-navy-600">
                      <span>Odometer at return</span>
                      <span className="font-semibold">{form.mileage.toLocaleString()} km</span>
                    </div>
                    <div className="flex justify-between text-navy-700 font-semibold border-t border-navy-100 pt-2">
                      <span>Total km driven</span>
                      <span>{totalKmDriven.toLocaleString()} km</span>
                    </div>
                    <div className="flex justify-between text-navy-600 border-t border-navy-100 pt-2">
                      <span>Base ({booking?.totalDays ?? 0}d × Rs {vehicle?.dailyRent.toLocaleString()}/day)</span>
                      <span className="font-semibold">Rs {baseAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-navy-500">
                      <span>Included km ({vehicle?.includedKmPerDay ?? 100}/day × {booking?.totalDays ?? 0}d)</span>
                      <span>{includedKm.toLocaleString()} km free</span>
                    </div>
                    {(form.extraKm ?? 0) > 0 ? (
                      <div className="flex justify-between text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                        <span>Extra km ({(form.extraKm ?? 0).toLocaleString()} km × Rs {vehicle?.extraKmRate ?? 50}/km)</span>
                        <span className="font-bold">+ Rs {form.extraKmCharge?.toLocaleString()}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1.5">
                        <CheckCircle2 size={12} />
                        Within included km — no extra charge
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-navy-800 border-t border-navy-100 pt-2">
                      <span>Final Amount</span>
                      <span>Rs {form.finalAmount?.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
                <button
                  onClick={handleSaveReturn}
                  disabled={!form.location || !form.dateTime || !form.mileage}
                  className="flex items-center gap-2 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={14} />
                  Complete Return
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Payment Settlement Modal ── */}
      <Modal open={modal === 'payment'} onClose={() => setModal(null)} title="Payment Settlement" width="max-w-lg">
        {paymentBookingId && (() => {
          const booking    = bookings.find((b) => b.id === paymentBookingId);
          const vehicle    = vehicles.find((v) => v.id === booking?.vehicleId);
          const delivery   = handovers.find((h) => h.bookingId === paymentBookingId && h.type === 'delivery');
          const returnH    = handovers.find((h) => h.bookingId === paymentBookingId && h.type === 'return');
          const commission = commissions.find((c) => c.bookingId === paymentBookingId);
          const owner      = owners.find((o) => o.id === commission?.ownerId);
          if (!booking || !vehicle || !commission) return null;

          const finalAmount   = returnH?.finalAmount ?? booking.totalAmount;
          const referralFee   = resolveReferralFee(booking.referralFeeType, booking.referralFeeValue, finalAmount);
          const ownerPayout   = Math.max(0, finalAmount - referralFee);
          const alreadyPaid   = booking.paidAmount;
          const balance       = Math.max(0, finalAmount - alreadyPaid);
          const totalKmDriven = delivery && returnH ? returnH.mileage - delivery.mileage : 0;
          const includedKm    = (vehicle.includedKmPerDay ?? 100) * booking.totalDays;
          const baseAmount    = vehicle.dailyRent * booking.totalDays;
          const extraKm       = returnH?.extraKm ?? 0;
          const referralLabel = booking.referral && booking.referral !== 'Direct' ? booking.referral : null;

          // Step 4: auto-calculated remaining after payment + discount
          const remaining        = Math.max(0, balance - payAmountPaid - payDiscount);
          // Step 6: credit = remaining after bad debt write-off
          const creditToTransfer = Math.max(0, remaining - payBadDebt);
          const hasReferral      = !!referralLabel && referralFee > 0;
          const canConfirm       = !hasReferral || referralConfirmed;

          const emailParams = {
            toEmail:          booking.customerEmail ?? '',
            toName:           booking.customerName,
            invoiceNo:        `INV-${booking.id.slice(-6).toUpperCase()}`,
            vehicleName:      `${vehicle.brand} ${vehicle.model}`,
            vehicleReg:       vehicle.vehicleNumber,
            startDate:        booking.startDate,
            endDate:          booking.endDate,
            totalDays:        booking.totalDays,
            dailyRate:        vehicle.dailyRent,
            baseAmount,
            extraKm,
            extraKmRate:      vehicle.extraKmRate ?? 50,
            extraCharge:      returnH?.extraKmCharge ?? 0,
            finalAmount,
            advancePaid:      alreadyPaid,
            balanceCollected: payAmountPaid,
            ownerName:        owner?.name ?? 'Owner',
            ownerPayout,
            referralLabel,
            referralFee,
          };

          const handleConfirmPayment = () => {
            updateCommission(commission.id, {
              status: creditToTransfer > 0 ? 'Credit' : 'Paid',
              totalIncome: finalAmount,
              commissionAmount: 0,
              coordinatorFee: referralFee,
              ownerPayout,
            });
            updateBooking(paymentBookingId, {
              paidAmount: alreadyPaid + payAmountPaid,
              ...(payDiscount > 0       && { discount:      payDiscount }),
              ...(payBadDebt > 0        && { badDebt:        payBadDebt }),
              ...(creditToTransfer > 0  && { creditAmount:   creditToTransfer, creditSettled: false }),
            });
            sendRentalSummary(emailParams).catch(console.error);
            setModal(null);
            setPaymentBookingId(null);
          };

          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="bg-navy-50/80 rounded-xl p-4 flex items-center gap-3">
                <CreditCard size={18} className="text-navy-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-navy-800">{booking.customerName}</p>
                  <p className="text-xs text-navy-500">
                    {vehicle.brand} {vehicle.model} · {booking.totalDays} days · {booking.startDate} → {booking.endDate}
                  </p>
                </div>
              </div>

              {/* Amount breakdown */}
              <div className="border border-navy-100 rounded-xl overflow-hidden">
                <div className="bg-navy-50 px-4 py-2.5 flex items-center gap-2">
                  <Receipt size={13} className="text-navy-500" />
                  <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide">Final Amount Breakdown</p>
                </div>
                <div className="p-4 space-y-2 text-xs">
                  <div className="flex justify-between text-navy-600">
                    <span>Base ({booking.totalDays}d × Rs {vehicle.dailyRent.toLocaleString()}/day)</span>
                    <span className="font-semibold">Rs {baseAmount.toLocaleString()}</span>
                  </div>
                  {totalKmDriven > 0 && (
                    <>
                      <div className="flex justify-between text-navy-500">
                        <span>Total km driven</span>
                        <span>{totalKmDriven.toLocaleString()} km</span>
                      </div>
                      <div className="flex justify-between text-navy-500">
                        <span>Included km ({vehicle.includedKmPerDay ?? 100}/day × {booking.totalDays}d)</span>
                        <span>{includedKm.toLocaleString()} km free</span>
                      </div>
                    </>
                  )}
                  {extraKm > 0 ? (
                    <div className="flex justify-between text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                      <span>Extra km ({extraKm.toLocaleString()} km × Rs {vehicle.extraKmRate ?? 50}/km)</span>
                      <span className="font-bold">+ Rs {(returnH?.extraKmCharge ?? 0).toLocaleString()}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1.5">
                      <CheckCircle2 size={12} />
                      No extra km charge
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-navy-800 border-t border-navy-100 pt-2">
                    <span>Final Total</span>
                    <span>Rs {finalAmount.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Payment split */}
              <div className="border border-navy-100 rounded-xl overflow-hidden">
                <div className="bg-navy-50 px-4 py-2.5">
                  <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide">Payment Split</p>
                </div>
                <div className="divide-y divide-navy-50">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-navy-800">{owner?.name ?? 'Owner'}</p>
                      <p className="text-xs text-navy-400">Owner receives{referralFee > 0 ? ' · total minus referral' : ' · full amount'}</p>
                    </div>
                    <p className="text-base font-bold text-emerald-700">Rs {ownerPayout.toLocaleString()}</p>
                  </div>
                  {referralLabel && referralFee > 0 && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-navy-800">{referralLabel}</p>
                        <p className="text-xs text-navy-400">Referral fee</p>
                      </div>
                      <p className="text-base font-bold text-amber-700">Rs {referralFee.toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Payment Settlement Steps ── */}
              <div className="border border-navy-100 rounded-xl overflow-hidden">
                <div className="bg-navy-50 px-4 py-2.5 flex items-center gap-2">
                  <Receipt size={13} className="text-navy-500" />
                  <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide">Payment Settlement</p>
                </div>
                <div className="p-4 space-y-3">

                  {/* Step 1 — Total booking amount */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-navy-500">
                      <StepBadge n={1} />
                      Total Booking Amount
                    </span>
                    <span className="font-bold text-navy-800">Rs {finalAmount.toLocaleString()}</span>
                  </div>
                  {alreadyPaid > 0 && (
                    <div className="flex items-center justify-between text-xs ml-[22px] text-navy-500">
                      <span>Advance already collected</span>
                      <span className="font-semibold text-emerald-700">− Rs {alreadyPaid.toLocaleString()}</span>
                    </div>
                  )}
                  <div className={`flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5 ${balance > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    <span className="font-semibold ml-[22px]">Balance Due at Return</span>
                    <span className="font-bold">Rs {balance.toLocaleString()}</span>
                  </div>

                  <div className="border-t border-navy-100 pt-3 space-y-3">
                    {/* Step 2 — Amount paid by customer */}
                    <div>
                      <label className="label flex items-center gap-1.5 mb-1">
                        <StepBadge n={2} active />
                        Amount Paid by Customer
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-navy-400 font-medium pointer-events-none">Rs</span>
                        <input
                          type="number"
                          min={0}
                          max={balance}
                          value={payAmountPaid}
                          onChange={(e) => {
                            const v = Math.min(balance, Math.max(0, Number(e.target.value)));
                            setPayAmountPaid(v);
                            setPayBadDebt(0);
                          }}
                          className="input pl-9"
                        />
                      </div>
                    </div>

                    {/* Step 3 — Discount */}
                    <div>
                      <label className="label flex items-center gap-1.5 mb-1">
                        <StepBadge n={3} />
                        Discount Amount
                        <span className="text-navy-400 font-normal text-[10px]">(optional)</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-navy-400 font-medium pointer-events-none">Rs</span>
                        <input
                          type="number"
                          min={0}
                          max={Math.max(0, balance - payAmountPaid)}
                          value={payDiscount}
                          onChange={(e) => {
                            const max = Math.max(0, balance - payAmountPaid);
                            setPayDiscount(Math.min(max, Math.max(0, Number(e.target.value))));
                            setPayBadDebt(0);
                          }}
                          className="input pl-9"
                        />
                      </div>
                    </div>

                    {/* Step 4 — Remaining balance (auto) */}
                    <div className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${remaining > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      <span className="flex items-center gap-1.5">
                        <StepBadge n={4} />
                        Remaining Balance
                      </span>
                      <span className="font-bold">Rs {remaining.toLocaleString()}</span>
                    </div>

                    {remaining > 0 && (
                      <>
                        {/* Step 5 — Bad debt write-off */}
                        <div>
                          <label className="label flex items-center gap-1.5 mb-1">
                            <StepBadge n={5} variant="red" />
                            Bad Debt Write-off
                            <span className="text-navy-400 font-normal text-[10px]">(optional)</span>
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-navy-400 font-medium pointer-events-none">Rs</span>
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={payBadDebt}
                              onChange={(e) => setPayBadDebt(Math.min(remaining, Math.max(0, Number(e.target.value))))}
                              className="input pl-9"
                            />
                          </div>
                          <p className="text-[10px] text-red-500 mt-1">This amount will be written off as unrecoverable.</p>
                        </div>

                        {/* Step 6 — Credit transfer (auto) */}
                        {creditToTransfer > 0 ? (
                          <div className="flex items-center justify-between text-xs bg-purple-50 rounded-lg px-3 py-2 text-purple-700">
                            <span className="flex items-center gap-1.5">
                              <StepBadge n={6} variant="purple" />
                              Auto-transferred to Customer Credit
                            </span>
                            <span className="font-bold">Rs {creditToTransfer.toLocaleString()}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                            <CheckCircle2 size={12} />
                            All remaining balance accounted for — no credit transfer needed
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 7 — Referral commission verification */}
              {hasReferral && (
                <div className="border border-amber-200 rounded-xl p-4 bg-amber-50/50">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
                    <StepBadge n={7} variant="amber" />
                    Referral Commission Verification
                  </p>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={referralConfirmed}
                      onChange={(e) => setReferralConfirmed(e.target.checked)}
                      className="mt-0.5 rounded accent-amber-600"
                    />
                    <span className="text-xs text-amber-800">
                      I confirm that the referral commission of{' '}
                      <strong>Rs {referralFee.toLocaleString()}</strong> for{' '}
                      <strong>{referralLabel}</strong> has been reviewed.
                      {booking.referralPaid && (
                        <span className="ml-1 text-emerald-700 font-semibold">(Already marked as paid)</span>
                      )}
                    </span>
                  </label>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    if (booking && vehicle) {
                      saveDraft({
                        type: 'payment',
                        label: `Payment: ${booking.customerName}`,
                        sublabel: `${vehicle.brand} ${vehicle.model} · Rs ${finalAmount.toLocaleString()}`,
                        bookingId: paymentBookingId ?? undefined,
                        vehicleId: booking.vehicleId,
                        formData: { bookingId: paymentBookingId, payAmountPaid, payDiscount, payBadDebt },
                      });
                    }
                    setModal(null);
                    setPaymentBookingId(null);
                  }}
                  className="btn-secondary"
                >
                  Save &amp; Continue Later
                </button>
                <button
                  onClick={() => { setInvoiceBookingId(paymentBookingId); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-navy-50 text-navy-700 hover:bg-navy-100 transition-colors"
                >
                  <BookMarked size={14} />
                  View Invoice
                </button>
                <button
                  onClick={handleConfirmPayment}
                  disabled={!canConfirm}
                  className="flex items-center gap-2 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 size={14} />
                  Confirm &amp; Finalize
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Invoice Modal ── */}
      <InvoiceModal
        bookingId={invoiceBookingId}
        onClose={() => setInvoiceBookingId(null)}
      />

      {/* ── View Record Modal ── */}
      <Modal open={modal === 'view'} onClose={() => setModal(null)} title="Handover Record">
        {viewItem && (() => {
          const booking = bookings.find((b) => b.id === viewItem.bookingId);
          const vehicle = vehicles.find((v) => v.id === viewItem.vehicleId);
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  viewItem.type === 'delivery' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                }`}>
                  {viewItem.type === 'delivery' ? <Truck size={20} /> : <RotateCcw size={20} />}
                </div>
                <div>
                  <p className="text-base font-bold text-navy-800 capitalize">{viewItem.type} Record</p>
                  <p className="text-xs text-navy-400">{booking?.customerName} · {vehicle?.brand} {vehicle?.model}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Location',  viewItem.location],
                  ['Date/Time', viewItem.dateTime.replace('T', ' ')],
                  ['Odometer',  `${viewItem.mileage.toLocaleString()} km`],
                  ['Fuel Level',viewItem.fuelLevel],
                ].map(([l, v]) => (
                  <div key={l} className="bg-navy-50/60 rounded-xl p-3">
                    <p className="text-xs text-navy-400">{l}</p>
                    <p className="text-sm font-semibold text-navy-800">{v}</p>
                  </div>
                ))}
              </div>

              {viewItem.notes && (
                <div className="bg-navy-50/60 rounded-xl p-3">
                  <p className="text-xs text-navy-400">Notes</p>
                  <p className="text-sm text-navy-700">{viewItem.notes}</p>
                </div>
              )}

              {viewItem.type === 'return' && (viewItem.extraKm ?? 0) > 0 && (
                <div className="bg-amber-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Extra Charges</p>
                  <div className="flex justify-between text-xs text-amber-700">
                    <span>Extra km</span><span className="font-bold">+{viewItem.extraKm} km</span>
                  </div>
                  <div className="flex justify-between text-xs text-amber-700">
                    <span>Extra km charge</span><span className="font-bold">Rs {viewItem.extraKmCharge?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-amber-800 border-t border-amber-200 pt-2">
                    <span>Final Amount</span><span>Rs {viewItem.finalAmount?.toLocaleString()}</span>
                  </div>
                </div>
              )}

              <button onClick={() => setModal(null)} className="btn-primary w-full">Close</button>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

/* Small helpers */
function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-navy-50/60 rounded-xl p-2.5">
      <p className="text-[10px] text-navy-400 uppercase tracking-wide">{label}</p>
      <p className="text-xs font-semibold text-navy-800 mt-0.5 truncate">{value}</p>
    </div>
  );
}

function HandoverDetail({
  icon: Icon, value, className = '',
}: {
  icon: React.ElementType; value: string; className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1 ${className || 'text-navy-600'}`}>
      <Icon size={11} className="flex-shrink-0 opacity-70" />
      <span className="truncate">{value}</span>
    </div>
  );
}
