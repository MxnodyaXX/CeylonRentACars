import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Database, Plus } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useBreakdownStore, forIncident } from '../../store/useBreakdownStore';
import { CATEGORY_LABEL, PARTY_LABEL, Party, SOLUTION_LABEL, STATUS_LABEL } from '../../lib/breakdowns';
import { ledgerFor } from '../../lib/breakdownLedger';
import type { Booking } from '../../types';
import ReportBreakdownModal from './ReportBreakdownModal';
import { Pill, rs, when } from './bdui';

/** Booking details → Breakdowns: every incident on this booking (a booking can have several) */
export default function BookingBreakdownsTab({ b, canReport }: { b: Booking; canReport: boolean }) {
  const navigate = useNavigate();
  const store = useBreakdownStore();
  const { vehicles } = useStore();
  const [reporting, setReporting] = useState(false);
  useEffect(() => { if (!store.ready) store.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = store.incidents.filter((i) => i.bookingId === b.id).sort((a, c) => (c.occurredAt ?? c.reportedAt).localeCompare(a.occurredAt ?? a.reportedAt));
  const car = (id?: string) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : '—'; };

  return (
    <div className="space-y-3">
      {store.missing && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex gap-1.5"><Database size={13} className="mt-0.5" /> Run 06_breakdowns.sql in Supabase to use breakdowns.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-navy-500">{list.length ? `${list.length} breakdown${list.length === 1 ? '' : 's'} on this booking` : 'No breakdowns on this booking.'}</p>
        {canReport && !store.missing && (
          <button type="button" className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => setReporting(true)}>
            <Plus size={14} /> Report breakdown
          </button>
        )}
      </div>
      {list.map((i) => {
        const l = ledgerFor(i.id, store);
        const sols = forIncident(store.solutions, i.id).filter((s) => s.status !== 'cancelled');
        const allocs = forIncident(store.allocations, i.id).filter((a) => !a.supersededAt);
        const docs = forIncident(store.documents, i.id).length;
        const charges = forIncident(store.payments, i.id).filter((p) => p.status === 'posted' && p.kind === 'customer_charge').reduce((s, p) => s + p.amount, 0);
        return (
          <article key={i.id} className="rounded-2xl border border-navy-100 p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={15} className={i.status === 'open' ? 'text-red-500' : 'text-navy-300'} />
              <b className="font-mono text-xs">{i.ref}</b>
              <Pill k={i.status}>{STATUS_LABEL[i.status]}</Pill>
              {i.urgency === 'emergency' && <Pill k="emergency">Emergency</Pill>}
              <span className="text-[11px] text-navy-400">{when(i.occurredAt ?? i.reportedAt)}</span>
              <span className="flex-1" />
              <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => navigate(`/breakdowns/${i.id}`)}>Manage incident</button>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 text-sm">
              <p><span className="text-navy-400">Vehicle:</span> {car(i.vehicleId)}</p>
              <p><span className="text-navy-400">Where:</span> {i.location ?? '—'}</p>
              <p><span className="text-navy-400">Issue:</span> {CATEGORY_LABEL[i.category]}</p>
              <p><span className="text-navy-400">Assigned:</span> {i.assignedTo ?? '—'}</p>
              <p><span className="text-navy-400">Solutions:</span> {sols.length ? sols.map((s) => `${SOLUTION_LABEL[s.kind]} (${s.status.replace('_', ' ')})`).join(', ') : '—'}</p>
              <p><span className="text-navy-400">Costs:</span> {rs(l.cost)} · <Pill k={l.settled ? 'settled' : 'outstanding'}>{l.settled ? 'settled' : 'outstanding'}</Pill></p>
              <p><span className="text-navy-400">Responsible:</span> {allocs.length ? allocs.map((a) => `${PARTY_LABEL[a.party as Party]} ${rs(a.amount)}`).join(', ') : 'pending'}</p>
              <p><span className="text-navy-400">Customer:</span> {charges ? `${rs(charges)} added to bill` : 'no charges'}{l.refundsPaid ? ` · ${rs(l.refundsPaid)} refunded` : ''}{l.refundPending ? ` · ${rs(l.refundPending)} refund pending` : ''}</p>
              <p><span className="text-navy-400">Files:</span> {docs}</p>
            </div>
          </article>
        );
      })}
      {reporting && <ReportBreakdownModal bookingId={b.id} onClose={() => setReporting(false)} onCreated={(id) => navigate(`/breakdowns/${id}`)} />}
    </div>
  );
}
