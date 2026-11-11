import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, RefreshCw } from 'lucide-react';
import BookingDetailsModal from './BookingDetailsModal';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import Modal from './Modal';
import { bookingNo } from '../../lib/bookingRecord';
import { shareBaseOf, shareWorking } from '../../lib/companyShare';
import { KIND_LABEL, balanceDetail, heldDetail, profitRows, type Books, type LedgerEntry, type PeriodFigures, type ProfitRow } from '../../lib/ledger';

/*
 * Company accounts → click any figure: how that number was worked out, down to the bookings, accounts and
 * expenses behind it. Read-only; every booking opens its own page.
 */

export type FigureKey = 'cash' | 'owed' | 'deposits' | 'unpaid' | 'own'
  | 'commission' | 'other' | 'depositKept' | 'carried' | 'rentalProfit' | 'running' | 'private' | 'badDebt' | 'profit'
  | 'collected' | 'depositsIn' | 'depositsOut';

const rs = (n: number) => `${n < 0 ? '− ' : ''}Rs ${Math.abs(Math.round(n)).toLocaleString('en-LK')}`;
const fmtDay = (d?: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** a worked sum: each line with its sign, then the result */
function Sum({ lines, result }: { lines: [string, number, ('+' | '−')?][]; result: [string, number] }) {
  return (
    <div className="rounded-xl bg-navy-50/70 px-4 py-3 text-sm tabular-nums">
      {lines.map(([l, v, op], i) => (
        <div key={i} className="flex justify-between gap-4 py-0.5">
          <span className="text-navy-600"><span className="inline-block w-4 text-navy-400">{i === 0 ? '' : op ?? '+'}</span>{l}</span>
          <span className="text-navy-800">{rs(v)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-navy-200 mt-1.5 pt-1.5 font-bold text-navy-900">
        <span><span className="inline-block w-4">=</span>{result[0]}</span><span>{rs(result[1])}</span>
      </div>
    </div>
  );
}

function List({ title, children, empty }: { title: string; children: ReactNode; empty?: boolean }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-400 mb-1">{title}</p>
      {empty ? <p className="text-sm text-navy-400 py-2">Nothing in this one.</p> : <div className="divide-y divide-navy-50 max-h-[50vh] overflow-y-auto">{children}</div>}
    </div>
  );
}

/** opens a booking's full record over the panel */
const OpenBooking = createContext<(id: string) => void>(() => undefined);

/** a clickable row that opens its booking (or a plain row) */
function Opener({ id, className, children }: { id?: string; className: string; children: ReactNode }) {
  const open = useContext(OpenBooking);
  if (!id) return <div className={className}>{children}</div>;
  return (
    <div role="button" tabIndex={0} title="Open the booking — payments first" onClick={() => open(id)}
         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id); } }}
         className={`${className} cursor-pointer hover:bg-navy-50/70`}>{children}</div>
  );
}

