import { useMemo, useState } from 'react';
import { AlertCircle, History, Save } from 'lucide-react';
import Modal from './Modal';
import Select from './Select';
import DateInput from './DateInput';
import TimePicker from './TimePicker';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { rentalDays, statusDateProblem, statusForDates } from '../../lib/availability';
import type { Booking } from '../../types';
import RentalPeriodFields, { PeriodValue } from './RentalPeriodFields';
import { RentalType, UNIT } from '../../lib/rentalPeriod';

const REFERRAL_SOURCES = ['WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Google', 'Word of Mouth'];
const STATUSES: Booking['status'][] = ['Confirmed', 'Ongoing', 'Completed', 'Cancelled'];
const rs = (n?: number) => `Rs ${Math.round(n ?? 0).toLocaleString('en-LK')}`;

/** The booking fields an admin can correct */
const formOf = (b: Booking) => ({
  vehicleId: b.vehicleId,
  customerName: b.customerName ?? '',
  customerPhone: b.customerPhone ?? '',
  customerNIC: b.customerNIC ?? '',
  customerEmail: b.customerEmail ?? '',
  startDate: b.startDate,
  endDate: b.endDate,
  startTime: b.startTime ?? '',
  endTime: b.endTime ?? '',
  waiveExtraDay: !!b.waiveExtraDay,
  rentalType: (b.rentalType ?? 'Daily') as RentalType,
  rentalUnits: b.rentalUnits as number | undefined,
  unitRate: b.unitRate as number | undefined,
  totalDays: b.totalDays,
  dailyRate: b.totalDays ? Math.round(b.totalAmount / b.totalDays) : b.totalAmount,
  totalAmount: b.totalAmount,
  discount: b.discount ?? 0,
  extraCharges: b.extraCharges ?? 0,
  advanceAmount: b.advanceAmount ?? 0,
  paidAmount: b.paidAmount ?? 0,
  creditAmount: b.creditAmount ?? 0,
  status: b.status,
  referral: b.referral ?? 'Direct',
  referralFee: b.referralFee ?? 0,
  pickupLocation: b.pickupLocation ?? '',
  dropLocation: b.dropLocation ?? '',
});
type Form = ReturnType<typeof formOf>;

/** How each field reads in the change list / audit note */
const FIELDS: { key: keyof Form; label: string; fmt?: (v: unknown, f: Form, vehicleName: (id: string) => string) => string }[] = [
  { key: 'vehicleId', label: 'Vehicle', fmt: (v, _f, name) => name(v as string) },
  { key: 'customerName', label: 'Customer' },
  { key: 'customerPhone', label: 'Phone' },
  { key: 'customerNIC', label: 'NIC' },
  { key: 'customerEmail', label: 'Email' },
  { key: 'startDate', label: 'Start date' },
  { key: 'startTime', label: 'Start time' },
  { key: 'endDate', label: 'End date' },
  { key: 'endTime', label: 'End time' },
  { key: 'waiveExtraDay', label: 'Waive extra day', fmt: (v) => (v ? 'yes' : 'no') },
  { key: 'rentalType', label: 'Rental type' },
  { key: 'rentalUnits', label: 'Hours / months' },
  { key: 'unitRate', label: 'Rate per hour / month', fmt: (v) => (v ? rs(v as number) : '—') },
  { key: 'totalDays', label: 'Days' },
  { key: 'totalAmount', label: 'Total', fmt: (v) => rs(v as number) },
  { key: 'discount', label: 'Discount', fmt: (v) => rs(v as number) },
  { key: 'extraCharges', label: 'Extra charges', fmt: (v) => rs(v as number) },
  { key: 'advanceAmount', label: 'Advance', fmt: (v) => rs(v as number) },
  { key: 'paidAmount', label: 'Paid', fmt: (v) => rs(v as number) },
  { key: 'creditAmount', label: 'Credit due', fmt: (v) => rs(v as number) },
  { key: 'status', label: 'Status' },
  { key: 'referral', label: 'Referral' },
  { key: 'referralFee', label: 'Referral fee', fmt: (v) => rs(v as number) },
  { key: 'pickupLocation', label: 'Pickup' },
  { key: 'dropLocation', label: 'Drop' },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-navy-500 mb-1">{label}</label>
      {children}
      {hint}
    </div>
  );
}

const numIn = (v: string) => Math.max(0, Number(v) || 0);

