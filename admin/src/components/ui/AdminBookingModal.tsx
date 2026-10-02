/**
 * AdminBookingModal
 *
 * 3-step flow for admins to enter a booking on behalf of an owner:
 *   Step 1 — select an owner
 *   Step 2 — pick from that owner's vehicles (shown as cards)
 *   Step 3 — fill the standard booking form
 *
 * The resulting booking is saved with insertedByAdmin = true so it can be
 * identified and labelled throughout the app.
 */

import { useState, useMemo } from 'react';
import Modal from './Modal';
import Select from './Select';
import TimePicker from './TimePicker';
import LocationInput from './LocationInput';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format, parseISO, addDays } from 'date-fns';
import {
  AlertTriangle, ChevronLeft, CheckCircle, XCircle, Shield,
  Car, ArrowRight, Printer,
} from 'lucide-react';
import { blocksAvailability, bookingStartMs, bookingEndMs, rangesOverlap, rentalDays } from '../../lib/availability';
import { printBookingConfirmation, sendBookingReceipt } from '../../lib/printReceipt';
import { Booking, Owner, Vehicle } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REFERRAL_SOURCES = ['WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Google', 'Word of Mouth'];

const fmt12 = (t?: string) => {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return '';
  const [hh, mm] = t.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${period}`;
};

const isTimeStr = (t?: string) => !!t && /^\d{1,2}:\d{2}$/.test(t);

const freeFromDay = (b: Booking) =>
  isTimeStr(b.endTime) ? b.endDate : addDays(parseISO(b.endDate), 1).toISOString().slice(0, 10);

const dayBlocked = (b: Booking, d: string) => d >= b.startDate && d < freeFromDay(b);

const emptyForm = (vehicleId = '') => ({
  vehicleId,
  customerId: 'c_' + Math.random().toString(36).slice(2, 6),
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerNIC: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  waiveExtraDay: false,
  totalDays: 0,
  totalAmount: 0,
  paidAmount: 0,
  status: 'Confirmed' as const,
  referral: 'Direct',
  referralFeeType: 'fixed' as 'fixed' | 'percent',
  referralFeeValue: 0,
  notes: '',
  pickupLocation: '',
  dropLocation: '',
  driverId: '',
  depositType: undefined as 'cash' | 'vehicle' | 'other' | undefined,
  depositVehicleModel: '',
  depositVehicleColor: '',
  depositVehicleNumber: '',
  depositAssetDescription: '',
  depositAmount: 0,
  insertedByAdmin: true as const,
});

// ── Owner card ────────────────────────────────────────────────────────────────

function OwnerCard({ owner, vehicleCount, onClick }: {
  owner: Owner;
  vehicleCount: number;
  onClick: () => void;
}) {
  const initials = owner.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <button
      onClick={onClick}
      className="card w-full text-left hover:shadow-card-hover hover:border-navy-300 border border-navy-100 transition-all group"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-navy-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-navy-800 truncate">{owner.name}</p>
          <p className="text-xs text-navy-400">{owner.phone}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs font-semibold text-navy-600">{vehicleCount}</p>
          <p className="text-[10px] text-navy-400">vehicle{vehicleCount !== 1 ? 's' : ''}</p>
        </div>
        <ArrowRight size={14} className="text-navy-300 group-hover:text-navy-600 flex-shrink-0 transition-colors" />
      </div>
    </button>
  );
}

// ── Vehicle card ──────────────────────────────────────────────────────────────

function VehicleCard({ vehicle, isSelected, bookings, onClick }: {
  vehicle: Vehicle;
  isSelected: boolean;
  bookings: Booking[];
  onClick: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isBusy = bookings.some(
    (b) => b.vehicleId === vehicle.id && blocksAvailability(b) && dayBlocked(b, today),
  );
  const statusColor = isBusy ? 'bg-red-400' : 'bg-emerald-400';
  const statusLabel = isBusy ? 'Occupied' : 'Available';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
        isSelected
          ? 'border-navy-700 bg-navy-50 shadow-card'
          : 'border-navy-100 bg-white hover:border-navy-300 hover:shadow-card'
      }`}
    >
      {/* Status dot + vehicle number */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-navy-500 tracking-wide">{vehicle.vehicleNumber}</span>
        <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          isBusy ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          {statusLabel}
        </span>
      </div>

      {/* Brand + model */}
      <p className="text-sm font-bold text-navy-800">
        {vehicle.brand} {vehicle.model}
        <span className="text-xs font-normal text-navy-400 ml-1">· {vehicle.year}</span>
      </p>

      {/* Daily rate */}
      <p className="text-xs text-navy-500 mt-1">
        Rs {vehicle.dailyRent.toLocaleString()} <span className="text-navy-300">/ day</span>
      </p>

      {isSelected && (
        <div className="mt-2 flex items-center gap-1 text-navy-700 text-xs font-semibold">
          <CheckCircle size={12} /> Selected
        </div>
      )}
    </button>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = 'owner' | 'vehicle' | 'form' | 'confirmed';

export default function AdminBookingModal({ open, onClose }: Props) {
  const { vehicles, bookings, owners, drivers, customers, addBooking, isVehicleAvailable } = useStore();

  const [step,               setStep]               = useState<Step>('owner');
  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(null);
  const [selectedOwner,   setSelectedOwner]   = useState<Owner | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [form,            setForm]            = useState(emptyForm());
  const [availability,    setAvailability]    = useState<boolean | null>(null);
  const [error,           setError]           = useState('');
  const [startWarn,       setStartWarn]       = useState('');
  const [endWarn,         setEndWarn]         = useState('');
  const [customerMode,    setCustomerMode]    = useState<'new' | 'existing'>('new');
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [referralCustom,  setReferralCustom]  = useState(false);

  // Reset everything when modal is opened/closed
  const handleClose = () => {
    setStep('owner');
    setSelectedOwner(null);
    setSelectedVehicle(null);
    setForm(emptyForm());
    setAvailability(null);
    setError('');
    setStartWarn('');
    setEndWarn('');
    setCustomerMode('new');
    setSelectedCustomer('');
    setReferralCustom(false);
    setConfirmedBookingId(null);
    onClose();
  };

  // Vehicles belonging to the selected owner
  const ownerVehicles = selectedOwner
    ? vehicles.filter((v) => v.ownerId === selectedOwner.id)
    : [];

  // Owners that have at least one vehicle
  const bookableOwners = useMemo(
    () => owners.filter((o) => vehicles.some((v) => v.ownerId === o.id)),
    [owners, vehicles],
  );

  // Form field updater — recalculates days/amount when dates or vehicle change
  const set = (field: string, value: unknown) => {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      const affects = ['startDate', 'endDate', 'vehicleId', 'startTime', 'endTime', 'waiveExtraDay'].includes(field);
      if (affects) {
        const { startDate: s, endDate: e, vehicleId: vid } = updated;
        if (s && e && s <= e) {
          const days    = rentalDays(s, e, updated.startTime, updated.endTime, updated.waiveExtraDay);
          const vehicle = vehicles.find((v) => v.id === vid);
          updated.totalDays   = days;
          updated.totalAmount = days * (vehicle?.dailyRent ?? 0);
        }
        if (s && e && vid) {
          setAvailability(isVehicleAvailable(vid, s, e, undefined, updated.startTime, updated.endTime));
        }
      }
      return updated;
    });
  };

  // Pick owner → go to vehicle step
  const pickOwner = (owner: Owner) => {
    setSelectedOwner(owner);
    setSelectedVehicle(null);
    setForm(emptyForm());
    setAvailability(null);
    setStep('vehicle');
  };

  // Pick vehicle → go to form step
  const pickVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setForm(emptyForm(vehicle.id));
    setAvailability(null);
    setStartWarn('');
    setEndWarn('');
    setStep('form');
  };

  // Date availability helpers
  const isDateAvailable = (date: Date): boolean => {
    if (!form.vehicleId) return true;
    const dateStr = format(date, 'yyyy-MM-dd');
    return !bookings.some(
      (b) => b.vehicleId === form.vehicleId && blocksAvailability(b) && dayBlocked(b, dateStr),
    );
  };

  const handleStartDate = (date: Date | null) => {
    if (!date) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    setStartWarn(isDateAvailable(date) ? '' : 'This date is not available — vehicle is already booked.');
    set('startDate', dateStr);
    setEndWarn('');
  };

  const handleEndDate = (date: Date | null) => {
    if (!date) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    setEndWarn(isDateAvailable(date) ? '' : 'This date is not available — vehicle is already booked.');
    set('endDate', dateStr);
  };

  // Referral logic
  const isPersonReferral = !!form.referral && form.referral !== 'Direct' && !REFERRAL_SOURCES.includes(form.referral);
  const selfReferral = isPersonReferral && !!selectedOwner &&
    form.referral.trim().toLowerCase() === selectedOwner.name.trim().toLowerCase();

  // Conflict detail for the unavailable banner
  const conflictDetail = useMemo(() => {
    if (availability !== false || !form.vehicleId || !form.startDate || !form.endDate) return null;
    const candS = bookingStartMs({ startDate: form.startDate, startTime: form.startTime });
    const candE = bookingEndMs({ endDate: form.endDate, endTime: form.endTime });
    const conflict = bookings.find(
      (b) => b.vehicleId === form.vehicleId && blocksAvailability(b)
        && rangesOverlap(candS, candE, bookingStartMs(b), bookingEndMs(b)),
    );
    return conflict ?? null;
  }, [availability, form.vehicleId, form.startDate, form.endDate, form.startTime, form.endTime, bookings]);

  // Submit
  const handleCreate = () => {
    setError('');
    if (!form.vehicleId || !form.customerName || !form.startDate || !form.endDate) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!isVehicleAvailable(form.vehicleId, form.startDate, form.endDate, undefined, form.startTime, form.endTime)) {
      setError('Vehicle is not available for the selected dates.');
      return;
    }
    if (selfReferral) {
      setError(`${selectedOwner!.name} owns this vehicle and can't also be the referrer.`);
      return;
    }
    const { depositVehicleModel, depositVehicleColor, depositVehicleNumber, ...bookingData } = form;
    const bookingId = addBooking({
      ...bookingData,
      depositAssetDescription: form.depositType === 'vehicle'
        ? [depositVehicleModel, depositVehicleColor, depositVehicleNumber].filter(Boolean).join(' | ')
        : form.depositAssetDescription,
    });
    setConfirmedBookingId(bookingId);
    setStep('confirmed');
    // Send SMS + email receipt automatically on confirmation
    const newBooking = useStore.getState().bookings.find((b) => b.id === bookingId);
    const receiptVehicle = vehicles.find((v) => v.id === form.vehicleId);
    const receiptDriver  = drivers.find((d) => d.id === form.driverId) ?? undefined;
    if (newBooking) sendBookingReceipt(newBooking, receiptVehicle, receiptDriver).catch(console.error);
  };

  // ── Step titles ─────────────────────────────────────────────────────────────
  const stepTitle =
    step === 'owner'   ? 'Enter Owner Booking — Select Owner' :
    step === 'vehicle' ? `Select Vehicle · ${selectedOwner?.name}` :
                         `New Booking · ${selectedVehicle?.brand} ${selectedVehicle?.model} (${selectedVehicle?.vehicleNumber})`;

  return (
    <Modal open={open} onClose={handleClose} title={stepTitle} width="max-w-2xl">

      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs mb-5">
        {(['owner', 'vehicle', 'form'] as Step[]).map((s, i) => {
          const labels = ['Owner', 'Vehicle', 'Booking'];
          const done   = step === 'vehicle' ? i < 1 : step === 'form' ? i < 2 : false;
          const active = s === step;
          return (
            <span key={s} className="flex items-center gap-2">
              {i > 0 && <span className="text-navy-200">›</span>}
              <button
                onClick={() => {
                  if (s === 'owner')   { setStep('owner'); }
                  if (s === 'vehicle' && selectedOwner) { setStep('vehicle'); }
                }}
                disabled={s === 'form' || (s === 'vehicle' && !selectedOwner)}
                className={`font-semibold transition-colors ${
                  active ? 'text-navy-800' :
                  done   ? 'text-navy-500 hover:text-navy-700 cursor-pointer' :
                           'text-navy-300 cursor-default'
                }`}
              >
                {labels[i]}
              </button>
            </span>
          );
        })}
      </div>

      {/* ── STEP 1: Owner selection ─────────────────────────────────────────── */}
      {step === 'owner' && (
        <div className="space-y-2">
          {bookableOwners.length === 0 && (
            <p className="text-sm text-navy-400 text-center py-8">No owners with vehicles registered yet.</p>
          )}
          {bookableOwners.map((owner) => (
            <OwnerCard
              key={owner.id}
              owner={owner}
              vehicleCount={vehicles.filter((v) => v.ownerId === owner.id).length}
              onClick={() => pickOwner(owner)}
            />
          ))}
        </div>
      )}

      {/* ── STEP 2: Vehicle cards ───────────────────────────────────────────── */}
      {step === 'vehicle' && (
        <div>
          {ownerVehicles.length === 0 && (
            <p className="text-sm text-navy-400 text-center py-8">No vehicles registered for this owner.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ownerVehicles.map((v) => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                bookings={bookings}
                isSelected={selectedVehicle?.id === v.id}
                onClick={() => pickVehicle(v)}
              />
            ))}
          </div>

          <div className="flex justify-start mt-5">
            <button
              onClick={() => setStep('owner')}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <ChevronLeft size={14} /> Back
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Booking form ────────────────────────────────────────────── */}
      {step === 'form' && (
        <>
          {/* Admin-inserted notice */}
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4">
            <Car size={14} className="text-amber-600 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              <span className="font-semibold">Admin entry</span> — this booking will be recorded on behalf of{' '}
              <span className="font-semibold">{selectedOwner?.name}</span> and labelled "Inserted By Admin".
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          <div className="space-y-5">
            {/* Customer mode toggle */}
            <div className="flex gap-2 p-1 bg-navy-50 rounded-xl">
              {(['new', 'existing'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setCustomerMode(mode);
                    setSelectedCustomer('');
                    if (mode === 'new') {
                      setForm((f) => ({ ...f, customerName: '', customerPhone: '', customerEmail: '', customerNIC: '' }));
                    }
                  }}
                  className={`flex-1 py-2 rounded-[10px] text-xs font-semibold transition-all ${
                    customerMode === mode ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'
                  }`}
                >
                  {mode === 'new' ? 'New Customer' : 'Existing Customer'}
                </button>
              ))}
            </div>

            {/* Customer fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {customerMode === 'existing' ? (
                <div className="sm:col-span-2">
                  <p className="label">Select Customer *</p>
                  <Select
                    value={selectedCustomer}
                    onChange={(id) => {
                      const c = customers.find((x) => x.id === id);
                      if (!c) return;
                      setSelectedCustomer(id);
                      setForm((f) => ({ ...f, customerName: c.name, customerPhone: c.phone, customerEmail: c.email ?? '', customerNIC: c.nic ?? '' }));
                    }}
                    placeholder="Search and select a customer…"
                    options={customers.map((c) => ({ value: c.id, label: c.name, sub: c.phone + (c.nic ? ` · ${c.nic}` : '') }))}
                  />
                </div>
              ) : (
                <>
                  <div>
                    <p className="label">Customer Name *</p>
                    <input className="input" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="Full name" />
                  </div>
                  <div>
                    <p className="label">Phone</p>
                    <input className="input" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} placeholder="07X XXXXXXX" />
                  </div>
                  <div>
                    <p className="label">Email</p>
                    <input className="input" type="email" value={form.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} placeholder="customer@email.com" />
                  </div>
                  <div>
                    <p className="label">NIC</p>
                    <input className="input" value={form.customerNIC} onChange={(e) => set('customerNIC', e.target.value)} placeholder="NIC number" />
                  </div>
                </>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="label">Start Date *</p>
                <DatePicker
                  selected={form.startDate ? parseISO(form.startDate) : null}
                  onChange={handleStartDate}
                  minDate={new Date()}
                  filterDate={isDateAvailable}
                  dateFormat="yyyy-MM-dd"
                  placeholderText="Select start date"
                  className={`input w-full ${startWarn ? 'border-red-400' : ''}`}
                  calendarClassName="emrac-datepicker"
                  showMonthDropdown showYearDropdown dropdownMode="select"
                />
                {startWarn && <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><XCircle size={12} />{startWarn}</p>}
              </div>
              <div>
                <p className="label">End Date *</p>
                <DatePicker
                  selected={form.endDate ? parseISO(form.endDate) : null}
                  onChange={handleEndDate}
                  minDate={form.startDate ? parseISO(form.startDate) : new Date()}
                  filterDate={isDateAvailable}
                  dateFormat="yyyy-MM-dd"
                  placeholderText="Select end date"
                  className={`input w-full ${endWarn ? 'border-red-400' : ''}`}
                  calendarClassName="emrac-datepicker"
                  showMonthDropdown showYearDropdown dropdownMode="select"
                />
                {endWarn && <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><XCircle size={12} />{endWarn}</p>}
              </div>
            </div>

            {/* Times */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="label">Pickup Time</p>
                <TimePicker value={form.startTime} onChange={(v) => set('startTime', v)} placeholder="Pickup time" />
              </div>
              <div>
                <p className="label">Return Time</p>
                <TimePicker value={form.endTime} onChange={(v) => set('endTime', v)} placeholder="Return time" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
              <input type="checkbox" className="rounded" checked={form.waiveExtraDay} onChange={(e) => set('waiveExtraDay', e.target.checked)} />
              Don't charge extra days (owner approved) — a partial day past a full 24h period won't be billed as another day
            </label>

            {/* Availability banner */}
            {form.vehicleId && form.startDate && form.endDate && availability !== null && (
              availability ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 rounded-xl">
                  <CheckCircle size={15} className="flex-shrink-0" />
                  <span>
                    Available · <span className="font-semibold">{form.totalDays}d</span>
                    {' · '}Base: <span className="font-semibold">Rs {form.totalAmount.toLocaleString()}</span>
                  </span>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle size={14} className="text-red-500 flex-shrink-0" />
                    <span className="text-sm font-bold text-red-700">Selected dates not available</span>
                  </div>
                  {conflictDetail && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <span className="text-red-400">Booked by</span>
                      <span className="font-semibold text-red-800">{conflictDetail.customerName}</span>
                      <span className="text-red-400">Period</span>
                      <span className="font-semibold text-red-800">
                        {conflictDetail.startDate}{conflictDetail.startTime ? ` ${fmt12(conflictDetail.startTime)}` : ''} → {conflictDetail.endDate}{conflictDetail.endTime ? ` ${fmt12(conflictDetail.endTime)}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              )
            )}

            {/* Referral */}
            <div>
              <p className="label">Referral <span className="text-navy-400 font-normal">(who sent this hire)</span></p>
              {referralCustom ? (
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    value={form.referral === 'Direct' ? '' : form.referral}
                    onChange={(e) => set('referral', e.target.value || 'Direct')}
                    placeholder="Third-party name"
                    autoFocus
                  />
                  <button type="button" onClick={() => { setReferralCustom(false); set('referral', 'Direct'); }} className="btn-secondary text-xs flex-shrink-0">
                    Pick from list
                  </button>
                </div>
              ) : (
                <Select
                  value={form.referral}
                  onChange={(val) => {
                    if (val === '__custom__') { setReferralCustom(true); setForm((f) => ({ ...f, referral: '', referralFeeValue: 0 })); return; }
                    const isSource = REFERRAL_SOURCES.includes(val);
                    setForm((f) => ({
                      ...f, referral: val || 'Direct',
                      ...((val === 'Direct' || val === '' || isSource) ? { referralFeeValue: 0 } : {}),
                    }));
                  }}
                  placeholder="Direct"
                  options={[
                    { value: 'Direct', label: 'Direct' },
                    ...owners.map((o) => ({ value: o.name, label: o.name, sub: 'Owner referral · earns a fee' })),
                    ...REFERRAL_SOURCES.map((s) => ({ value: s, label: s, sub: 'Marketing source' })),
                    { value: '__custom__', label: 'Other / third party…', sub: 'Type a name · earns a fee' },
                  ]}
                />
              )}
            </div>

            {/* Self-referral block */}
            {selfReferral && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <div className="flex items-start gap-2">
                  <XCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-red-700">{selectedOwner?.name} owns this vehicle</p>
                    <p className="text-xs text-red-600 mt-0.5">A vehicle owner can't be the referrer for their own vehicle.</p>
                    <button
                      type="button"
                      onClick={() => { setReferralCustom(false); setForm((f) => ({ ...f, referral: 'Direct', referralFeeValue: 0 })); }}
                      className="mt-2 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg px-3 py-1.5 transition-colors"
                    >
                      Set to Direct
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Referral fee */}
            {isPersonReferral && !selfReferral && (
              <div className="bg-navy-50/60 rounded-xl p-3">
                <p className="label">Referral Fee for {form.referral}</p>
                <div className="flex gap-2 items-center">
                  <div className="flex bg-white rounded-xl p-0.5 gap-0.5 border border-navy-100 flex-shrink-0">
                    {(['fixed', 'percent'] as const).map((t) => (
                      <button key={t} type="button" onClick={() => set('referralFeeType', t)}
                        className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${form.referralFeeType === t ? 'bg-navy-700 text-white' : 'text-navy-500'}`}>
                        {t === 'fixed' ? 'Rs' : '%'}
                      </button>
                    ))}
                  </div>
                  <input className="input flex-1" type="number" min={0} value={form.referralFeeValue || ''}
                    onChange={(e) => set('referralFeeValue', +e.target.value)}
                    placeholder={form.referralFeeType === 'percent' ? 'e.g. 5' : 'e.g. 2000'} />
                </div>
                {form.referralFeeValue > 0 && (
                  <p className="text-xs text-navy-500 mt-2">
                    Referrer gets <span className="font-semibold text-navy-800">Rs {(
                      form.referralFeeType === 'percent'
                        ? Math.round(form.totalAmount * (form.referralFeeValue / 100))
                        : Math.round(form.referralFeeValue)
                    ).toLocaleString()}</span> · deducted from owner payout
                  </p>
                )}
              </div>
            )}

            {/* Locations + payment + driver */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="label">Pickup Location</p>
                <LocationInput value={form.pickupLocation} onChange={(v) => set('pickupLocation', v)} placeholder="Pickup location…" />
              </div>
              <div>
                <p className="label">Drop Location</p>
                <LocationInput value={form.dropLocation} onChange={(v) => set('dropLocation', v)} placeholder="Drop location…" />
              </div>
              <div>
                <p className="label">Paid Amount (Rs)</p>
                <input className="input" type="number" value={form.paidAmount} onChange={(e) => set('paidAmount', +e.target.value)} />
              </div>
              <div>
                <p className="label">Assign Driver</p>
                <Select
                  value={form.driverId}
                  onChange={(val) => set('driverId', val)}
                  placeholder="No driver"
                  options={drivers.filter((d) => d.status === 'Available').map((d) => ({
                    value: d.id, label: d.name, sub: `Rs ${d.dailyRate.toLocaleString()} / day`,
                  }))}
                />
              </div>
              <div className="sm:col-span-2">
                <p className="label flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block flex-shrink-0" />
                  Security Deposit
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select
                    className="w-36 flex-shrink-0"
                    value={form.depositType ?? ''}
                    nullable
                    placeholder="None"
                    options={[
                      { value: 'cash',    label: 'Cash' },
                      { value: 'vehicle', label: 'Vehicle' },
                      { value: 'other',   label: 'Other' },
                    ]}
                    onChange={(val) => {
                      const v = val as 'cash' | 'vehicle' | 'other' | '';
                      set('depositType', v || undefined);
                      if (v !== 'cash')    set('depositAmount', 0);
                      if (v !== 'vehicle') { set('depositVehicleModel', ''); set('depositVehicleColor', ''); set('depositVehicleNumber', ''); }
                      if (v !== 'other')   set('depositAssetDescription', '');
                    }}
                  />
                  {form.depositType === 'cash' && (
                    <input className="input flex-1" type="number" min="0" value={form.depositAmount || ''} onChange={(e) => set('depositAmount', +e.target.value)} placeholder="Amount (Rs)" />
                  )}
                  {form.depositType === 'vehicle' && (
                    <>
                      <input className="input flex-1" type="text" value={form.depositVehicleModel}  onChange={(e) => set('depositVehicleModel', e.target.value)}  placeholder="Model (e.g. Honda CB150R)" />
                      <input className="input w-28"  type="text" value={form.depositVehicleColor}  onChange={(e) => set('depositVehicleColor', e.target.value)}  placeholder="Color" />
                      <input className="input w-32"  type="text" value={form.depositVehicleNumber} onChange={(e) => set('depositVehicleNumber', e.target.value)} placeholder="Vehicle No." />
                    </>
                  )}
                  {form.depositType === 'other' && (
                    <input className="input flex-1" type="text" value={form.depositAssetDescription} onChange={(e) => set('depositAssetDescription', e.target.value)} placeholder="Describe the item held as deposit" />
                  )}
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="label">Notes</p>
                <textarea className="input resize-none" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Additional notes..." />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-navy-50">
            <button
              onClick={() => setStep('vehicle')}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <ChevronLeft size={14} /> Back to vehicles
            </button>
            <button
              onClick={handleCreate}
              disabled={selfReferral}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm Booking
            </button>
          </div>
        </>
      )}

      {/* ── Step 4: Confirmed ─────────────────────────────────────────── */}
      {step === 'confirmed' && (() => {
        const confirmedBooking = bookings.find((b) => b.id === confirmedBookingId);
        const assignedDriver   = drivers.find((d) => d.id === form.driverId);
        return (
          <div className="py-6 flex flex-col items-center gap-6 text-center">
            {/* Success icon */}
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle size={32} className="text-emerald-600" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-navy-800 mb-1">Booking Confirmed!</h3>
              <p className="text-sm text-navy-500">
                Ref: <span className="font-mono font-semibold text-navy-700">MRAC-{confirmedBookingId?.slice(0, 8).toUpperCase()}</span>
              </p>
            </div>

            {/* Summary card */}
            {confirmedBooking && (
              <div className="w-full bg-navy-50/60 rounded-2xl p-4 text-left grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-navy-400 text-xs">Customer</span><p className="font-semibold text-navy-800">{confirmedBooking.customerName}</p></div>
                <div><span className="text-navy-400 text-xs">Vehicle</span><p className="font-semibold text-navy-800">{selectedVehicle ? `${selectedVehicle.brand} ${selectedVehicle.model}` : '—'}</p></div>
                <div><span className="text-navy-400 text-xs">Period</span><p className="font-semibold text-navy-800">{confirmedBooking.startDate} → {confirmedBooking.endDate}</p></div>
                <div><span className="text-navy-400 text-xs">Total</span><p className="font-semibold text-navy-800">Rs {confirmedBooking.totalAmount.toLocaleString()}</p></div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 w-full">
              <button
                onClick={handleClose}
                className="btn-secondary flex-1"
              >
                Close
              </button>
              <button
                onClick={() => {
                  if (confirmedBooking)
                    printBookingConfirmation(confirmedBooking, selectedVehicle ?? undefined, assignedDriver);
                }}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Printer size={15} /> Print Confirmation
              </button>
            </div>
            <button
              onClick={() => { setConfirmedBookingId(null); setStep('owner'); setSelectedOwner(null); setSelectedVehicle(null); setForm(emptyForm()); }}
              className="text-xs text-navy-400 hover:text-navy-600 transition-colors"
            >
              + Add another booking
            </button>
          </div>
        );
      })()}
    </Modal>
  );
}
