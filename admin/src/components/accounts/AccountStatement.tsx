import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Car, Columns2, Download, ExternalLink, Landmark, List, Printer, Receipt, RotateCcw, Search, ShieldCheck, Undo2, UserRound, Wallet, X,
} from 'lucide-react';
import BookingDetailsModal from '../ui/BookingDetailsModal';
import type { Books, LedgerEntry, LedgerKind } from '../../lib/ledger';

/*
 * Company accounts → Statement: every money movement like a bank statement — date, description, money in (credit),
 * money out (debit) and the running balance — for all accounts or one, any period, filtered by type and searchable.
 * Built from the same ledger as the rest of Company accounts, so its closing balance is the "Money in our accounts" figure.
 */

const rs = (n: number) => `Rs ${Math.abs(Math.round(n)).toLocaleString('en-LK')}`;
const signed = (n: number) => `${n < 0 ? '− ' : ''}${rs(n)}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const fmtLong = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** what each kind of movement is, in plain words */
const CAT: Record<LedgerKind, { label: string; icon: typeof Wallet; tone: string }> = {
  payment:         { label: 'Customer payment',  icon: Wallet,         tone: 'bg-emerald-50 text-emerald-700' },
  deposit_in:      { label: 'Deposit received',  icon: ShieldCheck,    tone: 'bg-sky-50 text-sky-700' },
  refund:          { label: 'Refund',            icon: Undo2,          tone: 'bg-rose-50 text-rose-700' },
  deposit_out:     { label: 'Deposit returned',  icon: RotateCcw,      tone: 'bg-sky-50 text-sky-700' },
  deposit_used:    { label: 'Deposit used',      icon: ShieldCheck,    tone: 'bg-sky-50 text-sky-700' },
  owner_payout:    { label: 'Owner payout',      icon: UserRound,      tone: 'bg-amber-50 text-amber-700' },
  company_expense: { label: 'Company expense',   icon: Receipt,        tone: 'bg-orange-50 text-orange-700' },
  vehicle_expense: { label: 'Vehicle expense',   icon: Car,            tone: 'bg-orange-50 text-orange-700' },
  transfer:        { label: 'Transfer',          icon: ArrowLeftRight, tone: 'bg-navy-100 text-navy-700' },
  write_off:       { label: 'Written off',       icon: X,              tone: 'bg-navy-100 text-navy-600' },
};

type PeriodKey = 'month' | 'last' | 'quarter' | 'year' | 'all' | 'custom';
type Flow = 'all' | 'in' | 'out';

function rangeOf(k: PeriodKey, custom: { from: string; to: string }, since: string) {
  const n = new Date();
  if (k === 'month') return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) };
  if (k === 'last') return { start: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), end: iso(new Date(n.getFullYear(), n.getMonth(), 0)) };
  if (k === 'quarter') { const q = Math.floor(n.getMonth() / 3) * 3; return { start: iso(new Date(n.getFullYear(), q, 1)), end: iso(new Date(n.getFullYear(), q + 3, 0)) }; }
  if (k === 'year') return { start: `${n.getFullYear()}-01-01`, end: `${n.getFullYear()}-12-31` };
  if (k === 'all') return { start: since, end: iso(n) };
  return { start: custom.from, end: custom.to };
}

/** remembered per browser: list or side by side, and which side money in goes */
const pref = (k: string, d: string) => { try { return localStorage.getItem(`crc.statement.${k}`) ?? d; } catch { return d; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(`crc.statement.${k}`, v); } catch { /* not remembered */ } };

export default function AccountStatement({ books, ledger, onClose, page = false }: { books: Books; ledger: LedgerEntry[]; onClose: () => void; page?: boolean }) {
  const navigate = useNavigate();
  const [pk, setPk] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState({ from: books.from, to: iso(new Date()) });
  const [acct, setAcct] = useState<string>('all');          // 'all' | 'none' (not assigned) | an account id
  const [flow, setFlow] = useState<Flow>('all');
  const [cat, setCat] = useState<LedgerKind | 'any'>('any');
  const [q, setQ] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  const [layout, setLayoutS] = useState<'list' | 'sides'>(() => (pref('layout', 'list') === 'sides' ? 'sides' : 'list'));
  const [inLeft, setInLeftS] = useState(() => pref('inLeft', '1') === '1');
  const setLayout = (v: 'list' | 'sides') => { setLayoutS(v); keep('layout', v); };
  const swap = () => setInLeftS((x) => { keep('inLeft', x ? '0' : '1'); return !x; });
  const { start, end } = rangeOf(pk, custom, books.from);

  // which account an entry is counted in (as "Money in our accounts" counts it), and whether it counts at all
  const accOf = (e: LedgerEntry) => (e.accountId && books.accounts.some((a) => a.id === e.accountId) ? e.accountId : 'none');
  const counts = (e: LedgerEntry) => {
    if (!e.amount) return false;
    const a = books.accounts.find((x) => x.id === e.accountId);
    return a ? e.date >= a.openingDate : e.date >= books.from;
  };
  const inScope = (e: LedgerEntry) => counts(e) && (acct === 'all' ? e.kind !== 'transfer' || false : accOf(e) === acct);

  const data = useMemo(() => {
    // opening balance: the accounts' opening balances + everything before the period
    const openAcc = books.accounts.filter((a) => (acct === 'all' || a.id === acct) && a.openingDate <= start).reduce((s, a) => s + a.openingBalance, 0);
    const before = ledger.filter((e) => inScope(e) && e.date < start).reduce((s, e) => s + e.amount, 0);
    const opening = openAcc + before;
    // the period, oldest first, with the running balance (filters only hide rows — the balance follows every movement)
    const rows = ledger.filter((e) => inScope(e) && e.date >= start && e.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date) || (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0) || a.id.localeCompare(b.id));
    let run = opening;
    const withBal = rows.map((e) => { run += e.amount; return { e, bal: run }; });
    const moneyIn = rows.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
    const moneyOut = -rows.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
    return { opening, withBal, moneyIn, moneyOut, closing: run };
  }, [ledger, books, acct, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  const term = q.trim().toLowerCase();
  const shown = data.withBal.filter(({ e }) => (flow === 'all' || (flow === 'in' ? e.amount > 0 : e.amount < 0))
    && (cat === 'any' || e.kind === cat)
    && (!term || [e.label, e.detail, e.ref, e.method, e.by, CAT[e.kind].label].filter(Boolean).join(' ').toLowerCase().includes(term)));
  const filtered = flow !== 'all' || cat !== 'any' || !!term;

  // months, newest last (a statement reads top to bottom in date order)
  const months = useMemo(() => {
    const m = new Map<string, typeof shown>();
    shown.forEach((r) => { const k = r.e.date.slice(0, 7); m.set(k, [...(m.get(k) ?? []), r]); });
    return [...m.entries()];
  }, [shown]);

  // the money-in / money-out mix, for the small breakdown under the totals
  const mix = (sign: 1 | -1) => {
    const m = new Map<LedgerKind, number>();
    data.withBal.forEach(({ e }) => { if (Math.sign(e.amount) === sign) m.set(e.kind, (m.get(e.kind) ?? 0) + Math.abs(e.amount)); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const acctName = acct === 'all' ? 'All accounts' : acct === 'none' ? 'Not assigned to an account' : books.accounts.find((a) => a.id === acct)?.name ?? 'Account';
  const periodText = `${fmtLong(start)} – ${fmtLong(end)}`;

  const csv = () => {
    const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [['Date', 'Description', 'Details', 'Category', 'Method', 'Reference', 'Money in (credit)', 'Money out (debit)', 'Balance'].join(','),
      [start, 'Opening balance', '', '', '', '', '', '', data.opening].map(esc).join(','),
      ...shown.map(({ e, bal }) => [e.date, e.label, e.detail, CAT[e.kind].label, e.method, e.ref, e.amount > 0 ? e.amount : '', e.amount < 0 ? -e.amount : '', bal].map(esc).join(',')),
      [end, 'Closing balance', '', '', '', '', data.moneyIn, data.moneyOut, data.closing].map(esc).join(',')];
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ceylon-statement-${start}-to-${end}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return;
    const row = (c: string[]) => `<tr>${c.map((x, i) => `<td class="${i >= 4 ? 'n' : ''}">${x}</td>`).join('')}</tr>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Statement ${periodText}</title><style>body{font-family:Segoe UI,Arial,sans-serif;color:#111;font-size:12px;margin:28px}h1{margin:0}table{border-collapse:collapse;width:100%;margin-top:14px}th,td{padding:6px 6px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}th{font-size:10px;text-transform:uppercase;color:#71717A}.n{text-align:right;white-space:nowrap}.s{display:flex;gap:28px;margin-top:12px}.s div b{display:block;font-size:15px}small{color:#71717A}</style></head><body>
      <div style="color:#E11D2A;font-weight:800;font-size:11px">CEYLON RENT A CARS</div><h1>Account statement</h1><div>${acctName} · ${periodText}</div>
      <div class="s"><div>Opening balance<b>${signed(data.opening)}</b></div><div>Money in<b>${rs(data.moneyIn)}</b></div><div>Money out<b>${rs(data.moneyOut)}</b></div><div>Closing balance<b>${signed(data.closing)}</b></div></div>
      <table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Method / ref</th><th class="n">Money in</th><th class="n">Money out</th><th class="n">Balance</th></tr></thead><tbody>
      ${row([fmtDay(start), '<b>Opening balance</b>', '', '', '', '', signed(data.opening)])}
      ${shown.map(({ e, bal }) => row([fmtDay(e.date), `${e.label}${e.detail ? `<br><small>${e.detail}</small>` : ''}`, CAT[e.kind].label, [e.method, e.ref].filter(Boolean).join(' · '), e.amount > 0 ? rs(e.amount) : '', e.amount < 0 ? rs(e.amount) : '', signed(bal)])).join('')}
      ${row([fmtDay(end), '<b>Closing balance</b>', '', '', `<b>${rs(data.moneyIn)}</b>`, `<b>${rs(data.moneyOut)}</b>`, `<b>${signed(data.closing)}</b>`])}
      </tbody></table><p><small>Printed ${new Date().toLocaleString('en-GB')}</small></p></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  };

  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) => (
    <button type="button" onClick={onClick} className={`rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${on ? 'bg-navy-900 text-white' : 'text-navy-500 hover:text-navy-900'}`}>{children}</button>
  );

  return (
    <div className={page ? 'fixed inset-0 z-[60] flex' : 'fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4'}>
      {!page && <div className="absolute inset-0 bg-navy-900/40 backdrop-blur-sm anim-fade-in" onClick={onClose} />}
      <div className={page ? 'relative bg-[#F7F7F8] w-full h-full flex flex-col overflow-hidden' : 'relative bg-[#F7F7F8] w-full max-w-7xl sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[94vh] overflow-hidden anim-panel-in'}>
        {/* ── header ── */}
        <div className="bg-navy-900 text-white px-5 sm:px-7 pt-5 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0"><Landmark size={20} /></div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/50 font-semibold">Ceylon Rent A Cars</p>
                <h2 className="text-lg font-bold leading-tight">Account statement</h2>
                <p className="text-xs text-white/60 truncate">{acctName} · {periodText}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {!page && <button type="button" onClick={() => window.open('/accounts/statement', '_blank')} title="Open full screen in a new tab"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold"><ExternalLink size={13} /> New tab</button>}
              <button type="button" onClick={csv} className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold"><Download size={13} /> Excel</button>
              <button type="button" onClick={print} className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold"><Printer size={13} /> Print</button>
              <button type="button" onClick={onClose} title="Close" className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center"><X size={17} /></button>
            </div>
          </div>
          {/* the four numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            {[
              ['Opening balance', signed(data.opening), 'text-white', `on ${fmtLong(start)}`],
              ['Money in', `+ ${rs(data.moneyIn)}`, 'text-emerald-300', `${data.withBal.filter((x) => x.e.amount > 0).length} credits`],
              ['Money out', `− ${rs(data.moneyOut)}`, 'text-rose-300', `${data.withBal.filter((x) => x.e.amount < 0).length} debits`],
              ['Closing balance', signed(data.closing), 'text-white', `on ${fmtLong(end)}`],
            ].map(([k, v, c, sub]) => (
              <div key={k} className="rounded-xl bg-white/[0.06] border border-white/10 px-4 py-3">
                <p className="text-[11px] text-white/55">{k}</p>
                <p className={`text-xl font-bold tabular-nums mt-0.5 ${c}`}>{v}</p>
                <p className="text-[10px] text-white/40 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
          {/* where it came from / where it went */}
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-[11px]">
            {([[1, 'In', 'text-emerald-300'], [-1, 'Out', 'text-rose-300']] as const).map(([sg, t, c]) => (
              <p key={t} className="text-white/50 truncate"><span className={`font-semibold ${c}`}>{t}:</span>{' '}
                {mix(sg).map(([k, v]) => `${CAT[k].label} ${rs(v)}`).join(' · ') || 'nothing'}</p>
            ))}
          </div>
        </div>

        {/* ── filters ── */}
        <div className="px-4 sm:px-7 py-3 bg-white border-b border-navy-100 flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 bg-navy-50 rounded-xl p-1 overflow-x-auto">
            {([['month', 'This month'], ['last', 'Last month'], ['quarter', 'Quarter'], ['year', 'Year'], ['all', 'Since 1 Oct'], ['custom', 'Custom']] as [PeriodKey, string][]).map(([k, l]) => (
              <Chip key={k} on={pk === k} onClick={() => setPk(k)}>{l}</Chip>
            ))}
          </div>
          {pk === 'custom' && (<>
            <input type="date" className="input !py-1 !w-auto text-xs" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <input type="date" className="input !py-1 !w-auto text-xs" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </>)}
          <select className="input !py-1.5 !w-auto text-xs" value={acct} onChange={(e) => setAcct(e.target.value)}>
            <option value="all">All accounts</option>
            {books.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="none">Not assigned to an account</option>
          </select>
          <div className="flex gap-0.5 bg-navy-50 rounded-xl p-1">
            <Chip on={flow === 'all'} onClick={() => setFlow('all')}>All</Chip>
            <Chip on={flow === 'in'} onClick={() => setFlow('in')}><span className="inline-flex items-center gap-1"><ArrowDownLeft size={12} /> Money in</span></Chip>
            <Chip on={flow === 'out'} onClick={() => setFlow('out')}><span className="inline-flex items-center gap-1"><ArrowUpRight size={12} /> Money out</span></Chip>
          </div>
          <select className="input !py-1.5 !w-auto text-xs" value={cat} onChange={(e) => setCat(e.target.value as LedgerKind | 'any')}>
            <option value="any">Every category</option>
            {(Object.keys(CAT) as LedgerKind[]).filter((k) => data.withBal.some((x) => x.e.kind === k)).map((k) => <option key={k} value={k}>{CAT[k].label}</option>)}
          </select>
          <div className="flex gap-0.5 bg-navy-50 rounded-xl p-1">
            <Chip on={layout === 'list'} onClick={() => setLayout('list')}><span className="inline-flex items-center gap-1"><List size={12} /> List</span></Chip>
            <Chip on={layout === 'sides'} onClick={() => setLayout('sides')}><span className="inline-flex items-center gap-1"><Columns2 size={12} /> Side by side</span></Chip>
          </div>
          {layout === 'sides' && (
            <button type="button" onClick={swap} className="rounded-xl border border-navy-100 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-600 hover:text-navy-900 inline-flex items-center gap-1">
              <ArrowLeftRight size={12} /> {inLeft ? 'Money in left · out right' : 'Money out left · in right'}
            </button>
          )}
          <label className="relative flex-1 min-w-[12rem]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
            <input className="input !py-1.5 !pl-8 text-xs" placeholder="Search a name, booking no., reference…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        {/* ── the statement ── */}
        <div className="flex-1 overflow-y-auto px-2 sm:px-7 pt-4">
          {layout === 'sides' && (
            <SideBySide rows={shown} opening={data.opening} closing={data.closing} start={start} end={end} inLeft={inLeft} onOpen={setViewing} filtered={filtered} />
          )}
          <div className={`bg-white rounded-2xl shadow-card overflow-hidden ${layout === 'sides' ? 'hidden' : ''}`}>
            <div className="hidden md:grid grid-cols-[5.5rem_minmax(0,1fr)_9.5rem_9rem_8.5rem_8.5rem_9rem] gap-3 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-navy-400 border-b border-navy-100 bg-navy-50/50 sticky top-0 z-10">
              <span>Date</span><span>Description</span><span>Category</span><span>Method · ref</span>
              <span className="text-right">Money in</span><span className="text-right">Money out</span><span className="text-right">Balance</span>
            </div>

            <StatementLine date={start} label="Opening balance" bal={data.opening} strong />

            {months.map(([m, rows]) => {
              const inM = rows.filter((r) => r.e.amount > 0).reduce((s, r) => s + r.e.amount, 0);
              const outM = -rows.filter((r) => r.e.amount < 0).reduce((s, r) => s + r.e.amount, 0);
              return (
                <div key={m}>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 bg-navy-50/70 border-y border-navy-100 text-xs">
                    <b className="text-navy-800">{new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
                    <span className="text-navy-500 tabular-nums">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · <span className="text-emerald-700 font-semibold">+ {rs(inM)}</span> · <span className="text-rose-600 font-semibold">− {rs(outM)}</span></span>
                  </div>
                  {rows.map(({ e, bal }) => {
                    const C = CAT[e.kind]; const I = C.icon; const isIn = e.amount > 0;
                    const open = e.bookingId ? () => setViewing(e.bookingId!) : undefined;
                    return (
                      <div key={e.id} role={open ? 'button' : undefined} tabIndex={open ? 0 : undefined} onClick={open}
                           onKeyDown={(k) => { if (open && (k.key === 'Enter' || k.key === ' ')) { k.preventDefault(); open(); } }}
                           className={`grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[5.5rem_minmax(0,1fr)_9.5rem_9rem_8.5rem_8.5rem_9rem] gap-x-3 gap-y-0.5 px-4 md:px-5 py-2.5 border-b border-navy-50 text-sm items-center ${open ? 'cursor-pointer hover:bg-navy-50/60' : ''}`}>
                        <span className="hidden md:block text-xs text-navy-500 tabular-nums">{fmtDay(e.date)}</span>
                        <span className="min-w-0 flex items-start gap-2.5">
                          <span className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${C.tone}`}><I size={14} /></span>
                          <span className="min-w-0">
                            <span className="block text-navy-900 font-medium truncate">{e.label}</span>
                            <span className="block text-[11px] text-navy-400 truncate"><span className="md:hidden">{fmtDay(e.date)} · {C.label} · </span>{e.detail || '—'}</span>
                          </span>
                        </span>
                        <span className="hidden md:inline-flex"><span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${C.tone}`}>{C.label}</span></span>
                        <span className="hidden md:block text-xs text-navy-500 truncate">{[e.method, e.ref].filter(Boolean).join(' · ') || '—'}</span>
                        <span className={`text-right tabular-nums font-semibold md:block ${isIn ? 'text-emerald-700' : 'hidden'}`}>{isIn ? `+ ${rs(e.amount)}` : ''}</span>
                        <span className={`text-right tabular-nums font-semibold ${isIn ? 'hidden md:block' : 'text-rose-600'}`}>{!isIn ? `− ${rs(e.amount)}` : ''}</span>
                        <span className="hidden md:block text-right tabular-nums text-navy-700">{signed(bal)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {!shown.length && <p className="text-sm text-navy-400 text-center py-12">{filtered ? 'Nothing matches these filters.' : 'No money moved in this period.'}</p>}

            <StatementLine date={end} label="Closing balance" bal={data.closing} strong moneyIn={data.moneyIn} moneyOut={data.moneyOut} />
          </div>
          <p className="text-[11px] text-navy-400 mt-3 pb-4 px-1 flex flex-wrap gap-x-4 gap-y-1">
            <span><b>Money in</b> = credit · <b>Money out</b> = debit.</span>
            {filtered && <span>Filters hide rows; the balance still follows every movement.</span>}
            {acct === 'all' && <span>Transfers between your own accounts are left out of "All accounts" (they don't change the total).</span>}
            <span className="inline-flex items-center gap-1"><Banknote size={11} /> Click a row to open its booking.</span>
          </p>
        </div>
      </div>

      {viewing && <BookingDetailsModal bookingId={viewing} startTab="payments" onClose={() => setViewing(null)}
        onEdit={(b) => navigate(`/bookings/${b.id}`)} onCancel={(b) => navigate(`/bookings/${b.id}`)} />}
    </div>
  );
}

function StatementLine({ date, label, bal, strong, moneyIn, moneyOut }: { date: string; label: string; bal: number; strong?: boolean; moneyIn?: number; moneyOut?: number }) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[5.5rem_minmax(0,1fr)_9.5rem_9rem_8.5rem_8.5rem_9rem] gap-3 px-4 md:px-5 py-3 text-sm items-center ${strong ? 'bg-navy-900/[0.03] font-semibold' : ''}`}>
      <span className="hidden md:block text-xs text-navy-500 tabular-nums">{fmtDay(date)}</span>
      <span className="text-navy-900">{label}</span>
      <span className="hidden md:block" /><span className="hidden md:block" />
      <span className="hidden md:block text-right tabular-nums text-emerald-700">{moneyIn !== undefined ? `+ ${rs(moneyIn)}` : ''}</span>
      <span className="hidden md:block text-right tabular-nums text-rose-600">{moneyOut !== undefined ? `− ${rs(moneyOut)}` : ''}</span>
      <span className="text-right tabular-nums text-navy-900">{signed(bal)}</span>
    </div>
  );
}

/**
 * Side by side, like a cash book: money in (credits) on one side, money out (debits) on the other.
 * The money-in side starts with the opening balance brought forward, the money-out side ends with the closing balance
 * carried forward — so both sides add up to the same total.
 */
function SideBySide({ rows, opening, closing, start, end, inLeft, onOpen, filtered }: {
  rows: { e: LedgerEntry; bal: number }[]; opening: number; closing: number; start: string; end: string; inLeft: boolean; onOpen: (id: string) => void; filtered: boolean;
}) {
  const ins = rows.filter((r) => r.e.amount > 0).map((r) => r.e);
  const outs = rows.filter((r) => r.e.amount < 0).map((r) => r.e);
  const tIn = ins.reduce((s, e) => s + e.amount, 0), tOut = -outs.reduce((s, e) => s + e.amount, 0);
  const sideIn = (
    <Side key="in" title="Money in" sub="Credits — what came to the company" tone="emerald" entries={ins} onOpen={onOpen}
      first={{ date: start, label: 'Opening balance brought forward', amount: opening }} total={opening + tIn} />
  );
  const sideOut = (
    <Side key="out" title="Money out" sub="Debits — what the company paid out" tone="rose" entries={outs} onOpen={onOpen}
      last={{ date: end, label: 'Closing balance carried forward', amount: closing }} total={tOut + closing} />
  );
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-2 items-stretch">{inLeft ? [sideIn, sideOut] : [sideOut, sideIn]}</div>
      {filtered && <p className="text-[11px] text-navy-400 mt-2 px-1">Filtered — the two sides only balance when every entry is shown.</p>}
    </div>
  );
}

function Side({ title, sub, tone, entries, onOpen, first, last, total }: {
  title: string; sub: string; tone: 'emerald' | 'rose'; entries: LedgerEntry[]; onOpen: (id: string) => void;
  first?: { date: string; label: string; amount: number }; last?: { date: string; label: string; amount: number }; total: number;
}) {
  const months = new Map<string, LedgerEntry[]>();
  entries.forEach((e) => { const k = e.date.slice(0, 7); months.set(k, [...(months.get(k) ?? []), e]); });
  const amt = tone === 'emerald' ? 'text-emerald-700' : 'text-rose-600';
  const fixed = (x: { date: string; label: string; amount: number }) => (
    <div className="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] gap-2 px-4 py-2.5 bg-navy-900/[0.03] text-sm font-semibold">
      <span className="text-xs text-navy-500 tabular-nums">{fmtDay(x.date)}</span><span className="text-navy-900 truncate">{x.label}</span>
      <span className="tabular-nums text-navy-900 text-right">{signed(x.amount)}</span>
    </div>
  );
  return (
    <section className="bg-white rounded-2xl shadow-card flex flex-col">
      <div className={`flex items-center justify-between gap-2 px-4 py-3 border-b rounded-t-2xl ${tone === 'emerald' ? 'border-emerald-100 bg-emerald-50/60' : 'border-rose-100 bg-rose-50/60'}`}>
        <div>
          <p className={`text-sm font-bold flex items-center gap-1.5 ${tone === 'emerald' ? 'text-emerald-800' : 'text-rose-700'}`}>
            {tone === 'emerald' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}{title}</p>
          <p className="text-[11px] text-navy-500">{sub}</p>
        </div>
        <p className={`text-sm font-bold tabular-nums ${amt}`}>{entries.length} · {rs(entries.reduce((s, e) => s + Math.abs(e.amount), 0))}</p>
      </div>
      {first && fixed(first)}
      {[...months.entries()].map(([m, list]) => (
        <div key={m}>
          <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-navy-400 bg-navy-50/60 border-y border-navy-50">
            {new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>
          {list.map((e) => {
            const C = CAT[e.kind]; const I = C.icon;
            return (
              <div key={e.id} role={e.bookingId ? 'button' : undefined} onClick={e.bookingId ? () => onOpen(e.bookingId!) : undefined}
                   className={`grid grid-cols-[3.75rem_minmax(0,1fr)_auto] gap-2 px-4 py-2 border-b border-navy-50 text-sm items-center ${e.bookingId ? 'cursor-pointer hover:bg-navy-50/60' : ''}`}>
                <span className="text-xs text-navy-500 tabular-nums">{fmtDay(e.date)}</span>
                <span className="min-w-0 flex items-start gap-2">
                  <span className={`mt-0.5 w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${C.tone}`}><I size={12} /></span>
                  <span className="min-w-0"><span className="block text-navy-900 truncate">{e.label}</span>
                    <span className="block text-[11px] text-navy-400 truncate">{C.label}{e.method ? ` · ${e.method}` : ''}{e.ref ? ` · ${e.ref}` : ''}</span></span>
                </span>
                <span className={`tabular-nums font-semibold text-right ${amt}`}>{rs(e.amount)}</span>
              </div>
            );
          })}
        </div>
      ))}
      {!entries.length && <p className="text-xs text-navy-400 px-4 py-4">Nothing in this period.</p>}
      {last && fixed(last)}
      {/* the totals sit level at the bottom of both sides, and stay in view while scrolling */}
      <div className="flex-1" />
      <div className="sticky bottom-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3 border-t-2 border-navy-900 text-sm font-bold bg-white rounded-b-2xl shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.15)]">
        <span className="text-navy-900">Total</span><span className="tabular-nums text-navy-900">{signed(total)}</span>
      </div>
    </section>
  );
}
