import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, Ban, Car, CheckCircle2, ClipboardCheck, Hammer, PlayCircle, Receipt, RotateCcw, Truck, User, Wrench, XCircle,
} from 'lucide-react';
import { useBreakdownStore, newKey } from '../../store/useBreakdownStore';
import { useStore } from '../../store/useStore';
import {
  BdIncident, BdSolution, ExpenseCategory, REPAIR_RESULT_LABEL, SOLUTION_HINT, SOLUTION_LABEL, SOLUTION_STATUS_LABEL, SolutionKind,
} from '../../lib/breakdowns';
import { REFUND_POLICY } from '../../lib/breakdownLedger';
import { legsOf } from '../../lib/exchange';
import ExchangeVehicleModal from '../ui/ExchangeVehicleModal';
import { ExpenseEditor } from './MoneyPanels';
import { Chips, ErrorLine, Field, Grid, KV, Pill, Section, fromLocalInput, num, rs, toLocalInput, when } from './bdui';
import { toast } from '../../store/useToast';

const EXPENSE_CATS: Record<SolutionKind, ExpenseCategory[]> = {
  onsite_repair: ['callout', 'labour', 'parts', 'transport', 'tax', 'discount', 'other'],
  replacement: ['replacement', 'transport', 'other'],
  partner_vehicle: ['partner', 'transport', 'other'],
  towing_garage: ['towing', 'garage', 'parts', 'labour', 'transport', 'tax', 'discount', 'other'],
  alt_transport: ['alt_transport', 'other'],
  termination: ['transport', 'other'],
};
const ICON: Record<SolutionKind, typeof Wrench> = {
  onsite_repair: Wrench, replacement: ArrowLeftRight, partner_vehicle: Car, towing_garage: Truck, alt_transport: User, termination: Ban,
};

/** Local edits to one solution; Save writes only the changed fields */
function useDraft(s: BdSolution) {
  const [d, setD] = useState<Partial<BdSolution>>({});
  const v = { ...s, ...d } as BdSolution;
  const dirty = Object.keys(d).some((k) => (d as Record<string, unknown>)[k] !== (s as unknown as Record<string, unknown>)[k]);
  const set = <K extends keyof BdSolution>(k: K, val: BdSolution[K]) => setD((x) => ({ ...x, [k]: val }));
  const text = (k: keyof BdSolution) => ({ value: (v[k] as string) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, (e.target.value || undefined) as never) });
  const number = (k: keyof BdSolution) => ({ type: 'number', min: 0, value: (v[k] as number | undefined) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, num(e.target.value) as never) });
  const dt = (k: keyof BdSolution) => ({ type: 'datetime-local', value: toLocalInput(v[k] as string | undefined), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, fromLocalInput(e.target.value) as never) });
  return { v, d, dirty, set, text, number, dt, reset: () => setD({}) };
}

