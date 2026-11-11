import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CheckCircle2, Download, Info, Landmark, Lock, Plus, Printer, Unlock, Wallet,
} from 'lucide-react';
import Header from '../components/layout/Header';
import Select from '../components/ui/Select';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from '../store/useToast';
import { bookingNo, depositHeld } from '../lib/bookingRecord';
import { completedOn, payoutDate, dueMonth, periodLabel, STATUS_INFO, useSettlements, linesFor, totalsOf } from '../lib/settlements';
import { EXPENSE_CATEGORIES, PAY_METHODS, useCompanyFinance } from '../lib/companyFinance';
import {
  KIND_LABEL, balances, buildLedger, checks, heldForOthers, incomeBy, monthlyTrend, periodFigures, receivables, utilisation,
  type Books, type LedgerKind,
} from '../lib/ledger';
import type { CompanyAccount } from '../types';
import FigureExplain, { type FigureKey } from '../components/ui/FigureExplain';
import AccountStatement from '../components/accounts/AccountStatement';

/*
 * Finance → Company accounts: the company's books on one page.
 *   Overview   whose money we hold, profit for the period, money to come in / go out, charts, checks
 *   Ledger     every money movement (export for the accountant)
 *   Expenses   company running costs — approved by Brian above the approval amount, then paid
 *   Accounts   cash box & bank accounts, opening balances, transfers, the usual account per method
 *   Months     close a checked month (its figures are kept; its expenses and transfers are locked)
 */

const rs = (n: number) => `${n < 0 ? '− ' : ''}Rs ${Math.abs(Math.round(n)).toLocaleString('en-LK')}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = (d?: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
type Tab = 'overview' | 'ledger' | 'expenses' | 'accounts' | 'months';
type PeriodKey = 'month' | 'last' | 'quarter' | 'year' | 'custom';

function rangeOf(k: PeriodKey, custom: { from: string; to: string }) {
  const n = new Date();
  if (k === 'month') return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) };
  if (k === 'last') return { start: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), end: iso(new Date(n.getFullYear(), n.getMonth(), 0)) };
  if (k === 'quarter') { const q = Math.floor(n.getMonth() / 3) * 3; return { start: iso(new Date(n.getFullYear(), q, 1)), end: iso(new Date(n.getFullYear(), q + 3, 0)) }; }
  if (k === 'year') return { start: `${n.getFullYear()}-01-01`, end: `${n.getFullYear()}-12-31` };
  return { start: custom.from, end: custom.to };
}
/** the same length of time just before */
function previousOf(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`), e = new Date(`${end}T00:00:00`);
  const len = e.getTime() - s.getTime();
  const pe = new Date(s.getTime() - 864e5), ps = new Date(pe.getTime() - len);
  return { start: iso(ps), end: iso(pe) };
}

function Delta({ now, before, invert }: { now: number; before?: number; invert?: boolean }) {
  if (before === undefined || before === 0) return null;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  if (!isFinite(pct) || pct === 0) return <span className="text-[11px] text-navy-400 ml-1.5">±0%</span>;
  const good = invert ? pct < 0 : pct > 0;
  return <span className={`text-[11px] font-semibold ml-1.5 ${good ? 'text-emerald-600' : 'text-red-600'}`}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%</span>;
}
function Row({ label, amount, before, detail, strong, minus, invert, onClick }: { label: string; amount: number; before?: number; detail?: string; strong?: boolean; minus?: boolean; invert?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} title="How it's worked out"
      className={`group w-full text-left flex items-start justify-between gap-4 py-1.5 px-1.5 -mx-1.5 rounded-lg hover:bg-navy-50/80 ${strong ? 'border-t border-navy-200 mt-1 pt-2' : ''}`}>
      <div className="min-w-0"><p className={`${strong ? 'font-semibold text-navy-900' : 'text-navy-700'} flex items-center gap-1`}>{label}<Info size={12} className="text-navy-300 group-hover:text-navy-600" /></p>{detail && <p className="text-xs text-navy-400">{detail}</p>}</div>
      <p className={`whitespace-nowrap tabular-nums ${strong ? 'font-bold text-navy-900 text-base' : minus ? 'text-red-600' : 'text-navy-800'}`}>
        {minus && amount > 0 ? '− ' : ''}{rs(amount)}<Delta now={amount} before={before} invert={invert || minus} />
      </p>
    </button>
  );
}

