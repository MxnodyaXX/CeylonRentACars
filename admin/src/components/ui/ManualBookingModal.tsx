import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  X, Car, User, Calendar, Gauge, DollarSign, Users,
  MapPin, FileText, AlertCircle, CheckCircle2, Search, UserCheck, Lock,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import Select from './Select';
import ChannelSelect from './ChannelSelect';
import CompanyShareField from './CompanyShareField';
import { companyShareOf } from '../../lib/companyShare';
import { isChannel, isMarketingChannel, referrerOf } from '../../lib/channels';
import DateInput from './DateInput';
import TimePicker from './TimePicker';
import LocationInput from './LocationInput';
import { rentalDays, statusForDates, statusDateProblem } from '../../lib/availability';
import RentalPeriodFields, { PeriodValue } from './RentalPeriodFields';
import { PartDayToggle } from './RentalPriceField';
import { partDayText, rentFor } from '../../lib/partDay';
import DoNotRentWarning from './DoNotRentWarning';
import { CustomerIdFields, MissingDetailsPanel } from './NewBookingDetails';
import type { Booking, CustomerInfo } from '../../types';
import { RentalType } from '../../lib/rentalPeriod';
import { resolveReferralFee } from '../../lib/referral';
import { creditResponsibilityOf } from '../../lib/credit';
import { sendSms } from '../../lib/sms';
import { sendBookingReceipt } from '../../lib/printReceipt';
import ManualMileageFields, { emptyMileage, mileageOf } from './ManualMileageFields';

const genOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

type BookingStatus = 'Confirmed' | 'Ongoing' | 'Completed' | 'Cancelled';

const emptyForm = () => ({
  vehicleId: '',
  customerId: '',
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerNIC: '',
  customerAddress: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  waiveExtraDay: false,
  rentalType: 'Daily' as RentalType,
  rentalUnits: undefined as number | undefined,
  unitRate: undefined as number | undefined,
  totalDays: 0,
  dailyRateUsed: 0,
  /** one of the days is a part day (e.g. an evening pickup) charged this — undefined = none */
  partDayAmount: undefined as number | undefined,
  totalAmount: 0,
  estimatedAmount: 0,
  paidAmount: 0,
  advanceAmount: 0,
  discount: 0,
  paymentMethod: 'Cash',
  creditAmount: 0,
  status: 'Completed' as BookingStatus,
  referral: 'Direct',
  channel: '',
  companyShareType: undefined as Booking['companyShareType'],
  companyShareValue: undefined as number | undefined,
  companyShareMin: undefined as number | undefined,
  referralFeeType: 'fixed' as 'fixed' | 'percent',
  referralFeeValue: 0,
  referralAlreadyPaid: false,
  commissionAlreadyPaid: false,
  notes: '',
  pickupLocation: '',
  dropLocation: '',
  driverId: '',
  customerInfo: {} as CustomerInfo,
  depositType: undefined as 'cash' | 'vehicle' | 'other' | undefined,
  depositVehicleModel: '',
  depositVehicleColor: '',
  depositVehicleNumber: '',
  depositAssetDescription: '',
  depositAmount: 0,
  depositReturned: 0,
  depositDeduction: 0,
  depositNotes: '',
  quotation: { startLocation: '', endLocation: '', stops: [] as string[], isRoundTrip: true, totalKm: 0 },
});

