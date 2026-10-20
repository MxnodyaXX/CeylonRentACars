import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, BadgeCheck, Banknote, Camera, CheckCircle2, Circle, ClipboardCheck, Flag, History,
  MessageSquare, Pencil, Receipt, Scale, ShieldAlert, Wrench, type LucideIcon,
} from 'lucide-react';
import { useBreakdownStore, forIncident } from '../../store/useBreakdownStore';
import { useStore } from '../../store/useStore';
import { BdEvent, BdIncident, BdSolution, SOLUTION_LABEL, SOLUTION_STATUS_LABEL } from '../../lib/breakdowns';
import { FINANCE_LABEL, financeStatus, ledgerFor } from '../../lib/breakdownLedger';
import { Pill, Section, rs, when } from './bdui';

/*
 * The incident's history, laid out for a reviewer: a "what has been recorded" checklist on top,
 * then every entry by day — what kind it is, which solution it belongs to, who entered it and when,
 * and for edits exactly which fields were filled in.
 */

type Group = 'solutions' | 'money' | 'vehicle' | 'notes';
const KIND: Record<string, { label: string; Icon: LucideIcon; tone: string; group: Group }> = {
  created:    { label: 'Breakdown reported',        Icon: AlertTriangle,  tone: 'bg-red-100 text-red-700',         group: 'notes' },
  hold:       { label: 'Vehicle under maintenance', Icon: ShieldAlert,    tone: 'bg-red-100 text-red-700',         group: 'vehicle' },
  ready:      { label: 'Vehicle ready',             Icon: CheckCircle2,   tone: 'bg-emerald-100 text-emerald-700', group: 'vehicle' },
  swap:       { label: 'Replacement vehicle',       Icon: ArrowLeftRight, tone: 'bg-indigo-100 text-indigo-700',   group: 'vehicle' },
  solution:   { label: 'Solution',                  Icon: Wrench,         tone: 'bg-blue-100 text-blue-700',       group: 'solutions' },
  expense:    { label: 'Cost',                      Icon: Receipt,        tone: 'bg-amber-100 text-amber-800',     group: 'money' },
  payment:    { label: 'Payment',                   Icon: Banknote,       tone: 'bg-emerald-100 text-emerald-700', group: 'money' },
  approval:   { label: 'Approval',                  Icon: BadgeCheck,     tone: 'bg-violet-100 text-violet-700',   group: 'money' },
  allocation: { label: 'Responsibility',            Icon: Scale,          tone: 'bg-violet-100 text-violet-700',   group: 'money' },
  document:   { label: 'Photo / document',          Icon: Camera,         tone: 'bg-slate-100 text-slate-700',     group: 'notes' },
  status:     { label: 'Incident status',           Icon: Flag,           tone: 'bg-navy-100 text-navy-700',       group: 'notes' },
  update:     { label: 'Details updated',           Icon: Pencil,         tone: 'bg-slate-100 text-slate-700',     group: 'notes' },
  note:       { label: 'Note',                      Icon: MessageSquare,  tone: 'bg-slate-100 text-slate-700',     group: 'notes' },
};
const FALLBACK = { label: 'Update', Icon: History, tone: 'bg-slate-100 text-slate-700', group: 'notes' as Group };
const FILTERS: [Group | 'all', string][] = [['all', 'All'], ['solutions', 'Solutions'], ['money', 'Money'], ['vehicle', 'Vehicle'], ['notes', 'Notes & status']];

type Change = { label: string; from: string; to: string };

/** A clearer title for solution entries: added / details entered / status changed */
function titleOf(e: BdEvent) {
  const k = KIND[e.type] ?? FALLBACK;
  if (e.type !== 'solution') return k.label;
  if (Array.isArray(e.data?.changes)) return 'Solution details entered';
  if (/ started$/.test(e.text)) return 'Solution added';
  if (/ → /.test(e.text)) return 'Solution status changed';
  return 'Solution';
}
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

