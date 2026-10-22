import { useMemo, useState } from 'react';
import Select from '../ui/Select';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, CheckCircle2, Database, Gauge, RotateCcw, ShieldAlert, Undo2 } from 'lucide-react';
import { tripKmFor, useBreakdownStore } from '../../store/useBreakdownStore';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { BdIncident, BdSolution, BdSwap, swapDays } from '../../lib/breakdowns';
import { swapMoney } from '../../lib/breakdownLedger';
import { payoutRowFor } from '../../lib/exchange';
import { FUEL_LEVELS } from '../../lib/bookingRecord';
import { Chips, ErrorLine, Field, Grid, KV, Section, fromLocalInput, nowLocal, rs, when } from './bdui';
import { toast } from '../../store/useToast';

/*
 * The replacement period of a breakdown (breakdown_vehicle_swaps) — separate from the booking's
 * "Exchange vehicle" records. The booking stays on the original car; this records the replacement
 * going out and coming back (fleet car → back to the fleet, partner car → back to the partner).
 */
export default function SwapPanel({ s, incident, by, blocked, beforeStart }: { s: BdSolution; incident: BdIncident; by: string; blocked?: string; beforeStart?: () => void }) {
  const store = useBreakdownStore();
  const swaps = store.swaps.filter((w) => w.solutionId === s.id).sort((a, c) => a.outAt.localeCompare(c.outAt));
  const active = swaps.find((w) => w.status === 'active');
  const fleet = s.kind === 'replacement';
  const finished = ['completed', 'failed', 'cancelled'].includes(s.status);

  if (store.swapsMissing) {
    return (
      <Section title={fleet ? 'Replacement vehicle' : 'Partner car handover'} icon={ArrowLeftRight}>
        <p className="text-xs text-amber-800 flex gap-1.5"><Database size={13} className="mt-0.5" /> Run 08_breakdown_swaps.sql in Supabase to record replacements.</p>
      </Section>
    );
  }
  return (
    <>
      {swaps.filter((w) => w.status === 'closed').map((w) => <SwapSummary key={w.id} w={w} />)}
      {active ? <ActiveSwap w={active} incident={incident} by={by} />
        : !swaps.length && !finished && <SwapOut s={s} incident={incident} by={by} blocked={blocked} beforeStart={beforeStart} />}
    </>
  );
}

const fuelSelect = (value: string, onChange: (v: string) => void) => (
  <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">—</option>{FUEL_LEVELS.map((f) => <option key={f}>{f}</option>)}
  </select>
);
const km = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Math.round(Number(v))));
const kmText = (n?: number) => (n == null ? '—' : `${n.toLocaleString('en-LK')} km`);

