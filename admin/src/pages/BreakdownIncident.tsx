import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Camera, Car, CheckCircle2, ClipboardList, FileText, History, Lock, MessageCircle, Plus, Printer,
  Scale, ShieldAlert, Stethoscope, Truck, Users, Wrench,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { useBreakdownStore, forIncident } from '../store/useBreakdownStore';
import { leftoverSolutions, BdIncident, BdCategory, BdSolution, CATEGORY_LABEL, SOLUTION_LABEL, SOLUTION_STATUS_LABEL, SolutionKind, STATUS_LABEL, UNSAFE_CATEGORIES, BdDocument, PHASE_LABEL, phaseOf } from '../lib/breakdowns';
import VehicleReadiness from '../components/breakdowns/VehicleReadiness';
import VehicleBreakdownHistory from '../components/breakdowns/VehicleBreakdownHistory';
import IncidentTimeline from '../components/breakdowns/IncidentTimeline';
import { ledgerFor } from '../lib/breakdownLedger';
import { legsOf } from '../lib/exchange';
import { uploadBookingFile } from '../lib/bookingRecord';
import { openWhatsApp } from '../lib/whatsapp';
import { printBreakdownReport } from '../lib/printBreakdown';
import { toast } from '../store/useToast';
import SolutionPanel, { SOLUTION_CHOICES } from '../components/breakdowns/SolutionPanel';
import { ExpenseEditor, LedgerSummary, PaymentForm, PaymentList, ResponsibilityEditor, SettlementActions, openFile } from '../components/breakdowns/MoneyPanels';
import { Chips, ErrorLine, Field, Grid, KV, Pill, Section, rs, when } from '../components/breakdowns/bdui';

const TABS = [
  ['overview', 'Overview', ClipboardList], ['timeline', 'Timeline', History], ['diagnosis', 'Diagnosis', Stethoscope],
  ['solutions', 'Solutions', Wrench], ['providers', 'Providers', Users], ['vehicles', 'Vehicles', Car],
  ['money', 'Expenses & payments', Scale], ['documents', 'Documents', Camera], ['communication', 'Customer messages', MessageCircle],
  ['resolution', 'Resolution', CheckCircle2],
] as const;
type Tab = (typeof TABS)[number][0];