interface Props { onClose: () => void; }

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-navy-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function ManualBookingModal({ onClose }: Props) {
  const { vehicles, owners, drivers, customers, bookings, addManualBooking, saveDraft, discardDraft, drafts, isVehicleAvailable, updateVehicle } = useStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  // Owners can only record bookings against their own vehicles; admins see the full fleet.
  const selectableVehicles = currentUser?.role === 'owner'
    ? vehicles.filter((v) => v.ownerId === currentUser.ownerId)
    : vehicles;
  const [form, setForm]           = useState(emptyForm());
  const [mileageDraft, setMileageDraft] = useState(emptyMileage());
  const [error, setError]         = useState('');
  // Until staff pick a status themselves, it follows the dates (past → Completed, now → Ongoing, future → Confirmed)
  const [statusTouched, setStatusTouched] = useState(false);
  const [customerMode, setCustomerMode] = useState<'new' | 'existing'>('new');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [custFound, setCustFound] = useState<null | 'found' | 'new'>(null);
  const [referralCustom, setReferralCustom] = useState(false);
  const [creditChoice, setCreditChoice] = useState<'balance' | 'discount' | 'credit'>('balance');
  const [creditAck, setCreditAck] = useState(false);
  const [otp, setOtp] = useState<{ sent: boolean; code: string; input: string; verified: boolean; fallback?: string }>({ sent: false, code: '', input: '', verified: false });

  const savedRef = useRef(false);  // true once handleSave succeeds — suppresses draft on close
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore from draft when opened via ?resume=draftId
  useEffect(() => {
    const resumeId = searchParams.get('resume');
    if (!resumeId) return;
    const draft = drafts.find((d) => d.id === resumeId && d.type === 'booking');
    if (draft) {
      setForm(draft.formData as ReturnType<typeof emptyForm>);
      setStatusTouched(true);
      discardDraft(resumeId);
    }
    setSearchParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDiscardClose = () => {
    if (!savedRef.current && (form.customerName !== '' || form.vehicleId !== '')) {
      const veh = vehicles.find((v) => v.id === form.vehicleId);
      saveDraft({
        type: 'booking',
        label: form.customerName ? `Booking: ${form.customerName}` : 'Incomplete Booking',
        sublabel: veh ? `${veh.brand} ${veh.model}` : 'No vehicle selected yet',
        vehicleId: form.vehicleId || undefined,
        formData: { ...form },
      });
    }
    onClose();
  };

  const vehicle     = vehicles.find((v) => v.id === form.vehicleId);
  const vehicleOwner = owners.find((o) => o.id === vehicle?.ownerId);
  const referralFee = resolveReferralFee(form.referralFeeType, form.referralFeeValue, form.totalAmount);
  const companyAmount = companyShareOf(form, form.totalAmount);
  const ownerPayout = Math.max(0, form.totalAmount - referralFee - companyAmount);
  // readings, breakdown replacements and the extra km charge (Ongoing / Completed bookings)
  const mileage = mileageOf(mileageDraft, {
    vehicles, vehicleId: form.vehicleId, status: form.status, startDate: form.startDate, startTime: form.startTime,
    endDate: form.endDate, endTime: form.endTime, totalDays: form.totalDays, by: currentUser?.name ?? 'Admin',
  });
  const billAmount  = Math.max(0, form.totalAmount + mileage.charge - (form.discount || 0));
  // "Amount paid" of a finished (Completed) booking follows the bill (rental + extra km − discount − advance) until typed by hand
  const [paidTouched, setPaidTouched] = useState(false);
  const followBill = form.status === "Completed" && !paidTouched;
  const autoPaid = Math.max(0, billAmount - (form.advanceAmount || 0));
  useEffect(() => {
    if (followBill && form.paidAmount !== autoPaid) setForm((f) => ({ ...f, paidAmount: autoPaid }));
  }, [autoPaid, followBill]); // eslint-disable-line react-hooks/exhaustive-deps
  const paidTotal   = (form.paidAmount || 0) + (form.advanceAmount || 0);
  const due         = Math.max(0, billAmount - paidTotal);

  const isOwnerReferral = !!referrerOf(form.referral) && form.referral !== 'Company';
  // found through marketing with nobody referring them: no one to hold responsible for a credit
  const isSocialReferral = !referrerOf(form.referral) && (isMarketingChannel(form.channel) || isChannel(form.referral));
  const companyResponsible = form.referral === 'Company';
  // A credit on another party's vehicle needs that owner's OTP approval (Company is exempt).
  const needsOwnerOtp = creditChoice === 'credit' && due > 0 && !isSocialReferral && !companyResponsible && !!vehicleOwner;

  const sendOwnerOtp = async () => {
    if (!vehicleOwner) return;
    const code = genOtp();
    const ok = await sendSms(
      vehicleOwner.phone,
      `EMRAC: A credit of Rs ${due.toLocaleString()} for ${form.customerName || 'a customer'} is being recorded against your vehicle. Approve with code ${code}.`,
      { category: 'creditOtp', role: 'owner', transactional: true },
    );
    setOtp({ sent: true, code, input: '', verified: false, fallback: ok ? undefined : code });
  };
  const verifyOwnerOtp = () => setOtp((s) => ({ ...s, verified: s.input.trim() === s.code }));
  const referralOwner   = isOwnerReferral
    ? owners.find((o) => o.name.trim().toLowerCase() === form.referral.trim().toLowerCase())
    : undefined;

  const set = (field: string, value: unknown) => {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      // Recalculate days + amount when dates, times, the waive-extra-day toggle,
      // or vehicle/rate change. Billing follows actual hours held (24h = 1 day),
      // not inclusive calendar days — see rentalDays() in lib/availability.ts.
      const affects = ['startDate', 'endDate', 'startTime', 'endTime', 'waiveExtraDay', 'vehicleId', 'dailyRateUsed', 'partDayAmount'].includes(field);
      if (affects) {
        const s   = updated.startDate;
        const e   = updated.endDate;
        const v   = vehicles.find((x) => x.id === updated.vehicleId);
        // Hourly / monthly prices come from their own rate — only daily is days × the daily rate
        if (s && e && s <= e && updated.rentalType === 'Daily') {
          const days = rentalDays(s, e, updated.startTime, updated.endTime, updated.waiveExtraDay);
          const rate = field === 'dailyRateUsed' ? (value as number) : (updated.dailyRateUsed || v?.dailyRent || 0);
          updated.totalDays   = days;
          updated.dailyRateUsed = rate;
          updated.totalAmount = rentFor(days, rate, updated.partDayAmount);
        }
        if (field === 'vehicleId' && v) updated.dailyRateUsed = v.dailyRent;
        if (!statusTouched && s && e && s <= e && updated.status !== 'Cancelled') updated.status = statusForDates(updated);
      }
      return updated;
    });
  };

  // Hourly / monthly / type change from RentalPeriodFields (status still follows the dates until picked by hand)
  const applyPeriod = (patch: Partial<PeriodValue>) => setForm((f) => {
    const updated = { ...f, ...patch } as typeof f;
    if (!statusTouched && updated.startDate && updated.endDate && updated.startDate <= updated.endDate && updated.status !== 'Cancelled') updated.status = statusForDates(updated);
    return updated;
  });

  // A returning customer's licence / ID details, from their latest booking that has them (shown, and filled in to check)
  const lastDetails = (customerId: string, phone: string) => bookings
    .filter((b) => (b.customerId === customerId || b.customerPhone === phone) && b.customerInfo && Object.keys(b.customerInfo).length)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];

  // Customer phone lookup
  useEffect(() => {
    if (form.customerPhone.length < 7) { setCustFound(null); return; }
    const existing = customers.find((c) => c.phone === form.customerPhone);
    if (existing) {
      setCustFound('found');
      const prev = lastDetails(existing.id, existing.phone);
      setForm((f) => ({ ...f, customerName: existing.name, customerEmail: existing.email ?? '', customerNIC: existing.nic ?? '', customerAddress: existing.address ?? '',
        customerInfo: { ...(prev?.customerInfo ?? {}), ...f.customerInfo } }));
    } else {
      setCustFound('new');
    }
  }, [form.customerPhone, customers]);

  // The status must match the dates — e.g. a rental running Oct 10 → Nov 10 can't be saved as Completed on Oct 20
  const statusProblem = statusDateProblem(form.status, form);
  const suggestedStatus = form.startDate && form.endDate && form.startDate <= form.endDate ? statusForDates(form) : undefined;
  // Live bookings (Confirmed / Ongoing) hold the vehicle, so they can't overlap another live booking
  const clash = !!form.vehicleId && !!form.startDate && !!form.endDate && (form.status === 'Confirmed' || form.status === 'Ongoing')
    && !isVehicleAvailable(form.vehicleId, form.startDate, form.endDate, undefined, form.startTime, form.endTime);

  const handleSave = () => {
    setError('');
    if (!form.vehicleId)      { setError('Please select a vehicle.'); return; }
    if (!form.customerName)   { setError('Customer name is required.'); return; }
    if (!form.customerPhone)  { setError('Customer phone is required.'); return; }
    if (!form.startDate || !form.endDate) { setError('Start and end dates are required.'); return; }
    if (form.startDate > form.endDate)    { setError('End date must be after start date.'); return; }
    if (form.rentalType !== 'Daily' && !((form.rentalUnits ?? 0) > 0 && (form.unitRate ?? 0) > 0)) { setError(`Enter the number of ${form.rentalType === 'Hourly' ? 'hours' : 'months'} and the rate.`); return; }
    if (form.totalAmount <= 0)            { setError('Total amount must be greater than 0.'); return; }
    if (statusProblem)                    { setError(statusProblem); return; }
    if (mileage.problems.length)          { setError(`Mileage: ${mileage.problems[0]}`); return; }
    if (clash)                            { setError(`This vehicle already has a ${form.status === 'Ongoing' ? 'live' : 'confirmed'} booking on these dates — check the dates or the status.`); return; }

    // Resolve the remaining balance into either a discount or a customer credit due.
    let discount = form.discount || 0;
    let creditAmount = 0;
    if (due > 0) {
      if (isSocialReferral) {
        if (creditChoice === 'credit') { setError('Social-media referral bookings cannot be on credit — leave it as the balance due, add it as a discount, or record full payment.'); return; }
      }
      if (creditChoice === 'balance') {
        // an ordinary balance: the customer pays it at pickup / return — no credit, no discount
      } else if (creditChoice === 'discount') {
        discount += due;                 // waive the remaining balance
      } else {
        if (!creditAck) { setError('Please acknowledge the credit responsibility notice before adding a credit due.'); return; }
        if (needsOwnerOtp && !otp.verified) { setError(`Owner approval (OTP) is required before recording this credit on ${vehicleOwner?.name}'s vehicle.`); return; }
        creditAmount = due;              // record as customer credit
      }
    }
    const creditResponsibility = creditResponsibilityOf(form.referral, isOwnerReferral);

    // Combine date + time into precise handover/return timestamps.
    const pickupAt = form.startTime ? `${form.startDate}T${form.startTime}` : undefined;
    const returnAt = form.endTime ? `${form.endDate}T${form.endTime}` : undefined;

    savedRef.current = true;
    const { depositVehicleModel, depositVehicleColor, depositVehicleNumber, ...formData } = form;
    const bookingId = addManualBooking({
      ...formData,
      discount, creditAmount, creditResponsibility, pickupAt, returnAt,
      ...(mileage.checklists && Object.keys(mileage.checklists).length ? { checklists: mileage.checklists } : {}),
      // the extra km is on the bill as a charge (shown with the km on the booking and the invoice) — saved with the booking
      ...(mileage.charge > 0 ? {
        charges: [{ id: Math.random().toString(36).slice(2, 10), kind: 'Other' as const, amount: mileage.charge, date: form.endDate, note: mileage.chargeNote, status: 'Charged' as const, by: currentUser?.name ?? 'Admin', at: new Date().toISOString() }],
        extraCharges: mileage.charge,
      } : {}),
      // the replacement cars' owners are paid for the days they covered
      extraPayouts: mileage.payouts,
      depositAssetDescription: form.depositType === 'vehicle'
        ? [depositVehicleModel, depositVehicleColor, depositVehicleNumber].filter(Boolean).join(' | ')
        : form.depositAssetDescription,
    } as Parameters<typeof addManualBooking>[0]);
    // each car's own mileage follows its last odometer reading (never lowered)
    mileage.carReadings.forEach((r) => {
      const v = useStore.getState().vehicles.find((x) => x.id === r.vehicleId);
      if (v && r.km > (v.mileage ?? 0)) updateVehicle(v.id, { mileage: r.km });
    });
    // Send SMS + email receipt automatically (only for Confirmed bookings)
    if (form.status === 'Confirmed' || !form.status) {
      const newBooking = useStore.getState().bookings.find((b) => b.id === bookingId);
      const receiptVehicle = useStore.getState().vehicles.find((v) => v.id === form.vehicleId);
      const receiptDriver  = useStore.getState().drivers.find((d) => d.id === form.driverId) ?? undefined;
      if (newBooking) sendBookingReceipt(newBooking, receiptVehicle, receiptDriver).catch(console.error);
    }
    onClose();
  };

  const allReferralOptions = [
    'Direct',
    ...owners.map((o) => o.name),
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-navy-700 flex items-center justify-center">
              <FileText size={17} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-navy-800">Add Manual Booking</h2>
              <p className="text-xs text-navy-400">Record a past booking — all related tables will be updated</p>
            </div>
          </div>
          <button onClick={handleDiscardClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {/* Body — two-column layout */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 divide-x divide-gray-100">

            {/* ── LEFT: Form ── */}
            <div className="lg:col-span-2 p-6 space-y-6 overflow-y-auto">

              {/* Vehicle & Dates */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Car size={15} className="text-navy-500" />
                  <h3 className="text-sm font-semibold text-navy-700">Vehicle & Dates</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <Field label="Vehicle" required>
                      <Select searchable searchPlaceholder="Search model or number…" value={form.vehicleId} onChange={(v) => set('vehicleId', v)} placeholder="Select vehicle…" nullable
                        options={selectableVehicles.map((v) => ({ value: v.id, label: `${v.vehicleNumber} — ${v.brand} ${v.model}`, sub: `Rs ${v.dailyRent.toLocaleString()}/day` }))} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <RentalPeriodFields
                      value={form}
                      onChange={applyPeriod}
                      dailyRate={form.dailyRateUsed || vehicle?.dailyRent || 0}
                      daily={<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Start Date" required>
                    <DateInput value={form.startDate} onChange={(v) => set('startDate', v)} />
                  </Field>
                  <Field label="Start Time">
                    <TimePicker value={form.startTime} onChange={(t) => set('startTime', t)} placeholder="Handover time" />
                  </Field>
                  <Field label="End Date" required>
                    <DateInput value={form.endDate} onChange={(v) => set('endDate', v)} minDate={form.startDate} />
                  </Field>
                  <Field label="End Time">
                    <TimePicker value={form.endTime} onChange={(t) => set('endTime', t)} placeholder="Return time" />
                  </Field>
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
                      <input type="checkbox" className="rounded" checked={form.waiveExtraDay} onChange={(e) => set('waiveExtraDay', e.target.checked)} />
                      Don't charge extra days (owner approved) — a partial day past a full 24h period won't be billed as another day
                    </label>
                  </div>
                      </div>}
                    />
                  </div>
                  {form.rentalType === 'Daily' && (
                    <Field label="Daily Rate Used (Rs)" required>
                      <input className="input" type="number" min="0" value={form.dailyRateUsed || ''} onChange={(e) => set('dailyRateUsed', +e.target.value)} />
                    </Field>
                  )}
                  {form.rentalType === 'Daily' && form.totalDays > 0 && (
                    <div className="sm:col-span-2">
                      <PartDayToggle value={form.partDayAmount} days={form.totalDays} rate={form.dailyRateUsed || vehicle?.dailyRent || 0}
                        onChange={(v) => set('partDayAmount', v)} />
                      {(form.partDayAmount ?? 0) > 0 && <p className="text-xs text-navy-500 mt-1">Rental: {partDayText(form.totalDays, form.dailyRateUsed || vehicle?.dailyRent || 0, form.partDayAmount!)} = <b>Rs {form.totalAmount.toLocaleString('en-LK')}</b></p>}
                    </div>
                  )}
                  <Field label="Booking Status" required>
                    <Select value={form.status} onChange={(v) => { setStatusTouched(true); set('status', v as BookingStatus); }}
                      options={['Completed', 'Confirmed', 'Ongoing', 'Cancelled'].map((s) => ({ value: s, label: s }))} />
                    {statusProblem ? (
                      <p className="mt-1.5 text-xs text-red-600 flex items-start gap-1">
                        <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                        <span>
                          {statusProblem}
                          {suggestedStatus && suggestedStatus !== form.status && (
                            <button type="button" onClick={() => { setStatusTouched(true); set('status', suggestedStatus); }} className="ml-1 font-semibold underline">Set to {suggestedStatus}</button>
                          )}
                        </span>
                      </p>
                    ) : !statusTouched && suggestedStatus ? (
                      <p className="mt-1 text-[11px] text-navy-400">Set from the dates</p>
                    ) : null}
                    {clash && <p className="mt-1 text-xs text-red-600">This vehicle already has a live booking on these dates.</p>}
                  </Field>
                </div>
              </section>

              {/* Mileage */}
              {(form.status === 'Completed' || form.status === 'Ongoing') && (
                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <Gauge size={15} className="text-navy-500" />
                    <h3 className="text-sm font-semibold text-navy-700">Mileage</h3>
                  </div>
                  <p className="text-xs text-navy-400 mb-3">Readings from the agreement / handover sheet. Add a breakdown replacement for each car the customer was given on the way — the km of every car count.</p>
                  <ManualMileageFields value={mileageDraft} onChange={setMileageDraft} mileage={mileage}
                    ctx={{ vehicles, vehicleId: form.vehicleId, status: form.status, startDate: form.startDate, startTime: form.startTime, endDate: form.endDate, endTime: form.endTime, totalDays: form.totalDays, by: currentUser?.name ?? 'Admin' }} />
                </section>
              )}

              {/* Customer */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <User size={15} className="text-navy-500" />
                    <h3 className="text-sm font-semibold text-navy-700">Customer</h3>
                  </div>
                  {/* New / Existing toggle */}
                  <div className="flex items-center bg-navy-50 rounded-xl p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => { setCustomerMode('new'); setSelectedCustomerId(''); setForm((f) => ({ ...f, customerName: '', customerPhone: '', customerEmail: '', customerNIC: '', customerAddress: '' })); setCustFound(null); }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${customerMode === 'new' ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}
                    >
                      <User size={12} /> New
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCustomerMode('existing'); setSelectedCustomerId(''); setCustFound(null); }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${customerMode === 'existing' ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}
                    >
                      <UserCheck size={12} /> Existing
                    </button>
                  </div>
                </div>

                {customerMode === 'existing' ? (
                  <div className="space-y-3">
                    <Field label="Select Customer" required>
                      <Select
                        value={selectedCustomerId}
                        onChange={(id) => {
                          const c = customers.find((x) => x.id === id);
                          if (!c) return;
                          setSelectedCustomerId(id);
                          const prev = lastDetails(c.id, c.phone);
                          setForm((f) => ({ ...f, customerId: c.id, customerName: c.name, customerPhone: c.phone, customerEmail: c.email ?? '', customerNIC: c.nic ?? '', customerAddress: c.address ?? '',
                            customerInfo: { ...(prev?.customerInfo ?? {}) } }));
                        }}
                        placeholder="Search customer…"
                        options={customers.map((c) => ({ value: c.id, label: c.name, sub: c.phone + (c.nic ? ` · ${c.nic}` : '') }))}
                      />
                    </Field>
                    {selectedCustomerId && (() => {
                      const c = customers.find((x) => x.id === selectedCustomerId);
                      if (!c) return null;
                      return (
                        <div className="bg-navy-50 border border-navy-100 rounded-xl px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div><span className="text-navy-400">Phone: </span><span className="font-medium text-navy-700">{c.phone}</span></div>
                          {c.email && <div><span className="text-navy-400">Email: </span><span className="font-medium text-navy-700">{c.email}</span></div>}
                          {c.nic && <div><span className="text-navy-400">NIC: </span><span className="font-medium text-navy-700">{c.nic}</span></div>}
                          {c.address && <div><span className="text-navy-400">Address: </span><span className="font-medium text-navy-700">{c.address}</span></div>}
                          <LicenceSummary info={form.customerInfo} until={form.endDate} from={lastDetails(c.id, c.phone)?.startDate} />
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <Field label="Phone Number (auto-detects existing customer)" required>
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input className="input pl-8" placeholder="+94 71 234 5678" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} />
                        </div>
                        {custFound === 'found' && (
                          <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                            <CheckCircle2 size={12} /> Existing customer found — details pre-filled
                          </p>
                        )}
                        <div className="col-span-full"><DoNotRentWarning phone={form.customerPhone} /></div>
                        {custFound === 'new' && (
                          <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                            <AlertCircle size={12} /> New customer — will be added to Customers table
                          </p>
                        )}
                      </Field>
                    </div>
                    <Field label="Full Name" required>
                      <input className="input" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
                    </Field>
                    <Field label="NIC / Passport">
                      <input className="input" value={form.customerNIC} onChange={(e) => set('customerNIC', e.target.value)} />
                    </Field>
                    <Field label="Email">
                      <input className="input" type="email" value={form.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} />
                    </Field>
                    <Field label="Address">
                      <input className="input" value={form.customerAddress} onChange={(e) => set('customerAddress', e.target.value)} />
                    </Field>
                  </div>
                )}
                <div className="mt-4"><CustomerIdFields value={form.customerInfo} selfDrive={!form.driverId} onChange={(ci) => setForm((f) => ({ ...f, customerInfo: ci }))} /></div>
              </section>

              {/* Payment */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign size={15} className="text-navy-500" />
                  <h3 className="text-sm font-semibold text-navy-700">Payment</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Rental (Rs)" required>
                    <input className="input" type="number" min="0" value={form.totalAmount || ''} onChange={(e) => set('totalAmount', +e.target.value)} />
                  </Field>
                  <Field label="Extra km (Rs)">
                    <input className="input bg-navy-50 text-navy-600" readOnly value={mileage.charge ? mileage.charge.toLocaleString() : '0'}
                      title="From the Mileage section — change the readings or the rate there" />
                  </Field>
                  <Field label="Discount (Rs)">
                    <input className="input" type="number" min="0" value={form.discount || ''} onChange={(e) => set('discount', +e.target.value)} />
                  </Field>
                </div>
                {/* the bill, worked out in front of the user */}
                <div className="mt-3 rounded-xl bg-navy-50/70 px-4 py-2.5 text-sm flex flex-wrap items-center justify-between gap-2">
                  <span className="text-navy-500">
                    Rental Rs {form.totalAmount.toLocaleString()}
                    {mileage.charge > 0 && <> + extra km Rs {mileage.charge.toLocaleString()}</>}
                    {form.discount > 0 && <> − discount Rs {form.discount.toLocaleString()}</>}
                  </span>
                  <span className="font-bold text-navy-900">Bill total Rs {billAmount.toLocaleString()}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
                  <Field label="Advance (Rs)">
                    <input className="input" type="number" min="0" value={form.advanceAmount || ''} onChange={(e) => set('advanceAmount', +e.target.value)} />
                  </Field>
                  <Field label="Amount Paid (Rs)">
                    <input className="input" type="number" min="0" value={form.paidAmount || ''} onChange={(e) => { setPaidTouched(true); set('paidAmount', +e.target.value); }} />
                    {!followBill && form.paidAmount !== autoPaid
                      ? <button type="button" onClick={() => { setPaidTouched(false); setForm((f) => ({ ...f, paidAmount: autoPaid })); }} className="mt-1 text-[11px] text-navy-600 underline">Paid in full — Rs {autoPaid.toLocaleString()}</button>
                      : followBill && <p className="mt-1 text-[11px] text-navy-400">Follows the bill total — change it if the customer paid less</p>}
                  </Field>
                  <Field label="Payment Method">
                    <Select value={form.paymentMethod} onChange={(v) => set('paymentMethod', v)}
                      options={['Cash', 'Card', 'Bank Transfer', 'Online', 'Cheque'].map((s) => ({ value: s, label: s }))} />
                  </Field>
                </div>
                {/* Security Deposit — spans full width */}
                <div className="mt-3">
                  <p className="label mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block flex-shrink-0" />
                    Security Deposit
                  </p>
                  <div className="flex items-center gap-2">
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
                        <input className="input w-28"   type="text" value={form.depositVehicleColor}  onChange={(e) => set('depositVehicleColor', e.target.value)}  placeholder="Color" />
                        <input className="input w-32"   type="text" value={form.depositVehicleNumber} onChange={(e) => set('depositVehicleNumber', e.target.value)} placeholder="Vehicle No." />
                      </>
                    )}
                    {form.depositType === 'other' && (
                      <input className="input flex-1" type="text" value={form.depositAssetDescription} onChange={(e) => set('depositAssetDescription', e.target.value)} placeholder="Describe the item held as deposit" />
                    )}
                  </div>
                </div>

                {/* Remaining balance → discount or credit */}
                {due > 0 && (
                  <div className="mt-4 border border-amber-200 bg-amber-50/60 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-navy-700">Remaining balance</span>
                      <span className="text-base font-bold text-red-600">Rs {due.toLocaleString()}</span>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setCreditChoice('balance')}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${creditChoice === 'balance' ? 'bg-navy-700 text-white' : 'bg-white text-navy-600 border border-navy-200'}`}>
                          Balance due — pays at return
                        </button>
                        <button type="button" onClick={() => setCreditChoice('discount')}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${creditChoice === 'discount' ? 'bg-navy-700 text-white' : 'bg-white text-navy-600 border border-navy-200'}`}>
                          Add as Discount
                        </button>
                        <button type="button" onClick={() => setCreditChoice('credit')}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${creditChoice === 'credit' ? 'bg-amber-500 text-white' : 'bg-white text-navy-600 border border-navy-200'}`}>
                          Credit — pays after the rental
                        </button>
                      </div>
                    <p className="text-[11px] text-navy-500">
                      {creditChoice === 'balance' ? 'The usual case: the customer pays the rest when the rental ends. It stays on the booking as the balance due, together with any extra km, charges or deductions at return.'
                        : creditChoice === 'discount' ? 'The remaining amount is given off the price — the customer does not pay it.'
                        : 'Only when the customer is allowed to pay after the rental is over. It is followed up on the Credit page, and is never more than what is still owed.'}
                    </p>
                    {isSocialReferral && creditChoice === 'credit' && (
                      <p className="text-xs text-red-600 flex items-start gap-1.5">
                        <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                        Social-media referral — credit is not allowed.
                      </p>
                    )}
                    {due > 0 && creditChoice === 'credit' && !isSocialReferral && (
                      <div className="space-y-2">
                        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                          <strong>The company is not responsible for credit payments.</strong> You are responsible for handling credit payments with your customers.
                        </div>
                        <p className="text-[11px] text-navy-500">
                          Liability: {isOwnerReferral
                            ? <>the <strong>referring owner ({form.referral})</strong> is responsible (owner approval / OTP required — coming in the next update).</>
                            : form.referral === 'Company'
                              ? <>the <strong>company</strong> is responsible.</>
                              : <>this booking is <strong>yours</strong> — you are fully responsible for collecting it.</>}
                        </p>
                        <label className="flex items-center gap-2 text-xs text-navy-700 cursor-pointer">
                          <input type="checkbox" className="rounded" checked={creditAck} onChange={(e) => setCreditAck(e.target.checked)} />
                          I understand and accept responsibility for this credit.
                        </label>

                        {/* Owner OTP approval (required when the credit sits on another owner's vehicle) */}
                        {needsOwnerOtp && (
                          <div className="bg-white border border-navy-200 rounded-lg p-3 space-y-2">
                            <p className="text-xs font-semibold text-navy-700 flex items-center gap-1.5">
                              <Lock size={12} /> Owner approval required — {vehicleOwner?.name}
                              {otp.verified && <span className="text-green-600 flex items-center gap-1 font-normal"><CheckCircle2 size={11} /> Approved</span>}
                            </p>
                            {!otp.verified && (
                              <>
                                {!otp.sent ? (
                                  <button type="button" onClick={sendOwnerOtp} className="btn btn-secondary text-xs w-full">
                                    Send approval OTP to {vehicleOwner?.name}
                                  </button>
                                ) : (
                                  <>
                                    {otp.fallback && (
                                      <div className="bg-amber-50 border border-amber-200 rounded px-2 py-1 text-[11px] text-amber-800">
                                        SMS not configured — dev OTP: <strong className="font-mono">{otp.fallback}</strong>
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      <input
                                        className="input flex-1 font-mono tracking-widest text-center"
                                        placeholder="000000" maxLength={6}
                                        value={otp.input}
                                        onChange={(e) => setOtp((s) => ({ ...s, input: e.target.value.replace(/\D/g, '') }))}
                                      />
                                      <button type="button" onClick={verifyOwnerOtp} className="btn btn-primary flex-shrink-0">Verify</button>
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {companyResponsible && (
                          <p className="text-[11px] text-blue-600">Company referral — the company is responsible; no owner approval needed.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3">
                  <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
                    <input type="checkbox" className="rounded" checked={form.commissionAlreadyPaid} onChange={(e) => set('commissionAlreadyPaid', e.target.checked)} />
                    The owner was already paid for this outside the monthly payouts <span className="text-navy-400">(leave unticked and it is paid in the next owner payout)</span>
                  </label>
                </div>
              </section>

              {/* Referral */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Users size={15} className="text-navy-500" />
                  <h3 className="text-sm font-semibold text-navy-700">Referral</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ChannelSelect className="sm:col-span-2" value={form.channel} onChange={(v) => set('channel', v)} />
                  <div className="sm:col-span-2">
                    <Field label="Referred By">
                      {referralCustom ? (
                        <div className="flex gap-2">
                          <input className="input flex-1" placeholder="Custom referral name…" value={form.referral === 'Direct' ? '' : form.referral} onChange={(e) => set('referral', e.target.value || 'Direct')} />
                          <button className="text-xs text-navy-500 underline whitespace-nowrap" onClick={() => { setReferralCustom(false); set('referral', 'Direct'); }}>
                            Use list
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Select
                            className="flex-1"
                            value={allReferralOptions.includes(form.referral) ? form.referral : 'Direct'}
                            onChange={(v) => set('referral', v)}
                            options={[
                              { value: 'Direct', label: 'Direct' },
                              ...owners.map((o) => ({ value: o.name, label: o.name, group: 'Owners', sub: 'earns referral fee' })),
                            ]}
                          />
                          <button className="text-xs text-navy-500 underline whitespace-nowrap" onClick={() => setReferralCustom(true)}>
                            Custom
                          </button>
                        </div>
                      )}
                      {referralOwner && (
                        <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                          <CheckCircle2 size={12} /> Owner found — referral fee will update {referralOwner.name}'s profile
                        </p>
                      )}
                    </Field>
                  </div>
                  <CompanyShareField className="sm:col-span-2" value={form} total={form.totalAmount} days={form.totalDays} rentalType={form.rentalType}
                                     onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
                </div>
              </section>

              {/* Additional */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <MapPin size={15} className="text-navy-500" />
                  <h3 className="text-sm font-semibold text-navy-700">Additional Details</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Pickup Location">
                    <LocationInput value={form.pickupLocation} onChange={(v) => set('pickupLocation', v)} placeholder="Pickup location…" />
                  </Field>
                  <Field label="Drop Location">
                    <LocationInput value={form.dropLocation} onChange={(v) => set('dropLocation', v)} placeholder="Drop location…" />
                  </Field>
                  <Field label="Driver (optional)">
                    <Select value={form.driverId} onChange={(v) => set('driverId', v)} placeholder="No driver" nullable
                      options={drivers.map((d) => ({ value: d.id, label: d.name }))} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Notes">
                      <textarea className="input resize-none" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any additional notes about this past booking…" />
                    </Field>
                  </div>
                </div>
              </section>
            </div>

            {/* ── RIGHT: Rent Summary ── */}
            <div className="p-6 bg-gray-50 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-navy-500" />
                <h3 className="text-sm font-semibold text-navy-700">Booking Summary</h3>
              </div>

              {/* Vehicle card */}
              {vehicle ? (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
                  <p className="text-xs text-navy-400">Vehicle</p>
                  <p className="font-semibold text-navy-800">{vehicle.brand} {vehicle.model}</p>
                  <p className="text-xs text-navy-500">{vehicle.vehicleNumber}</p>
                  {vehicleOwner && <p className="text-xs text-navy-400 mt-1">Owner: <span className="font-medium text-navy-600">{vehicleOwner.name}</span></p>}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-navy-400">
                  Select a vehicle to see summary
                </div>
              )}

              {/* Duration */}
              {form.totalDays > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                  <p className="text-xs text-navy-400">Duration</p>
                  {form.rentalType !== 'Daily' && form.rentalUnits ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-navy-600">{form.rentalType === 'Hourly' ? 'Hours' : 'Months'}</span>
                        <span className="font-semibold text-navy-800">{form.rentalUnits}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-navy-600">Rate {form.rentalType === 'Hourly' ? 'per hour' : 'per month'}</span>
                        <span className="font-semibold text-navy-800">Rs {(form.unitRate ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs text-navy-400">
                        <span>Ends</span><span>{form.endDate}{form.endTime ? ` ${form.endTime}` : ''}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-navy-600">Days</span>
                        <span className="font-semibold text-navy-800">{form.totalDays}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-navy-600">Daily Rate</span>
                        <span className="font-semibold text-navy-800">Rs {form.dailyRateUsed.toLocaleString()}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Financial breakdown */}
              {form.totalAmount > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2 text-sm">
                  <p className="text-xs text-navy-400 mb-2">Financial Breakdown</p>

                  <div className="flex justify-between">
                    <span className="text-navy-600">Rental</span>
                    <span className="font-semibold text-navy-800">Rs {form.totalAmount.toLocaleString()}</span>
                  </div>

                  {mileage.charge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-navy-600">Extra km ({mileage.extraKm.toLocaleString()} km)</span>
                      <span className="font-semibold text-navy-800">+ Rs {mileage.charge.toLocaleString()}</span>
                    </div>
                  )}
                  {form.discount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-navy-600">Discount</span>
                      <span className="font-semibold text-emerald-700">− Rs {form.discount.toLocaleString()}</span>
                    </div>
                  )}
                  {(mileage.charge > 0 || form.discount > 0) && (
                    <div className="flex justify-between border-t pt-2">
                      <span className="text-navy-700 font-semibold">Bill total</span>
                      <span className="font-bold text-navy-900">Rs {billAmount.toLocaleString()}</span>
                    </div>
                  )}

                  {companyAmount > 0 && (
                    <div className="flex justify-between text-navy-600">
                      <span>Company commission</span>
                      <span>− Rs {companyAmount.toLocaleString()}</span>
                    </div>
                  )}
                  {referralFee > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Referral Fee → <span className="font-medium">{form.referral}</span></span>
                      <span>− Rs {referralFee.toLocaleString()}</span>
                    </div>
                  )}

                  <div className="flex justify-between border-t pt-2 mt-1">
                    <span className="text-navy-600">Owner Payout{vehicleOwner ? ` → ${vehicleOwner.name}` : ''}</span>
                    <span className="font-semibold text-green-700">Rs {ownerPayout.toLocaleString()}</span>
                  </div>

                  <div className="border-t pt-2 mt-1 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-navy-600">Paid{form.advanceAmount > 0 ? ' + Advance' : ''}</span>
                      <span className="font-semibold text-blue-700">Rs {paidTotal.toLocaleString()}</span>
                    </div>
                    {due > 0 && (
                      <div className="flex justify-between">
                        <span className={creditChoice === 'credit' ? 'text-amber-600' : 'text-red-600'}>
                          {creditChoice === 'credit' ? 'Credit Due' : creditChoice === 'discount' ? 'To Discount' : 'Balance due'}
                        </span>
                        <span className={`font-semibold ${creditChoice === 'credit' ? 'text-amber-600' : 'text-red-600'}`}>Rs {due.toLocaleString()}</span>
                      </div>
                    )}
                    {due === 0 && paidTotal > 0 && (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Fully paid
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* What will be updated */}
              <div className="bg-navy-50 rounded-xl border border-navy-100 p-4 text-xs space-y-1.5">
                <p className="font-semibold text-navy-700 mb-2">Records that will be updated:</p>
                <p className="text-navy-600">✓ Bookings table (new entry)</p>
                <p className={custFound === 'found' ? 'text-navy-600' : 'text-amber-700'}>
                  {custFound === 'found' ? '✓ Customer profile (updated)' : '✓ Customers table (new entry)'}
                </p>
                <p className="text-navy-600">✓ Commissions table (new entry)</p>
                {form.vehicleId && <p className="text-navy-600">✓ Vehicle rent count & revenue</p>}
                {vehicleOwner && <p className="text-navy-600">✓ {vehicleOwner.name}'s earnings</p>}
                {referralOwner && <p className="text-amber-700">✓ {referralOwner.name}'s referral profile</p>}
              </div>

              {/* Status badge */}
              <div className="mt-auto">
                <p className="text-xs text-navy-400 mb-1">Booking Status</p>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                  form.status === 'Completed' ? 'bg-gray-100 text-gray-700' :
                  form.status === 'Confirmed' ? 'bg-blue-100 text-blue-700' :
                  form.status === 'Ongoing'   ? 'bg-green-100 text-green-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {form.status}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pt-3"><MissingDetailsPanel draft={form} /></div>

        {/* Footer */}
        {error && (
          <div className="px-6 py-2 bg-red-50 border-t border-red-100 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle size={15} /> {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn btn-primary">
            Save Manual Booking
          </button>
        </div>
      </div>
    </div>
  );
}

/** The licence / ID details we hold for a returning customer (from their last booking) */
function LicenceSummary({ info, until, from }: { info: CustomerInfo; until?: string; from?: string }) {
  const expired = !!info.licenceExpiry && !!until && info.licenceExpiry < until;
  const rows: [string, string | undefined][] = [
    ['Licence', info.licenceNumber ? `${info.licenceNumber}${info.licenceType ? ` · ${info.licenceType}` : ''}${info.idp ? ' · IDP' : ''}` : undefined],
    ['Licence expiry', info.licenceExpiry],
    ['Passport', info.passportNumber],
    ['Nationality', info.nationality],
    ['Emergency', [info.emergencyName, info.emergencyPhone].filter(Boolean).join(' · ') || undefined],
  ];
  return (
    <div className="col-span-2 border-t border-navy-100 pt-2 mt-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-400 mb-1">Licence &amp; ID{from ? ` — from their booking of ${from}` : ''}</p>
      {!info.licenceNumber && !info.passportNumber ? <p className="text-amber-700">No licence details on file — enter them below.</p> : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><span className="text-navy-400">{k}: </span><span className={`font-medium ${k === 'Licence expiry' && expired ? 'text-red-600' : 'text-navy-700'}`}>{v}{k === 'Licence expiry' && expired ? ' — expires before the rental ends' : ''}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