export default function IncidentTimeline({ i, by, onOpenSolution }: { i: BdIncident; by: string; onOpenSolution: (id: string) => void }) {
  const store = useBreakdownStore();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<Group | 'all'>('all');
  const [solFilter, setSolFilter] = useState('');
  const sols = forIncident(store.solutions, i.id).sort((a, c) => a.createdAt.localeCompare(c.createdAt));
  // "Vehicle replacement #2" when the same kind was used more than once
  const solName = (s: BdSolution) => {
    const same = sols.filter((x) => x.kind === s.kind);
    return `${SOLUTION_LABEL[s.kind]}${same.length > 1 ? ` #${same.indexOf(s) + 1}` : ''}`;
  };
  const all = forIncident(store.events, i.id).sort((a, c) => c.at.localeCompare(a.at));
  const list = all.filter((e) => (filter === 'all' || (KIND[e.type] ?? FALLBACK).group === filter)
    && (!solFilter || e.data?.solutionId === solFilter));
  const days = useMemo(() => {
    const out: [string, BdEvent[]][] = [];
    list.forEach((e) => { const d = dayOf(e.at); const last = out[out.length - 1]; if (last?.[0] === d) last[1].push(e); else out.push([d, [e]]); });
    return out;
  }, [list]);

  return (
    <div className="space-y-4">
      <Recorded i={i} sols={sols} solName={solName} events={all} onOpenSolution={onOpenSolution} />

      <Section title="Activity timeline" icon={History}>
        <div className="flex gap-2">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note (call with the customer, update from the garage…)" />
          <button type="button" className="btn-primary !py-1.5 text-sm" disabled={!text.trim()} onClick={() => { store.note(i.id, by, text.trim()); setText(''); }}>Add</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold border ${filter === k ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>
              {label}
            </button>
          ))}
          {sols.length > 0 && (
            <select className="input !w-auto !py-1 text-xs" value={solFilter} onChange={(e) => setSolFilter(e.target.value)} aria-label="Only one solution">
              <option value="">Every solution</option>
              {sols.map((s) => <option key={s.id} value={s.id}>{solName(s)}</option>)}
            </select>
          )}
          <span className="text-[11px] text-navy-400 ml-auto">{list.length} of {all.length} entries</span>
        </div>

        {!list.length ? <p className="text-sm text-navy-400">Nothing recorded{filter !== 'all' || solFilter ? ' for this filter' : ''} yet.</p> : (
          <div className="space-y-4">
            {days.map(([day, evs]) => (
              <div key={day}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-400 mb-2">{day}</p>
                <ol className="space-y-2">
                  {evs.map((e) => {
                    const k = KIND[e.type] ?? FALLBACK;
                    const sol = sols.find((s) => s.id === e.data?.solutionId);
                    const changes = (Array.isArray(e.data?.changes) ? e.data!.changes : []) as Change[];
                    // for edits the field list below says it all; show only the part before the dash
                    const headline = changes.length ? e.text.split(' — ')[0] : e.text;
                    return (
                      <li key={e.id} className="flex gap-3 rounded-xl border border-navy-100 bg-white p-3">
                        <span className={`flex-none w-8 h-8 rounded-lg grid place-items-center ${k.tone}`}><k.Icon size={15} /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-sm font-semibold text-navy-900">{titleOf(e)}</p>
                            {sol && (
                              <button type="button" onClick={() => onOpenSolution(sol.id)} title="Open this solution"
                                      className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-blue-50 text-blue-700 hover:bg-blue-100">
                                {solName(sol)} →
                              </button>
                            )}
                            <span className="text-[11px] text-navy-400 ml-auto whitespace-nowrap">{new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {e.by}</span>
                          </div>
                          <p className="text-sm text-navy-700 break-words">{headline}</p>
                          {changes.length > 0 && (
                            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                              {changes.map((c) => (
                                <div key={c.label} className="contents">
                                  <dt className="text-navy-400">{c.label}</dt>
                                  <dd className="text-navy-800 break-words">{c.to}{c.from !== '—' && <span className="text-navy-400"> (was {c.from})</span>}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ── What has been recorded (review checklist) ─────────────────────────────── */
function Recorded({ i, sols, solName, events, onOpenSolution }: {
  i: BdIncident; sols: BdSolution[]; solName: (s: BdSolution) => string; events: BdEvent[]; onOpenSolution: (id: string) => void;
}) {
  const store = useBreakdownStore();
  const { vehicles } = useStore();
  const l = ledgerFor(i.id, store);
  const live = sols.filter((s) => s.status !== 'cancelled');
  const expenses = forIncident(store.expenses, i.id).filter((e) => !e.voidedAt);
  const payments = forIncident(store.payments, i.id).filter((p) => !p.reversedAt);
  const allocations = forIncident(store.allocations, i.id).filter((a) => !a.supersededAt);
  const swaps = forIncident(store.swaps, i.id);
  const v = vehicles.find((x) => x.id === (i.holdVehicleId ?? i.vehicleId));
  const lastFor = (sid: string) => events.find((e) => e.data?.solutionId === sid);
  const last = events[0];
  const fin = financeStatus(l);

  const Row = ({ ok, warn, label, children }: { ok?: boolean; warn?: boolean; label: string; children: React.ReactNode }) => (
    <div className="flex gap-2.5 py-2 border-b border-navy-50 last:border-0">
      {ok ? <CheckCircle2 size={16} className="flex-none mt-0.5 text-emerald-600" />
        : warn ? <AlertTriangle size={16} className="flex-none mt-0.5 text-amber-600" />
        : <Circle size={16} className="flex-none mt-0.5 text-navy-300" />}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-navy-800">{label}</p>
        <div className="text-navy-600">{children}</div>
      </div>
    </div>
  );

  return (
    <Section title="What has been recorded" icon={ClipboardCheck}
             action={last ? <span className="text-[11px] text-navy-400">Last entry {when(last.at)} by {last.by}</span> : undefined}>
      <div>
        <Row ok label="Breakdown reported">{when(i.reportedAt)} by {i.createdBy}</Row>
        <Row ok={i.causeStatus === 'assessed'} label="Cause">{i.causeStatus === 'assessed' ? i.cause : 'Not assessed yet'}</Row>
        <Row ok={live.length > 0} warn={!live.length} label={`Solutions (${live.length})`}>
          {!live.length ? 'No solution recorded yet.' : (
            <ul className="space-y-1 mt-0.5">
              {live.map((s) => {
                const le = lastFor(s.id);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <button type="button" onClick={() => onOpenSolution(s.id)} className="font-semibold text-blue-700 hover:underline">{solName(s)}</button>
                    <Pill k={s.status}>{SOLUTION_STATUS_LABEL[s.status]}</Pill>
                    <span className="text-xs text-navy-500">added {when(s.createdAt)} by {s.createdBy}</span>
                    {(s.providerName || s.garageName) && <span className="text-xs text-navy-500">· {s.providerName ?? s.garageName}</span>}
                    {le && le.at !== s.createdAt && <span className="text-xs text-navy-400">· last entry {when(le.at)} by {le.by}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {sols.length > live.length && <p className="text-xs text-navy-400 mt-0.5">{sols.length - live.length} cancelled</p>}
        </Row>
        {swaps.length > 0 && (
          <Row ok={swaps.every((w) => w.status === 'closed')} label="Replacement vehicle">
            {swaps.map((w) => {
              const car = w.source === 'fleet' ? vehicles.find((x) => x.id === w.replacementVehicleId)?.vehicleNumber : [w.partnerVehicle, w.partnerReg].filter(Boolean).join(' ');
              return <p key={w.id}>{car ?? 'Replacement'}: out {when(w.outAt)}{w.backAt ? `, back ${when(w.backAt)} (${w.outcome === 'swapped_back' ? 'swapped back' : 'trip ended'})` : ' — still with the customer'}</p>;
            })}
          </Row>
        )}
        <Row ok={expenses.length > 0} label="Costs">
          {expenses.length ? `${expenses.length} line${expenses.length === 1 ? '' : 's'} · ${rs(l.cost)} · ${payments.length} payment${payments.length === 1 ? '' : 's'} recorded` : 'No costs entered.'}
        </Row>
        <Row ok={allocations.length > 0} warn={l.cost > 0 && !allocations.length} label="Who pays">
          {allocations.length ? `Decided — ${FINANCE_LABEL[fin]}` : l.cost > 0 ? 'Not decided yet' : '—'}
        </Row>
        {i.holdVehicleId && (
          <Row ok={!!i.holdClearedAt} warn={!i.holdClearedAt} label="Vehicle">
            {i.holdClearedAt ? `${v?.vehicleNumber ?? 'Vehicle'} confirmed ready ${when(i.readyApprovedAt ?? i.holdClearedAt)} by ${i.holdClearedBy} — ${i.readyOutcome}` : `${v?.vehicleNumber ?? 'Vehicle'} under maintenance since ${when(i.holdPlacedAt)}`}
          </Row>
        )}
        <Row ok={i.status === 'resolved' || i.status === 'closed'} label="Resolution">
          {i.status === 'closed' ? `Closed${i.closedAt ? ` ${when(i.closedAt)}` : ''}` : i.status === 'resolved' ? `Resolved ${i.resolvedAt ? when(i.resolvedAt) : ''}${i.resolution ? ` — ${i.resolution}` : ''}` : 'Not resolved yet'}
        </Row>
      </div>
    </Section>
  );
}
