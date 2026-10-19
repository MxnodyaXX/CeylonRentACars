import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Camera, Database } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useBreakdownStore, forIncident } from '../../store/useBreakdownStore';
import { CATEGORY_LABEL, PARTY_LABEL, PHASE_LABEL, SOLUTION_LABEL, phaseOf } from '../../lib/breakdowns';
import { ledgerFor, vehicleHistory } from '../../lib/breakdownLedger';
import { Pill, rs, when } from './bdui';

/**
 * Every breakdown this vehicle ever had (newest first) — kept permanently, also after it returns to
 * service. Each row opens the full incident. `exceptId` hides the incident you are looking at.
 */
export default function VehicleBreakdownHistory({ vehicleId, exceptId, compact, onOpen }: { vehicleId: string; exceptId?: string; compact?: boolean; onOpen?: () => void }) {
  const navigate = useNavigate();
  const store = useBreakdownStore();
  const { bookings, vehicles } = useStore();
  useEffect(() => { if (!store.ready) store.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const v = vehicles.find((x) => x.id === vehicleId);
  const hist = vehicleHistory(vehicleId, store.incidents);
  const list = store.incidents
    .filter((i) => i.vehicleId === vehicleId && i.id !== exceptId)
    .sort((a, c) => (c.occurredAt ?? c.reportedAt).localeCompare(a.occurredAt ?? a.reportedAt));
  const hold = store.activeHold(vehicleId);

  if (store.missing) return <p className="text-xs text-amber-800 flex gap-1.5"><Database size={13} className="mt-0.5" /> Run 06_breakdowns.sql in Supabase to keep breakdown history.</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill k={v?.status === 'Maintenance' ? 'maintenance' : 'ready'}>{v?.status === 'Maintenance' ? 'Under maintenance' : 'Ready'}</Pill>
        {hold && <span className="text-xs text-red-700">Breakdown hold from {hold.ref}</span>}
        {hist.repeat && <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1"><AlertTriangle size={12} /> Repeated breakdowns — {hist.reason}: full inspection recommended</span>}
      </div>
      {!list.length ? <p className="text-sm text-navy-400">{exceptId ? 'No earlier breakdowns for this vehicle.' : 'No breakdowns recorded for this vehicle.'}</p> : (
        <ul className="space-y-2">
          {list.map((i) => {
            const l = ledgerFor(i.id, store);
            const sols = forIncident(store.solutions, i.id).filter((s) => s.status !== 'cancelled');
            const provider = sols.map((s) => s.providerName || s.garageName).filter(Boolean)[0];
            const repair = sols.map((s) => s.workDone || s.diagnosis).filter(Boolean)[0];
            const allocs = forIncident(store.allocations, i.id).filter((a) => !a.supersededAt);
            const docs = forIncident(store.documents, i.id).length;
            const b = bookings.find((x) => x.id === i.bookingId);
            const ph = phaseOf(i, store.solutions);
            return (
              <li key={i.id}>
                <button type="button" onClick={() => { onOpen?.(); navigate(`/breakdowns/${i.id}`); }}
                        className="w-full text-left rounded-xl border border-navy-100 p-3 hover:border-navy-300 hover:bg-navy-50/40 transition-colors">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="font-mono text-xs">{i.ref}</b>
                    <Pill k={ph}>{PHASE_LABEL[ph]}</Pill>
                    <span className="text-[11px] text-navy-400">{when(i.occurredAt ?? i.reportedAt)}</span>
                    <span className="flex-1" />
                    <span className="text-sm font-semibold">{rs(l.cost)}</span>
                  </div>
                  <div className={`grid ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'} gap-x-6 text-xs text-navy-600 mt-1`}>
                    <p><span className="text-navy-400">Reason:</span> {CATEGORY_LABEL[i.category]}{i.cause ? ` — ${i.cause}` : ''}</p>
                    <p><span className="text-navy-400">Booking:</span> {b ? `${b.customerName} · ${i.bookingId.slice(0, 8).toUpperCase()}` : i.bookingId.slice(0, 8).toUpperCase()}</p>
                    <p><span className="text-navy-400">Where:</span> {i.location ?? '—'}</p>
                    <p><span className="text-navy-400">Solution:</span> {sols.length ? sols.map((s) => SOLUTION_LABEL[s.kind]).join(', ') : '—'}</p>
                    {!compact && <p><span className="text-navy-400">Technician / provider:</span> {provider ?? '—'}</p>}
                    {!compact && <p><span className="text-navy-400">Repair:</span> {repair ?? '—'}</p>}
                    <p><span className="text-navy-400">Responsible:</span> {allocs.length ? allocs.map((a) => `${PARTY_LABEL[a.party]} ${rs(a.amount)}`).join(', ') : 'pending'}</p>
                    <p><span className="text-navy-400">Resolved:</span> {i.resolvedAt ? when(i.resolvedAt) : '—'}</p>
                    <p><span className="text-navy-400">Back in service:</span> {i.holdClearedAt ? `${when(i.readyApprovedAt ?? i.holdClearedAt)} · ${i.holdClearedBy}` : i.holdVehicleId ? <span className="text-red-600">not yet</span> : '—'}</p>
                    <p className="inline-flex items-center gap-1"><Camera size={11} className="text-navy-400" /> {docs} photo{docs === 1 ? '' : 's'} / document{docs === 1 ? '' : 's'}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