export default function CompanyAccounts() {
  const st = useStore();
  const admin = useAuthStore((s) => s.isAdmin());
  const fin = useCompanyFinance();
  const settle = useSettlements();
  const [tab, setTab] = useState<Tab>('overview');
  const [pk, setPk] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState({ from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: iso(new Date()) });
  const [compare, setCompare] = useState(true);
  useEffect(() => { fin.refresh(); settle.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const books: Books = useMemo(() => ({
    bookings: st.bookings, commissions: st.commissions, expenses: st.expenses, vehicles: st.vehicles, owners: st.owners,
    settlements: settle.list, accounts: fin.accounts, companyExpenses: fin.expenses, transfers: fin.transfers, settings: fin.settings, from: settle.from,
  }), [st.bookings, st.commissions, st.expenses, st.vehicles, st.owners, settle.list, settle.from, fin.accounts, fin.expenses, fin.transfers, fin.settings]);
  const ledger = useMemo(() => buildLedger(books), [books]);
  const { start, end } = rangeOf(pk, custom);
  const prev = previousOf(start, end);
  const f = useMemo(() => periodFigures(books, ledger, start, end, admin), [books, ledger, start, end, admin]);
  const fp = useMemo(() => (compare ? periodFigures(books, ledger, prev.start, prev.end, admin) : undefined), [books, ledger, prev.start, prev.end, compare, admin]);
  const bal = useMemo(() => balances(books, ledger), [books, ledger]);
  const held = useMemo(() => heldForOthers(books), [books]);
  const own = bal.total - held.owed - held.deposits - held.unpaidExpenses;
  const periodText = `${fmtDay(start)} – ${fmtDay(end)}`;

  const tabs: [Tab, string][] = [['overview', 'Overview'], ['ledger', 'Ledger'], ['expenses', `Company expenses${fin.expenses.some((e) => e.status === 'pending') ? ` · ${fin.expenses.filter((e) => e.status === 'pending').length} to approve` : ''}`], ['accounts', 'Accounts'], ['months', 'Month close']];

  return (
    <div>
      <Header title="Company accounts" subtitle="The company's books — whose money we hold, what we earned, what's owed in and out" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 bg-navy-50 rounded-xl p-1 text-sm font-semibold overflow-x-auto">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 whitespace-nowrap ${tab === k ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500'}`}>{l}</button>
          ))}
        </div>
        {(tab === 'overview' || tab === 'ledger') && (
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <div className="flex gap-1 bg-white rounded-xl shadow-card p-1 text-xs font-semibold">
              {([['month', 'This month'], ['last', 'Last month'], ['quarter', 'Quarter'], ['year', 'Year'], ['custom', 'Custom']] as [PeriodKey, string][]).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setPk(k)} className={`rounded-lg px-2.5 py-1 ${pk === k ? 'bg-navy-800 text-white' : 'text-navy-500'}`}>{l}</button>
              ))}
            </div>
            {pk === 'custom' && (<>
              <input type="date" className="input !py-1 !w-auto text-xs" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <input type="date" className="input !py-1 !w-auto text-xs" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>)}
            {tab === 'overview' && <label className="text-xs text-navy-500 flex items-center gap-1"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with the period before</label>}
          </div>
        )}
      </div>

      {!fin.loaded && <p className="text-sm text-navy-400 py-10 text-center">Loading…</p>}
      {fin.loaded && tab === 'overview' && (
        <Overview books={books} ledger={ledger} f={f} fp={fp} bal={bal} held={held} own={own} start={start} end={end} periodText={periodText} admin={admin} />
      )}
      {fin.loaded && tab === 'ledger' && <LedgerTab books={books} ledger={ledger} start={start} end={end} periodText={periodText} />}
      {fin.loaded && tab === 'expenses' && <ExpensesTab admin={admin} />}
      {fin.loaded && tab === 'accounts' && <AccountsTab admin={admin} bal={bal} />}
      {fin.loaded && tab === 'months' && <MonthsTab books={books} ledger={ledger} admin={admin} bal={bal} held={held} />}
    </div>
  );
}

/* ═══════════════════════════════ Overview ═══════════════════════════════ */

