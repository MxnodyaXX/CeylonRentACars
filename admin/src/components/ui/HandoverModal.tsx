import { useState } from 'react';
import { AlertCircle, ArrowRight, Camera, CheckCircle, ChevronDown, Clock, Info, Loader2, PlayCircle, Plus, Receipt, Repeat, ShieldAlert, Trash2, X } from 'lucide-react';
import Modal from './Modal';
import SignaturePad from './SignaturePad';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import { CHECK_ITEMS, FUEL_LEVELS, depositHeld, monthlyRentUsed, priceBreakdown, rs, uploadBookingFile } from '../../lib/bookingRecord';
import { tripKmFor, useBreakdownStore } from '../../store/useBreakdownStore';
import { SwapReadingsFix } from '../breakdowns/SwapPanel';
import UsagePhases from '../breakdowns/UsagePhases';
import { rentalDays } from '../../lib/availability';
import { breakdownHooks } from '../../store/useStore';
import { printInvoice } from '../../lib/printInvoice';
import type { Booking, ChargeKind, HandoverChecklist, RecoveryReason } from '../../types';
import type { BdSwap } from '../../lib/breakdowns';

const EXTRA_KINDS: ChargeKind[] = ['Fuel', 'Late return', 'Damage', 'Cleaning', 'Traffic fine', 'Toll', 'Parking', 'Other'];
const METHODS = ['Cash', 'Bank transfer', 'Card', 'Online'];
const today = () => new Date().toLocaleDateString('en-CA');

const pad = (n: number) => String(n).padStart(2, '0');
const localNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/**
 * Pickup / return handover: odometer, fuel, checklist, damage photos and the customer's
 * signature. Saving starts (pickup) or completes (return) the rental.
 */
