import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Database, Plus, Search, X } from 'lucide-react';
import Header from '../components/layout/Header';
import Select from '../components/ui/Select';
import { useStore } from '../store/useStore';
import { useBreakdownStore } from '../store/useBreakdownStore';
import { BdCategory, BdStatus, CATEGORY_LABEL, SOLUTION_LABEL, STATUS_LABEL, SolutionKind } from '../lib/breakdowns';
import { FinanceFilter, dashboard, financeStatus } from '../lib/breakdownLedger';
import ReportBreakdownModal from '../components/breakdowns/ReportBreakdownModal';
import { Pill, rs, when } from '../components/breakdowns/bdui';

/** Admin → Breakdowns: every breakdown incident across the fleet */
export default function Breakdowns() {
  const navigate = useNavigate();
  const store = useBreakdownStore();
  const { bookings, vehicles, owners } = useStore();
  const [reporting, setReporting] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | BdStatus | 'active'>('active');
  const [category, setCategory] = useState<'' | BdCategory>('');
  const [solution, setSolution] = useState<'' | SolutionKind>('');
  const [finance, setFinance] = useState<FinanceFilter>('all');
  const [vehicleId, setVehicleId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => { store.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dash = useMemo(() => dashboard(store), [store]);
  const car = (id?: string) => vehicles.find((v) => v.id === id);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return store.incidents.filter((i) => {
      const b = bookings.find((x) => x.id === i.bookingId);
      const v = car(i.vehicleId);
      const sols = store.solutions.filter((s) => s.incidentId === i.id && s.status !== 'cancelled');
      if (status === 'active' ? !(i.status === 'open' || i.status === 'disputed') : status && i.status !== status) return false;
      if (category && i.category !== category) return false;
      if (solution && !sols.some((s) => s.kind === solution)) return false;
      if (finance !== 'all' && financeStatus(dash.ledgers.get(i.id)!) !== finance) return false;
      if (vehicleId && i.vehicleId !== vehicleId && !sols.some((s) => s.toVehicleId === vehicleId)) return false;
      if (ownerId && i.ownerId !== ownerId) return false;
      const d = (i.occurredAt ?? i.reportedAt).slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (needle && ![i.ref, i.location, i.description, b?.customerName, b?.customerPhone, b?.id, v?.vehicleNumber, v?.brand, v?.model]
        .some((x) => x?.toLowerCase().includes(needle))) return false;
      return true;
    }).sort((a, c) => (c.occurredAt ?? c.reportedAt).localeCompare(a.occurredAt ?? a.reportedAt));
  }, [store, bookings, q, status, category, solution, finance, vehicleId, ownerId, from, to, dash]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiles: [string, string | number, boolean?][] = [
    ['Reported', dash.total], ['Active now', dash.active], ['Emergency / unassigned', dash.emergency, dash.emergency > 0],
    ['Awaiting technician', dash.awaitingTechnician], ['Awaiting replacement', dash.awaitingReplacement], ['Under repair', dash.underRepair],
    ['Awaiting settlement', dash.awaitingSettlement, dash.awaitingSettlement > 0], ['Resolved', dash.resolved],
    ['Breakdown cost', rs(dash.cost)], ['Owners owe', rs(dash.ownerOutstanding), dash.ownerOutstanding > 0], ['Customers owe', rs(dash.customerOutstanding), dash.customerOutstanding > 0],
  ];
  const filtersOn = !!(q || status !== 'active' || category || solution || finance !== 'all' || vehicleId || ownerId || from || to);

  return (
    <div>
      <Header title="Breakdowns" subtitle="Roadside incidents, repairs, replacements and their costs" />
      <div className="p-4 md:p-6 space-y-4">
        {store.missing && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2">
            <Database size={16} className="flex-shrink-0 mt-0.5" />
            <span>The breakdown tables aren't set up yet. Run <code>admin/supabase/security/06_breakdowns.sql</code> in the Supabase SQL Editor, then reload.</span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {tiles.map(([label, value, warn]) => (
            <div key={label} className={`rounded-xl border p-3 ${warn ? 'border-amber-200 bg-amber-50/60' : 'border-navy-100 bg-white'}`}>
              <p className="text-[10.5px] uppercase tracking-wide font-semibold text-navy-400 leading-tight">{label}</p>
              <p className={`text-lg font-bold ${warn ? 'text-amber-800' : 'text-navy-900'}`}>{value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-navy-100 bg-white p-3 space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
              <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ref, customer, phone, vehicle, location…" />
            </div>
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={store.missing} onClick={() => setReporting(true)}><Plus size={15} /> Report breakdown</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
              <option value="active">Active</option><option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as BdStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </select>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as BdCategory | '')} aria-label="Issue type">
              <option value="">All issue types</option>{(Object.keys(CATEGORY_LABEL) as BdCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
            </select>
            <select className="input" value={solution} onChange={(e) => setSolution(e.target.value as SolutionKind | '')} aria-label="Resolution">
              <option value="">All resolutions</option>{(Object.keys(SOLUTION_LABEL) as SolutionKind[]).map((k) => <option key={k} value={k}>{SOLUTION_LABEL[k]}</option>)}
            </select>
            <select className="input" value={finance} onChange={(e) => setFinance(e.target.value as FinanceFilter)} aria-label="Money">
              <option value="all">Any money status</option><option value="outstanding">Outstanding</option><option value="settled">Settled</option><option value="no_cost">No costs</option>
            </select>
            <Select value={vehicleId} onChange={setVehicleId} placeholder="Any vehicle" nullable options={vehicles.map((v) => ({ value: v.id, label: `${v.brand} ${v.model}`, sub: v.vehicleNumber }))} />
            <Select value={ownerId} onChange={setOwnerId} placeholder="Any owner" nullable options={owners.map((o) => ({ value: o.id, label: o.name }))} />
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>
          {filtersOn && <button type="button" className="text-xs font-semibold text-navy-500 inline-flex items-center gap-1" onClick={() => { setQ(''); setStatus('active'); setCategory(''); setSolution(''); setFinance('all'); setVehicleId(''); setOwnerId(''); setFrom(''); setTo(''); }}><X size={12} /> Clear filters</button>}
        </div>

        {!rows.length ? (
          <div className="rounded-2xl border border-dashed border-navy-200 p-10 text-center text-sm text-navy-400">
            <AlertTriangle size={22} className="mx-auto mb-2 text-navy-300" />
            {store.incidents.length ? 'No breakdowns match these filters.' : 'No breakdowns reported yet.'}
          </div>
        ) : (
          <div className="rounded-2xl border border-navy-100 bg-white overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead><tr className="text-left">
                {['Incident', 'Booking / customer', 'Vehicle', 'Issue', 'Solutions', 'Status', 'Assigned', 'Cost', 'Money'].map((h) => <th key={h} className="table-head px-3 py-2.5">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((i) => {
                  const b = bookings.find((x) => x.id === i.bookingId);
                  const v = car(i.vehicleId);
                  const l = dash.ledgers.get(i.id)!;
                  const fs = financeStatus(l);
                  const sols = store.solutions.filter((s) => s.incidentId === i.id && s.status !== 'cancelled');
                  return (
                    <tr key={i.id} className="table-row cursor-pointer" onClick={() => navigate(`/breakdowns/${i.id}`)}>
                      <td className="px-3 py-2.5"><p className="font-semibold text-navy-800 font-mono text-xs">{i.ref}</p><p className="text-[11px] text-navy-400">{when(i.occurredAt ?? i.reportedAt)}</p>{i.urgency === 'emergency' && <Pill k="emergency">Emergency</Pill>}</td>
                      <td className="px-3 py-2.5"><p className="text-navy-800">{b?.customerName ?? '—'}</p><p className="text-[11px] text-navy-400">{b?.customerPhone}</p></td>
                      <td className="px-3 py-2.5"><p className="text-navy-800">{v ? `${v.brand} ${v.model}` : '—'}</p><p className="text-[11px] text-navy-400">{v?.vehicleNumber} · {owners.find((o) => o.id === i.ownerId)?.name ?? ''}</p></td>
                      <td className="px-3 py-2.5"><p>{CATEGORY_LABEL[i.category]}</p><p className="text-[11px] text-navy-400 max-w-[180px] truncate">{i.location ?? '—'}</p></td>
                      <td className="px-3 py-2.5 text-xs">{sols.length ? sols.map((s) => SOLUTION_LABEL[s.kind]).join(', ') : <span className="text-amber-700">None yet</span>}</td>
                      <td className="px-3 py-2.5"><Pill k={i.status}>{STATUS_LABEL[i.status]}</Pill></td>
                      <td className="px-3 py-2.5 text-xs">{i.assignedTo ?? <span className="text-amber-700">—</span>}</td>
                      <td className="px-3 py-2.5 font-semibold">{rs(l.cost)}</td>
                      <td className="px-3 py-2.5"><Pill k={fs}>{fs === 'settled' ? 'Settled' : fs === 'outstanding' ? 'Outstanding' : 'No costs'}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {reporting && <ReportBreakdownModal onClose={() => setReporting(false)} onCreated={(id) => navigate(`/breakdowns/${id}`)} />}
    </div>
  );
}