/** Admin-only: correct a booking that was entered wrongly (amounts, dates, status, customer…) */
export default function EditBookingModal({ booking, onClose, onSaved }: { booking: Booking; onClose: () => void; onSaved?: (b: Booking) => void }) {
  const { vehicles, owners, isVehicleAvailable, editBooking } = useStore();
  const staff = useAuthStore((s) => s.currentUser?.name) ?? 'Admin';
  const original = useMemo(() => formOf(booking), [booking]);
  const [f, setF] = useState<Form>(original);
  const [manualTotal, setManualTotal] = useState(false);   // once the total is typed, stop recalculating it
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : '—';
  };

  /** Dates, times, rate or vehicle changed → recalculate days (and the total, unless typed by hand) */
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => {
    const n = { ...cur, [k]: v };
    if (n.rentalType === 'Daily' && ['startDate', 'endDate', 'startTime', 'endTime', 'waiveExtraDay', 'dailyRate', 'vehicleId'].includes(k as string) && n.startDate && n.endDate && n.startDate <= n.endDate) {
      if (k === 'vehicleId') n.dailyRate = vehicles.find((x) => x.id === v)?.dailyRent ?? n.dailyRate;
      n.totalDays = rentalDays(n.startDate, n.endDate, n.startTime, n.endTime, n.waiveExtraDay);
      if (!manualTotal || k === 'dailyRate') n.totalAmount = n.totalDays * n.dailyRate;
    }
    return n;
  });

  /** Hourly / monthly / type change from RentalPeriodFields */
  const applyPeriod = (patch: Partial<PeriodValue>) => {
    setManualTotal(false);
    setF((cur) => ({ ...cur, ...patch } as Form));
  };

  const changes = FIELDS.filter(({ key }) => String(f[key] ?? '') !== String(original[key] ?? ''))
    .map(({ key, label, fmt }) => {
      const show = (x: unknown) => (fmt ? fmt(x, f, vehicleName) : (x === '' || x == null ? '—' : String(x)));
      return `${label}: ${show(original[key])} → ${show(f[key])}`;
    });

  const statusProblem = statusDateProblem(f.status, f);
  const suggested = f.startDate && f.endDate && f.startDate <= f.endDate ? statusForDates(f) : undefined;
  const live = f.status === 'Confirmed' || f.status === 'Ongoing';
  const datesOrVehicleChanged = f.vehicleId !== original.vehicleId || f.startDate !== original.startDate || f.endDate !== original.endDate
    || f.startTime !== original.startTime || f.endTime !== original.endTime || f.status !== original.status;
  const clash = live && datesOrVehicleChanged && !!f.vehicleId && !!f.startDate && !!f.endDate
    && !isVehicleAvailable(f.vehicleId, f.startDate, f.endDate, booking.id, f.startTime, f.endTime);
  const bill = Math.max(0, f.totalAmount + f.extraCharges - f.discount);
  const balance = bill - f.paidAmount - f.advanceAmount;

  const save = () => {
    setError('');
    if (!changes.length) return onClose();
    if (!f.vehicleId) return setError('Choose a vehicle.');
    if (!f.customerName.trim() || !f.customerPhone.trim()) return setError('Customer name and phone are required.');
    if (!f.startDate || !f.endDate || f.startDate > f.endDate) return setError('The end date must be on or after the start date.');
    if (f.rentalType !== 'Daily' && !((f.rentalUnits ?? 0) > 0 && (f.unitRate ?? 0) > 0)) return setError(`Enter the number of ${f.rentalType === 'Hourly' ? 'hours' : 'months'} and the rate.`);
    if (f.totalAmount <= 0) return setError('The total must be greater than 0.');
    if (f.referralFee > f.totalAmount) return setError("The referral fee can't be more than the total.");
    if (statusProblem) return setError(statusProblem);
    if (clash) return setError('This vehicle already has another live booking on these dates.');

    const updates: Partial<Booking> = {
      vehicleId: f.vehicleId,
      customerName: f.customerName.trim(), customerPhone: f.customerPhone.trim(),
      customerNIC: f.customerNIC.trim() || undefined, customerEmail: f.customerEmail.trim() || undefined,
      startDate: f.startDate, endDate: f.endDate, startTime: f.startTime || undefined, endTime: f.endTime || undefined,
      waiveExtraDay: f.waiveExtraDay, totalDays: f.totalDays, totalAmount: f.totalAmount,
      rentalType: f.rentalType, rentalUnits: f.rentalType === 'Daily' ? undefined : f.rentalUnits, unitRate: f.rentalType === 'Daily' ? undefined : f.unitRate,
      discount: f.discount, extraCharges: f.extraCharges, advanceAmount: f.advanceAmount, paidAmount: f.paidAmount,
      creditAmount: f.creditAmount, ...(f.creditAmount === 0 && booking.creditAmount ? { creditSettled: true } : {}),
      status: f.status, referral: f.referral, referralFee: f.referralFee,
      pickupLocation: f.pickupLocation, dropLocation: f.dropLocation,
      pickupAt: f.startTime ? `${f.startDate}T${f.startTime}` : booking.pickupAt,
      returnAt: f.endTime ? `${f.endDate}T${f.endTime}` : booking.returnAt,
    };
    // Send only what actually changed
    const changedKeys = new Set(FIELDS.filter(({ key }) => String(f[key] ?? '') !== String(original[key] ?? '')).map((x) => x.key as string));
    if (changedKeys.has('startTime') || changedKeys.has('startDate')) changedKeys.add('pickupAt');
    if (changedKeys.has('endTime') || changedKeys.has('endDate')) changedKeys.add('returnAt');
    if (changedKeys.has('creditAmount')) changedKeys.add('creditSettled');
    const diff = Object.fromEntries(Object.entries(updates).filter(([k]) => changedKeys.has(k))) as Partial<Booking>;

    editBooking(booking.id, diff, { by: staff, changes, reason: reason.trim() || undefined });
    onSaved?.(useStore.getState().bookings.find((b) => b.id === booking.id) ?? booking);
    onClose();
  };

  const referralOptions = ['Direct', 'Company', ...REFERRAL_SOURCES, ...owners.map((o) => o.name)];
  if (f.referral && !referralOptions.includes(f.referral)) referralOptions.push(f.referral);

  return (
    <Modal open onClose={onClose} title="Correct booking" width="max-w-3xl">
      <div className="space-y-5">
        <p className="text-xs text-navy-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Admin correction. Vehicle revenue, the owner's payout and referral earnings are adjusted automatically, and the change is recorded in the booking notes.
        </p>

        {/* Vehicle & dates */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label="Vehicle">
              <Select searchable searchPlaceholder="Search model or number…" value={f.vehicleId} onChange={(v) => set('vehicleId', v)}
                options={vehicles.map((v) => ({ value: v.id, label: `${v.vehicleNumber} — ${v.brand} ${v.model}`, sub: `Rs ${v.dailyRent.toLocaleString()}/day` }))} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <RentalPeriodFields value={f} onChange={applyPeriod} dailyRate={f.dailyRate} daily={<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Start date"><DateInput value={f.startDate} onChange={(v) => set('startDate', v)} /></Field>
          <Field label="Start time"><TimePicker value={f.startTime} onChange={(t) => set('startTime', t)} placeholder="Handover time" /></Field>
          <Field label="End date"><DateInput value={f.endDate} onChange={(v) => set('endDate', v)} minDate={f.startDate} /></Field>
          <Field label="End time"><TimePicker value={f.endTime} onChange={(t) => set('endTime', t)} placeholder="Return time" /></Field>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
            <input type="checkbox" className="rounded" checked={f.waiveExtraDay} onChange={(e) => set('waiveExtraDay', e.target.checked)} />
            Don't charge a partial extra day (owner approved)
          </label>
            </div>} />
          </div>
          <Field label="Status"
                 hint={statusProblem ? (
                   <p className="mt-1.5 text-xs text-red-600 flex items-start gap-1">
                     <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                     <span>{statusProblem}{suggested && suggested !== f.status && (
                       <button type="button" onClick={() => set('status', suggested)} className="ml-1 font-semibold underline">Set to {suggested}</button>
                     )}</span>
                   </p>
                 ) : clash ? <p className="mt-1.5 text-xs text-red-600">This vehicle already has another live booking on these dates.</p> : null}>
            <Select value={f.status} onChange={(v) => set('status', v as Booking['status'])} options={STATUSES.map((s) => ({ value: s, label: s }))} />
          </Field>
        </section>

        {/* Amounts */}
        <section className="border-t border-navy-100 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {f.rentalType === 'Daily' ? (
            <>
              <Field label="Daily rate (Rs)">
                <input className="input" type="number" min="0" value={f.dailyRate || ''} onChange={(e) => { setManualTotal(false); set('dailyRate', numIn(e.target.value)); }} />
              </Field>
              <Field label="Days">
                <input className="input bg-navy-50" value={f.totalDays} readOnly aria-readonly />
              </Field>
            </>
          ) : (
            <>
              <Field label={`${UNIT[f.rentalType].many[0].toUpperCase()}${UNIT[f.rentalType].many.slice(1)}`}>
                <input className="input bg-navy-50" value={f.rentalUnits ?? ''} readOnly aria-readonly />
              </Field>
              <Field label="Days held">
                <input className="input bg-navy-50" value={f.totalDays} readOnly aria-readonly />
              </Field>
            </>
          )}
          <Field label="Total (Rs)" hint={<p className="text-[11px] text-navy-400 mt-1">{manualTotal ? 'Typed by hand' : f.rentalType === 'Daily' ? `${f.totalDays} × ${rs(f.dailyRate)}` : `${f.rentalUnits ?? 0} × ${rs(f.unitRate ?? 0)}`}</p>}>
            <input className="input" type="number" min="0" value={f.totalAmount || ''} onChange={(e) => { setManualTotal(true); set('totalAmount', numIn(e.target.value)); }} />
          </Field>
          <Field label="Extra charges (Rs)">
            <input className="input" type="number" min="0" value={f.extraCharges || ''} onChange={(e) => set('extraCharges', numIn(e.target.value))} placeholder="0" />
          </Field>
          <Field label="Discount (Rs)">
            <input className="input" type="number" min="0" value={f.discount || ''} onChange={(e) => set('discount', numIn(e.target.value))} placeholder="0" />
          </Field>
          <Field label="Advance (Rs)">
            <input className="input" type="number" min="0" value={f.advanceAmount || ''} onChange={(e) => set('advanceAmount', numIn(e.target.value))} placeholder="0" />
          </Field>
          <Field label="Paid (Rs)">
            <input className="input" type="number" min="0" value={f.paidAmount || ''} onChange={(e) => set('paidAmount', numIn(e.target.value))} placeholder="0" />
          </Field>
          <Field label="Credit due (Rs)">
            <input className="input" type="number" min="0" value={f.creditAmount || ''} onChange={(e) => set('creditAmount', numIn(e.target.value))} placeholder="0" />
          </Field>
          <div className="col-span-2 sm:col-span-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-navy-700 text-white p-2"><p className="text-[11px] opacity-70">Bill</p><p className="font-bold">{rs(bill)}</p></div>
            <div className="rounded-xl bg-emerald-50 p-2"><p className="text-[11px] text-emerald-600">Paid + advance</p><p className="font-bold text-emerald-700">{rs(f.paidAmount + f.advanceAmount)}</p></div>
            <div className={`rounded-xl p-2 ${balance > 0 ? 'bg-red-50' : 'bg-navy-50'}`}>
              <p className={`text-[11px] ${balance > 0 ? 'text-red-500' : 'text-navy-400'}`}>{balance < 0 ? 'Overpaid' : 'Balance'}</p>
              <p className={`font-bold ${balance > 0 ? 'text-red-700' : 'text-navy-700'}`}>{rs(Math.abs(balance))}</p>
            </div>
          </div>
        </section>

        {/* Referral */}
        <section className="border-t border-navy-100 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Referral">
            <Select value={f.referral} onChange={(v) => set('referral', v)} options={referralOptions.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="Referral fee (Rs)" hint={booking.referralPaid && f.referralFee !== original.referralFee ? <p className="text-[11px] text-amber-700 mt-1">This fee was already marked as paid to the referrer.</p> : null}>
            <input className="input" type="number" min="0" value={f.referralFee || ''} onChange={(e) => set('referralFee', numIn(e.target.value))} placeholder="0" />
          </Field>
        </section>

        {/* Customer & places */}
        <section className="border-t border-navy-100 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Customer name"><input className="input" value={f.customerName} onChange={(e) => set('customerName', e.target.value)} /></Field>
          <Field label="Phone"><input className="input" value={f.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} /></Field>
          <Field label="NIC / passport"><input className="input" value={f.customerNIC} onChange={(e) => set('customerNIC', e.target.value)} /></Field>
          <Field label="Email"><input className="input" value={f.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} /></Field>
          <Field label="Pickup location"><input className="input" value={f.pickupLocation} onChange={(e) => set('pickupLocation', e.target.value)} /></Field>
          <Field label="Drop location"><input className="input" value={f.dropLocation} onChange={(e) => set('dropLocation', e.target.value)} /></Field>
        </section>

        {/* What will change */}
        <section className="border-t border-navy-100 pt-4">
          <p className="text-xs font-semibold text-navy-600 flex items-center gap-1.5 mb-1.5"><History size={13} /> Changes ({changes.length})</p>
          {changes.length ? (
            <ul className="text-xs text-navy-600 space-y-0.5 bg-navy-50/60 rounded-xl px-3 py-2">
              {changes.map((c) => <li key={c}>• {c}</li>)}
            </ul>
          ) : <p className="text-xs text-navy-400">Nothing changed yet.</p>}
          <input className="input mt-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the correction (optional), e.g. Entered wrong total" />
        </section>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 flex gap-2"><AlertCircle size={15} className="mt-0.5 flex-shrink-0" />{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={save} disabled={!changes.length} className="btn-primary flex items-center gap-1.5 disabled:opacity-40">
            <Save size={14} /> Save {changes.length || ''} correction{changes.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