export default function SolutionPanel({ s, incident, by }: { s: BdSolution; incident: BdIncident; by: string }) {
  const store = useBreakdownStore();
  const draft = useDraft(s);
  const { v, dirty } = draft;
  const [err, setErr] = useState('');
  const Icon = ICON[s.kind];
  const closed = s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled';

  const save = () => {
    store.updateSolution(s.id, { ...draft.d, ...(draft.d.providerName && !s.assignedAt ? { assignedBy: by, assignedAt: new Date().toISOString() } : {}) }, by, 'details updated');
    draft.reset();
  };
  const status = (st: BdSolution['status'], extra: Partial<BdSolution> = {}) => {
    setErr('');
    if (dirty) save();
    const e = store.setSolutionStatus(s.id, st, by, extra);
    if (e) setErr(e);
  };
  const act = (fn: () => string | null) => { setErr(''); if (dirty) save(); const e = fn(); if (e) setErr(e); };

  return (
    <div className={`rounded-2xl border ${closed ? 'border-navy-100 bg-navy-50/30' : 'border-navy-200 bg-white'} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-navy-100 bg-white">
        <span className="w-8 h-8 rounded-lg bg-navy-800 text-white flex items-center justify-center"><Icon size={15} /></span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-navy-900">{SOLUTION_LABEL[s.kind]}</p>
          <p className="text-[11px] text-navy-400">Started {when(s.createdAt)} by {s.createdBy}{s.completedAt ? ` · ended ${when(s.completedAt)}` : ''}</p>
        </div>
        <Pill k={s.status}>{SOLUTION_STATUS_LABEL[s.status]}</Pill>
      </div>

      <div className="p-4 space-y-4">
        {s.kind === 'onsite_repair' && <OnsiteRepair draft={draft} />}
        {s.kind === 'replacement' && <Replacement s={s} draft={draft} incident={incident} by={by} act={act} />}
        {s.kind === 'partner_vehicle' && <Partner s={s} draft={draft} incident={incident} by={by} act={act} />}
        {s.kind === 'towing_garage' && <TowingGarage s={s} draft={draft} incident={incident} by={by} act={act} />}
        {s.kind === 'alt_transport' && <AltTransport s={s} draft={draft} incident={incident} by={by} />}
        {s.kind === 'termination' && <Termination s={s} draft={draft} incident={incident} by={by} act={act} />}

        <Field label="Notes"><textarea className="input" rows={2} {...draft.text('notes')} /></Field>

        <Section title="Expenses for this solution" icon={Receipt}>
          <ExpenseEditor incidentId={incident.id} bookingId={incident.bookingId} solutionId={s.id} by={by} categories={EXPENSE_CATS[s.kind]} defaultCategory={EXPENSE_CATS[s.kind][0]} compact />
        </Section>

        <ErrorLine msg={err} />
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {dirty && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={draft.reset}>Discard changes</button>}
          {dirty && <button type="button" className="btn-primary !py-1.5 text-sm" onClick={save}>Save</button>}
          {!closed && s.status === 'planned' && <button type="button" className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1" onClick={() => status('in_progress')}><PlayCircle size={14} /> Start</button>}
          {!closed && s.kind === 'onsite_repair' && (
            <button type="button" className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1 text-red-700" onClick={() => {
              if (!v.repairResult || v.repairResult === 'repaired') { setErr('Choose the repair result (unsuccessful / unsafe / needs towing…) first.'); return; }
              status('failed', { repairResult: v.repairResult, result: REPAIR_RESULT_LABEL[v.repairResult] });
            }}><XCircle size={14} /> Repair didn't work</button>
          )}
          {!closed && <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1" onClick={() => status('completed', s.kind === 'onsite_repair' ? { repairResult: v.repairResult, result: v.repairResult ? REPAIR_RESULT_LABEL[v.repairResult] : undefined } : {})}><CheckCircle2 size={14} /> Mark completed</button>}
          {!closed && <button type="button" className="text-xs font-semibold text-navy-400 hover:text-red-600" onClick={() => { const r = prompt('Why is this solution cancelled? (Its records are kept.)'); if (r) status('cancelled', { result: r }); }}>Cancel solution</button>}
        </div>
        {s.status === 'failed' && <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle size={13} /> This attempt failed — its records and costs are kept. Add another solution above (e.g. towing or replacement).</p>}
        {s.status === 'completed' && <p className="text-[11px] text-navy-400">Completing a solution does not put the broken vehicle back in service — that needs <b>Mark vehicle as ready</b> on the Overview.</p>}
      </div>
    </div>
  );
}

type Draft = ReturnType<typeof useDraft>;
type Act = (fn: () => string | null) => void;

function Provider({ draft, title, companyLabel = 'Company / garage' }: { draft: Draft; title: string; companyLabel?: string }) {
  const { v, text, set } = draft;
  return (
    <Section title={title} icon={User}>
      <Grid cols={4}>
        <Field label="Name / ID"><input className="input" {...text('providerName')} /></Field>
        <Field label={companyLabel}><input className="input" {...text('providerCompany')} /></Field>
        <Field label="Contact number"><input className="input" type="tel" {...text('providerPhone')} /></Field>
        <Field label="Service area"><input className="input" {...text('providerArea')} /></Field>
      </Grid>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-navy-500">Accepted the job?</span>
        <Chips size="xs" value={v.acceptance} options={[['pending', 'Waiting'], ['accepted', 'Accepted'], ['declined', 'Declined']]} onChange={(x) => set('acceptance', x)} />
        {v.assignedAt && <span className="text-[11px] text-navy-400">Assigned by {v.assignedBy} · {when(v.assignedAt)}</span>}
      </div>
    </Section>
  );
}

/* ── 01 On-site repair ─────────────────────────────────────────────────────── */
function OnsiteRepair({ draft }: { draft: Draft }) {
  const { v, text, number, dt, set } = draft;
  return (
    <>
      <Provider draft={draft} title="Technician" />
      <Section title="Repair visit" icon={Wrench}>
        <Grid cols={4}>
          <Field label="Left for the site"><input className="input" {...dt('departAt')} /></Field>
          <Field label="Arrived"><input className="input" {...dt('arriveAt')} /></Field>
          <Field label="Repair started"><input className="input" {...dt('workStartAt')} /></Field>
          <Field label="Repair finished"><input className="input" {...dt('workEndAt')} /></Field>
        </Grid>
        <Grid>
          <Field label="Travel distance (km)"><input className="input" {...number('travelKm')} /></Field>
          <Field label="Where the repair was done"><input className="input" {...text('repairLocation')} /></Field>
        </Grid>
        <Grid>
          <Field label="Diagnosis / root cause"><textarea className="input" rows={2} {...text('diagnosis')} /></Field>
          <Field label="Work performed"><textarea className="input" rows={2} {...text('workDone')} /></Field>
          <Field label="Parts replaced"><textarea className="input" rows={2} {...text('partsReplaced')} /></Field>
          <Field label="Technician remarks"><textarea className="input" rows={2} {...text('remarks')} /></Field>
        </Grid>
        <p className="text-[11px] text-navy-400">Add before / after photos in the Documents section.</p>
      </Section>
      <Section title="Repair result" icon={ClipboardCheck}>
        <Chips size="xs" value={v.repairResult} options={Object.entries(REPAIR_RESULT_LABEL) as [NonNullable<BdSolution['repairResult']>, string][]} onChange={(x) => set('repairResult', x)} />
        {v.repairResult === 'repaired' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
            <p className="text-xs font-semibold text-emerald-800">Before the rental continues</p>
            <Grid cols={4}>
              <Field label="Cleared as safe by"><input className="input" {...text('clearanceBy')} placeholder="Technician name" /></Field>
              <Field label="Cleared at"><input className="input" {...dt('clearanceAt')} /></Field>
              <Field label="Customer confirmed by"><input className="input" {...text('customerConfirmedBy')} /></Field>
              <Field label="Confirmed at"><input className="input" {...dt('customerConfirmedAt')} /></Field>
            </Grid>
          </div>
        )}
        {v.repairResult && ['unsafe', 'needs_tow_or_replacement', 'unsuccessful'].includes(v.repairResult) && (
          <p className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle size={13} /> Do not let the customer drive on. Use “Repair didn’t work”, then add towing or a replacement.</p>
        )}
      </Section>
    </>
  );
}

/* ── 02 Vehicle replacement ────────────────────────────────────────────────── */
function Replacement({ s, draft, incident, by, act }: { s: BdSolution; draft: Draft; incident: BdIncident; by: string; act: Act }) {
  const store = useBreakdownStore();
  const { bookings, vehicles, owners } = useStore();
  const b = bookings.find((x) => x.id === incident.bookingId);
  const { v, text, dt, set } = draft;
  const [exchanging, setExchanging] = useState(false);
  const exchangesBefore = useRef(b?.exchanges?.length ?? 0);
  const [adj, setAdj] = useState('');
  const car = (id?: string) => vehicles.find((x) => x.id === id);
  const ownerOf = (id?: string) => owners.find((o) => o.id === car(id)?.ownerId)?.name ?? '—';
  const from = car(s.fromVehicleId ?? incident.vehicleId), to = car(s.toVehicleId);
  const legs = b ? legsOf(b) : [];
  const remaining = legs[legs.length - 1]?.days ?? 0;

  // the exchange screen closed: if it created a new exchange, link it here
  useEffect(() => {
    if (exchanging) return;
    if ((b?.exchanges?.length ?? 0) > exchangesBefore.current && !s.exchangeId) {
      const e = store.linkLatestExchange(s.id, by);
      if (e) toast.error('Exchange not linked', e);
    }
    exchangesBefore.current = b?.exchanges?.length ?? 0;
  }, [exchanging, b?.exchanges?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Section title="Original vehicle" icon={Car}>
        <Grid cols={4}>
          <KV k="Vehicle" v={from ? `${from.brand} ${from.model}` : '—'} />
          <KV k="Registration" v={from?.vehicleNumber} />
          <KV k="Owner" v={ownerOf(from?.id)} />
          <KV k="Daily rent" v={from ? rs(from.dailyRent) : '—'} />
          <KV k="Booking price" v={b ? rs(b.totalAmount) : '—'} />
          <KV k="Breakdown mileage" v={incident.mileage != null ? `${incident.mileage.toLocaleString()} km` : '—'} />
          <KV k="Fuel" v={incident.fuel} />
          <KV k="Status now" v={from?.status} />
        </Grid>
      </Section>

      <Section title="Before the handover" icon={ClipboardCheck}>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v.insuranceChecked} onChange={(e) => set('insuranceChecked', e.target.checked)} /> Replacement's insurance covers this rental</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v.driverChecked} onChange={(e) => set('driverChecked', e.target.checked)} /> Customer / driver is authorised for this vehicle (licence checked)</label>
      </Section>

      <Section title="Replacement vehicle" icon={ArrowLeftRight}>
        {!s.exchangeId ? (
          <div className="space-y-2">
            <p className="text-sm text-navy-600">The exchange screen records the return of {from?.vehicleNumber ?? 'the car'}, the handover of the replacement (only cars free for the rest of the trip are offered) and splits the owners' payouts by days.</p>
            <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5" onClick={() => {
              if (!v.insuranceChecked || !v.driverChecked) { act(() => 'Confirm the insurance and driver checks first.'); return; }
              if (b?.status !== 'Ongoing') { act(() => 'Only a rental in progress can have its vehicle exchanged.'); return; }
              if (draft.dirty) store.updateSolution(s.id, draft.d, by);
              act(() => null);   // clears an earlier message
              setExchanging(true);
            }}><ArrowLeftRight size={14} /> Start vehicle exchange</button>
          </div>
        ) : (
          <div className="space-y-2">
            <Grid cols={4}>
              <KV k="From" v={from ? `${from.vehicleNumber} · ${ownerOf(from.id)}` : '—'} />
              <KV k="To" v={to ? `${to.brand} ${to.model} (${to.vehicleNumber})` : '—'} />
              <KV k="New owner" v={ownerOf(to?.id)} />
              <KV k="Daily rent" v={to ? `${rs(to.dailyRent)} (${s.rateScenario === 'same' ? 'same rate' : s.rateScenario === 'higher' ? `${rs(s.rateDifference)}/day more` : `${rs(-(s.rateDifference ?? 0))}/day less`})` : '—'} />
            </Grid>
            <p className="text-[11px] text-navy-400">Owners are paid for their own days (see the Vehicles section). To give the customer the repaired original car back later, set it to Available and use Exchange vehicle again — that's a temporary replacement.</p>
          </div>
        )}
      </Section>

      <Section title="Delivery & collection" icon={Truck}>
        <Grid cols={4}>
          <Field label="Delivery location"><input className="input" {...text('deliveryLocation')} /></Field>
          <Field label="Delivered at"><input className="input" {...dt('deliveryAt')} /></Field>
          <Field label="Delivery driver"><input className="input" {...text('deliveryDriver')} /></Field>
          <Field label="Driver phone"><input className="input" type="tel" {...text('deliveryDriverPhone')} /></Field>
          <Field label="Original car collected from"><input className="input" {...text('collectionLocation')} /></Field>
          <Field label="Collected at"><input className="input" {...dt('collectionAt')} /></Field>
          <Field label="Collected by"><input className="input" {...text('collectionPerson')} /></Field>
          <Field label="Customer acknowledged"><input className="input" {...dt('customerAckAt')} /></Field>
        </Grid>
        <p className="text-[11px] text-navy-400">Add delivery / recovery costs as expenses below.</p>
      </Section>

      <PriceChange s={s} incident={incident} by={by} act={act} adj={adj} setAdj={setAdj}
        hint={to && from ? `Difference: ${rs((to.dailyRent - from.dailyRent))}/day × ${remaining} day(s) left ≈ ${rs((to.dailyRent - from.dailyRent) * remaining)}` : undefined} />

      {exchanging && b && <ExchangeVehicleModal booking={b} onClose={() => setExchanging(false)} />}
    </>
  );
}

/** Agreed change to the customer's price (+ more / − credit). Applied once, after the customer agrees. */
function PriceChange({ s, by, act, adj, setAdj, hint }: { s: BdSolution; incident: BdIncident; by: string; act: Act; adj: string; setAdj: (v: string) => void; hint?: string }) {
  const store = useBreakdownStore();
  return (
    <Section title="Customer price" icon={Receipt}>
      {s.adjustmentApprovedAt ? (
        <p className="text-sm text-navy-700">{(s.customerAdjustment ?? 0) > 0 ? `Customer agreed to pay ${rs(s.customerAdjustment)} more` : `Credit of ${rs(-(s.customerAdjustment ?? 0))} given`} — approved by {s.adjustmentApprovedBy}, {when(s.adjustmentApprovedAt)}.</p>
      ) : (
        <>
          <p className="text-xs text-navy-500">By default the customer's price stays the same and the company covers / keeps any difference. Only change it when the customer has agreed.</p>
          {hint && <p className="text-xs text-navy-400">{hint}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Agreed change (Rs) — + more, − credit"><input className="input !w-48" type="number" value={adj} onChange={(e) => setAdj(e.target.value)} /></Field>
            <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => {
              const n = Number(adj);
              if (!n) { act(() => 'Enter the agreed amount.'); return; }
              if (!confirm(n > 0 ? `The customer has agreed to pay ${rs(n)} more? It will be added to their booking bill.` : `Give the customer a credit of ${rs(-n)}?`)) return;
              act(() => store.applyPriceDifference(s.id, n, by));
            }}>Customer agreed — apply</button>
          </div>
        </>
      )}
    </Section>
  );
}

/* ── 03 Partner vehicle ────────────────────────────────────────────────────── */
function Partner({ s, draft, incident, by, act }: { s: BdSolution; draft: Draft; incident: BdIncident; by: string; act: Act }) {
  const store = useBreakdownStore();
  const { bookings, vehicles } = useStore();
  const b = bookings.find((x) => x.id === incident.bookingId);
  const { v, text, number, dt, set } = draft;
  const [adj, setAdj] = useState('');
  const [ownerAdj, setOwnerAdj] = useState('');
  const original = vehicles.find((x) => x.id === (s.fromVehicleId ?? incident.vehicleId));
  const days = v.periodStart && v.periodEnd ? Math.max(1, Math.ceil((new Date(v.periodEnd).getTime() - new Date(v.periodStart).getTime()) / 864e5)) : 0;
  const perDay = b ? b.totalAmount / Math.max(1, b.totalDays) : 0;
  const suggestedOwner = Math.round(perDay * days);
  const hasPartnerExpense = store.expenses.some((e) => e.solutionId === s.id && e.category === 'partner' && !e.voidedAt);
  const subsidy = (v.agreedAmount ?? 0) - Math.max(0, s.customerAdjustment ?? 0) - (s.ownerShareAdjustment ?? 0);

  return (
    <>
      <Provider draft={draft} title="Partner (company or owner)" companyLabel="Contact person" />
      <Section title="Partner vehicle" icon={Car}>
        <Grid cols={4}>
          <Field label="Vehicle (make / model)"><input className="input" {...text('partnerVehicle')} /></Field>
          <Field label="Registration"><input className="input" {...text('partnerReg')} /></Field>
          <Field label="Category"><input className="input" {...text('partnerCategory')} placeholder="Sedan, SUV, van…" /></Field>
          <Field label="Deposit required (Rs)"><input className="input" {...number('depositAmount')} /></Field>
          <Field label="Rental start"><input className="input" {...dt('periodStart')} /></Field>
          <Field label="Rental end"><input className="input" {...dt('periodEnd')} /></Field>
          <Field label="Partner quoted (Rs)"><input className="input" {...number('quotedAmount')} /></Field>
          <Field label="Agreed amount (Rs)"><input className="input" {...number('agreedAmount')} /></Field>
          <Field label="Pickup / delivery at"><input className="input" {...text('deliveryLocation')} /></Field>
          <Field label="Customer received it"><input className="input" {...dt('deliveredAt')} /></Field>
        </Grid>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v.insuranceChecked} onChange={(e) => set('insuranceChecked', e.target.checked)} /> Partner vehicle insured and the customer is allowed to drive it</label>
        <p className="text-[11px] text-navy-400">Add the partner's agreement in Documents. The booking stays on {original?.vehicleNumber ?? 'the original car'} (in repair); this record holds the partner period and costs.</p>
      </Section>

      <Section title="Partner money" icon={Receipt}>
        <Grid cols={4}>
          <KV k="Payable to partner" v={rs(v.agreedAmount)} />
          <KV k="Customer price change" v={s.adjustmentApprovedAt ? rs(s.customerAdjustment) : 'none'} />
          <KV k="Original owner's share reduced" v={s.ownerShareAdjustment ? rs(s.ownerShareAdjustment) : 'not yet'} />
          <KV k="Company covers" v={rs(Math.max(0, subsidy))} />
        </Grid>
        {!hasPartnerExpense && (v.agreedAmount ?? 0) > 0 && (
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => act(() => {
            if (draft.dirty) store.updateSolution(s.id, draft.d, by);
            return store.addExpense({ incidentId: incident.id, solutionId: s.id, category: 'partner', description: `Partner vehicle ${v.partnerVehicle ?? ''} ${v.partnerReg ?? ''}`.trim(), quantity: 1, unitCost: v.agreedAmount!, vendor: v.providerName, by });
          })}>Add the agreed amount as the partner cost</button>
        )}
        <div className="border-t border-navy-50 pt-3 space-y-2">
          <p className="text-xs text-navy-500">The original owner's car did not serve these days{days ? ` (${days} day${days === 1 ? '' : 's'} ≈ ${rs(suggestedOwner)} of the booking price)` : ''}. Reduce their payout by the agreed amount:</p>
          {s.ownerShareAdjustment ? <p className="text-sm">Reduced by {rs(s.ownerShareAdjustment)}.</p> : (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Reduce original owner's payout by (Rs)"><input className="input !w-48" type="number" min="0" placeholder={suggestedOwner ? String(suggestedOwner) : ''} value={ownerAdj} onChange={(e) => setOwnerAdj(e.target.value)} /></Field>
              <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => {
                const n = Number(ownerAdj || suggestedOwner);
                if (!confirm(`Reduce the original owner's payout by ${rs(n)}?`)) return;
                act(() => store.applyOwnerShareAdjustment(s.id, n, by));
              }}>Apply</button>
            </div>
          )}
        </div>
      </Section>
      <PriceChange s={s} incident={incident} by={by} act={act} adj={adj} setAdj={setAdj} />
    </>
  );
}