export default function HandoverModal({ booking: b, kind, onClose, onDone }: { booking: Booking; kind: 'pickup' | 'return' | 'recover'; onClose: () => void; onDone?: () => void }) {
  // 'recover': the company takes the vehicle back (non-payment, fraud…) — a return with its reason, closed as "Recovered"
  const recover = kind === 'recover';
  const step = recover ? 'return' as const : kind;
  const { vehicles, commissions, recordHandover, addCharge, recordPayment, settleDeposit, updateVehicle, editBooking, updateCommission, addSwapPayout } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const vehicle = vehicles.find((v) => v.id === b.vehicleId);
  const pickup = b.checklists?.pickup;
  const [at, setAt] = useState(localNow());
  const [location, setLocation] = useState((kind === 'pickup' ? b.pickupLocation : b.dropLocation) ?? '');
  const [odometer, setOdometer] = useState<number | ''>(step === 'return' ? '' : vehicle?.mileage ?? '');
  const [fuel, setFuel] = useState<string>(step === 'return' ? '' : 'Full');
  const [items, setItems] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CHECK_ITEMS.map((i) => [i, step === 'return' ? pickup?.items?.[i] ?? true : true])));
  const [damage, setDamage] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [signature, setSignature] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Km for the return: driven (incl. any earlier car of a mid-trip exchange) vs included, with the extra-km cost
  // older bookings may have no pickup reading saved — then it can be typed in from the agreement
  const [pickupKmIn, setPickupKmIn] = useState('');
  const startKm = pickup?.odometer ?? (Number(pickupKmIn) > 0 ? Number(pickupKmIn) : undefined);
  // every car of the trip: the booked car, breakdown replacements, earlier cars of an exchange (lib/tripKm.ts)
  const swaps = useBreakdownStore((s) => s.swaps);   // subscribed: a missing reading entered here re-renders the km
  const trip = step === 'return' ? tripKmFor(b, { startKm, returnKm: odometer === '' ? undefined : Number(odometer) }) : undefined;
  const swapGaps = trip ? trip.missing.filter((m) => m.swapId) : [];
  const gapSwaps = swaps.filter((w) => swapGaps.some((m) => m.swapId === w.id));
  // breakdown replacements: the customer pays the booking price for those days too — only the owners' payouts move
  const bookingSwaps = step === 'return' ? swaps.filter((w) => w.bookingId === b.id) : [];
  const carNo = (id?: string) => vehicles.find((v) => v.id === id)?.vehicleNumber ?? 'Car';
  const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'now');
  // "1 Oct 2026 · 22:00" from a booking date + time
  const when = (date: string, time?: string) =>
    `${new Date(`${date}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${time ? ` · ${time}` : ''}`;
  // a fleet replacement's owner also earns its extra km: the km it was driven over its own allowance
  // for its days, at its own rate — a separate payout line (sw-km-…), added when the rental completes
  // staff can change the rate or the amount (kmSet); the editor's typed values are kmDraft
  const [kmSet, setKmSet] = useState<Record<string, { rate: number; amount: number }>>({});
  const [kmDraft, setKmDraft] = useState<{ id: string; rate: string; amount: string } | null>(null);
  const replKm = (w: BdSwap) => {
    const leg = trip?.legs.find((l) => l.swapId === w.id && l.role === 'replacement');
    const car = vehicles.find((v) => v.id === w.replacementVehicleId);
    if (!car || w.status !== 'closed' || leg?.km == null || leg.wrong) return undefined;
    const included = (car.includedKmPerDay ?? 100) * Math.max(1, w.days ?? 1);
    const extra = Math.max(0, leg.km - included);
    const o = kmSet[w.id];
    const rate = o?.rate ?? car.extraKmRate ?? 50;
    return { km: leg.km, from: leg.from, to: leg.to, included, extra, rate, amount: o ? o.amount : Math.round(extra * rate), edited: !!o };
  };
  const kmPayoutId = (w: BdSwap) => `sw-km-${w.id}`;
  const kmNote = (w: BdSwap, k: NonNullable<ReturnType<typeof replKm>>) =>
    `Breakdown replacement extra km: ${carNo(w.replacementVehicleId)} was driven ${k.km.toLocaleString()} km in ${w.days ?? 1} day${w.days === 1 ? '' : 's'} (${k.included.toLocaleString()} km included) — ${k.extra.toLocaleString()} km × Rs ${k.rate.toLocaleString()}${k.edited && k.amount !== Math.round(k.extra * k.rate) ? `, set to Rs ${k.amount.toLocaleString()} by ${by}` : ''}`;
  const addKmPayout = (w: BdSwap) => {
    const k = replKm(w);
    if (w.source !== 'fleet' || !k?.amount || useStore.getState().commissions.some((c) => c.id === kmPayoutId(w))) return;
    const e = addSwapPayout({ id: kmPayoutId(w), bookingId: b.id, vehicleId: w.replacementVehicleId!, amount: k.amount, note: kmNote(w, k) });
    if (e) toast.error('Extra km payout not added', e);
  };
  const saveKmEdit = (w: BdSwap) => {
    if (!kmDraft) return;
    const rate = Math.max(0, Number(kmDraft.rate) || 0), amount = Math.max(0, Math.round(Number(kmDraft.amount) || 0));
    setKmSet((s) => ({ ...s, [w.id]: { rate, amount } }));
    setKmDraft(null);
    // already in the owner's payouts (not paid yet) → that line and the owner's totals follow
    const st = useStore.getState();
    const line = st.commissions.find((c) => c.id === kmPayoutId(w));
    if (line && line.status !== 'Paid' && line.ownerPayout !== amount) {
      const k = replKm(w)!;
      updateCommission(line.id, { ownerPayout: amount, totalIncome: amount, note: kmNote(w, { ...k, rate, amount, edited: true }) });
      const owner = st.owners.find((o) => o.id === line.ownerId);
      if (owner) st.updateOwner(owner.id, { totalEarnings: owner.totalEarnings + amount - line.ownerPayout, pendingPayout: owner.pendingPayout + amount - line.ownerPayout });
    }
  };
  // the booked car's last part ends at this return (not when the trip ended in a replacement)
  const lastLeg = trip?.legs[trip.legs.length - 1];
  const finalLeg = lastLeg?.role === 'booked' && !trip!.endedInReplacement ? lastLeg : undefined;
  const carsUsed = trip ? [...new Set(trip.legs.filter((l) => l.km).map((l) => l.car))] : [];
  const driven = trip?.total;
  const [kmAck, setKmAck] = useState(false);
  // a recovery ends the rental early: the km allowance is for the days the customer actually had the car
  const kmDays = recover ? Math.max(1, rentalDays(b.startDate, at.slice(0, 10), b.startTime, at.slice(11, 16), b.waiveExtraDay)) : b.totalDays;
  const includedKm = (vehicle?.includedKmPerDay ?? 100) * (kmDays || 1);
  const extraKm = driven !== undefined ? Math.max(0, driven - includedKm) : 0;

  // ── Settlement at return: rent so far, extra km, other charges, deposit, payment collected ──
  const isReturn = step === 'return';
  const price = priceBreakdown(b, vehicle);
  const kmAlreadyCharged = (b.charges ?? []).some((c) => c.status === 'Charged' && /extra km/i.test(c.note ?? ''));
  const [kmRate, setKmRate] = useState(String(vehicle?.extraKmRate ?? 50));
  const [saveRate, setSaveRate] = useState(false);
  const [chargeKm, setChargeKm] = useState(true);
  const [extras, setExtras] = useState<{ kind: ChargeKind; amount: string; note: string }[]>([]);
  const held = depositHeld(b);
  const [depKeep, setDepKeep] = useState('');
  const [depNote, setDepNote] = useState('');
  const [settleDep, setSettleDep] = useState(held > 0);
  // a recovery usually collects nothing on the spot — what's unpaid stays owed on the booking
  const [collect, setCollect] = useState<string | null>(recover ? '0' : null);   // null = follow the balance
  const [method, setMethod] = useState('Cash');
  const [receiptNo, setReceiptNo] = useState('');
  const [invoice, setInvoice] = useState(true);
  const rate = Math.max(0, Number(kmRate) || 0);
  const kmCharge = isReturn && chargeKm && !kmAlreadyCharged ? Math.round(extraKm * rate) : 0;
  const extrasTotal = extras.reduce((s, x) => s + Math.max(0, Number(x.amount) || 0), 0);
  // Returned early / late (daily rentals): the days actually used, from the scheduled start to the return time
  const daily = isReturn && !recover && (b.rentalType ?? 'Daily') === 'Daily' && b.totalDays > 0;
  const usedDays = daily ? rentalDays(b.startDate, at.slice(0, 10), b.startTime, at.slice(11, 16), b.waiveExtraDay) : b.totalDays;
  const dayRate = b.totalDays ? Math.round(b.totalAmount / b.totalDays) : 0;
  const exchangedDays = (b.exchanges ?? []).reduce((s, e) => s + e.fromDays, 0);
  const early = daily && usedDays < b.totalDays && usedDays >= Math.max(1, exchangedDays);
  const late = daily && usedDays > b.totalDays;
  const [chargeUsedOnly, setChargeUsedOnly] = useState(true);
  const [chargeLate, setChargeLate] = useState(true);
  const usedValue = early ? Math.round((b.totalAmount * usedDays) / b.totalDays) : b.totalAmount;
  const earlyCut = early && chargeUsedOnly ? b.totalAmount - usedValue : 0;
  const lateCharge = late && chargeLate ? (usedDays - b.totalDays) * dayRate : 0;
  // Recovery: why, and the rent the customer owes for the time they had the car (any rental type)
  const [rcReason, setRcReason] = useState<RecoveryReason | ''>('');
  const [rcDetails, setRcDetails] = useState('');
  const [rcPolice, setRcPolice] = useState('');
  const [rcFlag, setRcFlag] = useState(true);
  const [rcRent, setRcRent] = useState<'used' | 'full' | 'custom'>('used');
  const [rcCustom, setRcCustom] = useState('');
  const rType = b.rentalType ?? 'Daily';
  const rcDays = kmDays;
  const perDay = b.totalDays ? b.totalAmount / b.totalDays : 0;
  // monthly: full calendar months + the started days of the month in progress at (monthly rent ÷ its days)
  const monthRate = b.unitRate ?? Math.round(perDay * 30);
  const mu = monthlyRentUsed({ date: b.startDate, time: b.startTime }, at, monthRate, b.waiveExtraDay);
  const usedRent = rType === 'Monthly' ? mu.rent
    : rType === 'Hourly' ? b.totalAmount : Math.round(rcDays * perDay);
  const usedLabel = rType === 'Monthly'
    ? [mu.months ? `${mu.months} full month${mu.months === 1 ? '' : 's'} × ${rs(monthRate)}` : '', mu.days ? `${mu.days} day${mu.days === 1 ? '' : 's'} × ${rs(monthRate)} ÷ ${mu.monthDays}` : ''].filter(Boolean).join(' + ')
    : rType === 'Hourly' ? 'the booked hours' : `${rcDays} day${rcDays === 1 ? '' : 's'} × ${rs(Math.round(perDay))}`;
  // "15 Oct, 07:00" and "7 days 5 h 20 min" for the recovery working
  const dt = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const span = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60; return [d && `${d} day${d === 1 ? '' : 's'}`, h && `${h} h`, mi && `${mi} min`].filter(Boolean).join(' ') || '0 min'; };
  const recoverRent = rcRent === 'full' ? b.totalAmount : rcRent === 'custom' ? Math.max(0, Math.round(Number(rcCustom) || 0)) : usedRent;
  const rentChange = recover ? recoverRent - b.totalAmount : 0;
  const newBill = price.bill - earlyCut + rentChange + kmCharge + extrasTotal + lateCharge;
  const dueNow = Math.max(0, newBill - price.paid);
  const refundDue = Math.max(0, price.paid - newBill);
  const [refundNow, setRefundNow] = useState(true);
  const collectAmt = collect === null ? dueNow : Math.max(0, Number(collect) || 0);
  const remaining = Math.max(0, newBill - price.paid - collectAmt);
  // Recovered with money still owed: keep it as the customer's credit (followed up on the Credit page),
  // or write it off as bad debt — all of it, or part with the rest kept as credit
  const [owedAs, setOwedAs] = useState<'credit' | 'writeoff' | ''>('');
  const [writeOffIn, setWriteOffIn] = useState('');
  const [writeOffWhy, setWriteOffWhy] = useState('');
  const writeOff = owedAs === 'writeoff' ? Math.min(remaining, writeOffIn.trim() === '' ? remaining : Math.max(0, Math.round(Number(writeOffIn) || 0))) : 0;
  const creditLeft = owedAs ? remaining - writeOff : 0;
  const keep = Math.min(held, Math.max(0, Number(depKeep) || 0));

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const path = await uploadBookingFile(b.id, f);
        setPhotos((p) => [...p, path]);
        setPreviews((p) => [...p, URL.createObjectURL(f)]);
      }
    } catch (e) {
      toast.error('Photo not uploaded', (e as Error).message);
    } finally { setUploading(false); }
  };

  const save = () => {
    setError('');
    if (odometer === '' || Number(odometer) <= 0) return setError('Enter the odometer reading.');
    if (!fuel) return setError('Choose the fuel level.');
    if (finalLeg?.wrong && finalLeg.from != null) return setError(`The odometer can't be lower than ${finalLeg.from.toLocaleString()} km (${finalLeg.part.split(' → ')[0].toLowerCase()}).`);
    if (isReturn && swapGaps.length && !kmAlreadyCharged && !kmAck) return setError('Odometer readings of a breakdown replacement are missing — enter them under Extra mileage, or tick that the bill goes out without those km.');
    if (recover && !rcReason) return setError('Choose why the vehicle was recovered.');
    if (recover && rcDetails.trim().length < 5) return setError('Describe what happened (a few words at least).');
    if (recover && rcRent === 'custom' && rcCustom.trim() === '') return setError('Enter the rent the customer owes.');
    if (recover && remaining > 0 && !owedAs) return setError(`${rs(remaining)} is still owed — choose to keep it as credit or write it off as bad debt.`);
    if (recover && writeOff > 0 && !writeOffWhy.trim()) return setError('Say why the amount is written off.');
    const list: HandoverChecklist = {
      at: new Date(at).toISOString(), by, odometer: Number(odometer), fuel, items,
      damage: damage.trim() || undefined, notes: notes.trim() || undefined,
      photos: photos.length ? photos : undefined, signature,
      ...(recover && rcReason ? { recovery: { reason: rcReason, details: rcDetails.trim(), policeRef: rcPolice.trim() || undefined, customerFlagged: rcFlag || undefined } } : {}),
    };
    if (isReturn && settleDep && keep > 0 && !depNote.trim()) return setError('Say why part of the deposit is kept.');
    if (isReturn && extras.some((x) => (Number(x.amount) || 0) > 0 && x.kind === 'Other' && !x.note.trim())) return setError('Describe each "Other" charge.');
    if (isReturn) {
      // nothing is changed when the rental can't be completed (e.g. a breakdown replacement is still out)
      const blocked = breakdownHooks.activeSwapNote?.(b.id);
      if (blocked) return setError(blocked);
      // returned early and only the days used are charged: shorten the booking first (audited; owner payouts follow)
      if (earlyCut > 0) {
        const back = new Date(at);
        editBooking(b.id, {
          endDate: at.slice(0, 10), endTime: at.slice(11, 16), totalDays: usedDays, totalAmount: usedValue,
        }, {
          by, changes: [`Returned early on ${back.toLocaleDateString('en-GB')}: ${usedDays} day${usedDays === 1 ? '' : 's'} used of ${b.totalDays}`, `Price Rs ${b.totalAmount.toLocaleString('en-LK')} → Rs ${usedValue.toLocaleString('en-LK')}`],
          reason: 'Charged for the days used',
        });
      }
      // recovered: the rental ends today — the booking is cut to the recovery date and the rent owed (audited; owner payouts follow)
      if (recover) {
        const on = new Date(at).toLocaleDateString('en-GB');
        const keepType = rcRent === 'full' || (rcRent === 'used' && rType === 'Monthly');
        editBooking(b.id, {
          endDate: at.slice(0, 10), endTime: at.slice(11, 16), totalAmount: recoverRent,
          ...(rcRent === 'full' ? {} : { totalDays: rcDays }),
          ...(rcRent === 'used' && rType === 'Monthly' ? { rentalUnits: mu.months } : {}),
          ...(!keepType && rType !== 'Daily' ? { rentalType: 'Daily' as const, rentalUnits: undefined, unitRate: undefined } : {}),
        }, {
          by, changes: [
            `Vehicle recovered on ${on} (${rcReason}): rental ended ${b.endDate} → ${at.slice(0, 10)}`,
            ...(recoverRent !== b.totalAmount ? [`Rent Rs ${b.totalAmount.toLocaleString('en-LK')} → Rs ${recoverRent.toLocaleString('en-LK')} (${rcRent === 'used' ? usedLabel : 'amount set at recovery'})`] : []),
          ],
          reason: 'Vehicle recovered by the company',
        });
      }
    }
    recordHandover(b.id, step, list, location.trim() || undefined);
    if (isReturn) {
      // only if the rental really completed (e.g. not blocked by a breakdown replacement still out)
      const done = useStore.getState().bookings.find((x) => x.id === b.id);
      if (done?.status !== 'Completed') return;
      bookingSwaps.forEach(addKmPayout);
      // warn staff before renting to this customer again
      if (recover && rcFlag) {
        const st = useStore.getState();
        const same = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-9) === b.customerPhone.replace(/\D/g, '').slice(-9);
        const c = st.customers.find((x) => x.id === b.customerId) ?? st.customers.find((x) => same(x.phone));
        const why = `Vehicle recovered ${new Date(at).toLocaleDateString('en-GB')} (${rcReason}): ${rcDetails.trim()}`;
        if (c && !c.doNotRent) st.updateCustomer(c.id, { doNotRent: true, doNotRentReason: why });
        // no customer record yet (older bookings) — make one, so the warning shows when their number is typed again
        if (!c) st.addCustomer({ name: b.customerName, phone: b.customerPhone, email: b.customerEmail, nic: b.customerNIC, doNotRent: true, doNotRentReason: why });
      }
      // a pickup reading typed in now (none was saved at pickup) is kept, so the booking and invoice show the km
      if (!pickup && startKm !== undefined) {
        useStore.getState().logBookingActivity(b.id, { by, type: 'Handover', text: `Pickup odometer ${startKm.toLocaleString()} km entered at return (from the agreement)` }, {
          checklists: { ...(done.checklists ?? {}), pickup: { at: b.pickupAt ?? new Date(`${b.startDate}T${b.startTime ?? '09:00'}`).toISOString(), by, odometer: startKm, fuel: '—', items: {}, notes: 'Entered at return from the agreement' } },
        });
      }
      if (saveRate && vehicle && rate !== (vehicle.extraKmRate ?? 50)) updateVehicle(vehicle.id, { extraKmRate: rate });
      if (lateCharge > 0) addCharge(b.id, { kind: 'Late return', amount: lateCharge, date: today(), note: `${usedDays - b.totalDays} extra day${usedDays - b.totalDays === 1 ? '' : 's'} × Rs ${dayRate.toLocaleString('en-LK')} (booked until ${b.endDate})`, by });
      if (kmCharge > 0) addCharge(b.id, { kind: 'Other', amount: kmCharge, date: today(), note: `Extra km: ${extraKm.toLocaleString()} km × Rs ${rate.toLocaleString()}${carsUsed.length > 1 ? ` (${driven!.toLocaleString()} km driven in ${carsUsed.join(' + ')})` : ''}`, by });
      extras.forEach((x) => {
        const amount = Math.max(0, Number(x.amount) || 0);
        if (amount > 0) addCharge(b.id, { kind: x.kind, amount, date: today(), note: x.note.trim() || undefined, by });
      });
      if (collectAmt > 0) recordPayment(b.id, { kind: 'Payment', amount: collectAmt, method, receiptNo: receiptNo.trim() || undefined, note: recover ? 'Collected at recovery' : 'Collected at return', by });
      if (refundDue > 0 && refundNow) recordPayment(b.id, { kind: 'Refund', amount: refundDue, method, receiptNo: receiptNo.trim() || undefined, note: 'Overpayment refunded at return', by });
      if (settleDep && held > 0) settleDeposit(b.id, { returned: held - keep, deduction: keep, method, notes: depNote.trim() || undefined }, by);
      // what's still owed after a recovery: the customer's credit, and/or written off as bad debt
      if (recover && owedAs && remaining > 0) {
        const st = useStore.getState();
        const fresh = st.bookings.find((x) => x.id === b.id)!;
        const parts = [
          writeOff > 0 ? `${rs(writeOff)} written off as bad debt — ${writeOffWhy.trim()}` : '',
          creditLeft > 0 ? `${rs(creditLeft)} kept as credit — the customer still owes it` : '',
        ].filter(Boolean);
        st.logBookingActivity(b.id, { by, type: 'Payment', text: `Owed after the recovery: ${parts.join('; ')}` }, {
          ...(writeOff > 0 ? { badDebt: (fresh.badDebt ?? 0) + writeOff } : {}),
          creditAmount: creditLeft, creditSettled: creditLeft > 0 ? false : !!fresh.creditAmount,
        });
      }
      if (invoice) {
        const fresh = useStore.getState().bookings.find((x) => x.id === b.id);
        if (fresh && !printInvoice(fresh, vehicle)) toast.error('Invoice not opened', 'Allow pop-ups for this site, then use "Print invoice" in the booking.');
      }
    }
    onDone?.();
    onClose();
  };

  const missingItems = CHECK_ITEMS.filter((i) => !items[i]);

  return (
    <Modal open onClose={onClose} title={kind === 'pickup' ? 'Hand over vehicle — start rental' : recover ? 'Recover vehicle — company takes it back' : 'Receive vehicle — complete rental'} width={isReturn ? 'max-w-[1400px]' : 'max-w-3xl'} maxHeight="max-h-[96vh]">
      <div className="space-y-3">
        <div className="rounded-xl bg-navy-50/70 px-3 py-2 text-sm flex flex-wrap justify-between gap-2">
          <span><b className="text-navy-800">{b.customerName}</b> <span className="text-navy-500">· {vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})` : ''}</span></span>
          {isReturn && pickup && <span className="text-xs text-navy-500">At pickup: {pickup.odometer.toLocaleString()} km · fuel {pickup.fuel}</span>}
        </div>
        {recover && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900 flex gap-2">
            <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" />
            <p><b>The company is taking the vehicle back</b> before the rental ends — this is not a normal return. The booking is closed as <b>Recovered</b> on the date above, and whatever the customer hasn't paid stays owed on the booking.</p>
          </div>
        )}
        {/* readings, then checklist / notes / photos / signature folded | payment & settlement given the room */}
        <div className={`grid grid-cols-1 gap-4 ${isReturn ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]' : ''}`}>
          <div className="space-y-3 min-w-0">
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-navy-500">{kind === 'pickup' ? 'Handed over at' : recover ? 'Recovered at' : 'Returned at'}
                <input type="datetime-local" className="input mt-1" value={at} onChange={(e) => setAt(e.target.value)} />
              </label>
              <label className="text-xs font-medium text-navy-500">Location
                <input className="input mt-1" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Colombo office / Hotel" />
              </label>
              <label className="text-xs font-medium text-navy-500">Odometer (km) *
                <input className="input mt-1" type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value === '' ? '' : Number(e.target.value))} placeholder="e.g. 48,250" />
              </label>
              <div className="text-xs font-medium text-navy-500">Fuel level *
                <div className="grid grid-cols-5 gap-1 mt-1">
                  {FUEL_LEVELS.map((f) => (
                    <button key={f} type="button" onClick={() => setFuel(f)}
                            className={`py-2 rounded-lg text-xs font-semibold border ${fuel === f ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {recover && (
              <section className="rounded-xl border border-red-200 p-3 space-y-3">
                <p className="text-sm font-semibold text-navy-800">Why was the vehicle recovered? *</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['Non-payment', 'Fraud / false details', 'Agreement broken', 'Misuse / unsafe use', 'Not returned on time', 'Other'] as RecoveryReason[]).map((r) => (
                    <button key={r} type="button" onClick={() => setRcReason(r)}
                            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${rcReason === r ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-navy-200 text-navy-700 hover:border-red-300'}`}>{r}</button>
                  ))}
                </div>
                <label className="text-xs font-medium text-navy-500 block">What happened *
                  <textarea className="input mt-1 min-h-[80px]" value={rcDetails} onChange={(e) => setRcDetails(e.target.value)}
                            placeholder="e.g. Rent unpaid since 15 Sep, calls not answered; gave a false address. Vehicle taken back from Kandy with the owner's consent." />
                </label>
                <label className="text-xs font-medium text-navy-500 block">Police complaint / entry no. (if one was made)
                  <input className="input mt-1" value={rcPolice} onChange={(e) => setRcPolice(e.target.value)} placeholder="e.g. CIB 123/2026 — Kandy police" />
                </label>
                <label className="flex items-start gap-2 text-sm text-navy-700"><input type="checkbox" className="mt-0.5" checked={rcFlag} onChange={(e) => setRcFlag(e.target.checked)} />
                  <span>Flag {b.customerName} as <b className="text-red-700">do not rent</b> — staff are warned if they try to book this customer again</span></label>
              </section>
            )}

            {driven !== undefined && driven >= 0 && (
              <div className={`rounded-xl px-3 py-2.5 text-sm ${extraKm ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
                <b>{driven.toLocaleString()} km</b> driven{carsUsed.length > 1 ? ` in ${carsUsed.length} cars` : ''} · {includedKm.toLocaleString()} km included
                {extraKm > 0 && <> · <b>{extraKm.toLocaleString()} extra km</b></>}
              </div>
            )}

            <Fold title="Checklist" hint={missingItems.length ? `${missingItems.length} not OK` : `All ${CHECK_ITEMS.length} OK`} warn={missingItems.length > 0}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {CHECK_ITEMS.map((i) => (
                  <label key={i} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm cursor-pointer ${items[i] ? 'border-emerald-200 bg-emerald-50/50 text-navy-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    <input type="checkbox" className="accent-emerald-600" checked={!!items[i]} onChange={(e) => setItems((x) => ({ ...x, [i]: e.target.checked }))} />
                    {i}
                  </label>
                ))}
              </div>
              {missingItems.length > 0 && <p className="text-[11px] text-red-600 mt-1">Not OK / missing: {missingItems.join(', ')}</p>}
            </Fold>

            <Fold title="Damage & notes" hint={damage.trim() ? 'Damage noted' : notes.trim() ? 'Notes added' : 'None'} warn={!!damage.trim()}>
              <div className="grid grid-cols-1 gap-3">
                <label className="text-xs font-medium text-navy-500">Damage / scratches noted
                  <textarea className="input mt-1 min-h-[70px]" value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="e.g. Small scratch on rear bumper (left)" />
                </label>
                <label className="text-xs font-medium text-navy-500">Other notes
                  <textarea className="input mt-1 min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else to remember" />
                </label>
              </div>
            </Fold>

            <Fold title="Photos of the vehicle" hint={uploading ? 'Uploading…' : photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'None yet'}>
              <div className="flex flex-wrap gap-2">
                {previews.map((p, i) => (
                  <div key={p} className="relative w-20 h-16 rounded-lg overflow-hidden bg-navy-50">
                    <img src={p} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => { setPhotos((x) => x.filter((_, j) => j !== i)); setPreviews((x) => x.filter((_, j) => j !== i)); }}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Remove photo"><X size={11} /></button>
                  </div>
                ))}
                <label className="w-20 h-16 rounded-lg border border-dashed border-navy-200 flex flex-col items-center justify-center text-[10px] text-navy-400 cursor-pointer hover:bg-navy-50">
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                  {uploading ? 'Uploading' : 'Add photos'}
                  <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                </label>
              </div>
              <p className="text-[11px] text-navy-400 mt-1">Front, back, both sides and any damage — these settle deposit disputes.</p>
            </Fold>

            <Fold title="Customer signature" hint={signature ? 'Signed' : 'Not signed'}>
              <SignaturePad onChange={setSignature} />
              <p className="text-[11px] text-navy-400 mt-1">The customer confirms the condition, fuel and km above.</p>
            </Fold>
          </div>

        {isReturn && (
          <section className="rounded-2xl border border-navy-100 p-4 space-y-3 min-w-0 self-start">
            <p className="label !mb-0 !text-sm flex items-center gap-1.5"><Receipt size={16} /> Payment &amp; settlement</p>

            {/* returned early / late */}
            {(early || late) && (
              <div className={`rounded-xl p-3 space-y-2.5 ${early ? 'bg-sky-50 text-sky-900' : 'bg-amber-50 text-amber-900'}`}>
                <p className="text-sm font-semibold">
                  {early ? `Returned ${b.totalDays - usedDays} day${b.totalDays - usedDays === 1 ? '' : 's'} early — ${usedDays} of ${b.totalDays} days used`
                         : `Returned ${usedDays - b.totalDays} day${usedDays - b.totalDays === 1 ? '' : 's'} late — ${usedDays} days used, ${b.totalDays} booked`}
                </p>
                {/* booked period vs the return time, so it's clear where the days come from */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { k: 'Booked from', v: when(b.startDate, b.startTime) },
                    { k: 'Booked until', v: when(b.endDate, b.endTime) },
                    { k: 'Returned', v: when(at.slice(0, 10), at.slice(11, 16)), hi: true },
                  ].map((t) => (
                    <div key={t.k} className={`rounded-lg px-2.5 py-1.5 ${t.hi ? 'bg-white ring-1 ring-current/20' : 'bg-white/60'}`}>
                      <p className="text-[11px] uppercase tracking-wide opacity-70">{t.k}</p>
                      <p className="text-sm font-semibold text-navy-800">{t.v}</p>
                    </div>
                  ))}
                </div>
                {early ? (
                  <div className="flex flex-col gap-1 text-sm">
                    <label className="flex items-center gap-2"><input type="radio" checked={chargeUsedOnly} onChange={() => setChargeUsedOnly(true)} />
                      Charge the days used: {usedDays} × {rs(dayRate)} = <b>{rs(usedValue)}</b></label>
                    <label className="flex items-center gap-2"><input type="radio" checked={!chargeUsedOnly} onChange={() => setChargeUsedOnly(false)} />
                      Keep the full booking price ({rs(b.totalAmount)})</label>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={chargeLate} onChange={(e) => setChargeLate(e.target.checked)} />
                    Charge the extra days: {usedDays - b.totalDays} × {rs(dayRate)} = <b>{rs((usedDays - b.totalDays) * dayRate)}</b></label>
                )}
                <ul className="text-xs space-y-0.5 opacity-90">
                  {[
                    'Days are counted from the booked start to the "Returned at" time.',
                    b.waiveExtraDay && 'Partial days are waived for this booking.',
                    bookingSwaps.length > 0 && 'Days in a breakdown replacement count as used — the customer pays for them.',
                    early && chargeUsedOnly && 'The booking is shortened and the change is kept in its history; owner payouts follow.',
                  ].filter(Boolean).map((n) => <li key={n as string} className="flex gap-1.5"><Info size={13} className="mt-0.5 flex-shrink-0" />{n}</li>)}
                </ul>
              </div>
            )}

            {/* recovered: the rent owed for the time the customer had the car */}
            {recover && (
              <div className="rounded-xl p-3 space-y-2.5 bg-red-50 text-red-900">
                <p className="text-sm font-semibold">Rent the customer owes</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { k: 'Booked from', v: when(b.startDate, b.startTime) },
                    { k: 'Booked until', v: when(b.endDate, b.endTime) },
                    { k: 'Recovered', v: when(at.slice(0, 10), at.slice(11, 16)), hi: true },
                  ].map((t) => (
                    <div key={t.k} className={`rounded-lg px-2.5 py-1.5 ${t.hi ? 'bg-white ring-1 ring-red-200' : 'bg-white/60'}`}>
                      <p className="text-[11px] uppercase tracking-wide opacity-70">{t.k}</p>
                      <p className="text-sm font-semibold text-navy-800">{t.v}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" checked={rcRent === 'used'} onChange={() => setRcRent('used')} />
                    For the time they had it: {usedLabel} = <b>{rs(usedRent)}</b></label>
                  {rcRent === 'used' && rType !== 'Hourly' && (
                    <div className="ml-6 rounded-lg bg-white/80 px-3 py-2 text-navy-700">
                      <p className="text-[11px] uppercase tracking-wide text-red-800/70 mb-1">How it's worked out</p>
                      {(rType === 'Monthly' ? [
                        ...(mu.months ? [{ k: `Full month${mu.months === 1 ? '' : 's'}`, d: `${dt(mu.from)} → ${dt(mu.periodStart)}`, w: `${mu.months} × ${rs(monthRate)}`, v: mu.months * monthRate }] : []),
                        { k: 'Month in progress', d: `${dt(mu.periodStart)} → ${dt(mu.periodEnd)} = ${mu.monthDays} days`, w: `day rate ${rs(monthRate)} ÷ ${mu.monthDays} = Rs ${mu.dayRate.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                        { k: 'Days used in it', d: `${dt(mu.periodStart)} → ${dt(mu.to)} = ${span(mu.partMs)} → ${mu.days} day${mu.days === 1 ? '' : 's'} (${mu.waived ? 'partial day waived for this booking' : 'a started day counts'})`,
                          w: `${mu.days} × Rs ${mu.dayRate.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, v: mu.partRent },
                      ] : [
                        { k: 'Days used', d: `${dt(new Date(`${b.startDate}T${b.startTime || '00:00'}`))} → ${dt(new Date(at))} = ${span(new Date(at).getTime() - new Date(`${b.startDate}T${b.startTime || '00:00'}`).getTime())} → ${rcDays} day${rcDays === 1 ? '' : 's'} (${b.waiveExtraDay ? 'partial day waived for this booking' : 'a started day counts'})`,
                          w: `${rcDays} × ${rs(Math.round(perDay))}`, v: usedRent },
                      ]).map((x) => (
                        <div key={x.k} className="grid grid-cols-[120px_minmax(0,1fr)_auto] gap-x-3 py-1 border-b border-red-100 last:border-0 text-xs items-start">
                          <span className="font-semibold">{x.k}</span>
                          <span className="text-navy-500">{x.d}<br /><span className="text-navy-700">{x.w}</span></span>
                          <span className="text-right font-semibold whitespace-nowrap">{x.v !== undefined ? rs(x.v) : ''}</span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-1.5 text-sm font-bold"><span>Rent owed</span><span>{rs(usedRent)}</span></div>
                    </div>
                  )}
                  <label className="flex items-center gap-2"><input type="radio" checked={rcRent === 'full'} onChange={() => setRcRent('full')} />
                    The full booking price ({rs(b.totalAmount)})</label>
                  <label className="flex flex-wrap items-center gap-2"><input type="radio" checked={rcRent === 'custom'} onChange={() => setRcRent('custom')} />
                    Another amount
                    {rcRent === 'custom' && <input className="input !py-1 !w-40" type="number" min="0" placeholder="Rs" value={rcCustom} onChange={(e) => setRcCustom(e.target.value)} autoFocus />}
                  </label>
                </div>
                <ul className="text-xs space-y-0.5 opacity-90">
                  <li className="flex gap-1.5"><Info size={13} className="mt-0.5 flex-shrink-0" />The booking ends on the recovery date; the change is kept in its history and owner payouts follow the new rent.</li>
                  <li className="flex gap-1.5"><Info size={13} className="mt-0.5 flex-shrink-0" />Add recovery costs (transport, towing, staff) and any damage under Other charges below.</li>
                </ul>
              </div>
            )}

            {/* rent so far */}
            <div className="text-sm">
              {price.lines.map((l, i) => recover && rentChange !== 0 && i === 0 ? (
                // recovered: the booked rent is replaced by the rent for the time used (below)
                <div key={i} className="flex justify-between gap-3 py-0.5 text-navy-400"><span><span className="line-through">{l.label}</span> · booked, not charged</span><span className="line-through">{rs(l.amount)}</span></div>
              ) : (
                <div key={i} className="flex justify-between gap-3 py-0.5"><span className="text-navy-600">{l.label}</span><span className={l.amount < 0 ? 'text-red-600' : 'text-navy-800'}>{l.amount < 0 ? `− ${rs(-l.amount)}` : rs(l.amount)}</span></div>
              ))}
              {recover && rentChange !== 0 && (rcRent === 'used' && rType === 'Monthly' ? [
                ...(mu.months ? [{ k: `${mu.months} month${mu.months === 1 ? '' : 's'} × ${rs(monthRate)}`, v: mu.months * monthRate }] : []),
                ...(mu.days ? [{ k: `Part month — ${mu.days} day${mu.days === 1 ? '' : 's'} × ${rs(monthRate)} ÷ ${mu.monthDays}`, v: mu.partRent }] : []),
              ] : [{ k: rcRent === 'used' ? `Rent for the time used — ${usedLabel}` : 'Rent agreed at recovery', v: recoverRent }]).map((x) => (
                <div key={x.k} className="flex justify-between gap-3 py-0.5"><span className="text-navy-600">{x.k}</span><span className="text-navy-800">{rs(x.v)}</span></div>
              ))}
              {earlyCut > 0 && <div className="flex justify-between gap-3 py-0.5"><span className="text-navy-600">Returned early — {b.totalDays - usedDays} unused day{b.totalDays - usedDays === 1 ? '' : 's'} not charged</span><span className="text-red-600">− {rs(earlyCut)}</span></div>}
              {lateCharge > 0 && <div className="flex justify-between gap-3 py-0.5"><span className="text-navy-600">Late return — {usedDays - b.totalDays} extra day{usedDays - b.totalDays === 1 ? '' : 's'}</span><span className="text-navy-800">{rs(lateCharge)}</span></div>}
              <div className="flex justify-between gap-3 py-0.5 border-t border-navy-50 mt-1"><span className="text-navy-500">Bill</span><b>{rs(price.bill - earlyCut + lateCharge + rentChange)}</b></div>
              <div className="flex justify-between gap-3 py-0.5"><span className="text-navy-500">Already paid</span><span className="text-emerald-700">{rs(price.paid)}</span></div>
            </div>

            {/* breakdown replacements: billed to the customer as part of the booking; here only the owner's payout status */}
            {bookingSwaps.length > 0 && (
              <div className="rounded-xl bg-navy-50/60 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-navy-700 flex items-center gap-1.5"><Repeat size={15} /> Breakdown replacements</p>
                  <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs font-semibold">Customer's bill unchanged</span>
                </div>
                {bookingSwaps.map((w) => {
                  const days = w.days ? `${w.days} day${w.days === 1 ? '' : 's'}` : w.status === 'active' ? 'Still out' : '—';
                  const partner = w.source === 'partner';
                  const row = partner ? undefined : commissions.find((c) => c.id === w.commissionId);
                  const k = partner ? undefined : replKm(w);
                  const kmRow = commissions.find((c) => c.id === kmPayoutId(w));
                  const kmAmount = kmRow?.ownerPayout ?? k?.amount ?? 0;
                  const total = (row?.ownerPayout ?? 0) + kmAmount;
                  const rentPaid = row?.status === 'Paid';
                  const paid = rentPaid && (kmAmount === 0 || kmRow?.status === 'Paid');
                  const unpaid = (rentPaid ? 0 : row?.ownerPayout ?? 0) + (kmRow?.status === 'Paid' ? 0 : kmAmount);
                  const markPaid = () => {
                    if (!confirm(`Mark ${rs(unpaid)} as paid to ${carNo(w.replacementVehicleId)}'s owner?`)) return;
                    addKmPayout(w);   // the extra km line is created first, so it is paid together
                    const ids = [w.commissionId, kmPayoutId(w)];
                    useStore.getState().commissions.filter((c) => ids.includes(c.id) && c.status !== 'Paid').forEach((c) => updateCommission(c.id, { status: 'Paid' }));
                    toast.success('Owner payout marked paid');
                  };
                  const line = (label: string, detail: string, amount?: string) => (
                    <div className="flex justify-between gap-3 py-0.5"><span className="text-navy-600">{label} <span className="text-navy-400">· {detail}</span></span><span className="text-navy-800 whitespace-nowrap">{amount}</span></div>
                  );
                  return (
                    <div key={w.id} className="rounded-xl bg-white border border-navy-100 p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="rounded-md bg-sky-100 text-sky-800 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">{partner ? 'Partner car' : 'Replacement'}</span>
                        <b className="text-navy-900">{partner ? (w.partnerReg || w.partnerVehicle || 'Partner car') : carNo(w.replacementVehicleId)}</b>
                        <ArrowRight size={14} className="text-navy-300" />
                        <span className="text-navy-500">covered <b className="text-navy-800">{carNo(w.originalVehicleId)}</b></span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div><p className="text-[11px] uppercase tracking-wide text-navy-400">Period</p><p className="text-sm font-medium text-navy-800">{shortDate(w.outAt)} → {shortDate(w.backAt)}</p></div>
                        <div><p className="text-[11px] uppercase tracking-wide text-navy-400">Days</p><p className="text-sm font-medium text-navy-800">{days}</p></div>
                        <div><p className="text-[11px] uppercase tracking-wide text-navy-400">{partner ? 'Paid to' : 'Km driven'}</p>
                          <p className="text-sm font-medium text-navy-800">{partner ? (w.partnerName ?? 'Partner') : k ? `${k.km.toLocaleString()} km` : 'Readings missing'}</p></div>
                      </div>
                      {!partner && row && (
                        <div className="text-sm rounded-lg bg-navy-50/60 px-2.5 py-1.5">
                          {line('Daily rent', `${w.days ?? 0} × ${rs(w.replacementRate ?? 0)}`, rs(row.ownerPayout))}
                          {!k ? line('Extra km', 'enter the readings to work it out') : kmDraft?.id === w.id ? (
                            <div className="py-1 space-y-1.5">
                              <p className="text-navy-600">Extra km <span className="text-navy-400">· {k.extra.toLocaleString()} km over the {k.included.toLocaleString()} km included</span></p>
                              <div className="grid grid-cols-2 sm:grid-cols-[120px_140px_auto] gap-2 items-end">
                                <label className="text-xs text-navy-500">Rate (Rs / km)
                                  <input className="input !py-1.5 mt-1" type="number" min="0" value={kmDraft.rate}
                                         onChange={(e) => setKmDraft({ ...kmDraft, rate: e.target.value, amount: String(Math.round(k.extra * (Number(e.target.value) || 0))) })} />
                                </label>
                                <label className="text-xs text-navy-500">Amount (Rs)
                                  <input className="input !py-1.5 mt-1" type="number" min="0" value={kmDraft.amount} onChange={(e) => setKmDraft({ ...kmDraft, amount: e.target.value })} />
                                </label>
                                <div className="flex gap-1.5 col-span-2 sm:col-span-1 pb-0.5">
                                  <button type="button" className="rounded-lg bg-navy-800 text-white px-2.5 py-1.5 text-xs font-semibold" onClick={() => saveKmEdit(w)}>Save</button>
                                  <button type="button" className="rounded-lg border border-navy-200 px-2.5 py-1.5 text-xs font-semibold text-navy-700" onClick={() => setKmDraft(null)}>Cancel</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-between gap-3 py-0.5">
                              <span className="text-navy-600">Extra km <span className="text-navy-400">· {k.extra ? `${k.extra.toLocaleString()} km over the ${k.included.toLocaleString()} km included × ${rs(k.rate)}` : `within the ${k.included.toLocaleString()} km included`}{(kmRow ? kmRow.ownerPayout !== Math.round(k.extra * k.rate) : k.edited && k.amount !== Math.round(k.extra * k.rate)) ? ' · amount changed' : ''}</span>
                                {isAdmin && kmRow?.status !== 'Paid' && (
                                  <button type="button" aria-label="Edit the extra km amount" className="ml-2 text-xs font-semibold text-sky-700 hover:underline"
                                          onClick={() => setKmDraft({ id: w.id, rate: String(k.rate), amount: String(kmAmount) })}>Edit</button>
                                )}
                              </span>
                              <span className="text-navy-800 whitespace-nowrap">{rs(kmAmount)}</span>
                            </div>
                          )}
                          <div className="flex justify-between gap-3 pt-1 mt-1 border-t border-navy-100"><b className="text-navy-700">Owner gets</b><b className="text-navy-900">{rs(total)}</b></div>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-50 pt-2">
                        {partner ? <span className="text-xs text-navy-500">Paid through the partner cost in the breakdown.</span>
                          : !row ? <span className="text-xs text-navy-500">The payout is worked out when the car comes back.</span>
                          : paid ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 text-xs font-semibold"><CheckCircle size={13} /> Owner paid</span>
                          : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-xs font-semibold"><Clock size={13} /> {rentPaid ? `Rent paid · extra km ${rs(unpaid)} not paid yet` : 'Owner not paid yet'}</span>}
                        {row && !paid && isAdmin && (
                          <button type="button" className="rounded-lg border border-navy-200 px-2.5 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50" onClick={markPaid}>Mark as paid</button>
                        )}
                      </div>
                      {!partner && k && kmAmount > 0 && !kmRow && <p className="text-xs text-navy-400">The extra km line is added to the owner's payouts when the rental completes.</p>}
                    </div>
                  );
                })}
                <p className="text-xs text-navy-500 flex gap-1.5"><Info size={13} className="mt-0.5 flex-shrink-0" />The customer pays the booking price for these days as usual — the owners are paid for their own days and km.</p>
              </div>
            )}

            {/* extra mileage */}
            <div className="rounded-xl bg-navy-50/60 p-3 space-y-2">
              <p className="text-sm font-semibold text-navy-700">Extra mileage</p>
              {!kmAlreadyCharged && !pickup && (
                <label className="text-sm text-navy-500 block">No odometer reading was saved at pickup — enter it from the agreement:
                  <input className="input !py-1.5 mt-1 sm:!w-56" type="number" min="0" placeholder="Odometer at pickup (km)" value={pickupKmIn} onChange={(e) => setPickupKmIn(e.target.value)} />
                </label>
              )}
              {trip?.endedInReplacement && (
                <p className="text-sm text-sky-800 bg-sky-50 rounded-lg px-2 py-1.5">The trip ended in the replacement — its km are counted from the breakdown readings. The odometer above is {vehicle?.vehicleNumber ?? 'the booked car'}'s, for its record only.</p>
              )}
              {trip && trip.legs.length > 1 && <UsagePhases trip={trip} includedKm={includedKm} />}
              {!kmAlreadyCharged && gapSwaps.map((w) => <SwapReadingsFix key={w.id} w={w} />)}
              {!kmAlreadyCharged && swapGaps.length > 0 && (
                <label className="text-sm text-amber-900 flex items-start gap-1.5"><input type="checkbox" className="mt-0.5" checked={kmAck} onChange={(e) => setKmAck(e.target.checked)} />
                  The readings can't be found — complete without charging the km of the missing parts (add an estimate under Other charges if agreed with the customer).</label>
              )}
              {kmAlreadyCharged ? <p className="text-sm text-navy-500">Extra km is already on the bill.</p> : trip?.legs.some((l) => l.wrong) ? (
                <p className="text-sm text-red-600">A reading is lower than the one before it ({trip.legs.filter((l) => l.wrong).map((l) => `${l.car}: ${l.part}`).join('; ')}) — check the numbers.</p>
              ) : driven === undefined ? (
                <p className="text-sm text-navy-500">{swapGaps.length ? 'The km can be worked out when the missing readings are entered.' : `Enter the odometer reading${!pickup ? 's' : ' above'} to work it out.`}</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div className="text-sm text-navy-500">Extra km<p className="text-sm font-semibold text-navy-800 mt-1">{extraKm.toLocaleString()} km</p></div>
                  <label className="text-sm text-navy-500">Rate (Rs / km)
                    <input className="input !py-1.5 mt-1" type="number" min="0" value={kmRate} onChange={(e) => setKmRate(e.target.value)} />
                  </label>
                  <div className="text-sm text-navy-500">Charge<p className="text-sm font-semibold text-navy-800 mt-1">{rs(extraKm * rate)}</p></div>
                  <label className="text-sm text-navy-700 flex items-center gap-1.5 pb-2"><input type="checkbox" checked={chargeKm} onChange={(e) => setChargeKm(e.target.checked)} /> Charge it</label>
                </div>
              )}
              {vehicle && rate !== (vehicle.extraKmRate ?? 50) && (
                <label className="text-sm text-navy-700 flex items-center gap-1.5"><input type="checkbox" checked={saveRate} onChange={(e) => setSaveRate(e.target.checked)} />
                  Save Rs {rate.toLocaleString()}/km as {vehicle.vehicleNumber}'s extra km rate (now Rs {(vehicle.extraKmRate ?? 50).toLocaleString()})</label>
              )}
            </div>

            {/* other charges collected at return */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-navy-700">Other charges</p>
              {extras.map((x, i) => (
                <div key={i} className="grid grid-cols-[1fr_110px_auto] sm:grid-cols-[150px_120px_1fr_auto] gap-2 items-center">
                  <select className="input !py-1.5 text-sm" value={x.kind} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, kind: e.target.value as ChargeKind } : y)))}>
                    {EXTRA_KINDS.map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <input className="input !py-1.5 text-sm" type="number" min="0" placeholder="Rs" value={x.amount} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
                  <input className="input !py-1.5 text-sm col-span-2 sm:col-span-1 order-last sm:order-none" placeholder="Details, e.g. fuel top-up 10 L" value={x.note} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
                  <button type="button" onClick={() => setExtras((l) => l.filter((_, j) => j !== i))} className="p-1.5 text-navy-400 hover:text-red-600" aria-label="Remove charge"><Trash2 size={15} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setExtras((l) => [...l, { kind: 'Fuel', amount: '', note: '' }])} className="text-sm font-semibold text-navy-600 hover:text-navy-900 inline-flex items-center gap-1"><Plus size={13} /> Add a charge (fuel, late return, damage…)</button>
            </div>

            {/* deposit */}
            {held > 0 && (
              <div className="rounded-xl bg-amber-50/70 p-3 space-y-2">
                <label className="text-sm font-semibold text-amber-900 flex items-center gap-1.5"><input type="checkbox" checked={settleDep} onChange={(e) => setSettleDep(e.target.checked)} /> Settle the deposit now ({rs(held)} held)</label>
                {settleDep && (
                  <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
                    <label className="text-sm text-navy-500">Keep (Rs)<input className="input !py-1.5 mt-1" type="number" min="0" max={held} value={depKeep} placeholder="0" onChange={(e) => setDepKeep(e.target.value)} /></label>
                    <label className="text-sm text-navy-500">{keep > 0 ? 'Why is part kept? *' : 'Note'}<input className="input !py-1.5 mt-1" value={depNote} onChange={(e) => setDepNote(e.target.value)} /></label>
                    <p className="text-sm text-amber-900 sm:col-span-2">Return {rs(held - keep)} to the customer{keep > 0 ? `, keep ${rs(keep)}` : ''}.</p>
                  </div>
                )}
              </div>
            )}

            {/* totals and payment collected now */}
            <div className="rounded-xl bg-navy-800 text-white p-3 space-y-2">
              <div className="flex justify-between text-sm"><span className="opacity-70">Final bill</span><b>{rs(newBill)}</b></div>
              <div className="flex justify-between text-sm"><span className="opacity-70">Balance before payment</span><b>{rs(dueNow)}</b></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <label className="text-xs opacity-80">Collected now (Rs)
                  <input className="input !py-1.5 mt-1 text-navy-900" type="number" min="0" value={collect ?? String(dueNow)} onChange={(e) => setCollect(e.target.value)} />
                </label>
                <label className="text-xs opacity-80">Method
                  <select className="input !py-1.5 mt-1 text-navy-900" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
                </label>
                <label className="text-xs opacity-80">Receipt no.
                  <input className="input !py-1.5 mt-1 text-navy-900" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
                </label>
              </div>
              {refundDue > 0 && (
                <label className="flex items-center justify-between gap-2 text-sm text-sky-200">
                  <span className="flex items-center gap-2"><input type="checkbox" checked={refundNow} onChange={(e) => setRefundNow(e.target.checked)} /> Refund the overpayment now</span>
                  <b>{rs(refundDue)}</b>
                </label>
              )}
              <div className="flex justify-between text-sm pt-1 border-t border-white/15">
                <span className="opacity-70">Still owed after this</span>
                <b className={remaining > 0 ? 'text-amber-300' : 'text-emerald-300'}>{remaining > 0 ? rs(remaining) : 'Paid in full'}</b>
              </div>
            </div>

            {/* recovered with money still owed: credit or bad debt */}
            {recover && remaining > 0 && (
              <div className={`rounded-xl border p-3 space-y-2.5 ${owedAs ? 'border-navy-100' : 'border-amber-300 bg-amber-50/60'}`}>
                <p className="text-sm font-semibold text-navy-800">{rs(remaining)} is still owed — what happens to it? *</p>
                <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer ${owedAs === 'credit' ? 'border-navy-800 bg-white' : 'border-navy-100 bg-white/70'}`}>
                  <input type="radio" className="mt-1" checked={owedAs === 'credit'} onChange={() => setOwedAs('credit')} />
                  <span className="text-sm"><b className="text-navy-800">Keep it as credit</b> — the customer still owes {rs(remaining)}. It's listed on the Credit page to follow up, send reminders and mark settled when paid.</span>
                </label>
                <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer ${owedAs === 'writeoff' ? 'border-red-500 bg-white' : 'border-navy-100 bg-white/70'}`}>
                  <input type="radio" className="mt-1" checked={owedAs === 'writeoff'} onChange={() => setOwedAs('writeoff')} />
                  <span className="text-sm"><b className="text-red-700">Write it off as bad debt</b> — it can't be recovered. It's recorded on the booking and counted as bad debt on the dashboard; it's no longer chased on the Credit page.</span>
                </label>
                {owedAs === 'writeoff' && (
                  <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 pl-1">
                    <label className="text-xs text-navy-500">Amount written off (Rs)
                      <input className="input !py-1.5 mt-1" type="number" min="0" max={remaining} placeholder={String(remaining)} value={writeOffIn} onChange={(e) => setWriteOffIn(e.target.value)} />
                    </label>
                    <label className="text-xs text-navy-500">Why it can't be recovered *
                      <input className="input !py-1.5 mt-1" value={writeOffWhy} onChange={(e) => setWriteOffWhy(e.target.value)} placeholder="e.g. Customer untraceable, false NIC — police complaint made" />
                    </label>
                    {creditLeft > 0 && <p className="text-xs text-navy-600 sm:col-span-2">{rs(writeOff)} written off · the other <b>{rs(creditLeft)}</b> is kept as credit.</p>}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 flex gap-2"><AlertCircle size={15} className="mt-0.5 flex-shrink-0" />{error}</p>}

        {/* always visible, however long the form is */}
        <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-3 bg-white/95 backdrop-blur border-t border-navy-100 flex flex-wrap items-center justify-end gap-2">
          {isReturn && <label className="text-xs text-navy-700 flex items-center gap-1.5 mr-auto"><input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} /> {recover ? 'Open the statement of what is owed (print or save as PDF)' : 'Open the invoice after completing (print or save as PDF)'}</label>}
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={save} disabled={uploading}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${kind === 'pickup' ? 'bg-navy-800 hover:bg-navy-700' : recover ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
            {kind === 'pickup' ? <><PlayCircle size={15} /> Start rental</> : recover ? <><ShieldAlert size={15} /> Record recovery{invoice ? ' & statement' : ''}</> : <><CheckCircle size={15} /> Complete rental{invoice ? ' & invoice' : ''}</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A folded section of the form. Mounted on first open and then only hidden, so a signature or typed text survives folding. */
function Fold({ title, hint, warn, children }: { title: string; hint?: string; warn?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  return (
    <div className="rounded-xl border border-navy-100">
      <button type="button" aria-expanded={open} onClick={() => { setOpen((o) => !o); setSeen(true); }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left rounded-xl hover:bg-navy-50/60">
        <span className="text-sm font-semibold text-navy-800">{title}</span>
        <span className="flex items-center gap-2 text-xs">
          {hint && <span className={warn ? 'text-red-600 font-medium' : 'text-navy-400'}>{hint}</span>}
          <ChevronDown size={16} className={`text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {seen && <div className={open ? 'px-3 pb-3' : 'hidden'}>{children}</div>}
    </div>
  );
}
