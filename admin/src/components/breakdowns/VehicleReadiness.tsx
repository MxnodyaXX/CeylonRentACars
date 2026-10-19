import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, Upload } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useBreakdownStore } from '../../store/useBreakdownStore';
import { BdIncident, READY_OUTCOMES } from '../../lib/breakdowns';
import { uploadBookingFile } from '../../lib/bookingRecord';
import { toast } from '../../store/useToast';
import { Chips, ErrorLine, Field, Grid, fromLocalInput, nowLocal, when } from './bdui';

/**
 * The broken vehicle's operational status for this breakdown:
 *   UNDER MAINTENANCE (hold placed when the breakdown was reported) → admin confirms it safe → READY.
 * Completing a repair / replacement never does this by itself.
 */
export default function VehicleReadiness({ i }: { i: BdIncident }) {
  const store = useBreakdownStore();
  const { vehicles } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const isAdmin = useAuthStore((s) => s.isAdmin)();
  const vid = i.holdVehicleId ?? i.vehicleId;
  const v = vehicles.find((x) => x.id === vid);
  const otherHold = !i.holdVehicleId ? store.activeHold(i.vehicleId) : undefined;
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [detail, setDetail] = useState('');
  const [safe, setSafe] = useState(false);
  const [at, setAt] = useState(nowLocal());
  const [comments, setComments] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const name = v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : 'The vehicle';

  const confirmReady = async () => {
    setErr('');
    const full = [outcome, detail.trim()].filter(Boolean).join(' — ');
    if (!outcome) { setErr('Choose the repair or inspection outcome.'); return; }
    if (outcome === 'Other' && !detail.trim()) { setErr('Describe the outcome.'); return; }
    if (!safe) { setErr('Confirm the vehicle is safe for rental.'); return; }
    if (!confirm(`Return ${name} to service? It becomes available for bookings again.`)) return;
    setBusy(true);
    for (const file of files) {   // evidence first, so it is on record with the approval
      try { store.addDocument({ incidentId: i.id, kind: 'report', name: file.name, path: await uploadBookingFile(i.bookingId, file), uploadedBy: by }); }
      catch (e) { toast.error(`${file.name} not uploaded`, (e as Error).message); }
    }
    const e = await store.markVehicleReady(i.id, { outcome: full, safe, comments, approvedAt: fromLocalInput(at), by, isAdmin });
    setBusy(false);
    if (e) { setErr(e); return; }
    toast.success('Vehicle ready', `${name} is back in service.`);
    setOpen(false);
  };

  if (i.holdClearedAt) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm space-y-1">
        <p className="font-semibold text-emerald-800 flex items-center gap-1.5"><ShieldCheck size={16} /> {name} — READY</p>
        <p className="text-emerald-900">Returned to service {when(i.readyApprovedAt ?? i.holdClearedAt)} · approved by {i.holdClearedBy}</p>
        <p className="text-emerald-900">Outcome: {i.readyOutcome}{i.readySafeConfirmed ? ' · confirmed safe for rental' : ''}</p>
        {i.readyComments && <p className="text-emerald-900">“{i.readyComments}”</p>}
      </div>
    );
  }
  if (otherHold) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-sm">
        <p className="font-semibold text-red-800 flex items-center gap-1.5"><ShieldAlert size={16} /> {name} — UNDER MAINTENANCE</p>
        <p className="text-red-900">Held by the earlier breakdown <Link className="underline font-semibold" to={`/breakdowns/${otherHold.id}`}>{otherHold.ref}</Link> — it returns to service from there.</p>
      </div>
    );
  }
  if (!i.holdVehicleId) {
    return <p className="text-xs text-navy-400">{name} · status {v?.status ?? '—'} (no maintenance hold on this breakdown).</p>;
  }
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <p className="font-semibold text-red-800 flex items-center gap-1.5"><ShieldAlert size={16} /> {name} — UNDER MAINTENANCE</p>
          <p className="text-red-900">Since {when(i.holdPlacedAt)} · not available for new bookings. Completing a repair or replacement doesn't change this.</p>
        </div>
        {isAdmin && !open && <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5" onClick={() => setOpen(true)}><CheckCircle2 size={14} /> Mark vehicle as ready</button>}
      </div>
      {open && (
        <div className="rounded-xl bg-white border border-red-100 p-3 space-y-3">
          <Field label="Repair / inspection outcome *"><Chips size="xs" value={outcome} options={READY_OUTCOMES.map((o) => [o, o] as [string, string])} onChange={setOutcome} /></Field>
          <Field label={outcome === 'Other' ? 'Describe the outcome *' : 'Details'}><input className="input" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. Radiator and thermostat replaced, road-tested 20 km" /></Field>
          <Grid>
            <Field label="Approved at"><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
            <Field label="Evidence (inspection report, photos)">
              <input className="input !py-1.5 text-xs" type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </Field>
          </Grid>
          <Field label="Comments"><textarea className="input" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
          <label className="flex items-start gap-2 text-sm text-navy-800"><input type="checkbox" className="mt-0.5" checked={safe} onChange={(e) => setSafe(e.target.checked)} />
            <span>I confirm <b>{name}</b> has been repaired or inspected and is <b>safe for rental</b>.</span></label>
          <p className="text-[11px] text-navy-400">Approved by {by}. Checked again on the server; the hold, the approval and the vehicle's status change are saved together.</p>
          <ErrorLine msg={err} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5" disabled={busy} onClick={confirmReady}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Confirm — vehicle ready
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