function Overview({ books, ledger, f, fp, bal, held, own, start, end, periodText, admin }: {
  books: Books; ledger: ReturnType<typeof buildLedger>; f: ReturnType<typeof periodFigures>; fp?: ReturnType<typeof periodFigures>;
  bal: ReturnType<typeof balances>; held: ReturnType<typeof heldForOthers>; own: number; start: string; end: string; periodText: string; admin: boolean;
}) {
  const settle = useSettlements();
  const rec = useMemo(() => receivables(books), [books]);
  const trend = useMemo(() => monthlyTrend(books, ledger, 12, admin), [books, ledger, admin]);
  const [by, setBy] = useState<'car' | 'owner' | 'type' | 'channel'>('owner');
  const groups = useMemo(() => incomeBy(books, start, end, by), [books, start, end, by]);
  const util = useMemo(() => utilisation(books, start, end), [books, start, end]);
  const due = dueMonth();
  const payoutDue = payoutDate(due, settle.payoutDay);
  const issues = useMemo(() => checks(books, ledger, payoutDue), [books, ledger, payoutDue]);
  const data = { bookings: books.bookings, commissions: books.commissions, expenses: books.expenses, vehicles: books.vehicles, owners: books.owners };
  const ownerRows = books.owners.map((o) => {
    const s = settle.list.find((x) => x.ownerId === o.id && x.period === due);
    return { o, s, net: s ? s.net : totalsOf(linesFor(o.id, due, data, books.from)).net };
  }).filter((r) => r.s || r.net);
  const depositsToReturn = books.bookings.filter((b) => b.status === 'Completed' && depositHeld(b) > 0);
  const [ex, setEx] = useState<FigureKey | null>(null);
  // the bank-style statement: every movement with money in / out and the running balance
  const [statement, setStatement] = useState(false);
  const noAccounts = books.accounts.length === 0;

  const printSummary = () => {
    const w = window.open('', '_blank'); if (!w) { toast.error('Not opened', 'Allow pop-ups for this site.'); return; }
    const line = (k: string, v: number, b = false) => `<tr${b ? ' class="b"' : ''}><td>${k}</td><td class="n">${rs(v)}</td></tr>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Company accounts ${periodText}</title><style>body{font-family:Segoe UI,Arial,sans-serif;color:#111;font-size:13px;margin:24px}h1{margin:0 0 4px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#71717A;margin:20px 0 6px}table{border-collapse:collapse;width:420px}td{padding:5px 4px;border-bottom:1px solid #eee}.n{text-align:right}.b td{font-weight:700;border-top:2px solid #111}</style></head><body>
      <div style="color:#E11D2A;font-weight:800;font-size:12px">CEYLON RENT A CARS</div><h1>Company accounts</h1><div>${periodText} · printed ${new Date().toLocaleString('en-GB')}</div>
      <h2>Profit for the period</h2><table>${line('Company commission', f.commission)}${line('Other rental income', f.otherIncome)}${line('Deposit amounts kept', f.depositKept)}${line('Costs carried on rentals', -f.carried)}${line('Rental profit', f.rentalProfit, true)}${line('Company running costs', -f.running)}${admin ? line('Private costs (salaries…)', -f.runningPrivate) : ''}${line('Bad debt written off', -f.badDebt)}${line('Company profit', f.profit, true)}</table>
      <h2>Cash today</h2><table>${line('Money in accounts', bal.total)}${line('Owed to owners', -held.owed)}${line('Customer deposits held', -held.deposits)}${line('Approved expenses not paid', -held.unpaidExpenses)}${line("Company's own money", own, true)}</table>
      <h2>Money to come in</h2><table>${line('Balances on finished trips', rec.total)}${line('On rent now (collect at return)', rec.onRentTotal)}</table>
      <h2>Collected in the period</h2><table>${line('From customers', f.collected)}${line('Deposits received', f.depositsIn)}${line('Deposits returned', -f.depositsOut)}</table></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  };

  return (
    <div className="space-y-5">
      {statement && <AccountStatement books={books} ledger={ledger} onClose={() => setStatement(false)} />}
      <FigureExplain k={ex} onClose={() => setEx(null)} books={books} ledger={ledger} f={f} start={start} end={end} periodText={periodText} admin={admin} />
      {noAccounts && (
        <p className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-900 flex gap-2"><Info size={16} className="flex-shrink-0 mt-0.5" />
          Set up the company's cash box and bank accounts (Accounts tab) with their balances on {fmtDay(books.from)} — the cash figures then match the bank.</p>
      )}

      {/* 2 · whose money do we hold */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="section-title">Whose money do we hold — today</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStatement(true)} className="btn-primary !py-1.5 text-xs inline-flex items-center gap-1.5"><Landmark size={13} /> Account statement</button>
            <button type="button" onClick={printSummary} className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5"><Printer size={13} /> Print for the accountant</button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            ['cash', 'Money in our accounts', bal.total, 'bg-navy-800 text-white', `${books.accounts.length} account${books.accounts.length === 1 ? '' : 's'}${bal.unassigned ? ` + ${rs(bal.unassigned)} not assigned` : ''}`],
            ['owed', 'Owed to owners', -held.owed, 'bg-amber-50 text-amber-900', 'their share, not paid yet'],
            ['deposits', 'Customer deposits held', -held.deposits, 'bg-amber-50 text-amber-900', 'to be returned — not ours'],
            ['unpaid', 'Approved expenses not paid', -held.unpaidExpenses, 'bg-amber-50 text-amber-900', 'company bills to pay'],
            ['own', "Company's own money", own, own >= 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800', 'what is really the company\'s'],
          ].map(([key, k, v, cls, sub]) => (
            <button type="button" key={key as string} onClick={() => setEx(key as FigureKey)} title="How it's worked out"
              className={`group text-left rounded-2xl px-4 py-3 transition hover:ring-2 hover:ring-navy-300 ${cls}`}>
              <p className="text-xs opacity-70 flex items-center justify-between gap-1">{k}<Info size={13} className="opacity-50 group-hover:opacity-100" /></p>
              <p className="text-xl font-bold mt-0.5">{rs(v as number)}</p><p className="text-[11px] opacity-60 mt-0.5">{sub}</p>
              <p className="text-[10px] opacity-0 group-hover:opacity-70 mt-0.5 underline">how it's worked out</p>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        {/* 3 · profit for the period */}
        <section className="card">
          <p className="section-title">Profit · {periodText}</p>
          <p className="text-xs text-navy-400 mb-2">{f.bookings} rental{f.bookings === 1 ? '' : 's'} completed in the period{fp ? ' · compared with the period before' : ''} · click any line to see how it's worked out</p>
          <div className="text-sm">
            <Row onClick={() => setEx('commission')} label="Company commission" amount={f.commission} before={fp?.commission} detail="on final bills (rent + charges − discount)" />
            <Row onClick={() => setEx('other')} label="Other rental income" amount={f.otherIncome} before={fp?.otherIncome} detail="extra charges kept on older bookings, company-owned cars" />
            {f.depositKept > 0 && <Row onClick={() => setEx('depositKept')} label="Deposit amounts kept" amount={f.depositKept} before={fp?.depositKept} />}
            {f.carried > 0 && <Row onClick={() => setEx('carried')} label="Costs carried on rentals" amount={f.carried} before={fp?.carried} minus detail="deductions the company paid (not the owners)" />}
            <Row onClick={() => setEx('rentalProfit')} label="Rental profit" amount={f.rentalProfit} before={fp?.rentalProfit} strong />
            <Row onClick={() => setEx('running')} label="Company running costs" amount={f.running} before={fp?.running} minus detail="approved company expenses dated in the period" />
            {admin && f.runningPrivate > 0 && <Row onClick={() => setEx('private')} label="Private costs" amount={f.runningPrivate} before={fp?.runningPrivate} minus detail="salaries and other private items — admins only" />}
            {f.badDebt > 0 && <Row onClick={() => setEx('badDebt')} label="Bad debt written off" amount={f.badDebt} before={fp?.badDebt} minus />}
            <Row onClick={() => setEx('profit')} label={f.profit >= 0 ? 'Company profit' : 'Company loss'} amount={f.profit} before={fp?.profit} strong />
            {f.discounts > 0 && <p className="text-xs text-navy-400 mt-1">Discounts given: {rs(f.discounts)} (already taken off the bills above)</p>}
            {!admin && <p className="text-xs text-navy-400 mt-1">Private costs (such as salaries) are not included here.</p>}
          </div>
          <div className="mt-3 pt-3 border-t border-navy-100 grid grid-cols-3 gap-2 text-xs">
            <button type="button" onClick={() => setEx('collected')} title="How it's worked out" className="group text-left rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-navy-50/80"><p className="text-navy-400 flex items-center gap-1">Collected from customers<Info size={11} className="text-navy-300 group-hover:text-navy-600" /></p><p className="font-semibold text-navy-800">{rs(f.collected)}<Delta now={f.collected} before={fp?.collected} /></p></button>
            <button type="button" onClick={() => setEx('depositsIn')} title="How it's worked out" className="group text-left rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-navy-50/80"><p className="text-navy-400 flex items-center gap-1">Deposits received<Info size={11} className="text-navy-300 group-hover:text-navy-600" /></p><p className="font-semibold text-navy-800">{rs(f.depositsIn)}</p></button>
            <button type="button" onClick={() => setEx('depositsOut')} title="How it's worked out" className="group text-left rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-navy-50/80"><p className="text-navy-400 flex items-center gap-1">Deposits returned<Info size={11} className="text-navy-300 group-hover:text-navy-600" /></p><p className="font-semibold text-navy-800">{rs(f.depositsOut)}</p></button>
          </div>
        </section>

        <div className="space-y-5">
          {/* 4 · money to come in */}
          <section className="card">
            <div className="flex items-center justify-between"><p className="section-title flex items-center gap-1.5"><ArrowDownLeft size={15} className="text-emerald-600" /> Money to come in</p><span className="text-sm font-bold text-navy-900">{rs(rec.total + rec.onRentTotal)}</span></div>
            <div className="grid grid-cols-3 gap-2 my-3 text-xs">
              {Object.entries(rec.aged).map(([k, v]) => (
                <div key={k} className={`rounded-xl px-3 py-2 ${k === 'Over 30 days' && v > 0 ? 'bg-red-50 text-red-800' : 'bg-navy-50/70 text-navy-700'}`}><p className="opacity-70">{k}</p><p className="font-bold">{rs(v)}</p></div>
              ))}
            </div>
            <p className="text-xs text-navy-500 mb-1">Finished trips not fully paid ({rec.done.length}) · on rent now: {rs(rec.onRentTotal)} to collect at return</p>
            <div className="divide-y divide-navy-50 max-h-56 overflow-y-auto">
              {rec.done.slice(0, 30).map(({ b, due: d, credit, days }) => (
                <Link key={b.id} to={`/bookings/${b.id}`} className="flex items-center justify-between gap-2 py-1.5 text-xs hover:bg-navy-50/60 rounded px-1">
                  <span className="min-w-0 truncate"><b className="text-navy-800">{b.customerName}</b> <span className="text-navy-400">· {bookingNo(b)} · {days} day{days === 1 ? '' : 's'} ago{credit ? ' · credit' : ''}</span></span>
                  <span className={`font-semibold ${days > 30 ? 'text-red-600' : 'text-navy-800'}`}>{rs(d)}</span>
                </Link>
              ))}
              {!rec.done.length && <p className="text-xs text-navy-400 py-2">Nothing owed on finished trips.</p>}
            </div>
          </section>

          {/* 5 · money to go out */}
          <section className="card">
            <div className="flex items-center justify-between"><p className="section-title flex items-center gap-1.5"><ArrowUpRight size={15} className="text-red-600" /> Money to go out</p><span className="text-sm font-bold text-navy-900">{rs(held.owed + depositsToReturn.reduce((s, b) => s + depositHeld(b), 0) + held.unpaidExpenses)}</span></div>
            <p className="text-xs text-navy-500 mt-2 mb-1">Owner payouts for {periodLabel(due)} · due {payoutDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</p>
            <div className="divide-y divide-navy-50 max-h-48 overflow-y-auto">
              {ownerRows.map(({ o, s, net }) => (
                <div key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="text-navy-800">{o.name}</span>
                  <span className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_INFO[s?.status ?? 'not_prepared'].cls}`}>{STATUS_INFO[s?.status ?? 'not_prepared'].label}</span><b className="text-navy-800">{rs(net)}</b></span>
                </div>
              ))}
              {!ownerRows.length && <p className="text-xs text-navy-400 py-1.5">No owner payouts for {periodLabel(due)}.</p>}
            </div>
            <Link to="/settlements" className="text-xs font-semibold text-navy-600 hover:underline">Open owner payouts →</Link>
            {depositsToReturn.length > 0 && (<>
              <p className="text-xs text-navy-500 mt-3 mb-1">Deposits to return on finished trips ({depositsToReturn.length})</p>
              {depositsToReturn.slice(0, 10).map((b) => (
                <Link key={b.id} to={`/bookings/${b.id}`} className="flex justify-between py-1 text-xs hover:bg-navy-50/60 rounded px-1"><span>{b.customerName} · {bookingNo(b)}</span><b>{rs(depositHeld(b))}</b></Link>
              ))}
            </>)}
            {held.unpaidExpenses > 0 && <p className="text-xs text-navy-500 mt-3">Approved company expenses not paid yet: <b>{rs(held.unpaidExpenses)}</b></p>}
          </section>
        </div>
      </div>

      {/* 8 · checks */}
      {issues.length > 0 && (
        <section className="card">
          <p className="section-title flex items-center gap-1.5 mb-2"><AlertTriangle size={15} className="text-amber-600" /> Things to check</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {issues.map((c) => (
              <div key={c.text} className={`rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-2 ${c.level === 'warn' ? 'bg-amber-50 text-amber-900' : 'bg-navy-50/70 text-navy-700'}`}>
                <span>{c.text}</span><b>{c.count}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6 · charts */}
      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <section className="card">
          <p className="section-title mb-3">Last 12 months</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trend} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => rs(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="income" name="Rental profit" fill="#111114" radius={[4, 4, 0, 0]} />
              <Bar dataKey="costs" name="Costs" fill="#E11D2A" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="section-title">Rental profit by</p>
            <div className="flex gap-1 bg-navy-50 rounded-lg p-0.5 text-xs font-semibold">
              {([['owner', 'Owner'], ['car', 'Car'], ['type', 'Trip type'], ['channel', 'Channel']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setBy(k)} className={`rounded-md px-2 py-0.5 ${by === k ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {groups.map((g) => (
              <div key={g.name} className="flex items-center gap-2 text-xs">
                <span className="w-36 truncate text-navy-700">{g.name}</span>
                <span className="flex-1 h-2 rounded-full bg-navy-50 overflow-hidden"><span className="block h-full bg-navy-800" style={{ width: `${Math.max(2, (g.income / (groups[0]?.income || 1)) * 100)}%` }} /></span>
                <span className="w-24 text-right font-semibold text-navy-800">{rs(g.income)}</span>
                <span className="w-12 text-right text-navy-400">{g.trips} trip{g.trips === 1 ? '' : 's'}</span>
              </div>
            ))}
            {!groups.length && <p className="text-xs text-navy-400">No completed rentals in the period.</p>}
          </div>
          <p className="section-title mt-5 mb-2">Fleet use · days on rent in the period</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {util.map((u) => (
              <div key={u.name} className="flex items-center gap-2 text-xs">
                <span className="w-36 truncate text-navy-700">{u.name}</span>
                <span className="flex-1 h-2 rounded-full bg-navy-50 overflow-hidden"><span className={`block h-full ${u.pct >= 60 ? 'bg-emerald-500' : u.pct >= 30 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(2, u.pct)}%` }} /></span>
                <span className="w-20 text-right text-navy-600">{u.pct}% · {u.days}d</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ Ledger ═══════════════════════════════ */

function LedgerTab({ books, ledger, start, end, periodText }: { books: Books; ledger: ReturnType<typeof buildLedger>; start: string; end: string; periodText: string }) {
  const [kind, setKind] = useState<LedgerKind | ''>('');
  const [acc, setAcc] = useState('');
  const [q, setQ] = useState('');
  const accName = (id?: string) => (id ? books.accounts.find((a) => a.id === id)?.name ?? 'Unknown account' : 'Not assigned');
  const rows = ledger.filter((e) => e.date >= start && e.date <= end && (!kind || e.kind === kind) && (!acc || (acc === 'none' ? !e.accountId : e.accountId === acc))
    && (!q || `${e.label} ${e.detail ?? ''} ${e.ref ?? ''} ${e.by ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const tin = rows.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0), tout = -rows.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);

  const exportCsv = () => {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Type', 'Description', 'Details', 'Account', 'Method', 'Reference', 'By', 'Money in', 'Money out'].map(cell).join(','),
      ...rows.map((e) => [e.date, KIND_LABEL[e.kind], e.label, e.detail, accName(e.accountId), e.method, e.ref, e.by, e.amount > 0 ? e.amount : '', e.amount < 0 ? -e.amount : ''].map(cell).join(','))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ceylon-ledger-${start}-to-${end}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="text-xs text-navy-500">Type
          <select className="input !py-1.5 mt-1 !w-auto" value={kind} onChange={(e) => setKind(e.target.value as LedgerKind | '')}>
            <option value="">Everything</option>{(Object.keys(KIND_LABEL) as LedgerKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="text-xs text-navy-500">Account
          <select className="input !py-1.5 mt-1 !w-auto" value={acc} onChange={(e) => setAcc(e.target.value)}>
            <option value="">All accounts</option>{books.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="none">Not assigned</option>
          </select>
        </label>
        <input className="input !py-1.5 flex-1 min-w-[12rem]" placeholder="Search customer, reference, person…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" onClick={exportCsv} className="btn-secondary !py-2 text-sm inline-flex items-center gap-1.5"><Download size={14} /> Export (Excel)</button>
      </div>
      <div className="flex flex-wrap gap-4 text-sm mb-2"><span className="text-navy-500">{periodText} · {rows.length} entries</span><span className="text-emerald-700">In <b>{rs(tin)}</b></span><span className="text-red-600">Out <b>{rs(tout)}</b></span><span className="text-navy-700">Net <b>{rs(tin - tout)}</b></span></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-xs">
          <thead><tr className="text-left text-navy-400 border-b border-navy-100"><th className="py-2">Date</th><th>Type</th><th>Description</th><th>Account</th><th>Method · ref</th><th>By</th><th className="text-right">In</th><th className="text-right">Out</th></tr></thead>
          <tbody>
            {rows.slice(0, 500).map((e) => (
              <tr key={e.id} className="border-b border-navy-50 align-top">
                <td className="py-1.5 whitespace-nowrap text-navy-600">{fmtDay(e.date)}</td>
                <td className="text-navy-600 whitespace-nowrap">{KIND_LABEL[e.kind]}</td>
                <td className="text-navy-800">{e.bookingId ? <Link to={`/bookings/${e.bookingId}`} className="hover:underline">{e.label}</Link> : e.label}{e.detail && <span className="block text-navy-400">{e.detail}</span>}</td>
                <td className={e.accountId ? 'text-navy-600' : 'text-amber-700'}>{e.amount ? accName(e.accountId) : '—'}</td>
                <td className="text-navy-500">{[e.method, e.ref].filter(Boolean).join(' · ') || '—'}</td>
                <td className="text-navy-500">{e.by ?? '—'}</td>
                <td className="text-right text-emerald-700 font-semibold">{e.amount > 0 ? rs(e.amount) : ''}</td>
                <td className="text-right text-red-600 font-semibold">{e.amount < 0 ? rs(-e.amount) : ''}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-8 text-center text-navy-400">Nothing in this period.</td></tr>}
          </tbody>
        </table>
        {rows.length > 500 && <p className="text-xs text-navy-400 mt-2">Showing the latest 500 — export to see all {rows.length}.</p>}
      </div>
    </div>
  );
}

/* ═══════════════════════════ Company expenses ═══════════════════════════ */

function ExpensesTab({ admin }: { admin: boolean }) {
  const fin = useCompanyFinance();
  const [form, setForm] = useState({ date: iso(new Date()), category: EXPENSE_CATEGORIES[0], amount: '', description: '', accountId: '', private: false, paidNow: true });
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [payAcc, setPayAcc] = useState('');
  const [payOn, setPayOn] = useState(iso(new Date()));
  const accName = (id?: string) => fin.accounts.find((a) => a.id === id)?.name ?? '—';
  const amt = Number(form.amount) || 0;
  const needsApproval = !admin && amt > fin.settings.approvalAbove;

  const add = async () => {
    if (!form.description.trim() || amt <= 0) { toast.error('Missing details', 'Enter the amount and what it was for.'); return; }
    if (form.paidNow && !needsApproval && !form.accountId) { toast.error('Account needed', 'Choose the account it was paid from, or untick "Paid already".'); return; }
    setBusy(true);
    try {
      await fin.addExpense({ date: form.date, category: form.category, amount: amt, description: form.description, accountId: form.accountId || undefined, private: admin && form.private });
      if (form.paidNow && !needsApproval && form.accountId) {
        const just = useCompanyFinance.getState().expenses.find((e) => e.description === form.description.trim() && e.amount === amt && e.status === 'approved');
        if (just) await fin.payExpense(just.id, form.accountId, form.date);
      }
      toast.success(needsApproval ? 'Sent to Brian for approval' : 'Expense recorded', `${form.category} · ${rs(amt)}`);
      setForm((f) => ({ ...f, amount: '', description: '' }));
    } catch (e) { toast.error('Not saved', (e as Error).message); }
    setBusy(false);
  };
  const run = async (fn: () => Promise<void>, done: string) => { try { await fn(); toast.success(done); } catch (e) { toast.error('Not saved', (e as Error).message); } };
  const groups = (['pending', 'approved', 'paid', 'rejected'] as const).map((s) => ({ s, list: fin.expenses.filter((e) => e.status === s) })).filter((g) => g.list.length);
  const TITLE = { pending: 'Waiting for Brian', approved: 'Approved — to pay', paid: 'Paid', rejected: 'Rejected' };

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <p className="section-title flex items-center gap-1.5"><Plus size={15} /> Add a company expense</p>
        <p className="text-xs text-navy-400">Running costs not tied to a car (vehicle repairs go on the Expenses page). Over {rs(fin.settings.approvalAbove)} waits for Brian's approval.</p>
        <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_9rem] lg:grid-cols-[9rem_14rem_9rem_minmax(0,1fr)]">
          <label className="text-xs text-navy-500">Date<input type="date" className="input !py-1.5 mt-1" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></label>
          <label className="text-xs text-navy-500">Category<select className="input !py-1.5 mt-1" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="text-xs text-navy-500">Amount (Rs)<input type="number" min={0} className="input !py-1.5 mt-1" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></label>
          <label className="text-xs text-navy-500 sm:col-span-3 lg:col-span-1">What for<input className="input !py-1.5 mt-1" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. CEB bill October" /></label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!needsApproval && (<>
            <label className="text-xs text-navy-700 flex items-center gap-1.5"><input type="checkbox" checked={form.paidNow} onChange={(e) => setForm((f) => ({ ...f, paidNow: e.target.checked }))} /> Paid already, from</label>
            {form.paidNow && <select className="input !py-1.5 !w-auto text-xs" value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}><option value="">Choose the account…</option>{fin.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
          </>)}
          {needsApproval && <span className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2 py-1">Over {rs(fin.settings.approvalAbove)} — Brian approves it first, then it's paid.</span>}
          {admin && <label className="text-xs text-navy-700 flex items-center gap-1.5"><input type="checkbox" checked={form.private} onChange={(e) => setForm((f) => ({ ...f, private: e.target.checked }))} /> Private (admins only — e.g. salaries)</label>}
          <button type="button" disabled={busy} onClick={add} className="btn-primary !py-2 ml-auto">{needsApproval ? 'Send for approval' : 'Add expense'}</button>
        </div>
      </section>

      {groups.map(({ s, list }) => (
        <section key={s} className="card">
          <p className="section-title mb-2">{TITLE[s]} · {list.length} · {rs(list.reduce((t, e) => t + e.amount, 0))}</p>
          <div className="divide-y divide-navy-50">
            {list.map((e) => (
              <div key={e.id} className="py-2 text-sm flex flex-wrap items-center gap-3">
                <span className="w-24 text-xs text-navy-400">{fmtDay(e.date)}</span>
                <span className="flex-1 min-w-[14rem]">
                  <span className="font-medium text-navy-800">{e.category}</span>{e.private && <span className="ml-1.5 rounded bg-navy-100 px-1.5 py-px text-[10px] font-semibold text-navy-600">PRIVATE</span>}
                  <span className="text-navy-500"> · {e.description}</span>
                  <span className="block text-xs text-navy-400">Added by {e.requestedBy ?? '—'}{e.approvedBy ? ` · approved by ${e.approvedBy}` : ''}{e.paidOn ? ` · paid ${fmtDay(e.paidOn)} from ${accName(e.accountId)} by ${e.paidBy ?? '—'}` : ''}{e.reviewNote ? ` · “${e.reviewNote}”` : ''}</span>
                </span>
                <b className="text-navy-900">{rs(e.amount)}</b>
                {s === 'pending' && admin && (<>
                  <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => { const why = prompt('Why is it rejected?'); if (why?.trim()) run(() => fin.reviewExpense(e.id, false, why.trim()), 'Rejected'); }}>Reject</button>
                  <button type="button" className="btn-primary !py-1 text-xs" onClick={() => run(() => fin.reviewExpense(e.id, true), 'Approved')}>Approve</button>
                </>)}
                {(s === 'pending' || s === 'rejected') && <button type="button" className="text-xs text-navy-400 hover:text-red-600" onClick={() => { if (confirm('Delete this expense?')) run(() => fin.deleteExpense(e.id), 'Deleted'); }}>Delete</button>}
                {s === 'approved' && paying !== e.id && <button type="button" className="btn-primary !py-1 text-xs" onClick={() => { setPaying(e.id); setPayAcc(e.accountId ?? ''); }}>Mark paid</button>}
                {s === 'approved' && paying === e.id && (
                  <span className="flex items-center gap-1.5">
                    <select className="input !py-1 !w-auto text-xs" value={payAcc} onChange={(x) => setPayAcc(x.target.value)}><option value="">From which account…</option>{fin.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                    <input type="date" className="input !py-1 !w-auto text-xs" value={payOn} onChange={(x) => setPayOn(x.target.value)} />
                    <button type="button" disabled={!payAcc} className="btn-primary !py-1 text-xs disabled:opacity-40" onClick={() => run(() => fin.payExpense(e.id, payAcc, payOn), 'Paid').then(() => setPaying(null))}>Save</button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      {!fin.expenses.length && <p className="text-sm text-navy-400 text-center py-8">No company expenses yet.</p>}
    </div>
  );
}

/* ═══════════════════════════════ Accounts ═══════════════════════════════ */

function AccountsTab({ admin, bal }: { admin: boolean; bal: ReturnType<typeof balances> }) {
  const fin = useCompanyFinance();
  const blank = { name: '', kind: 'bank' as CompanyAccount['kind'], bankName: '', accountNo: '', openingBalance: 0, openingDate: '2026-10-01', active: true };
  const [edit, setEdit] = useState<(typeof blank & { id?: string }) | null>(null);
  const [tr, setTr] = useState({ date: iso(new Date()), fromAccount: '', toAccount: '', amount: '', note: '' });
  const [limit, setLimit] = useState(String(fin.settings.approvalAbove));
  const run = async (fn: () => Promise<void>, done: string) => { try { await fn(); toast.success(done); return true; } catch (e) { toast.error('Not saved', (e as Error).message); return false; } };
  const ICON = { cash: Banknote, bank: Landmark, card: Wallet, online: Wallet };

  return (
    <div className="space-y-5">
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="section-title">Accounts · balance today</p>
          {admin && <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1" onClick={() => setEdit({ ...blank })}><Plus size={14} /> Add account</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fin.accounts.map((a) => {
            const I = ICON[a.kind];
            return (
              <div key={a.id} className={`rounded-2xl border p-4 ${a.active ? 'border-navy-100' : 'border-dashed border-navy-200 opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-navy-800 flex items-center gap-1.5"><I size={16} /> {a.name}</p>
                  {admin && <button type="button" className="text-xs text-navy-400 hover:text-navy-800" onClick={() => setEdit({ ...blank, ...a, bankName: a.bankName ?? '', accountNo: a.accountNo ?? '' })}>Edit</button>}
                </div>
                <p className="text-2xl font-bold text-navy-900 mt-1">{rs(bal.byAccount.get(a.id) ?? 0)}</p>
                <p className="text-xs text-navy-400">{[a.bankName, a.accountNo].filter(Boolean).join(' · ') || a.kind} · opening {rs(a.openingBalance)} on {fmtDay(a.openingDate)}</p>
              </div>
            );
          })}
          {bal.unassigned !== 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="font-semibold text-amber-900">Not assigned to an account</p>
              <p className="text-2xl font-bold text-amber-900 mt-1">{rs(bal.unassigned)}</p>
              <p className="text-xs text-amber-800">Payments whose method has no usual account — set them below.</p>
            </div>
          )}
          {!fin.accounts.length && <p className="text-sm text-navy-400">No accounts yet. {admin ? 'Add the cash box and each bank account with its balance on the start date.' : 'An admin adds them.'}</p>}
        </div>
        {edit && (
          <div className="mt-4 rounded-xl border border-navy-200 p-3 grid gap-2 sm:grid-cols-3">
            <label className="text-xs text-navy-500">Name<input className="input !py-1.5 mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. BOC current account" /></label>
            <label className="text-xs text-navy-500">Kind<select className="input !py-1.5 mt-1" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as CompanyAccount['kind'] })}><option value="cash">Cash box</option><option value="bank">Bank account</option><option value="card">Card / POS</option><option value="online">Online (e.g. payment gateway)</option></select></label>
            <label className="text-xs text-navy-500">Bank<input className="input !py-1.5 mt-1" value={edit.bankName} onChange={(e) => setEdit({ ...edit, bankName: e.target.value })} /></label>
            <label className="text-xs text-navy-500">Account no.<input className="input !py-1.5 mt-1" value={edit.accountNo} onChange={(e) => setEdit({ ...edit, accountNo: e.target.value })} /></label>
            <label className="text-xs text-navy-500">Opening balance (Rs)<input type="number" className="input !py-1.5 mt-1" value={edit.openingBalance} onChange={(e) => setEdit({ ...edit, openingBalance: Number(e.target.value) || 0 })} /></label>
            <label className="text-xs text-navy-500">On<input type="date" className="input !py-1.5 mt-1" value={edit.openingDate} onChange={(e) => setEdit({ ...edit, openingDate: e.target.value })} /></label>
            <label className="text-xs text-navy-700 flex items-center gap-1.5"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> In use</label>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setEdit(null)}>Cancel</button>
              <button type="button" className="btn-primary !py-1.5 text-sm" disabled={!edit.name.trim()} onClick={() => run(() => fin.saveAccount(edit), 'Account saved').then((ok) => ok && setEdit(null))}>Save</button>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <section className="card">
          <p className="section-title mb-1">Move money between accounts</p>
          <p className="text-xs text-navy-400 mb-3">e.g. cash banked, or cash taken from the bank.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-navy-500">From<select className="input !py-1.5 mt-1" value={tr.fromAccount} onChange={(e) => setTr({ ...tr, fromAccount: e.target.value })}><option value="">Choose…</option>{fin.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="text-xs text-navy-500">To<select className="input !py-1.5 mt-1" value={tr.toAccount} onChange={(e) => setTr({ ...tr, toAccount: e.target.value })}><option value="">Choose…</option>{fin.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="text-xs text-navy-500">Amount (Rs)<input type="number" min={0} className="input !py-1.5 mt-1" value={tr.amount} onChange={(e) => setTr({ ...tr, amount: e.target.value })} /></label>
            <label className="text-xs text-navy-500">Date<input type="date" className="input !py-1.5 mt-1" value={tr.date} onChange={(e) => setTr({ ...tr, date: e.target.value })} /></label>
            <input className="input !py-1.5 sm:col-span-2" placeholder="Note (e.g. deposit slip no.)" value={tr.note} onChange={(e) => setTr({ ...tr, note: e.target.value })} />
            <button type="button" className="btn-primary !py-1.5 text-sm sm:col-span-2" disabled={!tr.fromAccount || !tr.toAccount || !(Number(tr.amount) > 0)}
              onClick={() => run(() => fin.addTransfer({ date: tr.date, fromAccount: tr.fromAccount, toAccount: tr.toAccount, amount: Number(tr.amount), note: tr.note || undefined }), 'Transfer recorded').then((ok) => ok && setTr({ ...tr, amount: '', note: '' }))}>Record transfer</button>
          </div>
          {fin.transfers.length > 0 && (
            <div className="mt-4 divide-y divide-navy-50 text-xs">
              {fin.transfers.slice(0, 10).map((t) => (
                <p key={t.id} className="py-1.5 flex justify-between gap-2"><span>{fmtDay(t.date)} · {fin.accounts.find((a) => a.id === t.fromAccount)?.name} → {fin.accounts.find((a) => a.id === t.toAccount)?.name}{t.note ? ` · ${t.note}` : ''} · {t.byName}</span><b>{rs(t.amount)}</b></p>
              ))}
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <p className="section-title">Settings</p>
          <div>
            <p className="text-xs text-navy-500 mb-1">The usual account for each payment method — payments that don't name an account go here.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PAY_METHODS.map((m) => (
                <label key={m} className="text-xs text-navy-500">{m}
                  <select className="input !py-1.5 mt-1" disabled={!admin} value={fin.settings.methodAccounts[m] ?? ''}
                          onChange={(e) => run(() => fin.saveSettings({ ...fin.settings, methodAccounts: { ...fin.settings.methodAccounts, [m]: e.target.value } }), 'Saved')}>
                    <option value="">Not set</option>{fin.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs text-navy-500">Company expenses over this need Brian's approval (Rs)
              <input type="number" className="input !py-1.5 mt-1" disabled={!admin} value={limit} onChange={(e) => setLimit(e.target.value)} />
            </label>
            {admin && <button type="button" className="btn-secondary !py-2 text-sm" disabled={Number(limit) === fin.settings.approvalAbove}
              onClick={() => run(() => fin.saveSettings({ ...fin.settings, approvalAbove: Math.max(0, Number(limit) || 0) }), 'Approval limit saved')}>Save</button>}
          </div>
          {!admin && <p className="text-[11px] text-navy-400">Only an admin changes these.</p>}
        </section>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ Month close ═══════════════════════════════ */

function MonthsTab({ books, ledger, admin, bal, held }: { books: Books; ledger: ReturnType<typeof buildLedger>; admin: boolean; bal: ReturnType<typeof balances>; held: ReturnType<typeof heldForOthers> }) {
  const fin = useCompanyFinance();
  const now = new Date();
  const months: string[] = [];
  for (let d = new Date(`${books.from}T00:00:00`); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  months.reverse();
  const figs = (p: string) => { const [y, m] = p.split('-').map(Number); return periodFigures(books, ledger, `${p}-01`, iso(new Date(y, m, 0)), true); };
  const SUM: [string, string][] = [['collected', 'Collected'], ['rentalProfit', 'Rental profit'], ['running', 'Running costs'], ['runningPrivate', 'Private costs'], ['badDebt', 'Bad debt'], ['profit', 'Profit'], ['cash', 'Cash in accounts'], ['owed', 'Owed to owners'], ['deposits', 'Deposits held']];

  const close = async (p: string) => {
    const f = figs(p);
    const pending = books.companyExpenses.filter((e) => e.status === 'pending' && e.date.startsWith(p)).length;
    if (pending && !confirm(`${pending} company expense${pending === 1 ? ' is' : 's are'} still waiting for approval in ${periodLabel(p)}. Close anyway?`)) return;
    if (!confirm(`Close ${periodLabel(p)}? Its figures are kept, and its company expenses and transfers are locked.`)) return;
    try {
      await fin.closeMonth(p, { collected: f.collected, rentalProfit: f.rentalProfit, running: f.running, runningPrivate: f.runningPrivate, badDebt: f.badDebt, profit: f.profit, cash: bal.total, owed: held.owed, deposits: held.deposits });
      toast.success(`${periodLabel(p)} closed`);
    } catch (e) { toast.error('Not closed', (e as Error).message); }
  };

  return (
    <div className="card">
      <p className="section-title">Month close</p>
      <p className="text-xs text-navy-400 mb-3">Once the accountant has checked a month, close it: its figures are saved as they were, and its company expenses and transfers can no longer be added or changed. An admin can reopen it.</p>
      <div className="divide-y divide-navy-50">
        {months.map((p) => {
          const c = fin.closes.find((x) => x.period === p);
          const live = figs(p);
          const current = p === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          return (
            <div key={p} className="py-3 flex flex-wrap items-center gap-3">
              <span className="w-36 font-semibold text-navy-800 flex items-center gap-1.5">{c ? <Lock size={14} className="text-emerald-600" /> : <Unlock size={14} className="text-navy-300" />}{periodLabel(p)}</span>
              <span className="flex-1 min-w-[18rem] text-xs text-navy-500">
                {c ? <>Closed by {c.closedBy} on {fmtDay(c.closedAt)} · profit <b className="text-navy-800">{rs(c.summary.profit ?? 0)}</b> · rental profit {rs(c.summary.rentalProfit ?? 0)} · collected {rs(c.summary.collected ?? 0)}
                  {Math.round(live.profit) !== Math.round(c.summary.profit ?? 0) && <span className="block text-amber-700">Bookings changed since it was closed: profit now {rs(live.profit)}.</span>}</>
                  : <>Open · profit so far {rs(live.profit)} · {live.bookings} rental{live.bookings === 1 ? '' : 's'} completed</>}
              </span>
              {admin && !c && !current && <button type="button" className="btn-primary !py-1 text-xs inline-flex items-center gap-1" onClick={() => close(p)}><CheckCircle2 size={13} /> Close month</button>}
              {admin && c && <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => { if (confirm(`Reopen ${periodLabel(p)}?`)) fin.reopenMonth(p).then(() => toast.success('Reopened')).catch((e) => toast.error('Not reopened', (e as Error).message)); }}>Reopen</button>}
              {current && !c && <span className="text-xs text-navy-400">Closes after the month ends</span>}
            </div>
          );
        })}
      </div>
      {fin.closes.length > 0 && (
        <details className="mt-4 text-xs"><summary className="cursor-pointer text-navy-500">Saved figures of closed months</summary>
          <div className="overflow-x-auto mt-2"><table className="min-w-[40rem] w-full">
            <thead><tr className="text-navy-400 text-left"><th className="py-1">Month</th>{SUM.map(([, l]) => <th key={l} className="text-right">{l}</th>)}</tr></thead>
            <tbody>{fin.closes.map((c) => <tr key={c.period} className="border-t border-navy-50"><td className="py-1">{periodLabel(c.period)}</td>{SUM.map(([k]) => <td key={k} className="text-right">{rs(c.summary[k] ?? 0)}</td>)}</tr>)}</tbody>
          </table></div>
        </details>
      )}
    </div>
  );
}