/** a row that opens into a short list of the entries behind it; each entry opens its booking */
function Group({ title, sub, amount, entries }: { title: ReactNode; sub?: ReactNode; amount: number; entries: LedgerEntry[] }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, 15);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="w-full text-left flex items-start justify-between gap-3 py-2 px-1 rounded hover:bg-navy-50/70">
        <div className="min-w-0 flex items-start gap-1.5">
          <ChevronDown size={15} className={`mt-0.5 flex-shrink-0 text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          <div className="min-w-0"><p className="text-sm text-navy-800">{title}</p>{sub && <p className="text-xs text-navy-400">{sub}{!open && entries.length ? ' · click to see them' : ''}</p>}</div>
        </div>
        <p className={`text-sm font-semibold whitespace-nowrap tabular-nums ${amount < 0 ? 'text-red-600' : 'text-navy-800'}`}>{rs(amount)}</p>
      </button>
      {open && (
        <div className="ml-6 mb-2 rounded-lg border border-navy-100 divide-y divide-navy-50">
          {shown.map((e) => (
            <Opener key={e.id} id={e.bookingId} className="flex items-start justify-between gap-3 px-2 py-1.5">
              <div className="min-w-0">
                <p className="text-xs text-navy-800 truncate">{e.label}</p>
                <p className="text-[11px] text-navy-400">{fmtDay(e.date)}{e.method ? ` · ${e.method}` : ''}{e.ref ? ` · ref ${e.ref}` : ''}{e.detail ? ` · ${e.detail.split(' · ')[0]}` : ''}</p>
              </div>
              <p className={`text-xs font-semibold whitespace-nowrap tabular-nums ${e.amount < 0 ? 'text-red-600' : 'text-navy-800'}`}>{rs(e.amount)}</p>
            </Opener>
          ))}
          {!entries.length && <p className="text-xs text-navy-400 px-2 py-1.5">No entries.</p>}
          {entries.length > 15 && <button type="button" onClick={() => setAll((a) => !a)} className="w-full text-xs text-navy-500 underline py-1.5">{all ? 'Show fewer' : `Show all ${entries.length}`}</button>}
        </div>
      )}
    </div>
  );
}

function Item({ to, title, sub, amount, warn }: { to?: string; title: ReactNode; sub?: ReactNode; amount: number; warn?: boolean; onGo?: () => void }) {
  const body = (
    <>
      <div className="min-w-0"><p className="text-sm text-navy-800 truncate">{title}</p>{sub && <p className="text-xs text-navy-400">{sub}</p>}</div>
      <p className={`text-sm font-semibold whitespace-nowrap tabular-nums ${warn || amount < 0 ? 'text-red-600' : 'text-navy-800'}`}>{rs(amount)}</p>
    </>
  );
  const cls = `flex items-start justify-between gap-3 py-2 px-1 rounded ${warn ? 'bg-red-50/60' : ''}`;
  return <Opener id={to?.startsWith('/bookings/') ? to.slice('/bookings/'.length) : undefined} className={cls}>{body}</Opener>;
}

const Note = ({ children }: { children: ReactNode }) => <p className="text-sm text-navy-600 mb-3">{children}</p>;
const Warn = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800 flex gap-2"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /><span>{children}</span></p>
);

/** one rental's working, written out: bill − owners − fee − commission = other */
const rowWorking = (r: ProfitRow) => [
  `bill ${rs(r.bill)}${r.charges || r.discount ? ` (rent ${rs(r.rent)}${r.charges ? ` + charges ${rs(r.charges)}` : ''}${r.discount ? ` − discount ${rs(r.discount)}` : ''})` : ''}`,
  `− owner${r.ownerLines.length > 1 ? 's' : ''} ${rs(r.owners)}`,
  r.fee ? `− referral fee ${rs(r.fee)}` : '',
  `− commission ${rs(r.commission)}`,
  r.carried ? `+ deductions carried ${rs(r.carried)}` : '',
].filter(Boolean).join(' ');

/** one step of a rental's working */
function Step({ n, label, how, v, bold, red }: { n: string; label: string; how?: ReactNode; v: number; bold?: boolean; red?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="min-w-0"><p className={`text-sm ${bold ? 'font-semibold text-navy-900' : 'text-navy-700'}`}><span className="inline-block w-5 text-navy-400">{n}</span>{label}</p>
        {how && <p className="text-xs text-navy-400 pl-5">{how}</p>}</div>
      <p className={`text-sm tabular-nums whitespace-nowrap ${red ? 'text-red-600 font-semibold' : bold ? 'font-bold text-navy-900' : 'text-navy-800'}`}>{rs(v)}</p>
    </div>
  );
}

/** one completed rental, step by step: the bill → the company's commission → the owner's share → what the company keeps */
function RentalCard({ r, highlight }: { r: ProfitRow; highlight: [string, number]; onGo?: () => void }) {
  const c = r.check;
  const keeps = r.bill - r.owners - r.fee;
  const comOff = !!c && Math.abs(c.savedCommission - c.commission) >= 0.5;
  const ownOff = !!c && Math.abs(c.savedOwner - c.owner) >= 0.5;
  const fix = () => { useStore.getState().refreshPayout(r.b.id); toast.success('Worked out again', `${r.b.customerName}: the commission and the owner's share now follow the final bill.`); };
  // an accordion: the rental on one line, its working when opened (out-of-date ones start open)
  const [open, setOpen] = useState(!!c?.stale);
  const openBooking = useContext(OpenBooking);
  return (
    <div className={`rounded-xl border ${c?.stale ? 'border-red-200 bg-red-50/30' : 'border-navy-100'}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="w-full text-left flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-navy-50/60">
        <div className="min-w-0 flex items-start gap-1.5">
          <ChevronDown size={15} className={`mt-0.5 flex-shrink-0 text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          <div className="min-w-0">
            <p className="text-sm truncate"><b className="text-navy-900">{r.b.customerName}</b> <span className="text-navy-400">· {bookingNo(r.b)}</span>{c?.stale && <span className="ml-1.5 text-[11px] font-semibold text-red-600">out of date</span>}</p>
            <p className="text-xs text-navy-400 truncate">{r.car} · completed {fmtDay(r.on)} · bill {rs(r.bill)}</p>
          </div>
        </div>
        <div className="text-right flex-shrink-0"><p className="text-[11px] text-navy-400">{highlight[0]}</p><p className={`text-sm font-bold tabular-nums ${highlight[1] < 0 ? 'text-red-600' : 'text-navy-900'}`}>{rs(highlight[1])}</p></div>
      </button>
      {open && <div className="px-3 pb-3">
      <div className="border-t border-navy-100 pt-1">
        <Step n="1" label="Customer's final bill" v={r.bill}
          how={r.charges || r.discount ? <>rent {rs(r.rent)}{r.charges ? <> + charges {rs(r.charges)}</> : null}{r.discount ? <> − discount {rs(r.discount)}</> : null}</> : 'the rent'} />
        <Step n="2" label="Company commission" v={r.commission} red={comOff}
          how={r.b.companyShareType ? <>{shareWorking(r.b, shareBaseOf(r.b))}{comOff ? <> → should be <b>{rs(c!.commission)}</b></> : null}</> : 'no commission method on this booking'} />
        <Step n="3" label={`Owner's share${r.ownerLines.length > 1 ? ` (${r.ownerLines.length} lines)` : ''}`} v={r.owners} red={ownOff}
          how={c ? <>should be bill − commission{r.fee ? ' − referral fee' : ''} = <b>{rs(c.owner)}</b>{r.ownerLines.some((l) => l.paidByHand) ? ' · marked paid by hand' : ''}</> : r.ownerLines.map((l) => `${l.name} ${rs(l.amount)}`).join(' · ')} />
        {r.fee > 0 && <Step n="" label="Old referral fee" v={r.fee} />}
        <Step n="=" label="Company keeps" how="bill − owner's share" v={keeps} bold red={keeps < 0} />
        {Math.abs(keeps - r.commission) >= 0.5 && <p className="text-xs text-navy-500 pl-5">= commission {rs(r.commission)} {keeps - r.commission >= 0 ? '+' : '−'} {rs(Math.abs(keeps - r.commission))} "other income"</p>}
      </div>
      <button type="button" onClick={() => openBooking(r.b.id)} className="mt-1 text-xs text-navy-500 hover:text-navy-800 underline">View the booking's payments</button>
      {c?.stale && (
        <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
          <p className="flex gap-1.5"><AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /><span>
            The saved figures are out of date: the owner is down for <b>{rs(c.savedOwner)}</b>{Math.abs(c.savedOwner - r.bill) < 0.5 ? ' (the whole bill)' : ''} and the commission is <b>{rs(c.savedCommission)}</b>.
            On the final bill they should be: commission <b>{rs(c.commission)}</b>, owner <b>{rs(c.owner)}</b>.
            This happens when a booking is changed or completed on the live site while it still runs the old version, which gives the owner the whole rent.</span></p>
          {c.fixable ? <button type="button" onClick={fix} className="mt-2 btn-primary !py-1 text-xs inline-flex items-center gap-1"><RefreshCw size={12} /> Work it out again</button>
            : <p className="mt-1 font-semibold">{c.why === 'settled' ? 'Already settled with the owner. Add an adjustment on Owner payouts instead.' : 'The payout is marked paid by hand. Reopen it on the booking first, then work it out again.'}</p>}
        </div>
      )}
      </div>}
    </div>
  );
}

/** finished / cancelled trips whose deposit was never marked returned or kept — not counted as held; settle them here */
function UnsettledDeposits({ rows }: { rows: { b: ProfitRow['b']; amount: number; car: string }[] }) {
  const open = useContext(OpenBooking);
  const by = useAuthStore((x) => x.currentUser?.name) ?? 'Admin';
  const returned = (r: { b: ProfitRow['b']; amount: number }) => {
    if (!confirm(`Was ${r.b.customerName}'s deposit of ${rs(r.amount)} given back at the end of the trip?

It is recorded as returned (cash, today's entry). If part of it was kept, open the booking and settle it there instead.`)) return;
    useStore.getState().settleDeposit(r.b.id, { returned: r.amount, deduction: 0, method: 'Cash', notes: 'Recorded later — returned at the end of the trip' }, by);
  };
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5"><AlertTriangle size={14} /> Finished trips with a deposit not settled · {rows.length}</p>
      <p className="text-xs text-amber-800 mb-2">A deposit is settled when the trip ends, so these are <b>not</b> counted as held. Record what happened to each one.</p>
      <div className="divide-y divide-amber-100">
        {rows.map((r) => (
          <div key={r.b.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="flex-1 min-w-[12rem]"><b className="text-navy-900">{r.b.customerName}</b> <span className="text-navy-400">· {bookingNo(r.b)} · {r.b.status}{r.car ? ` · ${r.car}` : ''}</span></span>
            <b className="tabular-nums text-amber-900">{rs(r.amount)}</b>
            <button type="button" className="btn-primary !py-1 text-xs" onClick={() => returned(r)}>It was returned</button>
            <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => open(r.b.id)}>Open to settle</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FixAll({ rows }: { rows: ProfitRow[] }) {
  const fixable = rows.filter((r) => r.check?.fixable);
  if (!fixable.length) return null;
  const run = () => { fixable.forEach((r) => useStore.getState().refreshPayout(r.b.id)); toast.success('Worked out again', `${fixable.length} rental${fixable.length === 1 ? '' : 's'} now follow the final bill.`); };
  return (
    <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 flex flex-wrap items-center justify-between gap-2">
      <span><b>{fixable.length}</b> rental{fixable.length === 1 ? ' has' : 's have'} an out-of-date commission or owner's share (in red below).</span>
      <button type="button" onClick={run} className="btn-primary !py-1 text-xs inline-flex items-center gap-1"><RefreshCw size={12} /> Work {fixable.length === 1 ? 'it' : 'them all'} out again</button>
    </div>
  );
}

export default function FigureExplain({ k, onClose, books, ledger, f, start, end, periodText, admin }: {
  k: FigureKey | null; onClose: () => void; books: Books; ledger: LedgerEntry[]; f: PeriodFigures;
  start: string; end: string; periodText: string; admin: boolean;
}) {
  const rows = useMemo(() => profitRows(books, start, end), [books, start, end]);
  const held = useMemo(() => heldDetail(books), [books]);
  const bal = useMemo(() => balanceDetail(books, ledger), [books, ledger]);
  const [viewing, setViewing] = useState<string | null>(null);
  const navigate = useNavigate();
  if (!k) return null;

  const go = onClose;
  const bk = (r: { b: ProfitRow['b'] }) => `/bookings/${r.b.id}`;
  const cashTotal = bal.accounts.reduce((s, a) => s + a.balance, 0) + bal.unassigned.reduce((s, u) => s + u.amount, 0);
  const owed = held.owners.reduce((s, o) => s + Math.max(0, o.net), 0);
  const deps = held.deposits.reduce((s, r) => s + r.amount, 0);
  const unpaid = held.unpaid.reduce((s, e) => s + e.amount, 0);
  const inP = (x: string) => x >= start && x <= end;
  const ce = books.companyExpenses.filter((e) => (e.status === 'approved' || e.status === 'paid') && inP(e.date));
  const ledgerList = (kinds: LedgerEntry['kind'][], title: string) => {
    const es = ledger.filter((e) => kinds.includes(e.kind) && inP(e.date));
    return (
      <List title={`${title} · ${es.length}`} empty={!es.length}>
        {es.map((e) => <Item key={e.id} to={e.bookingId ? `/bookings/${e.bookingId}` : undefined} onGo={go} title={e.label}
          sub={`${fmtDay(e.date)} · ${KIND_LABEL[e.kind]}${e.method ? ` · ${e.method}` : ''}${e.ref ? ` · ref ${e.ref}` : ''}${e.detail ? ` · ${e.detail}` : ''}`} amount={Math.abs(e.amount)} warn={e.kind === 'refund'} />)}
      </List>
    );
  };
  const rentals = (pick: (r: ProfitRow) => number, title: string, sub: (r: ProfitRow) => ReactNode, keep = (r: ProfitRow) => pick(r) !== 0) => {
    const list = rows.filter(keep);
    return (
      <List title={`${title} · ${list.length}`} empty={!list.length}>
        {list.map((r) => <Item key={r.b.id} to={bk(r)} onGo={go} title={<><b>{r.b.customerName}</b> <span className="text-navy-400">· {bookingNo(r.b)} · {r.car}</span></>}
          sub={<>{fmtDay(r.on)} · {sub(r)}</>} amount={pick(r)} warn={pick(r) < 0} />)}
      </List>
    );
  };
  const cards = (pick: (r: ProfitRow) => number, label: string) => (
    <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
      {rows.map((r) => <RentalCard key={r.b.id} r={r} highlight={[label, pick(r)]} onGo={go} />)}
      {!rows.length && <p className="text-sm text-navy-400 py-2">No rentals completed in this period.</p>}
    </div>
  );

  const C: Record<FigureKey, [string, ReactNode]> = {
    cash: ['Money in our accounts', <>
      <Note>Each account starts from its opening balance and adds every payment in and takes off every payment out since its opening date. Payments recorded without an account (from {fmtDay(books.from)}) are counted as "not assigned".</Note>
      <Sum lines={[...bal.accounts.map((x) => [x.a.name, x.balance] as [string, number]), ...(bal.unassigned.length ? [['Not assigned to an account', bal.unassigned.reduce((s, u) => s + u.amount, 0)] as [string, number]] : [])]}
        result={['Money in our accounts', cashTotal]} />
      {bal.accounts.length > 0 && <List title="Accounts">
        {bal.accounts.map((x) => <Group key={x.a.id} title={<b>{x.a.name}</b>} sub={`opening ${rs(x.a.openingBalance)} on ${fmtDay(x.a.openingDate)} + in ${rs(x.moneyIn)} − out ${rs(x.moneyOut)} · ${x.count} movement${x.count === 1 ? '' : 's'}`} amount={x.balance}
          entries={ledger.filter((e) => e.amount && e.accountId === x.a.id && e.date >= x.a.openingDate)} />)}
      </List>}
      {bal.unassigned.length > 0 && <List title="Not assigned to an account — by type">
        {bal.unassigned.map((u) => <Group key={u.kind} title={u.kind === 'deposit_in' ? 'Customer deposits — received − given back − used for bills' : KIND_LABEL[u.kind]}
          sub={u.kind === 'deposit_in' ? `${u.count} entries · still held: ${rs(deps)} on trips confirmed or on rent${held.unsettled.length ? ` + ${rs(held.unsettled.reduce((s, r) => s + r.amount, 0))} on finished trips not settled` : ''}` : `${u.count} entr${u.count === 1 ? 'y' : 'ies'}`}
          amount={u.amount} entries={bal.looseEntries.filter((e) => bal.groupOf(e.kind) === u.kind)} />)}
      </List>}
      {!bal.accounts.length && <Warn>No company accounts are set up yet, so all of this is "not assigned" — it's every payment, deposit, refund and payout recorded since {fmtDay(books.from)}, not a bank balance. Add the cash box and bank accounts (Accounts tab) with their balances on {fmtDay(books.from)}, and this becomes the real money you hold.</Warn>}
    </>],
    owed: ["Owed to owners", <>
      <Note>For each owner: their share of every rental completed (and not yet paid) up to now − vehicle expenses the company paid for their cars. These are the lines of their next monthly payout.</Note>
      <Sum lines={held.owners.map((o) => [o.owner.name, Math.max(0, o.net)] as [string, number])} result={['Owed to owners', owed]} />
      {held.owners.map((o) => (
        <List key={o.owner.id} title={`${o.owner.name} · rentals ${rs(o.rentals)}${o.deductions ? ` · adjustments ${rs(o.deductions)}` : ''}${o.expenses ? ` − expenses ${rs(o.expenses)}` : ''} = ${rs(o.net)}`}>
          {o.lines.map((l) => <Item key={l.id} to={l.bookingId ? `/bookings/${l.bookingId}` : undefined} onGo={go} title={l.label} sub={`${fmtDay(l.date)} · ${l.detail ?? ''}`} amount={l.amount} />)}
        </List>
      ))}
      {held.owners.some((o) => o.net < 0) && <Warn>An owner whose expenses are more than their rentals is counted as 0 here (they owe the company, not the other way).</Warn>}
    </>],
    deposits: ['Customer deposits held', <>
      <Note>Security deposits on bookings that are <b>confirmed or on rent</b> — received − returned − kept or used for the bill. This money is the customers' until it's settled at the end of the trip.</Note>
      <List title={`Bookings holding a deposit · ${held.deposits.length}`} empty={!held.deposits.length}>
        {held.deposits.map((r) => <Item key={r.b.id} to={`/bookings/${r.b.id}`} onGo={go} title={<><b>{r.b.customerName}</b> <span className="text-navy-400">· {bookingNo(r.b)}</span></>}
          sub={`${r.b.status}${r.car ? ` · ${r.car}` : ''}`} amount={r.amount} />)}
      </List>
      <Sum lines={[['Deposits held', deps]]} result={['Customer deposits held', deps]} />
      {held.unsettled.length > 0 && <UnsettledDeposits rows={held.unsettled} />}
    </>],
    unpaid: ['Approved expenses not paid', <>
      <Note>Company expenses that were approved but haven't been marked paid yet.</Note>
      <List title={`Expenses · ${held.unpaid.length}`} empty={!held.unpaid.length}>
        {held.unpaid.map((e) => <Item key={e.id} title={e.category} sub={`${fmtDay(e.date)} · ${e.description}`} amount={e.amount} />)}
      </List>
    </>],
    own: ["Company's own money", <>
      <Note>The money in the accounts that is really the company's: take off what belongs to the owners, the customers' deposits and the bills already approved.</Note>
      <Sum lines={[['Money in our accounts', cashTotal], ['Owed to owners', owed, '−'], ['Customer deposits held', deps, '−'], ['Approved expenses not paid', unpaid, '−']]}
        result={["Company's own money", cashTotal - owed - deps - unpaid]} />
      {!books.accounts.length && <Warn>"Money in our accounts" is only the money recorded since {fmtDay(books.from)} (no accounts set up yet), so this figure isn't the real position until the accounts and their opening balances are added.</Warn>}
    </>],
    commission: ['Company commission', <>
      <Note>The company's commission on each rental completed {periodText}. It's worked out on the customer's final bill with the method saved on the booking (e.g. 15%, but at least Rs 1,000 a day).</Note>
      <FixAll rows={rows} />
      {cards((r) => r.commission, 'Commission')}
      <div className="mt-3" /><Sum lines={[['Commission on these rentals', f.commission]]} result={['Company commission', f.commission]} />
    </>],
    other: ['Other rental income', <>
      <Note>On each rental the company keeps the bill minus what the owner gets. Normally that is exactly the commission, so "other income" is <b>Rs 0</b>. It's more only on company-owned cars and older bookings. It goes <b>below 0</b> when the owner is down for more than the bill minus the commission, which means the owner's share is out of date.</Note>
      <FixAll rows={rows} />
      {cards((r) => r.other, 'Other income')}
      <div className="mt-3" /><Sum lines={[['Company keeps on these rentals', f.commission + f.otherIncome], ['Company commission', f.commission, '−']]} result={['Other rental income', f.otherIncome]} />
    </>],
    depositKept: ['Deposit amounts kept', <>
      <Note>Parts of a security deposit the company kept (damage, fines…), not counting amounts used to pay the bill (those are already in the bill).</Note>
      {rentals((r) => r.depositKept, 'Rentals', (r) => `kept from the deposit ${rs(r.b.depositDeduction ?? 0)}`)}
    </>],
    carried: ['Costs carried on rentals', <>
      <Note>Deductions taken off a customer's bill that the company bears itself (not taken from the owner).</Note>
      {rentals((r) => r.carried, 'Rentals', rowWorking)}
    </>],
    rentalProfit: ['Rental profit', <>
      <Note>Everything the company made on the {f.bookings} rental{f.bookings === 1 ? '' : 's'} completed {periodText}.</Note>
      <Sum lines={[['Company commission', f.commission], ['Other rental income', f.otherIncome], ['Deposit amounts kept', f.depositKept], ['Costs carried on rentals', f.carried, '−']]} result={['Rental profit', f.rentalProfit]} />
      <div className="mt-3" /><FixAll rows={rows} />
      {cards((r) => r.commission + r.other + r.depositKept - r.carried, 'Profit')}
    </>],
    running: ['Company running costs', <>
      <Note>Company expenses (approved or paid) dated {periodText}{admin ? ', not counting private ones (shown separately)' : ''}.</Note>
      <List title={`Expenses · ${ce.filter((e) => !e.private).length}`} empty={!ce.some((e) => !e.private)}>
        {ce.filter((e) => !e.private).map((e) => <Item key={e.id} title={e.category} sub={`${fmtDay(e.date)} · ${e.status} · ${e.description}`} amount={e.amount} />)}
      </List>
    </>],
    private: ['Private costs', <>
      <Note>Private company expenses (such as salaries) dated {periodText} — only admins see these.</Note>
      <List title="Expenses" empty={!ce.some((e) => e.private)}>
        {(admin ? ce.filter((e) => e.private) : []).map((e) => <Item key={e.id} title={e.category} sub={`${fmtDay(e.date)} · ${e.status} · ${e.description}`} amount={e.amount} />)}
      </List>
    </>],
    badDebt: ['Bad debt written off', <>
      <Note>Balances on rentals completed {periodText} that were written off as not recoverable.</Note>
      {rentals((r) => r.badDebt, 'Rentals', (r) => `bill ${rs(r.bill)} · written off`)}
    </>],
    profit: [f.profit >= 0 ? 'Company profit' : 'Company loss', <>
      <Note>Rental profit, less the company's own costs {periodText}.</Note>
      <Sum lines={[['Rental profit', f.rentalProfit], ['Company running costs', f.running, '−'], ...(admin && f.runningPrivate ? [['Private costs', f.runningPrivate, '−'] as [string, number, '−']] : []), ...(f.badDebt ? [['Bad debt written off', f.badDebt, '−'] as [string, number, '−']] : [])]}
        result={[f.profit >= 0 ? 'Company profit' : 'Company loss', f.profit]} />
      <p className="text-xs text-navy-400 mt-3">Profit counts rentals when they're completed (whether or not the customer has paid yet). "Collected from customers" is the cash that actually came in.</p>
    </>],
    collected: ['Collected from customers', <>
      <Note>Every customer payment and advance recorded {periodText}, less refunds. Deposits are not included (they're the customer's money), and neither are amounts paid from a deposit.</Note>
      <Sum lines={[['Payments', ledger.filter((e) => e.kind === 'payment' && inP(e.date)).reduce((s, e) => s + e.amount, 0)], ['Refunds', -ledger.filter((e) => e.kind === 'refund' && inP(e.date)).reduce((s, e) => s + e.amount, 0), '−']]} result={['Collected', f.collected]} />
      {ledgerList(['payment', 'refund'], 'Payments and refunds')}
    </>],
    depositsIn: ['Deposits received', <>
      <Note>Security deposits taken from customers {periodText}.</Note>
      {ledgerList(['deposit_in'], 'Deposits')}
      <Sum lines={[['Deposits received', f.depositsIn]]} result={['Deposits received', f.depositsIn]} />
    </>],
    depositsOut: ['Deposits returned', <>
      <Note>Security deposits given back to customers {periodText}.</Note>
      {ledgerList(['deposit_out'], 'Deposits returned')}
      <Sum lines={[['Deposits returned', f.depositsOut]]} result={['Deposits returned', f.depositsOut]} />
    </>],
  };
  const [title, body] = C[k];
  return (
    <OpenBooking.Provider value={setViewing}>
      <Modal open closeOnOutside onClose={onClose} title={`How it's worked out · ${title}`} width="max-w-2xl">{body}</Modal>
      {viewing && <BookingDetailsModal bookingId={viewing} startTab="payments" onClose={() => setViewing(null)}
        onEdit={(x) => navigate(`/bookings/${x.id}`)} onCancel={(x) => navigate(`/bookings/${x.id}`)} />}
    </OpenBooking.Provider>
  );
}