/* ── 04 Towing & garage ────────────────────────────────────────────────────── */
function TowingGarage({ s, draft, incident, by, act }: { s: BdSolution; draft: Draft; incident: BdIncident; by: string; act: Act }) {
  const store = useBreakdownStore();
  const { vehicles } = useStore();
  const { text, number, dt } = draft;
  const vehicle = vehicles.find((x) => x.id === incident.vehicleId);
  return (
    <>
      <Provider draft={draft} title="Towing provider" companyLabel="Tow driver" />
      <Section title="Towing" icon={Truck}>
        <Grid cols={4}>
          <Field label="Pickup location"><input className="input" {...text('pickupLocation')} /></Field>
          <Field label="Destination garage address"><input className="input" {...text('destination')} /></Field>
          <Field label="Dispatched"><input className="input" {...dt('dispatchAt')} /></Field>
          <Field label="Tow arrived"><input className="input" {...dt('arriveAt')} /></Field>
          <Field label="Vehicle collected"><input className="input" {...dt('collectedAt')} /></Field>
          <Field label="Delivered to garage"><input className="input" {...dt('deliveredAt')} /></Field>
        </Grid>
        <p className="text-[11px] text-navy-400">Add the towing charge as an expense (with its receipt), and collection / handover photos in Documents.</p>
      </Section>
      <Section title="Garage" icon={Hammer}>
        <Grid cols={4}>
          <Field label="Garage name"><input className="input" {...text('garageName')} /></Field>
          <Field label="Garage contact"><input className="input" type="tel" {...text('garageContact')} /></Field>
          <Field label="Mechanic"><input className="input" {...text('mechanic')} /></Field>
          <Field label="Estimated completion"><input className="input" type="date" value={draft.v.estCompletion ?? ''} onChange={(e) => draft.set('estCompletion', e.target.value || undefined)} /></Field>
        </Grid>
        <Grid>
          <Field label="Initial inspection report"><textarea className="input" rows={2} {...text('inspectionReport')} /></Field>
          <Field label="Work actually done"><textarea className="input" rows={2} {...text('workDone')} /></Field>
          <Field label="Parts required"><textarea className="input" rows={2} {...text('partsReplaced')} /></Field>
          <Field label="Final invoice (Rs)"><input className="input" {...number('invoiceAmount')} /></Field>
        </Grid>
        <div className="flex flex-wrap items-end gap-3 border-t border-navy-50 pt-3">
          <Field label="Repair quotation (Rs)"><input className="input !w-40" {...number('quoteAmount')} /></Field>
          {s.quoteApprovedAt
            ? <span className="text-sm text-emerald-700 pb-2">Approved by {s.quoteApprovedBy}, {when(s.quoteApprovedAt)}</span>
            : <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => { if (confirm(`Approve the garage quotation of ${rs(draft.v.quoteAmount)}?`)) act(() => { if (draft.dirty) store.updateSolution(s.id, draft.d, by); return store.approveQuote(s.id, by); }); }}>Approve quotation</button>}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-navy-50 pt-3">
          {s.roadworthyAt ? <span className="text-sm text-emerald-700">Garage confirmed roadworthy — {s.roadworthyBy}, {when(s.roadworthyAt)}</span> : (
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => { if (confirm('The garage confirms the vehicle is repaired and roadworthy?')) act(() => store.confirmRoadworthy(s.id, by)); }}>Garage confirms roadworthy</button>
          )}
          <span className="text-[11px] text-navy-400">{vehicle?.vehicleNumber ?? 'The vehicle'} stays under maintenance until an admin uses <b>Mark vehicle as ready</b> (Overview).</span>
        </div>
        <p className="text-[11px] text-navy-400">While the car is at the garage you can add a replacement, partner vehicle or alternative transport as another solution.</p>
      </Section>
    </>
  );
}

