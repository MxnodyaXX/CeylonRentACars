import { useMemo, useState } from 'react';
import { AlertCircle, Gauge, History, Receipt, Save } from 'lucide-react';
import Modal from './Modal';
import Select from './Select';
import CompanyShareField from './CompanyShareField';
import { CHANNELS, channelOf } from '../../lib/channels';
import DateInput from './DateInput';
import TimePicker from './TimePicker';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { rentalDays, statusDateProblem, statusForDates } from '../../lib/availability';
import type { Booking, ExtraCharge } from '../../types';
import { useBreakdownStore, tripKmFor } from '../../store/useBreakdownStore';
import UsagePhases from '../breakdowns/UsagePhases';
import ManualMileageFields, { extraKmCharges, mileageDraftOf, mileageOf } from './ManualMileageFields';
import { chargeLine } from '../../lib/bookingRecord';
import { kmWithMeter } from '../../lib/tripKm';
import { toast } from '../../store/useToast';
import RentalPeriodFields, { PeriodValue } from './RentalPeriodFields';
import { PartDayToggle } from './RentalPriceField';
import { fullDayRate, partDayText, rentFor } from '../../lib/partDay';
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
  dailyRate: b.totalDays ? fullDayRate(b) : b.totalAmount,
  /** a part day (e.g. an evening pickup) charged this — 0 = none */
  partDayAmount: b.partDayAmount ?? 0,
  totalAmount: b.totalAmount,
  discount: b.discount ?? 0,
  // the part of the extra charges not tied to a listed charge (extra km, fines, deductions are listed separately)
  extraCharges: (b.extraCharges ?? 0) - (b.charges ?? []).filter((c) => c.status === 'Charged').reduce((t, c) => t + c.amount, 0),
  advanceAmount: b.advanceAmount ?? 0,
  paidAmount: b.paidAmount ?? 0,
  creditAmount: b.creditAmount ?? 0,
  status: b.status,
  referral: b.referral ?? 'Direct',
  channel: channelOf(b) ?? '',
  referralFee: b.referralFee ?? 0,
  companyShareType: b.companyShareType,
  companyShareValue: b.companyShareValue,
  companyShareMin: b.companyShareMin,
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
  { key: 'partDayAmount', label: 'Part day', fmt: (v) => ((v as number) > 0 ? rs(v as number) : 'none') },
  { key: 'totalAmount', label: 'Total', fmt: (v) => rs(v as number) },
  { key: 'discount', label: 'Discount', fmt: (v) => rs(v as number) },
  { key: 'extraCharges', label: 'Other extra charges (not itemised)', fmt: (v) => rs(v as number) },
  { key: 'advanceAmount', label: 'Advance', fmt: (v) => rs(v as number) },
  { key: 'paidAmount', label: 'Paid', fmt: (v) => rs(v as number) },
  { key: 'creditAmount', label: 'Credit due', fmt: (v) => rs(v as number) },
  { key: 'status', label: 'Status' },
  { key: 'referral', label: 'Referral' },
  { key: 'channel', label: 'How they found us' },
  { key: 'referralFee', label: 'Referral fee', fmt: (v) => rs(v as number) },
  { key: 'companyShareType', label: 'Commission method', fmt: (v) => String(v ?? 'none') },
  { key: 'companyShareValue', label: 'Commission', fmt: (v) => String(v ?? '—') },
  { key: 'companyShareMin', label: 'Commission minimum', fmt: (v) => (v ? rs(v as number) : '—') },
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
  const { vehicles, owners, commissions, isVehicleAvailable, editBooking, addSwapPayout, updateSwapPayout, updateVehicle } = useStore();
  const allSwaps = useBreakdownStore((s) => s.swaps);
  const liveSwaps = allSwaps.filter((w) => w.bookingId === booking.id);
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
    if (n.rentalType === 'Daily' && ['startDate', 'endDate', 'startTime', 'endTime', 'waiveExtraDay', 'dailyRate', 'vehicleId', 'partDayAmount'].includes(k as string) && n.startDate && n.endDate && n.startDate <= n.endDate) {
      if (k === 'vehicleId') n.dailyRate = vehicles.find((x) => x.id === v)?.dailyRent ?? n.dailyRate;
      n.totalDays = rentalDays(n.startDate, n.endDate, n.startTime, n.endTime, n.waiveExtraDay);
      if (!manualTotal || k === 'dailyRate' || k === 'partDayAmount') n.totalAmount = rentFor(n.totalDays, n.dailyRate, n.partDayAmount);
    }
    return n;
  });

  /** Hourly / monthly / type change from RentalPeriodFields */
  const applyPeriod = (patch: Partial<PeriodValue>) => {
    setManualTotal(false);
    setF((cur) => ({ ...cur, ...patch } as Form));
  };

  /* ── Mileage: readings, breakdown replacements typed in with the booking, and the extra km charge ──
     A booking with live breakdown swaps or vehicle exchanges keeps its readings there (corrected in
     the usage phases); the others are corrected here. */
  const liveTrip = liveSwaps.length > 0 || (booking.exchanges?.length ?? 0) > 0;
  const mileage0 = useMemo(() => mileageDraftOf(booking), [booking]);
  const [md, setMd] = useState(mileage0);
  const mCtx = { vehicles, vehicleId: f.vehicleId, status: f.status, startDate: f.startDate, startTime: f.startTime, endDate: f.endDate, endTime: f.endTime, totalDays: f.totalDays, by: staff };
  const mileage = mileageOf(md, mCtx);
  const showMileage = f.status === 'Ongoing' || f.status === 'Completed';
  const readingsChanged = !liveTrip && showMileage && JSON.stringify({ ...md, rate: '', chargeKm: false }) !== JSON.stringify({ ...mileage0, rate: '', chargeKm: false });
  // the extra km on the bill now, and what it becomes (unchanged while the readings are incomplete)
  const kmCharges = extraKmCharges(booking);
  const oldKm = kmCharges.reduce((t, c) => t + c.amount, 0);
  const newKm = liveTrip || !showMileage ? oldKm : !md.chargeKm ? 0 : mileage.trip?.total != null ? mileage.charge : oldKm;
  const kmChanged = newKm !== oldKm || (newKm > 0 && !!kmCharges[0] && kmCharges[0].note !== mileage.chargeNote && !liveTrip && mileage.trip?.total != null && md.chargeKm);
  // every other listed charge / deduction stays as it is (managed on the Payments tab)
  const listed = (booking.charges ?? []).filter((c) => c.status === 'Charged' && !kmCharges.includes(c));
  const listedTotal = listed.reduce((t, c) => t + c.amount, 0);
  const extraTotal = listedTotal + newKm + f.extraCharges;

  const r = (n?: number, m?: Parameters<typeof kmWithMeter>[1]) => kmWithMeter(n, m);
  const mileageChanges: string[] = [];
  if (readingsChanged) {
    const p0 = booking.checklists?.pickup, r0 = booking.checklists?.return, c = mileage.checklists;
    if (p0?.odometer !== c?.pickup?.odometer || (p0?.meter ?? 'odo') !== (c?.pickup?.meter ?? 'odo')) mileageChanges.push(`Pickup reading: ${p0 ? r(p0.odometer, p0.meter) : '—'} → ${c?.pickup ? r(c.pickup.odometer, c.pickup.meter) : '—'}`);
    if (r0?.odometer !== c?.return?.odometer || (r0?.meter ?? 'odo') !== (c?.return?.meter ?? 'odo')) mileageChanges.push(`Return reading: ${r0 ? r(r0.odometer, r0.meter) : '—'} → ${c?.return ? r(c.return.odometer, c.return.meter) : '—'}`);
    if (JSON.stringify(md.replacements) !== JSON.stringify(mileage0.replacements)) mileageChanges.push(`Breakdown replacements: ${mileage0.replacements.length} → ${md.replacements.length}${md.replacements.length && mileage0.replacements.length ? ' (readings / dates corrected)' : ''}`);
  }
  if (kmChanged) mileageChanges.push(`Extra km charge: ${rs(oldKm)} → ${rs(newKm)}${newKm ? ` (${mileage.chargeNote})` : ''}`);

  const changes = [...FIELDS.filter(({ key }) => String(f[key] ?? '') !== String(original[key] ?? ''))
    .map(({ key, label, fmt }) => {
      const show = (x: unknown) => (fmt ? fmt(x, f, vehicleName) : (x === '' || x == null ? '—' : String(x)));
      return `${label}: ${show(original[key])} → ${show(f[key])}`;
    }), ...mileageChanges];

  const statusProblem = statusDateProblem(f.status, f);
  const suggested = f.startDate && f.endDate && f.startDate <= f.endDate ? statusForDates(f) : undefined;
  const live = f.status === 'Confirmed' || f.status === 'Ongoing';
  const datesOrVehicleChanged = f.vehicleId !== original.vehicleId || f.startDate !== original.startDate || f.endDate !== original.endDate
    || f.startTime !== original.startTime || f.endTime !== original.endTime || f.status !== original.status;
  const clash = live && datesOrVehicleChanged && !!f.vehicleId && !!f.startDate && !!f.endDate
    && !isVehicleAvailable(f.vehicleId, f.startDate, f.endDate, booking.id, f.startTime, f.endTime);
  const bill = Math.max(0, f.totalAmount + extraTotal - f.discount);
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
    if (readingsChanged && mileage.problems.length) return setError(`Mileage: ${mileage.problems[0]}`);

    const updates: Partial<Booking> = {
      vehicleId: f.vehicleId,
      customerName: f.customerName.trim(), customerPhone: f.customerPhone.trim(),
      customerNIC: f.customerNIC.trim() || undefined, customerEmail: f.customerEmail.trim() || undefined,
      startDate: f.startDate, endDate: f.endDate, startTime: f.startTime || undefined, endTime: f.endTime || undefined,
      waiveExtraDay: f.waiveExtraDay, totalDays: f.totalDays, totalAmount: f.totalAmount,
      ...(f.rentalType === 'Daily' && f.partDayAmount !== (booking.partDayAmount ?? 0) ? { partDayAmount: f.partDayAmount } : {}),
      rentalType: f.rentalType, rentalUnits: f.rentalType === 'Daily' ? undefined : f.rentalUnits, unitRate: f.rentalType === 'Daily' ? undefined : f.unitRate,
      discount: f.discount, extraCharges: extraTotal, advanceAmount: f.advanceAmount, paidAmount: f.paidAmount,
      creditAmount: f.creditAmount, ...(f.creditAmount === 0 && booking.creditAmount ? { creditSettled: true } : {}),
      status: f.status, referral: f.referral, referralFee: f.referralFee, channel: f.channel || undefined,
      companyShareType: f.companyShareType, companyShareValue: f.companyShareValue, companyShareMin: f.companyShareMin,
      pickupLocation: f.pickupLocation, dropLocation: f.dropLocation,
      pickupAt: f.startTime ? `${f.startDate}T${f.startTime}` : booking.pickupAt,
      returnAt: f.endTime ? `${f.endDate}T${f.endTime}` : booking.returnAt,
    };
    // Send only what actually changed
    const changedKeys = new Set(FIELDS.filter(({ key }) => String(f[key] ?? '') !== String(original[key] ?? '')).map((x) => x.key as string));
    if (changedKeys.has('startTime') || changedKeys.has('startDate')) changedKeys.add('pickupAt');
    if (changedKeys.has('endTime') || changedKeys.has('endDate')) changedKeys.add('returnAt');
    if (changedKeys.has('creditAmount')) changedKeys.add('creditSettled');
    if (kmChanged) changedKeys.add('extraCharges');
    const diff = Object.fromEntries(Object.entries(updates).filter(([k]) => changedKeys.has(k))) as Partial<Booking>;
    // the extra km charge: the old one is marked waived (kept for the record) and the corrected one added
    if (kmChanged) {
      const now = new Date().toISOString();
      const fresh: ExtraCharge[] = newKm > 0 ? [{ id: Math.random().toString(36).slice(2, 10), kind: 'Other', amount: newKm, date: f.endDate, note: mileage.chargeNote, status: 'Charged', by: staff, at: now }] : [];
      diff.charges = [...(booking.charges ?? []).map((c) => (kmCharges.includes(c) ? { ...c, status: 'Waived' as const } : c)), ...fresh];
    }
    // the readings: the saved handover records keep their checklist, photos and signature — only the km change
    const owedPaid: string[] = [];
    if (readingsChanged) {
      const c = mileage.checklists ?? {};
      const keep = (old: NonNullable<Booking['checklists']>['pickup'], now: typeof old) => (now ? (old ? { ...old, odometer: now.odometer, meter: now.meter } : now) : undefined);
      const pickup = keep(booking.checklists?.pickup, c.pickup), ret = keep(booking.checklists?.return, c.return);
      diff.checklists = {
        ...(booking.checklists ?? {}),
        pickup, return: ret,
        replacements: c.replacements,
      };
      (['pickup', 'return', 'replacements'] as const).forEach((k) => { if (diff.checklists![k] === undefined) delete diff.checklists![k]; });
    }

    editBooking(booking.id, diff, { by: staff, changes, reason: reason.trim() || undefined });

    if (readingsChanged) {
      // replacement owners' payout lines follow the corrected amounts (a paid one is left — settle it with the owner)
      const want = new Map(mileage.payouts.map((x) => [x.id, x]));
      for (const x of mileage.payouts) {
        const row = commissions.find((c) => c.id === x.id);
        if (!row) addSwapPayout({ ...x, bookingId: booking.id });
        else if (row.status === 'Paid') { if (row.ownerPayout !== x.amount) owedPaid.push(x.id); }
        else if (row.ownerPayout !== x.amount || row.vehicleId !== x.vehicleId) updateSwapPayout(x.id, x.amount, x.note);
      }
      (booking.checklists?.replacements ?? []).forEach((old) => {
        if (!old.payoutId || want.has(old.payoutId)) return;
        const row = commissions.find((c) => c.id === old.payoutId);
        if (row && row.status !== 'Paid') updateSwapPayout(row.id, 0, 'Replacement removed from the booking');
        else if (row) owedPaid.push(row.id);
      });
      mileage.carReadings.forEach((x) => {
        const v = useStore.getState().vehicles.find((y) => y.id === x.vehicleId);
        if (v && x.km > (v.mileage ?? 0)) updateVehicle(v.id, { mileage: x.km });
      });
    }
    // a payout line already paid is not changed — the difference is settled with the owner
    if (owedPaid.length) toast.warning('Paid payout not changed', 'A replacement owner was already paid — settle the difference with them in Commissions.');

    editBooking(booking.id, diff, { by: staff, changes, reason: reason.trim() || undefined });
    onSaved?.(useStore.getState().bookings.find((b) => b.id === booking.id) ?? booking);
    onClose();
  };

  const referralOptions = ['Direct', 'Company', ...owners.map((o) => o.name)];
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
          <Field label="Total (Rs)" hint={<p className="text-[11px] text-navy-400 mt-1">{manualTotal ? 'Typed by hand' : f.rentalType === 'Daily' ? (f.partDayAmount > 0 ? partDayText(f.totalDays, f.dailyRate, f.partDayAmount) : `${f.totalDays} × ${rs(f.dailyRate)}`) : `${f.rentalUnits ?? 0} × ${rs(f.unitRate ?? 0)}`}</p>}>
            <input className="input" type="number" min="0" value={f.totalAmount || ''} onChange={(e) => { setManualTotal(true); set('totalAmount', numIn(e.target.value)); }} />
          </Field>
          {f.rentalType === 'Daily' && f.totalDays > 0 && (
            <div className="col-span-2 sm:col-span-4">
              <PartDayToggle value={f.partDayAmount > 0 ? f.partDayAmount : undefined} days={f.totalDays} rate={f.dailyRate}
                onChange={(v) => { setManualTotal(false); set('partDayAmount', v ?? 0); }} />
            </div>
          )}
          <Field label="Other charges, not itemised (Rs)">
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
          {/* everything on the bill, line by line */}
          <div className="col-span-2 sm:col-span-4 rounded-xl border border-navy-100 px-3 py-2 text-xs space-y-1">
            <p className="font-semibold text-navy-600 flex items-center gap-1.5"><Receipt size={13} /> On the bill</p>
            <p className="flex justify-between"><span className="text-navy-500">Rental</span><span className="tabular-nums">{rs(f.totalAmount)}</span></p>
            {(newKm > 0 || oldKm > 0) && (
              <p className="flex justify-between gap-3"><span className="text-navy-500">Extra km{newKm !== oldKm ? <span className="text-amber-700"> (was {rs(oldKm)})</span> : null}</span><span className="tabular-nums">{rs(newKm)}</span></p>
            )}
            {listed.map((c) => { const l = chargeLine(c); return (
              <p key={c.id} className="flex justify-between gap-3"><span className="text-navy-500 min-w-0">{c.amount < 0 ? 'Deduction — ' : ''}{l.label}{l.detail ? <span className="text-navy-400"> · {l.detail}</span> : null}</span>
                <span className={`tabular-nums whitespace-nowrap ${c.amount < 0 ? 'text-emerald-700' : ''}`}>{c.amount < 0 ? '− ' : ''}{rs(Math.abs(c.amount))}</span></p>
            ); })}
            {f.extraCharges !== 0 && <p className="flex justify-between"><span className="text-navy-500">Other charges (not itemised)</span><span className="tabular-nums">{rs(f.extraCharges)}</span></p>}
            {f.discount > 0 && <p className="flex justify-between"><span className="text-navy-500">Discount</span><span className="tabular-nums text-emerald-700">− {rs(f.discount)}</span></p>}
            <p className="flex justify-between font-bold text-navy-900 border-t border-navy-100 pt-1"><span>Bill</span><span className="tabular-nums">{rs(bill)}</span></p>
            {listed.length > 0 && <p className="text-[11px] text-navy-400">Fines, damage and deductions are added or removed on the booking's Payments tab.</p>}
          </div>
          <div className="col-span-2 sm:col-span-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-navy-700 text-white p-2"><p className="text-[11px] opacity-70">Bill</p><p className="font-bold">{rs(bill)}</p></div>
            <div className="rounded-xl bg-emerald-50 p-2"><p className="text-[11px] text-emerald-600">Paid + advance</p><p className="font-bold text-emerald-700">{rs(f.paidAmount + f.advanceAmount)}</p></div>
            <div className={`rounded-xl p-2 ${balance > 0 ? 'bg-red-50' : 'bg-navy-50'}`}>
              <p className={`text-[11px] ${balance > 0 ? 'text-red-500' : 'text-navy-400'}`}>{balance < 0 ? 'Overpaid' : 'Balance'}</p>
              <p className={`font-bold ${balance > 0 ? 'text-red-700' : 'text-navy-700'}`}>{rs(Math.abs(balance))}</p>
            </div>
          </div>
        </section>

        {/* Mileage */}
        {showMileage && (
          <section className="border-t border-navy-100 pt-4">
            <p className="text-sm font-semibold text-navy-700 flex items-center gap-1.5 mb-1"><Gauge size={15} /> Mileage</p>
            {liveTrip ? (
              <>
                <p className="text-xs text-navy-400 mb-2">This booking has a breakdown replacement or a vehicle exchange — its readings are kept there. Correct a reading with "Correct" on its phase below.</p>
                <UsagePhases trip={tripKmFor(booking)} bookingId={booking.id} includedKm={mileage.includedKm} />
              </>
            ) : (
              <>
                <p className="text-xs text-navy-400 mb-3">Readings from the agreement / handover sheet, and any breakdown replacement on the way. Changing them updates the extra km on the bill.</p>
                <ManualMileageFields value={md} onChange={setMd} mileage={mileage} ctx={mCtx} />
              </>
            )}
          </section>
        )}

        {/* Referral */}
        <section className="border-t border-navy-100 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Referred by">
            <Select value={f.referral} onChange={(v) => set('referral', v)} options={referralOptions.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="How they found us">
            <Select value={f.channel} onChange={(v) => set('channel', v)} placeholder="Not recorded" options={CHANNELS.map((c) => ({ value: c.value, label: c.label, sub: c.sub }))} />
          </Field>
          {(original.referralFee ?? 0) > 0 && (
            <Field label="Referral fee (Rs) — old booking" hint={<p className="text-[11px] text-navy-400 mt-1">Referral fees are no longer paid. Set 0 to remove it.</p>}>
              <input className="input" type="number" min="0" value={f.referralFee || ''} onChange={(e) => set('referralFee', numIn(e.target.value))} placeholder="0" />
            </Field>
          )}
          {f.companyShareType ? (
            <CompanyShareField className="sm:col-span-2" value={f} total={f.totalAmount} days={f.totalDays} rentalType={f.rentalType} autoDefault={false}
                               onChange={(v) => setF((cur) => ({ ...cur, ...v }))} />
          ) : (
            <div className="sm:col-span-2 rounded-xl border border-dashed border-navy-200 px-3 py-2 text-xs text-navy-500 flex items-center justify-between gap-2">
              <span>No company commission on this booking (made before commissions were set).</span>
              <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => setF((cur) => ({ ...cur, companyShareType: 'percent_min', companyShareValue: 15, companyShareMin: 1000 }))}>Add commission</button>
            </div>
          )}
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
