import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, History, Loader2, RefreshCw, Search, Undo2 } from 'lucide-react';
import Header from '../components/layout/Header';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import { supabase, supabaseEnabled } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { toast } from '../store/useToast';
import { PERIODS, periodRange } from './SmsLog';

/*
 * Undo changes (admin only). The database writes down every change to the main tables — who, when, and what each
 * changed field was before (33_change_undo.sql → change_log). Any one change can be put back here with
 * undo_change(): an edit gets its old values, an added record is removed, a deleted one comes back.
 * If the record was changed again afterwards, the admin is told first and can undo anyway.
 */

export interface ChangeRow {
  id: number; at: string; table_name: string; row_key: string; op: 'INSERT' | 'UPDATE' | 'DELETE'; label: string | null;
  old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null;
  by_name: string | null; by_role: string | null; undo_of: number | null; undone_at: string | null; undone_by: string | null;
}

const PAGE = 100;

export const TABLES: Record<string, string> = {
  bookings: 'Booking', customers: 'Customer', vehicles: 'Vehicle', owners: 'Owner', commissions: 'Payout line', expenses: 'Expense',
  drivers: 'Driver', handovers: 'Handover', inquiries: 'Inquiry', breakdown_incidents: 'Breakdown', breakdown_events: 'Breakdown step',
  breakdown_solutions: 'Breakdown solution', breakdown_expenses: 'Breakdown cost', breakdown_allocations: 'Breakdown cost split',
  breakdown_payments: 'Breakdown payment', breakdown_documents: 'Breakdown document', breakdown_vehicle_swaps: 'Replacement vehicle',
  owner_settlements: 'Owner payout statement', company_accounts: 'Company account', company_expenses: 'Company expense',
  account_transfers: 'Account transfer', month_closes: 'Month close', partner_applications: 'Partner application',
  vehicle_reviews: 'Vehicle review', service_reviews: 'Service review', inquiry_followups: 'Inquiry follow-up', app_settings: 'Setting',
};
export const tableLabel = (t: string) => TABLES[t] ?? t.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

const FIELD: Record<string, string> = {
  paid_amount: 'Paid', advance_amount: 'Advance', total_amount: 'Rental', extra_charges: 'Other charges', credit_amount: 'Credit due',
  deposit_amount: 'Deposit', deposit_returned: 'Deposit given back', deposit_deduction: 'Deposit kept', activity: 'History', payments: 'Payment log',
  charges: 'Charges', start_date: 'Start date', end_date: 'End date', start_time: 'Start time', end_time: 'End time', vehicle_id: 'Vehicle',
  customer_name: 'Customer', customer_phone: 'Phone', daily_rent: 'Daily rent', daily_rate: 'Daily rate', notes: 'Notes', value: 'Value',
  company_share_type: 'Commission method', company_share: 'Commission', owner_payout: 'Owner payout', total_days: 'Days',
};
export const fieldLabel = (k: string) => FIELD[k] ?? k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

const rsLike = /(amount|rent|rate|payout|share|charges|deduction|returned|price|total|fee|cost|balance)$/;

/** A value as a short readable text */
export function showValue(v: unknown, key = ''): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return rsLike.test(key) ? `Rs ${v.toLocaleString('en-US')}` : v.toLocaleString('en-US');
  if (Array.isArray(v)) return v.length === 0 ? 'none' : `${v.length} entr${v.length === 1 ? 'y' : 'ies'}`;
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return when(s);
  return s.length > 160 ? s.slice(0, 157) + '…' : s;
}

/** One list entry in plain words (a payment, a History line, a charge) */
const entryText = (e: unknown): string => {
  if (!e || typeof e !== 'object') return showValue(e);
  const o = e as Record<string, unknown>;
  if (typeof o.text === 'string') return o.text;
  const parts = [o.kind ?? o.label ?? o.type, typeof o.amount === 'number' ? `Rs ${o.amount.toLocaleString('en-US')}` : null, o.method, typeof o.at === 'string' ? o.at.slice(0, 10) : null];
  const s = parts.filter(Boolean).join(' · ');
  return s || showValue(e);
};

