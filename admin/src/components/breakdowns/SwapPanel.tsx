import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, CheckCircle2, Database, RotateCcw, ShieldAlert, Undo2 } from 'lucide-react';
import { useBreakdownStore } from '../../store/useBreakdownStore';
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

/* ── Hand over ───────────────────────────────────────────────────────────── */
function SwapOut({ s, incident, by, blocked, beforeStart }: { s: BdSolution; incident: BdIncident; by: string; blocked?: string; beforeStart?: () => void }) {
  const store = useBreakdownStore();
  const { bookings, vehicles, owners, isVehicleAvailable } = useStore();
  const b = bookings.find((x) => x.id === incident.bookingId);
  const fleet = s.kind === 'replacement';
  const [f, setF] = useState({ at: nowLocal(), car: '', rate: '', location: '', oKm: '', oFuel: '', rKm: '', rFuel: '', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const original = vehicles.find((v) => v.id === b?.vehicleId);
  const chosen = vehicles.find((v) => v.id === f.car);

  // only cars free from now to the end of the trip
  const free = useMemo(() => {
    if (!b || !fleet) return [];
    const at = new Date(fromLocalInput(f.at) ?? Date.now());
    return vehicles.filter((v) => v.id !== b.vehicleId && v.status !== 'Maintenance'
      && isVehicleAvailable(v.id, at.toLocaleDateString('en-CA'), b.endDate, undefined, at.toTimeString().slice(0, 5), b.endTime))
      .sort((a, c) => a.dailyRent - c.dailyRent);
  }, [b, fleet, vehicles, f.at, isVehicleAvailable]);

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
            <select className="input" value={f.car} onChange={(e) => set('car', e.target.value)}>
              <option value="">{free.length ? 'Choose a free car…' : 'No car is free until the end of the trip'}</option>
              {free.map((v) => <option key={v.id} value={v.id}>{v.brand} {v.model} ({v.vehicleNumber}) · {rs(v.dailyRent)}/day · {owners.find((o) => o.id === v.ownerId)?.name ?? '—'}</option>)}
            </select>
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
        <Field label={`${original?.vehicleNumber ?? 'Original'} odometer (km)`}><input className="input" type="number" min="0" value={f.oKm} onChange={(e) => set('oKm', e.target.value)} /></Field>
        <Field label={`${original?.vehicleNumber ?? 'Original'} fuel`}>{fuelSelect(f.oFuel, (v) => set('oFuel', v))}</Field>
        <Field label="Replacement odometer (km)"><input className="input" type="number" min="0" value={f.rKm} onChange={(e) => set('rKm', e.target.value)} /></Field>
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
  const [mode, setMode] = useState<'swapped_back' | 'customer_kept' | null>(null);
  const [f, setF] = useState({ at: nowLocal(), location: '', rKm: '', rFuel: '', oKm: '', oFuel: '', to: 'Available' as 'Available' | 'Maintenance', days: '', rate: String(w.replacementRate ?? ''), notes: '' });
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

      {!mode ? (
        isAdmin && (
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1.5" onClick={() => setMode('customer_kept')}>
              <Undo2 size={14} /> Trip ended — {fleet ? 'replacement returned' : 'returned to the partner'}
            </button>
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
              : `Trip ended: ${label} ${fleet ? 'returns to the fleet' : 'returns to the partner'}`}
          </p>
          <Grid cols={4}>
            <Field label={mode === 'swapped_back' ? 'Swapped at' : 'Returned at'}><input className="input" type="datetime-local" value={f.at} onChange={(e) => set('at', e.target.value)} /></Field>
            <Field label="Where"><input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
            <Field label="Replacement odometer (km)"><input className="input" type="number" min="0" value={f.rKm} onChange={(e) => set('rKm', e.target.value)} /></Field>
            <Field label="Replacement fuel">{fuelSelect(f.rFuel, (v) => set('rFuel', v))}</Field>
            {mode === 'swapped_back' && <>
              <Field label={`${original?.vehicleNumber ?? 'Original'} odometer (km)`}><input className="input" type="number" min="0" value={f.oKm} onChange={(e) => set('oKm', e.target.value)} /></Field>
              <Field label={`${original?.vehicleNumber ?? 'Original'} fuel`}>{fuelSelect(f.oFuel, (v) => set('oFuel', v))}</Field>
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
    <Section title={w.outcome === 'swapped_back' ? 'Replacement — swapped back' : 'Replacement — returned at trip end'} icon={CheckCircle2}>
      <Grid cols={4}>
        <KV k={fleet ? 'Replacement' : 'Partner car'} v={label} />
        <KV k="Out" v={when(w.outAt)} />
        <KV k="Back" v={w.backAt ? when(w.backAt) : '—'} />
        <KV k="Days" v={w.days} />
        <KV k="Outcome" v={w.outcome === 'swapped_back' ? `${original?.vehicleNumber ?? 'Original'} back with the customer` : 'Trip ended in the replacement'} />
        <KV k="Replacement went" v={fleet ? `to the fleet (${w.replacementTo})` : `back to ${w.partnerName ?? 'the partner'}`} />
        {fleet && <KV k="Replacement owner earned" v={`${rs(w.replacementPayout)} (${w.days ?? 0} × ${rs(w.replacementRate)}${repl && w.replacementRate !== repl.dailyRent ? ', agreed rate' : ''})`} />}
        {fleet && <KV k="Original owner's payout" v={w.adjustmentId?.startsWith('sw-owed') ? `owes back ${rs(w.originalDeduction)} (next payout)` : `− ${rs(w.originalDeduction)}`} />}
        <KV k="Odometer out → in" v={w.replacementOdometerOut != null || w.replacementOdometerIn != null ? `${w.replacementOdometerOut ?? '—'} → ${w.replacementOdometerIn ?? '—'} km` : '—'} />
        <KV k="Recorded by" v={`${w.outBy} / ${w.backBy ?? '—'}`} />
      </Grid>
      {(w.outNotes || w.backNotes) && <p className="text-xs text-navy-500">{[w.outNotes, w.backNotes].filter(Boolean).join(' · ')}</p>}
    </Section>
  );
}