/* ── 05 Alternative transport ──────────────────────────────────────────────── */
function AltTransport({ s, draft, incident, by }: { s: BdSolution; draft: Draft; incident: BdIncident; by: string }) {
  const store = useBreakdownStore();
  const { v, text, number, dt, set } = draft;
  const hasFare = store.expenses.some((e) => e.solutionId === s.id && e.category === 'alt_transport' && !e.voidedAt);
  return (
    <>
      <Section title="Transport" icon={Car}>
        <Chips size="xs" value={v.transportType as 'Taxi' | undefined} options={[['Taxi', 'Taxi'], ['Van', 'Van'], ['Car with driver', 'Car with driver'], ['Tuk-tuk', 'Tuk-tuk'], ['Other', 'Other']] as [string, string][]} onChange={(x) => set('transportType', x)} />
        <Grid cols={4}>
          <Field label="Provider"><input className="input" {...text('providerName')} /></Field>
          <Field label="Driver"><input className="input" {...text('providerCompany')} /></Field>
          <Field label="Driver phone"><input className="input" type="tel" {...text('providerPhone')} /></Field>
          <Field label="Passengers"><input className="input" {...number('passengers')} /></Field>
          <Field label="Pickup location"><input className="input" {...text('pickupLocation')} /></Field>
          <Field label="Destination"><input className="input" {...text('destination')} /></Field>
          <Field label="Pickup time"><input className="input" {...dt('dispatchAt')} /></Field>
          <Field label="Actually arrived"><input className="input" {...dt('arriveAt')} /></Field>
          <Field label="Agreed fare (Rs)"><input className="input" {...number('fare')} /></Field>
          <Field label="Customer acknowledged"><input className="input" {...dt('customerAckAt')} /></Field>
        </Grid>
        {!hasFare && (v.fare ?? 0) > 0 && (
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => {
            if (draft.dirty) store.updateSolution(s.id, draft.d, by);
            const e = store.addExpense({ incidentId: incident.id, solutionId: s.id, category: 'alt_transport', description: `${v.transportType ?? 'Transport'} ${v.pickupLocation ?? ''} → ${v.destination ?? ''}`.trim(), quantity: 1, unitCost: v.fare!, vendor: v.providerName, by });
            if (e) toast.error('Not added', e);
          }}>Add the fare as an expense</button>
        )}
        <p className="text-[11px] text-navy-400">Who pays is decided in the responsibility section; extra costs go in the expenses below.</p>
      </Section>
    </>
  );
}