export interface Diff { key: string; field: string; before: string; after: string; added?: string[]; removed?: string[] }

/** What a change did, field by field */
export function diffOf(r: Pick<ChangeRow, 'op' | 'old_values' | 'new_values'>): Diff[] {
  const o = r.old_values ?? {}, n = r.new_values ?? {};
  const keys = r.op === 'UPDATE' ? Object.keys(n) : Object.keys(r.op === 'INSERT' ? n : o);
  return keys.filter((k) => k !== 'updated_at' && k !== 'created_at' && !(r.op !== 'UPDATE' && (r.op === 'INSERT' ? n : o)[k] == null))
    .map((k) => {
      const d: Diff = { key: k, field: fieldLabel(k), before: r.op === 'INSERT' ? '' : showValue(o[k], k), after: r.op === 'DELETE' ? '' : showValue(n[k], k) };
      if (r.op === 'UPDATE' && (Array.isArray(o[k]) || Array.isArray(n[k]))) {
        const a = (Array.isArray(o[k]) ? o[k] : []) as unknown[], b = (Array.isArray(n[k]) ? n[k] : []) as unknown[];
        const js = (x: unknown) => JSON.stringify(x);
        const as = new Set(a.map(js)), bs = new Set(b.map(js));
        d.added = b.filter((x) => !as.has(js(x))).map(entryText);
        d.removed = a.filter((x) => !bs.has(js(x))).map(entryText);
      }
      return d;
    });
}