export default function BreakdownIncident() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const store = useBreakdownStore();
  const { bookings, vehicles, owners } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const isAdmin = useAuthStore((s) => s.isAdmin)();
  const [tab, setTab] = useState<Tab>('overview');
  const [focusSolution, setFocusSolution] = useState<string | undefined>();
  useEffect(() => { if (!store.ready) store.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const i = store.incidents.find((x) => x.id === id);
  if (!store.ready) return <div className="p-6 text-sm text-navy-400">Loading…</div>;
  if (!i) return <div className="p-6 space-y-3"><p className="text-sm text-navy-500">Breakdown not found.</p><Link to="/breakdowns" className="btn-secondary inline-flex">Back to breakdowns</Link></div>;

  const b = bookings.find((x) => x.id === i.bookingId);
  const vehicle = vehicles.find((v) => v.id === i.vehicleId);
  const owner = owners.find((o) => o.id === i.ownerId);
  const l = ledgerFor(i.id, store);
  const sols = forIncident(store.solutions, i.id).sort((a, c) => a.createdAt.localeCompare(c.createdAt));
  const readOnly = !isAdmin || i.status === 'closed' || i.status === 'cancelled';

  return (
    <div>
      <Header title={`Breakdown ${i.ref}`} subtitle={`${b?.customerName ?? '—'} · ${vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})` : '—'}`} />
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1"><ArrowLeft size={14} /> Back</button>
          <Pill k={phaseOf(i, store.solutions)}>{PHASE_LABEL[phaseOf(i, store.solutions)]}</Pill>
          {(i.holdVehicleId && !i.holdClearedAt) ? <Pill k="maintenance">Vehicle under maintenance</Pill> : i.holdClearedAt ? <Pill k="ready">Vehicle ready</Pill> : null}
          <Pill k={i.urgency}>{i.urgency === 'emergency' ? 'Emergency' : `${i.urgency} urgency`}</Pill>
          <Pill k={l.settled ? 'settled' : 'outstanding'}>{l.cost ? `${rs(l.cost)} · ${l.settled ? 'settled' : 'outstanding'}` : 'No costs yet'}</Pill>
          <span className="flex-1" />
          <button type="button" className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1" onClick={() => printBreakdownReport(i, store, b, vehicles, owners)}><Printer size={14} /> Print report</button>
        </div>
        {(UNSAFE_CATEGORIES.includes(i.category) || i.driveable === 'no') && i.status === 'open' && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex gap-2"><ShieldAlert size={16} className="flex-shrink-0 mt-0.5" /> Not to be driven until an authorised professional confirms it is safe.</div>
        )}

        <nav className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Incident sections">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`flex-none inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold ${tab === k ? 'bg-navy-800 text-white' : 'bg-white text-navy-600 border border-navy-100 hover:border-navy-300'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && <Overview i={i} by={by} readOnly={readOnly} onGo={setTab} />}
        {tab === 'timeline' && <IncidentTimeline i={i} by={by} onOpenSolution={(sid) => { setFocusSolution(sid); setTab('solutions'); }} />}
        {tab === 'diagnosis' && <Diagnosis i={i} by={by} readOnly={readOnly} />}
        {tab === 'solutions' && (
          <SolutionsTab key={focusSolution ?? 'latest'} i={i} sols={sols} by={by} readOnly={readOnly} focusId={focusSolution} />
        )}
        {tab === 'providers' && <Providers i={i} />}
        {tab === 'vehicles' && <Vehicles i={i} />}
        {tab === 'money' && (
          <div className="space-y-4">
            <LedgerSummary incidentId={i.id} />
            <ResponsibilityEditor incidentId={i.id} by={by} />
            <SettlementActions incidentId={i.id} by={by} />
            <Section title="All expenses" icon={FileText}><ExpenseEditor incidentId={i.id} bookingId={i.bookingId} by={by} /></Section>
            <Section title="Payments" icon={Scale}>
              <PaymentList incidentId={i.id} by={by} />
              <RecordPayment incidentId={i.id} bookingId={i.bookingId} by={by} />
            </Section>
          </div>
        )}
        {tab === 'documents' && <Documents i={i} by={by} />}
        {tab === 'communication' && <Communication i={i} by={by} />}
        {tab === 'resolution' && <Resolution i={i} by={by} isAdmin={isAdmin} />}
        {owner && tab === 'overview' && <p className="text-[11px] text-navy-400">Owner {owner.name} can see this incident (read-only) in their portal.</p>}
      </div>
    </div>
  );
}

function RecordPayment({ incidentId, bookingId, by }: { incidentId: string; bookingId: string; by: string }) {
  const [open, setOpen] = useState(false);
  return open ? <PaymentForm incidentId={incidentId} bookingId={bookingId} by={by} onDone={() => setOpen(false)} />
    : <button type="button" className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy-600" onClick={() => setOpen(true)}><Plus size={13} /> Record a payment / reimbursement</button>;
}

/* ── Overview ─────────────────────────────────────────────────────────────── */
function Overview({ i, by, readOnly, onGo }: { i: BdIncident; by: string; readOnly: boolean; onGo: (t: Tab) => void }) {
  const store = useBreakdownStore();
  const { bookings, vehicles, owners } = useStore();
  const b = bookings.find((x) => x.id === i.bookingId);
  const vehicle = vehicles.find((v) => v.id === i.vehicleId);
  const owner = owners.find((o) => o.id === i.ownerId);
  const l = ledgerFor(i.id, store);
  const sols = forIncident(store.solutions, i.id);
  void by; void readOnly;
  return (
    <div className="space-y-4">
    <VehicleReadiness i={i} />
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Booking" icon={ClipboardList}>
        <KV k="Customer" v={b ? `${b.customerName} · ${b.customerPhone}` : '—'} />
        <KV k="Booking" v={b ? `${b.startDate} → ${b.endDate} · ${b.status}` : '—'} />
        <KV k="Booking value" v={b ? rs(b.totalAmount) : '—'} />
        <KV k="Paid" v={b ? rs(b.paidAmount + (b.advanceAmount ?? 0)) : '—'} />
        <KV k="Vehicle at breakdown" v={vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})` : '—'} />
        <KV k="Owner" v={owner ? `${owner.name} · ${owner.phone}` : '—'} />
        {b && <Link to={`/bookings?open=${b.id}`} className="text-xs font-semibold text-navy-600 underline">Open booking</Link>}
      </Section>
      <Section title="Incident" icon={AlertTriangle}>
        <KV k="Type" v={CATEGORY_LABEL[i.category]} />
        <KV k="Broke down" v={when(i.occurredAt ?? i.reportedAt)} />
        <KV k="Where" v={i.location ? <>{i.location}{i.lat !== undefined && <> · <a className="underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${i.lat},${i.lng}`}>map</a></>}</> : '—'} />
        <KV k="Reported" v={`${when(i.reportedAt)} · by ${i.reportedBy}`} />
        <KV k="Contact" v={i.contactPhone} />
        <KV k="Driveable / passengers" v={`${i.driveable} · ${i.passengersSafe}`} warn={i.driveable === 'no' || i.passengersSafe === 'at_risk'} />
        <KV k="Assigned" v={i.assignedTo ?? 'Nobody yet'} warn={!i.assignedTo && i.status === 'open'} />
        <p className="text-sm text-navy-700 pt-1">{i.description}</p>
      </Section>
      <Section title="Solutions" icon={Wrench} action={<button type="button" className="text-xs font-semibold text-navy-600" onClick={() => onGo('solutions')}>Manage</button>}>
        {sols.length ? sols.map((s) => <KV key={s.id} k={SOLUTION_LABEL[s.kind]} v={<Pill k={s.status}>{s.status.replace('_', ' ')}</Pill>} />) : <p className="text-sm text-navy-400">None yet.</p>}
      </Section>
      <Section title="Money" icon={Scale} action={<button type="button" className="text-xs font-semibold text-navy-600" onClick={() => onGo('money')}>Open</button>}>
        <KV k="Total cost" v={rs(l.cost)} />
        <KV k="Unpaid to providers" v={rs(l.vendorUnpaid)} warn={l.vendorUnpaid > 0.5} />
        <KV k="Owner owes" v={rs(Math.max(0, l.outstanding.owner))} warn={l.outstanding.owner > 0.5} />
        <KV k="Customer owes" v={rs(Math.max(0, l.outstanding.customer))} warn={l.outstanding.customer > 0.5} />
        <KV k="Refunds" v={`${rs(l.refundsPaid)} paid${l.refundPending ? ` · ${rs(l.refundPending)} pending` : ''}`} />
      </Section>
    </div>
    {i.vehicleId && <Section title="Earlier breakdowns of this vehicle" icon={History}><VehicleBreakdownHistory vehicleId={i.vehicleId} exceptId={i.id} compact /></Section>}
    </div>
  );
}