/* ── 06 Termination & refund ──────────────────────────────────────────────── */
function Termination({ s, draft, incident, by, act }: { s: BdSolution; draft: Draft; incident: BdIncident; by: string; act: Act }) {
  const store = useBreakdownStore();
  const { bookings } = useStore();
  const b = bookings.find((x) => x.id === incident.bookingId);
  const { v, text, number, dt } = draft;
  const [approve, setApprove] = useState('');
  const [method, setMethod] = useState('Bank transfer');
  const [ref, setRef] = useState('');
  const [key] = useState(newKey);
  const usedValue = useMemo(() => (s.usedDays !== undefined && s.originalTotal !== undefined ? (s.originalTotal * s.usedDays) / Math.max(1, s.usedDays + (s.unusedDays ?? 0)) : undefined), [s.usedDays, s.unusedDays, s.originalTotal]);
  const paidStep = s.refundStatus === 'paid' || s.refundStatus === 'not_required';

  return (
    <>
      <Section title="End the booking early" icon={Ban} tone="warn">
        <Grid cols={3}>
          <Field label="Termination date & time *"><input className="input" {...dt('terminateAt')} /></Field>
          <Field label="Customer agreed / notified at"><input className="input" {...dt('customerAgreedAt')} /></Field>
          <Field label="Approved deductions (Rs)"><input className="input" {...number('deductions')} /></Field>
        </Grid>
        <Grid>
          <Field label="Reason *"><textarea className="input" rows={2} {...text('terminationReason')} /></Field>
          <Field label="Deductions note"><textarea className="input" rows={2} {...text('deductionsNote')} placeholder="e.g. damage caused by the customer" /></Field>
        </Grid>
        <Grid cols={3}>
          <Field label="Credits / goodwill (Rs)"><input className="input" {...number('credits')} /></Field>
        </Grid>
        <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={s.bookingAmendedAt !== undefined} onClick={() => act(() => {
          if (!v.terminateAt) return 'Enter the termination date and time.';
          store.updateSolution(s.id, draft.d, by); draft.reset();
          return store.proposeTermination(s.id, { terminateAt: v.terminateAt, reason: v.terminationReason ?? '', deductions: v.deductions, deductionsNote: v.deductionsNote, credits: v.credits }, by);
        })}>Work out the refund</button>
        <p className="text-[11px] text-navy-400">Policy: {REFUND_POLICY}</p>
      </Section>

      {s.refundProposed !== undefined && (
        <Section title="Refund" icon={Receipt}>
          <Grid cols={4}>
            <KV k="Booked" v={`${(s.usedDays ?? 0) + (s.unusedDays ?? 0)} days · ${rs(s.originalTotal)}`} />
            <KV k="Used" v={`${s.usedDays} day(s) · ${rs(usedValue)}`} />
            <KV k="Unused" v={`${s.unusedDays} day(s)`} />
            <KV k="Paid so far" v={rs(s.previouslyPaid)} />
            <KV k="Deductions" v={rs(s.deductions)} />
            <KV k="Credits" v={rs(s.credits)} />
            <KV k="Proposed refund" v={rs(s.refundProposed)} />
            <KV k="Status" v={({ pending_approval: 'Waiting for approval', approved: 'Approved — not paid', paid: 'Paid', not_required: 'No refund due' } as const)[s.refundStatus ?? 'pending_approval']} warn={s.refundStatus === 'pending_approval' || s.refundStatus === 'approved'} />
          </Grid>

          {s.refundStatus === 'pending_approval' && (
            <div className="flex flex-wrap items-end gap-2 border-t border-navy-50 pt-3">
              <Field label="Approve refund of (Rs)"><input className="input !w-40" type="number" min="0" placeholder={String(Math.round(s.refundProposed))} value={approve} onChange={(e) => setApprove(e.target.value)} /></Field>
              <button type="button" className="btn-primary !py-2 text-sm" onClick={() => {
                const n = approve === '' ? s.refundProposed! : Number(approve);
                if (!confirm(`Approve a refund of ${rs(n)}? (Only an authorised admin should do this.)`)) return;
                act(() => store.approveRefund(s.id, n, by));
              }}>Approve refund</button>
            </div>
          )}
          {s.refundApprovedAt && <p className="text-xs text-navy-500">Approved {rs(s.refundApproved)} by {s.refundApprovedBy}, {when(s.refundApprovedAt)}.</p>}

          <div className="border-t border-navy-50 pt-3 space-y-2">
            {s.bookingAmendedAt ? <p className="text-sm text-emerald-700">Booking shortened to the used period on {when(s.bookingAmendedAt)} (original price {rs(s.originalTotal)} kept in its history).</p> : (
              <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={!s.refundApprovedAt && s.refundStatus !== 'not_required'} onClick={() => {
                if (!confirm(`Shorten booking to ${s.usedDays} day(s) (${rs(usedValue)})? Owner payouts follow the shorter booking.`)) return;
                act(() => store.amendBookingForTermination(s.id, by));
              }}>Shorten booking to the used period</button>
            )}
          </div>

          {s.refundStatus === 'approved' && (
            <div className="flex flex-wrap items-end gap-2 border-t border-navy-50 pt-3">
              <Field label="Paid by"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{['Bank transfer', 'Cash', 'Card reversal', 'Online'].map((m) => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Transaction reference"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
              <button type="button" className="btn-primary !py-2 text-sm" disabled={!s.bookingAmendedAt} onClick={() => {
                if (!confirm(`Record that ${rs(s.refundApproved)} was refunded to ${b?.customerName ?? 'the customer'}?`)) return;
                act(() => store.payRefund(s.id, { method, reference: ref, key }, by));
              }}>Record refund paid</button>
            </div>
          )}
          {s.refundStatus === 'paid' && <p className="text-sm text-emerald-700">Refund paid by {s.refundMethod}{s.refundReference ? ` (ref ${s.refundReference})` : ''} — {s.refundPaidBy}, {when(s.refundPaidAt)}.</p>}
        </Section>
      )}

      <Section title="Vehicle recovery" icon={RotateCcw}>
        <Chips size="xs" value={s.recoveryStatus} options={[['pending', 'Not recovered yet'], ['in_progress', 'Being recovered'], ['recovered', 'Recovered']]} onChange={(x) => act(() => store.setRecovery(s.id, x, by))} />
        {!paidStep && <p className="text-[11px] text-navy-400">The incident can't be closed while a refund or the vehicle recovery is pending.</p>}
        {s.recoveryStatus === 'recovered' && s.bookingAmendedAt && <p className="text-[11px] text-emerald-700">The booking was completed when the vehicle was recovered.</p>}
      </Section>
      <p className="text-[11px] text-navy-400">Booking {b?.id.slice(0, 8).toUpperCase()}: {b ? `${b.startDate} → ${b.endDate} · ${rs(b.totalAmount)} · paid ${rs(b.paidAmount)}` : '—'}</p>
    </>
  );
}

export const SOLUTION_CHOICES = (Object.keys(SOLUTION_LABEL) as SolutionKind[]).map((k) => ({ kind: k, label: SOLUTION_LABEL[k], hint: SOLUTION_HINT[k], Icon: ICON[k] }));