const VERB = { INSERT: 'added', UPDATE: 'changed', DELETE: 'deleted' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ChangeLog() {
  const loadAll = useStore((s) => s.loadAll);
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [people, setPeople] = useState<string[]>([]);

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState('');
  const [table, setTable] = useState('');
  const [period, setPeriod] = useState('7');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // the undo being confirmed
  const [confirm, setConfirm] = useState<ChangeRow | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const filtered = useCallback(<T,>(base: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let x = base as any;
    const [a, b] = periodRange(period, from, to);
    if (a) x = x.gte('at', a);
    if (b) x = x.lt('at', b);
    if (who) x = x.eq('by_name', who);
    if (table) x = x.eq('table_name', table);
    if (query) {
      const safe = query.replace(/[,()*%\\]/g, ' ').trim();
      x = x.or(`row_key.ilike.*${safe}*,label.ilike.*${safe}*`);
    }
    return x as T;
  }, [period, from, to, who, table, query]);

  const load = useCallback(async () => {
    if (!supabaseEnabled) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await filtered(supabase.from('change_log').select('*')).order('id', { ascending: false }).range(0, PAGE);
      if (error) throw error;
      const got = (data ?? []) as ChangeRow[];
      setRows(got.slice(0, PAGE)); setMore(got.length > PAGE);
      setPeople((p) => [...new Set([...p, ...got.map((r) => r.by_name ?? '').filter(Boolean)])].sort());
    } catch (e) {
      const m = (e as Error).message;
      toast.error('Undo changes', /change_log/.test(m) ? 'The change log isn’t set up yet — run 33_change_undo.sql in Supabase.' : m);
    } finally { setLoading(false); }
  }, [filtered]);
  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { data, error } = await filtered(supabase.from('change_log').select('*')).order('id', { ascending: false }).range(rows.length, rows.length + PAGE);
      if (error) throw error;
      const got = (data ?? []) as ChangeRow[];
      setRows((r) => [...r, ...got.slice(0, PAGE)]); setMore(got.length > PAGE);
    } catch (e) { toast.error('Undo changes', (e as Error).message); } finally { setLoadingMore(false); }
  };

  const undo = async (force: boolean) => {
    if (!confirm) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('undo_change', { p_id: confirm.id, p_force: force });
      if (error) throw error;
      const res = data as { ok: boolean; conflict?: string };
      if (!res.ok) { setConflict(res.conflict ?? 'This record was changed again since.'); return; }
      toast.success('Undone', `${tableLabel(confirm.table_name)} ${confirm.label ?? confirm.row_key} is back as it was before ${confirm.by_name ?? 'that'} change.`);
      setConfirm(null); setConflict(null);
      await Promise.all([load(), loadAll()]);
    } catch (e) {
      toast.error('Not undone', (e as Error).message);
    } finally { setBusy(false); }
  };

  const recordLink = (r: ChangeRow) => {
    const name = <><b className="text-navy-800">{tableLabel(r.table_name).toLowerCase()}</b> {r.label ? <>“{r.label}”</> : null} <span className="text-navy-400">{r.row_key}</span></>;
    if (r.op !== 'DELETE' && r.table_name === 'bookings') return <Link to={`/bookings/${r.row_key}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{name}</Link>;
    if (r.op !== 'DELETE' && r.table_name === 'inquiries') return <Link to={`/inquiries/${r.row_key}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{name}</Link>;
    return <span>{name}</span>;
  };

  if (!supabaseEnabled) return <div><Header title="Undo changes" /><p className="card text-sm text-navy-500">Needs the live database — not available in demo mode.</p></div>;

  // a booking's History isn't rolled back (the database adds an "Undid …" line instead)
  const keepsHistory = confirm?.table_name === 'bookings' && confirm.op === 'UPDATE';
  const cDiff = confirm ? diffOf(confirm).filter((x) => !(keepsHistory && x.key === 'activity')) : [];

  return (
    <div>
      <Header title="Undo changes" subtitle="Every change made in the system — who made it and what it was before. Put any one of them back." />

      <div className="card !p-3 mb-4 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
          <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Booking no., customer, vehicle number…" />
        </label>
        <Select className="w-40" value={period} onChange={setPeriod} options={PERIODS} />
        {period === 'custom' && (
          <>
            <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </>
        )}
        <Select className="w-40" value={who} onChange={setWho} nullable placeholder="Anyone" options={people.map((p) => ({ value: p, label: p }))} />
        <Select className="w-48" value={table} onChange={setTable} nullable searchable placeholder="Any record"
                options={Object.entries(TABLES).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))} />
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700"><RefreshCw size={14} /> Refresh</button>
      </div>

      <section className="card !p-0 overflow-hidden">
        {loading ? <p className="p-6 text-sm text-navy-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</p>
          : rows.length === 0 ? (
            <div className="p-10 text-center">
              <History size={28} className="mx-auto text-navy-200 mb-2" />
              <p className="text-sm text-navy-500">No changes match these filters.</p>
            </div>
          ) : (
            <ul className="divide-y divide-navy-50">
              {rows.map((r) => {
                const isOpen = open === r.id;
                const d = diffOf(r);
                const fields = d.map((x) => x.field);
                return (
                  <li key={r.id} className={r.undone_at ? 'bg-navy-50/40' : ''}>
                    <div className="p-3 sm:p-4 flex gap-3 items-start">
                      <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="min-w-0 flex-1 text-left">
                        <p className="text-sm text-navy-600">
                          <b className="text-navy-900">{r.by_name ?? 'Someone'}</b> {r.undo_of ? 'undid a change on' : VERB[r.op]} {recordLink(r)}
                        </p>
                        <p className="text-xs text-navy-400 mt-0.5 truncate">
                          {when(r.at)}{r.op === 'UPDATE' && fields.length ? ` · ${fields.join(', ')}` : ''}
                        </p>
                        {r.undone_at && <p className="text-[11px] font-semibold text-amber-700 mt-0.5">Undone by {r.undone_by} · {when(r.undone_at)}</p>}
                      </button>
                      {!r.undone_at && (
                        <button type="button" onClick={() => { setConfirm(r); setConflict(null); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-navy-100 text-navy-700 hover:border-red-200 hover:text-red-700 flex-shrink-0">
                          <Undo2 size={13} /> Undo
                        </button>
                      )}
                      <button type="button" aria-label="Details" onClick={() => setOpen(isOpen ? null : r.id)} className="mt-1 flex-shrink-0">
                        <ChevronDown size={15} className={`text-navy-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                    {isOpen && <div className="px-3 sm:px-4 pb-4 -mt-1"><DiffTable op={r.op} diff={d} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
        {more && !loading && (
          <div className="p-3 border-t border-navy-50 text-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700 disabled:opacity-50">
              {loadingMore ? 'Loading…' : `Show ${PAGE} more`}
            </button>
          </div>
        )}
      </section>

      <Modal open={!!confirm} onClose={() => { if (!busy) { setConfirm(null); setConflict(null); } }} title="Undo this change?" width="max-w-xl">
        {confirm && (
          <div className="space-y-3 text-sm">
            <p className="text-navy-600">
              {confirm.by_name ?? 'Someone'} {VERB[confirm.op]} {recordLink(confirm)} on {when(confirm.at)}.{' '}
              {confirm.op === 'UPDATE' ? 'These go back to what they were before:' : confirm.op === 'INSERT' ? 'Undoing removes this record again:' : 'Undoing brings this record back:'}
            </p>
            <DiffTable op={confirm.op} diff={cDiff} undo />
            {keepsHistory && (
              <p className="text-xs text-navy-400">The booking’s History stays as it is, with a line saying you undid this.</p>
            )}
            {conflict && (
              <p className="flex gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900 text-xs">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> <span>{conflict} You can undo the later change first, or undo this one anyway.</span>
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setConfirm(null); setConflict(null); }}>Cancel</button>
              {conflict
                ? <button type="button" className="btn-primary !bg-amber-600" disabled={busy} onClick={() => undo(true)}>{busy ? 'Undoing…' : 'Undo anyway'}</button>
                : <button type="button" className="btn-primary" disabled={busy} onClick={() => undo(false)}>{busy ? 'Undoing…' : 'Undo'}</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Before → after, field by field. In the undo dialog it reads as now → back to. */
function DiffTable({ op, diff, undo }: { op: ChangeRow['op']; diff: Diff[]; undo?: boolean }) {
  if (!diff.length) return <p className="text-xs text-navy-400">No details.</p>;
  if (op !== 'UPDATE') {
    return (
      <div className="rounded-xl border border-navy-100 divide-y divide-navy-50 text-xs max-h-72 overflow-y-auto">
        {diff.map((x) => (
          <p key={x.key} className="flex gap-3 px-3 py-1.5"><span className="w-36 flex-shrink-0 text-navy-400">{x.field}</span><span className="min-w-0 break-words text-navy-800">{op === 'INSERT' ? x.after : x.before}</span></p>
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-navy-100 overflow-x-auto text-xs">
      <table className="w-full">
        <thead><tr className="text-left text-[11px] text-navy-400 bg-navy-50/50">
          <th className="px-3 py-1.5 font-medium">Field</th>
          <th className="px-3 py-1.5 font-medium">{undo ? 'Was changed to' : 'Before'}</th>
          <th className="px-3 py-1.5 font-medium">{undo ? 'Goes back to' : 'After'}</th>
        </tr></thead>
        <tbody>
          {diff.map((x) => (
            <tr key={x.key} className="border-t border-navy-50 align-top">
              <td className="px-3 py-1.5 text-navy-500 whitespace-nowrap">{x.field}</td>
              {x.added || x.removed ? (
                <td colSpan={2} className="px-3 py-1.5 text-navy-700">
                  {x.added?.map((t, i) => <p key={'a' + i} className={undo ? 'text-red-600' : 'text-emerald-700'}>{undo ? '− removed: ' : '+ added: '}{t}</p>)}
                  {x.removed?.map((t, i) => <p key={'r' + i} className={undo ? 'text-emerald-700' : 'text-red-600'}>{undo ? '+ comes back: ' : '− removed: '}{t}</p>)}
                  {!x.added?.length && !x.removed?.length && <span className="text-navy-400">order changed</span>}
                </td>
              ) : (
                <>
                  <td className={`px-3 py-1.5 break-words ${undo ? 'text-red-600' : 'text-navy-500'}`}>{undo ? x.after : x.before}</td>
                  <td className={`px-3 py-1.5 break-words font-semibold ${undo ? 'text-emerald-700' : 'text-navy-800'}`}>{undo ? x.before : x.after}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