/** Fleet cars free from a time to the end of the booking (for a replacement) */
function useFreeCars(bookingId: string | undefined, atLocal: string, exclude: (string | undefined)[]) {
  const { bookings, vehicles, isVehicleAvailable } = useStore();
  const b = bookings.find((x) => x.id === bookingId);
  return useMemo(() => {
    if (!b) return [];
    const at = new Date(fromLocalInput(atLocal) ?? Date.now());
    return vehicles.filter((v) => v.id !== b.vehicleId && !exclude.includes(v.id) && v.status !== 'Maintenance'
      && isVehicleAvailable(v.id, at.toLocaleDateString('en-CA'), b.endDate, undefined, at.toTimeString().slice(0, 5), b.endTime))
      .sort((a, c) => a.dailyRent - c.dailyRent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b, vehicles, atLocal, isVehicleAvailable, exclude.join()]);
}

/* ── Hand over ───────────────────────────────────────────────────────────── */
function SwapOut({ s, incident, by, blocked, beforeStart }: { s: BdSolution; incident: BdIncident; by: string; blocked?: string; beforeStart?: () => void }) {
  const store = useBreakdownStore();
  const { bookings, vehicles, owners } = useStore();
  const b = bookings.find((x) => x.id === incident.bookingId);
  const fleet = s.kind === 'replacement';
  // the mileage on the breakdown report is the booked car's reading at the breakdown
  const [f, setF] = useState({ at: nowLocal(), car: '', rate: '', location: '', oKm: incident.mileage != null ? String(incident.mileage) : '', oFuel: incident.fuel ?? '', rKm: '', rFuel: '', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const original = vehicles.find((v) => v.id === b?.vehicleId);
  const chosen = vehicles.find((v) => v.id === f.car);

  // only cars free from now to the end of the trip
  const freeCars = useFreeCars(b?.id, f.at, []);
  const free = fleet ? freeCars : [];

  const submit = () => {
    if (blocked) { setErr(blocked); return; }
    beforeStart?.();
    const e = store.startSwap(s.id, {
      at: fromLocalInput(f.at) ?? new Date().toISOString(), by, replacementVehicleId: fleet ? f.car : undefined, location: f.location.trim() || undefined,
      rate: fleet && f.rate.trim() !== '' ? Number(f.rate) : undefined,
      originalOdometer: km(f.oKm), originalFuel: f.oFuel || undefined, replacementOdometer: km(f.rKm), replacementFuel: f.rFuel || undefined, notes: f.notes,
    });
    setErr(e);
    if (!e) toast.success('Replacement handed over', fleet ? 'The booking stays on the original car until it comes back.' : 'The partner car is with the customer.');
  };

  return (
    <Section title={fleet ? 'Hand over a replacement from our fleet' : "Hand over the partner's car"} icon={ArrowLeftRight}>
      <p className="text-xs text-navy-500">
        Recorded on this breakdown only — the booking stays on {original?.vehicleNumber ?? 'the original car'}.
        {fleet ? ' Only cars free until the end of the trip are offered.' : ` The car goes back to ${s.providerName ?? 'the partner'} afterwards.`}
      </p>
      {fleet ? (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-3">
          <Field label="Replacement vehicle *">
            <Select searchable searchPlaceholder="Search model or number…" value={f.car} onChange={(v) => set('car', v)}
              placeholder={free.length ? 'Choose a free car…' : 'No car is free until the end of the trip'}
              options={free.map((v) => ({ value: v.id, label: `${v.brand} ${v.model} (${v.vehicleNumber})`, sub: `${rs(v.dailyRent)}/day · ${owners.find((o) => o.id === v.ownerId)?.name ?? '—'}` }))} />
          </Field>
          <Field label="Agreed daily rate (Rs)" hint={chosen ? `Listed ${rs(chosen.dailyRent)} — change it if the owner agreed another amount` : 'Pick the car first'}>
            <input className="input" type="number" min="0" value={f.rate} placeholder={chosen ? String(chosen.dailyRent) : ''} onChange={(e) => set('rate', e.target.value)} />
          </Field>
        </div>
      ) : (
        <p className="text-sm text-navy-700">{[s.partnerVehicle, s.partnerReg].filter(Boolean).join(' · ') || 'Vehicle not entered'} — {s.providerName ?? 'partner not entered'}</p>
      )}
      <Grid cols={4}>
        <Field label="Handed over at"><input className="input" type="datetime-local" value={f.at} onChange={(e) => set('at', e.target.value)} /></Field>
        <Field label="Where"><input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder={incident.location ?? ''} /></Field>
        <Field label={`${original?.vehicleNumber ?? 'Original'} odometer (km) *`} hint={incident.mileage != null ? 'From the breakdown report — check it' : 'Where it broke down'}>
          <input className="input" type="number" min="0" value={f.oKm} onChange={(e) => set('oKm', e.target.value)} />
        </Field>
        <Field label={`${original?.vehicleNumber ?? 'Original'} fuel`}>{fuelSelect(f.oFuel, (v) => set('oFuel', v))}</Field>
        <Field label={`${fleet ? chosen?.vehicleNumber ?? 'Replacement' : 'Partner car'} odometer (km) *`} hint={chosen?.mileage ? `Last recorded ${kmText(chosen.mileage)}` : 'As it goes to the customer'}>
          <input className="input" type="number" min="0" value={f.rKm} onChange={(e) => set('rKm', e.target.value)} />
        </Field>
        <Field label="Replacement fuel">{fuelSelect(f.rFuel, (v) => set('rFuel', v))}</Field>
        <Field label="Notes" className="lg:col-span-2"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Condition, scratches, items handed over…" /></Field>
      </Grid>
      <ErrorLine msg={err} />
      <div className="flex justify-end">
        <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5" onClick={submit}>
          <ArrowLeftRight size={14} /> {fleet ? 'Hand over replacement' : 'Partner car handed to the customer'}
        </button>
      </div>
    </Section>
  );
}

/* ── Out with the customer → back ────────────────────────────────────────── */
function ActiveSwap({ w, incident, by }: { w: BdSwap; incident: BdIncident; by: string }) {
  const store = useBreakdownStore();
  const { bookings, vehicles, owners, commissions } = useStore();
  const isAdmin = useAuthStore((st) => st.isAdmin());
  const b = bookings.find((x) => x.id === w.bookingId);
  const car = (id?: string) => vehicles.find((v) => v.id === id);
  const original = car(w.originalVehicleId), repl = car(w.replacementVehicleId);
  const fleet = w.source === 'fleet';
  const label = fleet ? (repl ? `${repl.brand} ${repl.model} (${repl.vehicleNumber})` : 'the replacement') : [w.partnerVehicle, w.partnerReg].filter(Boolean).join(' ') || "the partner's car";
  const hold = store.activeHold(w.originalVehicleId);
  const [mode, setMode] = useState<'swapped_back' | 'customer_kept' | 'replaced' | null>(null);
  const [f, setF] = useState({ at: nowLocal(), location: '', rKm: '', rFuel: '', oKm: '', oFuel: '', to: 'Available' as 'Available' | 'Maintenance', days: '', rate: String(w.replacementRate ?? ''), notes: '',
    next: '', nextKm: '', nextFuel: '', nextRate: '' });
  const freeNext = useFreeCars(mode === 'replaced' ? w.bookingId : undefined, f.at, [w.replacementVehicleId]);
  const nextCar = car(f.next);
  const replKm = km(f.rKm) != null && w.replacementOdometerOut != null ? km(f.rKm)! - w.replacementOdometerOut : undefined;
  const garageKm = km(f.oKm) != null && w.originalOdometer != null ? km(f.oKm)! - w.originalOdometer : undefined;
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const atIso = fromLocalInput(f.at) ?? new Date().toISOString();
  const autoDays = swapDays(w.outAt, atIso);
  const days = f.days.trim() === '' ? autoDays : Math.max(0, Math.round(Number(f.days)));
  const rate = f.rate.trim() === '' ? w.replacementRate ?? 0 : Math.max(0, Number(f.rate) || 0);
  const money = fleet && b ? swapMoney(b, w.originalVehicleId, rate, days) : null;
  const originalPaid = !!b && payoutRowFor(commissions, b, w.originalVehicleId)?.status === 'Paid';
  const soFar = swapDays(w.outAt, new Date().toISOString());

  const submit = () => {
    if (!mode) return;
    if (mode === 'replaced') {
      const e = store.replaceSwap(w.id, {
        at: atIso, by, location: f.location.trim() || undefined, days, rate,
        replacementOdometer: km(f.rKm), replacementFuel: f.rFuel || undefined, replacementTo: f.to,
        nextVehicleId: f.next, nextRate: f.nextRate.trim() !== '' ? Number(f.nextRate) : undefined, nextOdometer: km(f.nextKm), nextFuel: f.nextFuel || undefined, notes: f.notes,
      });
      setErr(e);
      if (!e) toast.success('Replacement changed', `${nextCar?.vehicleNumber ?? 'The next car'} is with the customer; ${repl?.vehicleNumber ?? 'the first replacement'} is back.`);
      return;
    }
    const e = store.closeSwap(w.id, {
      at: atIso, by, outcome: mode, location: f.location.trim() || undefined, days, rate: fleet ? rate : undefined,
      replacementOdometer: km(f.rKm), replacementFuel: f.rFuel || undefined,
      originalOdometer: mode === 'swapped_back' ? km(f.oKm) : undefined, originalFuel: mode === 'swapped_back' ? f.oFuel || undefined : undefined,
      replacementTo: fleet ? f.to : undefined, notes: f.notes,
    });
    setErr(e);
    if (!e) toast.success(mode === 'swapped_back' ? 'Original vehicle back with the customer' : 'Replacement returned', fleet ? 'Owner payouts updated for their own days.' : 'The partner car is back with the partner.');
  };

  return (
    <Section title={fleet ? 'Replacement with the customer' : 'Partner car with the customer'} icon={ArrowLeftRight}>
      <Grid cols={4}>
        <KV k="Customer drives" v={label} />
        <KV k={fleet ? 'Owner' : 'Partner'} v={fleet ? owners.find((o) => o.id === repl?.ownerId)?.name : w.partnerName} />
        <KV k="Since" v={`${when(w.outAt)} · ${soFar} day${soFar === 1 ? '' : 's'}`} />
        {fleet
          ? <KV k="Owner's daily rate" v={repl && w.replacementRate !== repl.dailyRent ? `${rs(w.replacementRate)} agreed (listed ${rs(repl.dailyRent)})` : rs(w.replacementRate)} />
          : <KV k="Goes back to" v={w.partnerName ?? 'the partner'} />}
      </Grid>
      <div className={`rounded-xl px-3 py-2 text-sm flex gap-2 ${hold ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
        {hold ? <ShieldAlert size={16} className="flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />}
        <span>
          {original?.vehicleNumber ?? 'The original car'} {hold
            ? <>is under maintenance. It can go back to the customer after <b>Mark vehicle as ready</b>{hold.id === incident.id ? ' (Overview tab)' : <> on <Link className="underline" to={`/breakdowns/${hold.id}`}>{hold.ref}</Link></>}.</>
            : <>is ready — it is kept for this customer until the end of the booking.</>}
        </span>
      </div>

      <SwapReadingsFix w={w} />
      {!mode ? (
        isAdmin && (
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1.5" onClick={() => setMode('customer_kept')}>
              <Undo2 size={14} /> Trip ended — {fleet ? 'replacement returned' : 'returned to the partner'}
            </button>
            {fleet && (
              <button type="button" className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1.5" onClick={() => { setMode('replaced'); set('to', 'Maintenance'); }}
                      title="The replacement has a problem too — give the customer another car from the fleet">
                <ArrowLeftRight size={14} /> Change for another car
              </button>
            )}
            <button type="button" disabled={!!hold} title={hold ? 'Mark the original vehicle as ready first' : undefined}
                    className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5 disabled:opacity-50" onClick={() => setMode('swapped_back')}>
              <RotateCcw size={14} /> Return the original vehicle (swap back)
            </button>
          </div>
        )
      ) : (
        <div className="rounded-xl border border-navy-100 p-3 space-y-3">
          <p className="text-sm font-semibold text-navy-800">
            {mode === 'swapped_back'
              ? `${original?.vehicleNumber ?? 'Original'} goes back to the customer; ${label} ${fleet ? 'returns to the fleet' : 'returns to the partner'}`
              : mode === 'replaced' ? `${label} comes back; the customer gets another car from the fleet`
              : `Trip ended: ${label} ${fleet ? 'returns to the fleet' : 'returns to the partner'}`}
          </p>
          <Grid cols={4}>
            <Field label={mode === 'swapped_back' ? 'Swapped at' : mode === 'replaced' ? 'Changed at' : 'Returned at'}><input className="input" type="datetime-local" value={f.at} onChange={(e) => set('at', e.target.value)} /></Field>
            <Field label="Where"><input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
            <Field label={`${fleet ? repl?.vehicleNumber ?? 'Replacement' : 'Partner car'} odometer (km) *`}
                   hint={w.replacementOdometerOut == null ? 'No reading was taken at the handover — enter it below the form' : replKm != null && replKm >= 0 ? `${replKm.toLocaleString('en-LK')} km driven since ${kmText(w.replacementOdometerOut)}` : `Handed over at ${kmText(w.replacementOdometerOut)}`}>
              <input className="input" type="number" min="0" value={f.rKm} onChange={(e) => set('rKm', e.target.value)} />
            </Field>
            <Field label="Replacement fuel">{fuelSelect(f.rFuel, (v) => set('rFuel', v))}</Field>
            {mode === 'swapped_back' && <>
              <Field label={`${original?.vehicleNumber ?? 'Original'} odometer (km) *`}
                     hint={w.originalOdometer == null ? 'As it goes back to the customer' : garageKm != null && garageKm > 0 ? `${garageKm.toLocaleString('en-LK')} km at the garage — not charged to the customer` : `${kmText(w.originalOdometer)} at the breakdown`}>
                <input className="input" type="number" min="0" value={f.oKm} onChange={(e) => set('oKm', e.target.value)} />
              </Field>
              <Field label={`${original?.vehicleNumber ?? 'Original'} fuel`}>{fuelSelect(f.oFuel, (v) => set('oFuel', v))}</Field>
            </>}
            {mode === 'replaced' && <>
              <Field label="Next replacement *" className="lg:col-span-2">
                <Select searchable searchPlaceholder="Search model or number…" value={f.next} onChange={(v) => set('next', v)}
                  placeholder={freeNext.length ? 'Choose a free car…' : 'No car is free until the end of the trip'}
                  options={freeNext.map((v) => ({ value: v.id, label: `${v.brand} ${v.model} (${v.vehicleNumber})`, sub: `${rs(v.dailyRent)}/day · ${owners.find((o) => o.id === v.ownerId)?.name ?? '—'}` }))} />
              </Field>
              <Field label={`${nextCar?.vehicleNumber ?? 'Next car'} odometer (km) *`} hint={nextCar?.mileage ? `Last recorded ${kmText(nextCar.mileage)}` : 'As it goes to the customer'}>
                <input className="input" type="number" min="0" value={f.nextKm} onChange={(e) => set('nextKm', e.target.value)} />
              </Field>
              <Field label={`${nextCar?.vehicleNumber ?? 'Next car'} fuel`}>{fuelSelect(f.nextFuel, (v) => set('nextFuel', v))}</Field>
              <Field label="Next car's agreed daily rate (Rs)" hint={nextCar ? `Listed ${rs(nextCar.dailyRent)}` : undefined}>
                <input className="input" type="number" min="0" value={f.nextRate} placeholder={nextCar ? String(nextCar.dailyRent) : ''} onChange={(e) => set('nextRate', e.target.value)} />
              </Field>
            </>}
            <Field label={`Days the ${fleet ? 'replacement' : 'partner car'} served`} hint={`From the times: ${autoDays}`}>
              <input className="input" type="number" min="0" value={f.days} placeholder={String(autoDays)} onChange={(e) => set('days', e.target.value)} />
            </Field>
            {fleet && (
              <Field label="Owner's agreed daily rate (Rs)" hint={repl ? `Listed ${rs(repl.dailyRent)}` : undefined}>
                <input className="input" type="number" min="0" value={f.rate} onChange={(e) => set('rate', e.target.value)} />
              </Field>
            )}
            {fleet && (
              <Field label="Replacement goes to">
                <Chips size="xs" value={f.to} options={[['Available', 'Available'], ['Maintenance', 'Maintenance']]} onChange={(v) => set('to', v)} />
              </Field>
            )}
          </Grid>
          {mode === 'swapped_back' && km(f.oKm) != null && (
            km(f.rKm) != null && Math.abs(km(f.oKm)! - km(f.rKm)!) <= 5 && km(f.oKm) !== w.originalOdometer ? (
              <p className="rounded-lg bg-amber-50 text-amber-900 px-3 py-2 text-xs">
                {original?.vehicleNumber ?? 'The booked car'}'s reading is the same as {label}'s. Each car has its own odometer — enter what {original?.vehicleNumber ?? 'the booked car'}'s own dashboard shows{w.originalOdometer != null ? ` (it was at ${kmText(w.originalOdometer)} at the breakdown)` : ''}.
              </p>
            ) : garageKm != null && garageKm > 150 ? (
              <p className="rounded-lg bg-amber-50 text-amber-900 px-3 py-2 text-xs">
                {garageKm.toLocaleString('en-LK')} km more than at the breakdown ({kmText(w.originalOdometer)}) — is that really {original?.vehicleNumber ?? 'the booked car'}'s reading? Garage km are not charged to the customer.
              </p>
            ) : null
          )}
          <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Condition on return, damage, fuel top-up…" /></Field>
          {money ? (
            <div className="rounded-xl bg-navy-50/60 px-3 py-2">
              <Grid cols={3}>
                <KV k={`${repl?.vehicleNumber ?? 'Replacement'} owner earns`} v={`${rs(money.replacementPayout)} (${days} × ${rs(rate)})`} />
                <KV k={`${original?.vehicleNumber ?? 'Original'} owner's payout`} warn={originalPaid && money.originalDeduction > 0}
                    v={originalPaid && money.originalDeduction > 0 ? `owes back ${rs(money.originalDeduction)}` : `− ${rs(money.originalDeduction)} (${days} × ${rs(money.perDay)})`} />
                <KV k="Company" v={money.companyNet >= 0 ? `keeps ${rs(money.companyNet)}` : `covers ${rs(-money.companyNet)}`} warn={money.companyNet < 0} />
              </Grid>
              {originalPaid && money.originalDeduction > 0 ? (
                <p className="text-xs text-amber-800 mt-1">{original?.vehicleNumber ?? 'The original'} owner's payout for this booking is already marked <b>paid</b>. {rs(money.originalDeduction)} ({days} × {rs(money.perDay)}) will be recorded as owed back — a pending −{rs(money.originalDeduction)} line in their payouts, taken off their next payout.</p>
              ) : (
                <p className="text-[11px] text-navy-400 mt-1">The customer's price doesn't change. The original owner's reduction is a payout adjustment on the booking (reversible there).</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-navy-400">The partner is paid through the partner cost (Partner money above); this only records the handover back.</p>
          )}
          <ErrorLine msg={err} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => { setMode(null); setErr(null); }}>Cancel</button>
            <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5" onClick={submit}><CheckCircle2 size={14} /> Confirm</button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ── Finished ────────────────────────────────────────────────────────────── */
function SwapSummary({ w }: { w: BdSwap }) {
  const { vehicles } = useStore();
  const car = (id?: string) => vehicles.find((v) => v.id === id);
  const original = car(w.originalVehicleId), repl = car(w.replacementVehicleId);
  const fleet = w.source === 'fleet';
  const label = fleet ? (repl ? `${repl.brand} ${repl.model} (${repl.vehicleNumber})` : '—') : [w.partnerVehicle, w.partnerReg].filter(Boolean).join(' ') || '—';
  return (
    <Section title={w.outcome === 'swapped_back' ? 'Replacement — swapped back' : w.outcome === 'replaced' ? 'Replacement — changed for another car' : 'Replacement — returned at trip end'} icon={CheckCircle2}>
      <Grid cols={4}>
        <KV k={fleet ? 'Replacement' : 'Partner car'} v={label} />
        <KV k="Out" v={when(w.outAt)} />
        <KV k="Back" v={w.backAt ? when(w.backAt) : '—'} />
        <KV k="Days" v={w.days} />
        <KV k="Outcome" v={w.outcome === 'swapped_back' ? `${original?.vehicleNumber ?? 'Original'} back with the customer` : w.outcome === 'replaced' ? 'Changed for the next replacement' : 'Trip ended in the replacement'} />
        <KV k="Replacement went" v={fleet ? `to the fleet (${w.replacementTo})` : `back to ${w.partnerName ?? 'the partner'}`} />
        {fleet && <KV k="Replacement owner earned" v={`${rs(w.replacementPayout)} (${w.days ?? 0} × ${rs(w.replacementRate)}${repl && w.replacementRate !== repl.dailyRent ? ', agreed rate' : ''})`} />}
        {fleet && <KV k="Original owner's payout" v={w.adjustmentId?.startsWith('sw-owed') ? `owes back ${rs(w.originalDeduction)} (next payout)` : `− ${rs(w.originalDeduction)}`} />}
        <KV k={`${fleet ? repl?.vehicleNumber ?? 'Replacement' : 'Partner car'} odometer`}
            warn={w.replacementOdometerOut == null || w.replacementOdometerIn == null}
            v={`${kmText(w.replacementOdometerOut)} → ${kmText(w.replacementOdometerIn)}${w.replacementOdometerOut != null && w.replacementOdometerIn != null ? ` · ${(w.replacementOdometerIn - w.replacementOdometerOut).toLocaleString('en-LK')} km driven` : ''}`} />
        <KV k={`${original?.vehicleNumber ?? 'Original'} odometer`} warn={w.originalOdometer == null || (w.outcome === 'swapped_back' && w.originalOdometerBack == null)}
            v={w.outcome === 'swapped_back' ? `${kmText(w.originalOdometer)} at breakdown → ${kmText(w.originalOdometerBack)} back` : `${kmText(w.originalOdometer)} at breakdown`} />
        <KV k="Recorded by" v={`${w.outBy} / ${w.backBy ?? '—'}`} />
      </Grid>
      {(w.outNotes || w.backNotes) && <p className="text-xs text-navy-500">{[w.outNotes, w.backNotes].filter(Boolean).join(' · ')}</p>}
      <SwapReadingsFix w={w} />
    </Section>
  );
}

/* ── Readings that were not taken (older swaps) ─────────────────────────── */
const FIELD_KEY = { originalOdometer: 'originalOdometer', replacementOdometerOut: 'replacementOdometerOut', replacementOdometerIn: 'replacementOdometerIn', originalOdometerBack: 'originalOdometerBack' } as const;
type SwapField = keyof typeof FIELD_KEY;

export function SwapReadingsFix({ w }: { w: BdSwap }) {
  const store = useBreakdownStore();
  const { bookings } = useStore();
  const isAdmin = useAuthStore((st) => st.isAdmin());
  const by = useAuthStore((st) => st.currentUser?.name) ?? 'Admin';
  const b = bookings.find((x) => x.id === w.bookingId);
  const missing = b ? tripKmFor(b).missing.filter((m) => m.swapId === w.id && m.field in FIELD_KEY) : [];
  const [vals, setVals] = useState<Partial<Record<SwapField, string>>>({});
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!missing.length) return null;
  const save = () => {
    const r = Object.fromEntries(Object.entries(vals).filter(([, v]) => v?.trim()).map(([k, v]) => [k, Number(v)]));
    const e = store.fillSwapReadings(w.id, r, reason, by, isAdmin);
    setErr(e);
    if (!e) { setVals({}); setReason(''); toast.success('Readings saved', 'The final bill now counts the km of this part of the trip.'); }
  };
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
      <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5"><Gauge size={15} /> Odometer readings missing — the final bill can't count these km</p>
      {!isAdmin ? <p className="text-xs text-amber-800">Ask an admin to enter: {missing.map((m) => m.label).join('; ')}.</p> : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {missing.map((m) => {
            const k = m.field as SwapField;
            return (
              <label key={k} className="text-xs text-amber-900">{m.label} (km)
                <input className="input !py-1.5 mt-1" type="number" min="0" value={vals[k] ?? ''} onChange={(e) => setVals((x) => ({ ...x, [k]: e.target.value }))} />
                {m.suggest && (
                  <span className="block text-[11px] text-amber-700 mt-0.5">
                    Found {m.suggest.km.toLocaleString('en-LK')} km — {m.suggest.from}.{' '}
                    <button type="button" className="underline font-medium" onClick={() => setVals((x) => ({ ...x, [k]: String(m.suggest!.km) }))}>Use it</button>
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <label className="text-xs text-amber-900 block">Where do these come from? *
          <input className="input !py-1.5 mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. photo of the dashboard sent by the driver, agreement copy, called the customer" />
        </label>
        <ErrorLine msg={err} />
        <div className="flex justify-end">
          <button type="button" className="btn-primary !py-1.5 text-sm" onClick={save}>Save readings</button>
        </div>
      </>}
    </div>
  );
}