/* ── Diagnosis ────────────────────────────────────────────────────────────── */
function Diagnosis({ i, by, readOnly }: { i: BdIncident; by: string; readOnly: boolean }) {
  const store = useBreakdownStore();
  const [f, setF] = useState({ category: i.category, description: i.description, cause: i.cause ?? '', causeStatus: i.causeStatus, driveable: i.driveable, passengersSafe: i.passengersSafe, urgency: i.urgency, location: i.location ?? '', mileage: i.mileage?.toString() ?? '', fuel: i.fuel ?? '', notes: i.notes ?? '' });
  const [err, setErr] = useState('');
  const save = () => {
    if (f.causeStatus === 'assessed' && !f.cause.trim()) { setErr('Write the assessed cause.'); return; }
    const changes: string[] = [];
    if (f.causeStatus !== i.causeStatus || f.cause !== (i.cause ?? '')) changes.push(f.causeStatus === 'assessed' ? `cause assessed: ${f.cause}` : 'cause back to pending');
    if (f.category !== i.category) changes.push(`type → ${CATEGORY_LABEL[f.category]}`);
    if (f.urgency !== i.urgency) changes.push(`urgency → ${f.urgency}`);
    store.updateIncident(i.id, { ...f, cause: f.cause || undefined, location: f.location || undefined, mileage: f.mileage === '' ? undefined : Number(f.mileage), fuel: f.fuel || undefined, notes: f.notes || undefined }, by, changes.length ? `Diagnosis updated — ${changes.join('; ')}` : 'Incident details updated');
    setErr('');
    toast.success('Saved', '');
  };
  return (
    <Section title="Diagnosis & incident details" icon={Stethoscope}>
      <Field label="Cause"><Chips size="xs" value={f.causeStatus} options={[['pending', 'Pending assessment'], ['assessed', 'Assessed']]} onChange={(v) => setF((x) => ({ ...x, causeStatus: v }))} /></Field>
      {f.causeStatus === 'assessed' && <Field label="Assessed cause"><textarea className="input" rows={2} value={f.cause} onChange={(e) => setF((x) => ({ ...x, cause: e.target.value }))} placeholder="e.g. Cooling fan relay failed — engine overheated" /></Field>}
      <Field label="Breakdown type"><Chips size="xs" value={f.category} options={Object.entries(CATEGORY_LABEL) as [BdCategory, string][]} onChange={(v) => setF((x) => ({ ...x, category: v }))} /></Field>
      <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} /></Field>
      <Grid cols={3}>
        <Field label="Driveable"><select className="input" value={f.driveable} onChange={(e) => setF((x) => ({ ...x, driveable: e.target.value as BdIncident['driveable'] }))}><option value="yes">Yes</option><option value="limited">Limited</option><option value="no">No</option><option value="unknown">Unknown</option></select></Field>
        <Field label="Passengers"><select className="input" value={f.passengersSafe} onChange={(e) => setF((x) => ({ ...x, passengersSafe: e.target.value as BdIncident['passengersSafe'] }))}><option value="safe">Safe</option><option value="at_risk">At risk</option><option value="unknown">Unknown</option></select></Field>
        <Field label="Urgency"><select className="input" value={f.urgency} onChange={(e) => setF((x) => ({ ...x, urgency: e.target.value as BdIncident['urgency'] }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="emergency">Emergency</option></select></Field>
        <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF((x) => ({ ...x, location: e.target.value }))} /></Field>
        <Field label="Mileage (km)"><input className="input" type="number" min="0" value={f.mileage} onChange={(e) => setF((x) => ({ ...x, mileage: e.target.value }))} /></Field>
        <Field label="Fuel"><input className="input" value={f.fuel} onChange={(e) => setF((x) => ({ ...x, fuel: e.target.value }))} /></Field>
      </Grid>
      <Field label="Admin notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} /></Field>
      <ErrorLine msg={err} />
      {!readOnly && <div className="flex justify-end"><button type="button" className="btn-primary !py-1.5 text-sm" onClick={save}>Save</button></div>}
    </Section>
  );
}

/* ── Solutions ────────────────────────────────────────────────────────────── */
// No solution yet → the full picker. Otherwise one tab per solution (only the chosen one is shown)
// and a compact "Add another solution" menu.
function SolutionsTab({ i, sols, by, readOnly, focusId }: { i: BdIncident; sols: BdSolution[]; by: string; readOnly: boolean; focusId?: string }) {
  const add = useBreakdownStore((s) => s.addSolution);
  const setStatus = useBreakdownStore((s) => s.setSolutionStatus);
  const expenses = useBreakdownStore((s) => s.expenses);
  const documents = useBreakdownStore((s) => s.documents);
  const dupes = readOnly ? [] : leftoverSolutions(sols, forIncident(expenses, i.id), forIncident(documents, i.id));
  const tidy = () => {
    const names = dupes.map((d) => SOLUTION_LABEL[d.kind]).join(', ');
    if (!confirm(`Remove ${dupes.length} unused solution${dupes.length === 1 ? '' : 's'} (${names})? Nothing was entered in ${dupes.length === 1 ? 'it' : 'them'}. ${dupes.length === 1 ? 'It stays' : 'They stay'} on record under "Show cancelled".`)) return;
    dupes.forEach((d) => setStatus(d.id, 'cancelled', by, { result: 'Not used — picked by mistake' }));
    toast.success('Unused solutions removed', `${dupes.length} removed from the list`);
  };
  const [showCancelled, setShowCancelled] = useState(() => sols.find((s) => s.id === focusId)?.status === 'cancelled');
  const cancelledCount = sols.filter((s) => s.status === 'cancelled').length;
  // Cancelled attempts stay on record but are hidden unless asked for
  const shown = sols.filter((s) => showCancelled || s.status !== 'cancelled');
  const latest = shown[shown.length - 1];
  const [activeId, setActiveId] = useState<string | undefined>(focusId ?? latest?.id);
  const [menu, setMenu] = useState(false);
  const active = shown.find((s) => s.id === activeId) ?? latest;
  // "Towing & garage repair #2" when the same kind was tried more than once
  const nth = (s: BdSolution) => {
    const same = sols.filter((x) => x.kind === s.kind);
    return same.length > 1 ? ` #${same.indexOf(s) + 1}` : '';
  };
  const pick = (kind: SolutionKind) => {
    const r = add(i.id, kind, by);
    if (r.error) { toast.error('Not added', r.error); return; }
    setMenu(false);
    if (r.existing) toast.info(`${SOLUTION_LABEL[kind]} is already open`, 'Showing it — finish or cancel it before starting another.');
    if (r.solution) { setActiveId(r.solution.id); if (r.solution.status === 'cancelled') setShowCancelled(true); }
  };

  if (!shown.length) {
    if (readOnly) return <p className="text-sm text-navy-400">No solutions were used.</p>;
    return (
      <Section title="Add a solution" icon={Plus}
               action={cancelledCount ? <button type="button" className="text-xs font-semibold text-navy-500 hover:text-navy-800" onClick={() => setShowCancelled(true)}>Show cancelled ({cancelledCount})</button> : undefined}>
        <p className="text-[11px] text-navy-400">Several can run together or one after another (e.g. towing, then a replacement). Earlier attempts and their costs are kept.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {SOLUTION_CHOICES.map(({ kind, label, hint, Icon }) => (
            <button key={kind} type="button" onClick={() => pick(kind)}
                    className="text-left rounded-xl border border-navy-100 p-3 hover:border-navy-400 hover:bg-navy-50/40 transition-colors">
              <p className="font-semibold text-sm text-navy-800 flex items-center gap-1.5"><Icon size={14} /> {label}</p>
              <p className="text-[11px] text-navy-400 mt-0.5">{hint}</p>
            </button>
          ))}
        </div>
      </Section>
    );
  }

  return (
    <div className="space-y-4">
      {dupes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex flex-wrap items-center gap-2">
          <AlertTriangle size={15} className="flex-shrink-0" />
          <span className="flex-1 min-w-[200px]">
            {dupes.map((d) => SOLUTION_LABEL[d.kind]).join(', ')} {dupes.length === 1 ? 'was' : 'were'} picked but never used — nothing was entered.
            Remove {dupes.length === 1 ? 'it' : 'them'} so only the solution{sols.length - dupes.length === 1 ? '' : 's'} actually used {sols.length - dupes.length === 1 ? 'is' : 'are'} shown.
          </span>
          <button type="button" onClick={tidy} className="btn-secondary !py-1 text-xs">Remove {dupes.length} unused</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((s) => {
          const Icon = SOLUTION_CHOICES.find((c) => c.kind === s.kind)?.Icon ?? Wrench;
          const on = s.id === active?.id;
          return (
            <button key={s.id} type="button" onClick={() => setActiveId(s.id)} aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold border ${on ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-700 border-navy-100 hover:border-navy-300'}`}>
              <Icon size={14} /> {SOLUTION_LABEL[s.kind]}{nth(s)}
              <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${on ? 'bg-white/15' : 'bg-navy-50 text-navy-500'}`}>{SOLUTION_STATUS_LABEL[s.status]}</span>
            </button>
          );
        })}
        {cancelledCount > 0 && (
          <button type="button" onClick={() => setShowCancelled((v) => !v)} className="text-xs font-semibold text-navy-500 hover:text-navy-800 px-1">
            {showCancelled ? 'Hide cancelled' : `Show cancelled (${cancelledCount})`}
          </button>
        )}
        <span className="flex-1" />
        {!readOnly && (
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu}
                    className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Add another solution</button>
            {menu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
                <div role="menu" className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-30 w-64 rounded-xl border border-navy-100 bg-white shadow-lg p-1">
                  {SOLUTION_CHOICES.map(({ kind, label, Icon }) => (
                    <button key={kind} type="button" role="menuitem" onClick={() => pick(kind)}
                            className="w-full text-left rounded-lg px-3 py-2 text-sm text-navy-800 hover:bg-navy-50 flex items-center gap-2"><Icon size={14} className="text-navy-400" /> {label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {active && <SolutionPanel key={active.id} s={active} incident={i} by={by} />}
    </div>
  );
}

/* ── Providers ────────────────────────────────────────────────────────────── */
function Providers({ i }: { i: BdIncident }) {
  const store = useBreakdownStore();
  const rows = forIncident(store.solutions, i.id).filter((s) => s.providerName || s.garageName || s.deliveryDriver);
  return (
    <Section title="Technicians & service providers" icon={Users}>
      {!rows.length ? <p className="text-sm text-navy-400">No providers assigned yet (add them inside a solution).</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-[11px] uppercase tracking-wide text-navy-400"><th className="text-left py-1 font-semibold">Role</th><th className="text-left font-semibold">Name</th><th className="text-left font-semibold">Contact</th><th className="text-left font-semibold">Status</th></tr></thead>
          <tbody>{rows.flatMap((s) => [
            s.providerName && <tr key={s.id + 'p'} className="border-t border-navy-50"><td className="py-1.5">{SOLUTION_LABEL[s.kind]}</td><td>{s.providerName}{s.providerCompany ? ` · ${s.providerCompany}` : ''}</td><td>{s.providerPhone ?? '—'}</td><td>{s.acceptance ?? '—'}{s.assignedAt ? ` · ${when(s.assignedAt)}` : ''}</td></tr>,
            s.garageName && <tr key={s.id + 'g'} className="border-t border-navy-50"><td className="py-1.5">Garage</td><td>{s.garageName}{s.mechanic ? ` · ${s.mechanic}` : ''}</td><td>{s.garageContact ?? '—'}</td><td>{s.roadworthyAt ? 'Roadworthy' : s.quoteApprovedAt ? 'Quote approved' : '—'}</td></tr>,
            s.deliveryDriver && <tr key={s.id + 'd'} className="border-t border-navy-50"><td className="py-1.5">Delivery driver</td><td>{s.deliveryDriver}</td><td>{s.deliveryDriverPhone ?? '—'}</td><td>{s.deliveryAt ? `Delivered ${when(s.deliveryAt)}` : '—'}</td></tr>,
          ].filter(Boolean))}</tbody>
        </table></div>
      )}
    </Section>
  );
}

/* ── Vehicle assignments ──────────────────────────────────────────────────── */
function Vehicles({ i }: { i: BdIncident }) {
  const { bookings, vehicles, owners } = useStore();
  const store = useBreakdownStore();
  const b = bookings.find((x) => x.id === i.bookingId);
  const legs = b ? legsOf(b) : [];
  const car = (id: string) => vehicles.find((v) => v.id === id);
  const partners = forIncident(store.solutions, i.id).filter((s) => s.kind === 'partner_vehicle' && (s.partnerVehicle || s.partnerReg));
  return (
    <Section title="Vehicles on this booking" icon={Truck}>
      <p className="text-[11px] text-navy-400">Every car the customer had, in order. The booking keeps its ID; each owner earns for their own days. History is never deleted.</p>
      <ol className="space-y-2">
        {legs.map((l, idx) => {
          const v = car(l.vehicleId);
          return (
            <li key={idx} className="rounded-xl border border-navy-100 p-3 text-sm flex flex-wrap justify-between gap-2">
              <span><b>{v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : '—'}</b> · {owners.find((o) => o.id === v?.ownerId)?.name ?? '—'}<br />
                <span className="text-[11px] text-navy-400">{l.from ? when(l.from) : `${b?.startDate} ${b?.startTime ?? ''}`} → {l.until ? when(l.until) : `${b?.endDate} ${b?.endTime ?? ''}`} · {l.days} day(s){idx === legs.length - 1 ? ' · now' : ''}</span></span>
              <span className="text-right">Share {rs(l.revenue)}<br /><span className="text-[11px] text-navy-500">owner earns {rs(l.payout)}</span></span>
            </li>
          );
        })}
        {partners.map((s) => (
          <li key={s.id} className="rounded-xl border border-dashed border-navy-200 p-3 text-sm">
            <b>Partner: {s.partnerVehicle} {s.partnerReg ? `(${s.partnerReg})` : ''}</b> · {s.providerName ?? 'partner'}<br />
            <span className="text-[11px] text-navy-400">{when(s.periodStart)} → {when(s.periodEnd)} · agreed {rs(s.agreedAmount)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ── Documents ────────────────────────────────────────────────────────────── */
function Documents({ i, by }: { i: BdIncident; by: string }) {
  const store = useBreakdownStore();
  const [kind, setKind] = useState<BdDocument['kind']>('photo');
  const [solutionId, setSolutionId] = useState('');
  const [busy, setBusy] = useState(false);
  const docs = forIncident(store.documents, i.id).sort((a, c) => c.uploadedAt.localeCompare(a.uploadedAt));
  const sols = forIncident(store.solutions, i.id);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      try {
        const path = await uploadBookingFile(i.bookingId, file);
        store.addDocument({ incidentId: i.id, solutionId: solutionId || undefined, kind, name: file.name, path, uploadedBy: by });
      } catch (e) { toast.error(`${file.name} not uploaded`, (e as Error).message); }
    }
    setBusy(false);
  };
  return (
    <Section title="Documents & evidence" icon={Camera}>
      <p className="text-[11px] text-navy-400 flex items-center gap-1"><Lock size={11} /> Private — opened with short-lived links; only admins and this vehicle's owner can see them.</p>
      <Grid cols={3}>
        <Field label="Type"><select className="input" value={kind} onChange={(e) => setKind(e.target.value as BdDocument['kind'])}>{['photo', 'video', 'receipt', 'report', 'agreement', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
        <Field label="Belongs to"><select className="input" value={solutionId} onChange={(e) => setSolutionId(e.target.value)}><option value="">The incident</option>{sols.map((s) => <option key={s.id} value={s.id}>{SOLUTION_LABEL[s.kind]}</option>)}</select></Field>
        <Field label="Files"><input className="input !py-1.5 text-xs" type="file" multiple accept="image/*,video/*,application/pdf" disabled={busy} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></Field>
      </Grid>
      {!docs.length ? <p className="text-sm text-navy-400">No files yet.</p> : (
        <ul className="divide-y divide-navy-50">
          {docs.map((d) => (
            <li key={d.id} className="py-2 flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0"><b className="truncate block">{d.name}</b><span className="text-[11px] text-navy-400">{d.kind}{d.solutionId ? ` · ${SOLUTION_LABEL[sols.find((s) => s.id === d.solutionId)?.kind ?? 'onsite_repair']}` : ''} · {d.uploadedBy} · {when(d.uploadedAt)}</span></span>
              <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => openFile(d.path)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ── Customer communication ───────────────────────────────────────────────── */
function Communication({ i, by }: { i: BdIncident; by: string }) {
  const store = useBreakdownStore();
  const { bookings, vehicles } = useStore();
  const b = bookings.find((x) => x.id === i.bookingId);
  const sols = forIncident(store.solutions, i.id);
  const first = (b?.customerName ?? '').split(' ')[0];
  const tech = sols.find((s) => s.kind === 'onsite_repair' && s.providerName);
  const rep = sols.find((s) => (s.kind === 'replacement' && s.toVehicleId) || s.kind === 'partner_vehicle');
  const repCar = rep?.toVehicleId ? vehicles.find((v) => v.id === rep.toVehicleId) : undefined;
  const templates = useMemo(() => [
    { id: 'received', label: 'We are on it', text: `Dear ${first}, we have received your breakdown report (${i.ref}). Please stay in a safe place and do not drive the vehicle until we confirm it is safe. Our team will update you shortly. — Ceylon Rent A Cars` },
    ...(tech ? [{ id: 'tech', label: 'Technician on the way', text: `Dear ${first}, our technician ${tech.providerName}${tech.providerPhone ? ` (${tech.providerPhone})` : ''} is on the way to you. — Ceylon Rent A Cars` }] : []),
    ...(rep ? [{ id: 'rep', label: 'Replacement arranged', text: `Dear ${first}, a replacement vehicle${repCar ? ` (${repCar.brand} ${repCar.model}, ${repCar.vehicleNumber})` : rep.partnerVehicle ? ` (${rep.partnerVehicle})` : ''} is being arranged for you${rep.deliveryAt ? ` for ${new Date(rep.deliveryAt).toLocaleString('en-GB')}` : ''}. We are sorry for the trouble. — Ceylon Rent A Cars` }] : []),
    { id: 'update', label: 'General update', text: `Dear ${first}, an update on your breakdown (${i.ref}): ` },
  ], [first, i.ref, tech, rep, repCar]);
  const [text, setText] = useState(templates[0].text);
  const messages = forIncident(store.events, i.id).filter((e) => e.type === 'message').sort((a, c) => c.at.localeCompare(a.at));
  const phone = i.contactPhone || b?.customerPhone || '';
  return (
    <Section title="Customer messages" icon={MessageCircle}>
      <p className="text-[11px] text-navy-400">Messages open in WhatsApp for you to check and send — nothing is sent automatically, and don't promise payments or refunds until they are approved.</p>
      <Chips size="xs" value={''} options={templates.map((t) => [t.id, t.label] as [string, string])} onChange={(id) => setText(templates.find((t) => t.id === id)!.text)} />
      <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => { navigator.clipboard?.writeText(text); store.note(i.id, by, `Message copied for ${phone}: “${text.slice(0, 140)}”`, 'message'); toast.success('Copied', ''); }}>Copy</button>
        <button type="button" className="btn-primary !py-1.5 text-sm" disabled={!phone} onClick={() => { openWhatsApp(phone, text); store.note(i.id, by, `WhatsApp opened to ${phone}: “${text.slice(0, 140)}”`, 'message'); }}>Open in WhatsApp</button>
      </div>
      {messages.length > 0 && <ul className="text-xs text-navy-600 space-y-1 border-t border-navy-50 pt-2">{messages.map((m) => <li key={m.id}>{when(m.at)} · {m.by}: {m.text}</li>)}</ul>}
    </Section>
  );
}

/* ── Resolution ───────────────────────────────────────────────────────────── */
function Resolution({ i, by, isAdmin }: { i: BdIncident; by: string; isAdmin: boolean }) {
  const store = useBreakdownStore();
  const [text, setText] = useState(i.resolution ?? '');
  const [err, setErr] = useState('');
  const l = ledgerFor(i.id, store);
  const run = (fn: () => string | null | void) => { setErr(''); const e = fn(); if (e) setErr(e); };
  return (
    <div className="space-y-4">
      <VehicleReadiness i={i} />
      <Section title="Final resolution" icon={CheckCircle2}>
        <p className="text-[11px] text-navy-400">Resolving says the customer's situation is sorted. Closing needs every cost, payment and refund settled — the two are separate.</p>
        <KV k="Incident status" v={PHASE_LABEL[phaseOf(i, store.solutions)]} />
        <KV k="Vehicle" v={i.holdVehicleId && !i.holdClearedAt ? 'Under maintenance — mark it ready separately' : i.holdClearedAt ? 'Ready' : '—'} warn={!!i.holdVehicleId && !i.holdClearedAt} />
        <KV k="Financial status" v={l.settled ? 'Settled' : 'Outstanding'} warn={!l.settled} />
        {!l.settled && <ul className="text-xs text-navy-500 list-disc pl-4">{l.blockers.map((x) => <li key={x}>{x}</li>)}</ul>}
        {(i.status === 'open' || i.status === 'disputed') && (
          <Field label="How was it resolved?"><textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Alternator replaced on site; customer continued the trip" /></Field>
        )}
        <ErrorLine msg={err} />
        {isAdmin && (
          <div className="flex flex-wrap gap-2 justify-end">
            {(i.status === 'open' || i.status === 'disputed') && <button type="button" className="btn-primary !py-1.5 text-sm" onClick={() => run(() => store.resolve(i.id, text, by))}>Mark resolved</button>}
            {i.status === 'resolved' && <button type="button" className="btn-primary !py-1.5 text-sm" onClick={() => run(() => store.close(i.id, by))}>Close incident</button>}
            {i.status === 'open' && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => { const r = prompt('What is disputed / being investigated?'); if (r !== null) store.setDisputed(i.id, true, r, by); }}>Mark disputed</button>}
            {i.status === 'disputed' && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => { const r = prompt('How was the dispute settled?'); if (r !== null) store.setDisputed(i.id, false, r, by); }}>Dispute settled</button>}
            {(i.status === 'resolved' || i.status === 'closed') && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => { const r = prompt('Why reopen it?'); if (r) store.reopen(i.id, r, by); }}>Reopen</button>}
          </div>
        )}
        {i.resolvedAt && <p className="text-xs text-navy-500">Resolved {when(i.resolvedAt)}{i.resolution ? ` — ${i.resolution}` : ''}{i.closedAt ? ` · closed ${when(i.closedAt)}` : ''}</p>}
      </Section>
    </div>
  );
}
