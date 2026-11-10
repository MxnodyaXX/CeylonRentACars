import type { Booking, Commission, CompanyAccount, CompanyExpense, AccountTransfer, Expense, Owner, OwnerSettlement, Vehicle } from '../types';
import { bookingNo, depositHeld, ledgerOf } from './bookingRecord';
import { bookingBill, bookingCredit, bookingDue } from './credit';
import { channelOf } from './channels';
import { completedOn, linesFor, totalsOf, periodOf } from './settlements';
import { accountFor, type FinanceSettings } from './companyFinance';
import { companyShareOf, shareBaseOf } from './companyShare';
import { legsOf, mainCommission } from './exchange';

/**
 * Is a booking's saved commission and owner share what its final bill says they should be?
 * (Edits made on an older version of the admin reset the owner's share to the whole rent — this finds those.)
 */
export interface ShareCheck {
  savedCommission: number; savedOwner: number; commission: number; owner: number;
  stale: boolean; fixable: boolean; why?: 'paid' | 'settled';
}
export function shareCheck(b: Booking, commissions: Commission[]): ShareCheck | undefined {
  if (!b.companyShareType || b.exchanges?.length || b.status === 'Cancelled') return undefined;
  const c = mainCommission(commissions, b);
  if (!c) return undefined;
  const commission = companyShareOf(b, shareBaseOf(b));
  const owner = legsOf(b)[0].payout;
  const stale = Math.abs(c.ownerPayout - owner) >= 0.5 || Math.abs((c.commissionAmount ?? 0) - commission) >= 0.5;
  const why = c.settlementId ? 'settled' as const : c.status === 'Paid' ? 'paid' as const : undefined;
  return { savedCommission: c.commissionAmount ?? 0, savedOwner: c.ownerPayout, commission, owner, stale, fixable: stale && !why, why };
}
/** every booking whose commission / owner share is out of date */
export function staleShares(d: Pick<Books, 'bookings' | 'commissions'>) {
  return d.bookings.map((b) => ({ b, check: shareCheck(b, d.commissions) })).filter((x): x is { b: Booking; check: ShareCheck } => !!x.check?.stale);
}

/*
 * The company's books, built from what the system already records:
 *   • customer payments, refunds, advances, deposits in / out / used (each booking's payment log)
 *   • owner payouts (monthly settlements), company expenses, company-paid vehicle expenses
 *   • transfers between accounts, write-offs
 * Money that belongs to others is kept apart: owners' share not paid yet, customer deposits held.
 * Profit is counted on rentals COMPLETED in the period (accrual): the bill − what the owners get.
 */

export type LedgerKind = 'payment' | 'refund' | 'deposit_in' | 'deposit_out' | 'deposit_used' | 'owner_payout'
  | 'company_expense' | 'vehicle_expense' | 'transfer' | 'write_off';
export interface LedgerEntry {
  id: string;
  date: string;             // YYYY-MM-DD
  kind: LedgerKind;
  /** money into (+) or out of (−) an account; 0 for entries that move no money (deposit used, write-off) */
  amount: number;
  accountId?: string;       // undefined = not assigned to an account
  method?: string;
  ref?: string;
  by?: string;
  bookingId?: string;
  label: string;
  detail?: string;
}

export const KIND_LABEL: Record<LedgerKind, string> = {
  payment: 'Customer payment', refund: 'Refund', deposit_in: 'Deposit received', deposit_out: 'Deposit returned',
  deposit_used: 'Deposit used for bill', owner_payout: 'Owner payout', company_expense: 'Company expense',
  vehicle_expense: 'Vehicle expense (company paid)', transfer: 'Transfer', write_off: 'Written off',
};

export interface Books {
  bookings: Booking[]; commissions: Commission[]; expenses: Expense[]; vehicles: Vehicle[]; owners: Owner[];
  settlements: OwnerSettlement[]; accounts: CompanyAccount[]; companyExpenses: CompanyExpense[]; transfers: AccountTransfer[];
  settings: FinanceSettings; from: string;   // owner payouts start date
}

const day = (iso?: string) => (iso ?? '').slice(0, 10);
const carOf = (d: Books, id?: string) => { const v = d.vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.model} ${v.vehicleNumber}` : ''; };

export function buildLedger(d: Books): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  d.bookings.forEach((b) => {
    if (b.status === 'Cancelled' && !(b.payments ?? []).length && !b.paidAmount) return;
    const car = carOf(d, b.vehicleId);
    ledgerOf(b).forEach((p) => {
      const base = { id: `${b.id}:${p.id}`, date: day(p.at), method: p.method, ref: p.receiptNo, by: p.by, bookingId: b.id,
        detail: [bookingNo(b), b.customerName, car, p.note].filter(Boolean).join(' · ') };
      const acc = accountFor(p.method, p.accountId, d.settings);
      if (p.kind === 'Payment' || p.kind === 'Advance') {
        if (p.method === 'Security deposit') out.push({ ...base, kind: 'deposit_used', amount: 0, label: `Deposit used · ${b.customerName}`, detail: `${base.detail} · Rs ${p.amount.toLocaleString('en-LK')} from the deposit` });
        else out.push({ ...base, kind: 'payment', amount: p.amount, accountId: acc, label: `${p.kind === 'Advance' ? 'Advance' : 'Payment'} · ${b.customerName}` });
      } else if (p.kind === 'Refund') out.push({ ...base, kind: 'refund', amount: -p.amount, accountId: acc, label: `Refund · ${b.customerName}` });
      else if (p.kind === 'Deposit received') out.push({ ...base, kind: 'deposit_in', amount: p.amount, accountId: acc, label: `Deposit received · ${b.customerName}` });
      else if (p.kind === 'Deposit returned') out.push({ ...base, kind: 'deposit_out', amount: -p.amount, accountId: acc, label: `Deposit returned · ${b.customerName}` });
    });
    if ((b.badDebt ?? 0) > 0) out.push({ id: `${b.id}:bad`, date: completedOn(b) || day(b.endDate), kind: 'write_off', amount: 0, bookingId: b.id,
      label: `Written off · ${b.customerName}`, detail: `${bookingNo(b)} · Rs ${(b.badDebt ?? 0).toLocaleString('en-LK')} not recoverable` });
  });
  d.settlements.filter((s) => s.status === 'paid' || s.status === 'confirmed').forEach((s) => {
    const o = d.owners.find((x) => x.id === s.ownerId);
    out.push({ id: `st:${s.id}`, date: day(s.paidAt), kind: 'owner_payout', amount: -s.net, accountId: accountFor(s.payMethod, s.payAccountId, d.settings),
      method: s.payMethod, ref: s.payRef, by: s.paidBy, label: `Owner payout · ${o?.name ?? 'Owner'}`, detail: `${s.period} · ${s.lines.length} lines` });
  });
  d.companyExpenses.filter((e) => e.status === 'paid').forEach((e) => out.push({ id: `ce:${e.id}`, date: e.paidOn ?? e.date, kind: 'company_expense',
    amount: -e.amount, accountId: e.accountId, by: e.paidBy, label: `${e.category}`, detail: e.description }));
  d.expenses.filter((e) => e.paidBy === 'company').forEach((e) => out.push({ id: `ve:${e.id}`, date: e.date, kind: 'vehicle_expense', amount: -e.amount,
    accountId: d.settings.methodAccounts.Cash, label: `${e.category} · ${carOf(d, e.vehicleId)}`, detail: `${e.description}${e.settlementId ? ' · taken off the owner\'s payout' : ' · to come off the owner\'s next payout'}` }));
  d.transfers.forEach((t) => {
    const from = d.accounts.find((a) => a.id === t.fromAccount)?.name ?? '?', to = d.accounts.find((a) => a.id === t.toAccount)?.name ?? '?';
    out.push({ id: `tr:${t.id}:out`, date: t.date, kind: 'transfer', amount: -t.amount, accountId: t.fromAccount, by: t.byName, label: `Transfer to ${to}`, detail: t.note });
    out.push({ id: `tr:${t.id}:in`, date: t.date, kind: 'transfer', amount: t.amount, accountId: t.toAccount, by: t.byName, label: `Transfer from ${from}`, detail: t.note });
  });
  return out.filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Each account's balance today (opening + everything since its opening date); 'unassigned' = payments with no account */
export function balances(d: Books, ledger: LedgerEntry[]) {
  const map = new Map<string, number>();
  d.accounts.forEach((a) => map.set(a.id, a.openingBalance));
  let unassigned = 0;
  ledger.forEach((e) => {
    if (!e.amount) return;
    const a = e.accountId ? d.accounts.find((x) => x.id === e.accountId) : undefined;
    if (a) { if (e.date >= a.openingDate) map.set(a.id, (map.get(a.id) ?? 0) + e.amount); }
    else if (e.date >= d.from) unassigned += e.amount;
  });
  return { byAccount: map, unassigned, total: [...map.values()].reduce((s, v) => s + v, 0) + unassigned };
}

/** What the company made on one completed booking: the bill − what its owners get − a referral fee */
export function bookingProfit(b: Booking, commissions: Commission[]) {
  const lines = commissions.filter((c) => c.bookingId === b.id);
  const owners = lines.reduce((s, c) => s + c.ownerPayout, 0);
  const commission = lines.reduce((s, c) => s + (c.commissionAmount ?? 0), 0);
  const companyCarried = (b.charges ?? []).filter((c) => c.status === 'Charged' && c.amount < 0 && !c.ownerAdjustmentId && !c.ownerOwedId).reduce((s, c) => s - c.amount, 0);
  const gross = bookingBill(b) - owners - (b.referralFee ?? 0);
  return { commission, companyCarried, other: gross - commission + companyCarried, gross };
}

export interface PeriodFigures {
  collected: number; depositsIn: number; depositsOut: number;
  commission: number; otherIncome: number; depositKept: number; carried: number; rentalProfit: number;
  running: number; runningPrivate: number; badDebt: number; discounts: number; profit: number; bookings: number;
}

/** One completed rental's part in the profit — every figure the profit box adds up, per booking */
export interface ProfitRow {
  b: Booking; on: string; car: string;
  rent: number; charges: number; discount: number; bill: number;
  /** each owner payout line on the booking (the main car, replacement cars, adjustments) */
  ownerLines: { name: string; amount: number; note?: string; paidByHand: boolean }[];
  owners: number; fee: number; commission: number; carried: number; other: number; depositKept: number; badDebt: number;
  /** what the commission and owner share should be on the final bill (undefined: no commission method / exchanged car) */
  check?: ShareCheck;
}

/** The completed rentals of a period, each worked out: bill − owners − fee = what the company kept (commission + other) */
export function profitRows(d: Books, start: string, end: string): ProfitRow[] {
  const out: ProfitRow[] = [];
  d.bookings.forEach((b) => {
    if (b.status !== 'Completed') return;
    const on = completedOn(b);
    if (!(on >= start && on <= end)) return;
    const p = bookingProfit(b, d.commissions);
    const lines = d.commissions.filter((c) => c.bookingId === b.id);
    const usedForBill = (b.payments ?? []).filter((x) => x.kind === 'Payment' && x.method === 'Security deposit').reduce((s, x) => s + x.amount, 0);
    out.push({
      b, on, car: carOf(d, b.vehicleId) || 'Vehicle removed',
      rent: b.totalAmount, charges: b.extraCharges ?? 0, discount: b.discount ?? 0, bill: bookingBill(b),
      ownerLines: lines.map((c) => ({ name: d.owners.find((o) => o.id === c.ownerId)?.name ?? 'Owner', amount: c.ownerPayout, note: c.note,
        paidByHand: c.status === 'Paid' && !c.settlementId })),
      owners: lines.reduce((s, c) => s + c.ownerPayout, 0), fee: b.referralFee ?? 0,
      commission: p.commission, carried: p.companyCarried, other: p.other,
      depositKept: Math.max(0, (b.depositDeduction ?? 0) - usedForBill), badDebt: b.badDebt ?? 0,
      check: shareCheck(b, d.commissions),
    });
  });
  return out.sort((a, b) => a.on.localeCompare(b.on));
}

/** Profit and cash for a period (dates YYYY-MM-DD, inclusive) */
export function periodFigures(d: Books, ledger: LedgerEntry[], start: string, end: string, withPrivate: boolean): PeriodFigures {
  const inP = (x: string) => x >= start && x <= end;
  const lp = ledger.filter((e) => inP(e.date));
  const collected = lp.filter((e) => e.kind === 'payment' || e.kind === 'refund').reduce((s, e) => s + e.amount, 0);
  const depositsIn = lp.filter((e) => e.kind === 'deposit_in').reduce((s, e) => s + e.amount, 0);
  const depositsOut = -lp.filter((e) => e.kind === 'deposit_out').reduce((s, e) => s + e.amount, 0);
  let commission = 0, other = 0, carried = 0, badDebt = 0, discounts = 0, depositKept = 0;
  const rows = profitRows(d, start, end);
  rows.forEach((r) => {
    commission += r.commission; other += r.other; carried += r.carried;
    badDebt += r.badDebt; discounts += r.discount; depositKept += r.depositKept;
  });
  const ce = d.companyExpenses.filter((e) => (e.status === 'approved' || e.status === 'paid') && inP(e.date));
  const running = ce.filter((e) => !e.private).reduce((s, e) => s + e.amount, 0);
  const runningPrivate = withPrivate ? ce.filter((e) => e.private).reduce((s, e) => s + e.amount, 0) : 0;
  const rentalProfit = commission + other + depositKept - carried;
  return { collected, depositsIn, depositsOut, commission, otherIncome: other, depositKept, carried, rentalProfit,
    running, runningPrivate, badDebt, discounts, profit: rentalProfit - running - runningPrivate - badDebt, bookings: rows.length };
}

/** Money held for others, today: owners' share not paid yet, and customer deposits */
export function heldForOthers(d: Books) {
  const x = heldDetail(d);
  return { owed: x.owners.reduce((s, o) => s + Math.max(0, o.net), 0), deposits: x.deposits.reduce((s, r) => s + r.amount, 0),
    unpaidExpenses: x.unpaid.reduce((s, e) => s + e.amount, 0) };
}

/** What makes up the money held for others — each owner's lines, each deposit, each unpaid expense */
export function heldDetail(d: Books) {
  const data = { bookings: d.bookings, commissions: d.commissions, expenses: d.expenses, vehicles: d.vehicles, owners: d.owners };
  const now = periodOf(new Date());
  const owners = d.owners.map((o) => { const lines = linesFor(o.id, now, data, d.from); return { owner: o, lines, ...totalsOf(lines) }; })
    .filter((o) => o.lines.length).sort((a, b) => b.net - a.net);
  const deposits = d.bookings.filter((b) => b.status !== 'Cancelled').map((b) => ({ b, amount: depositHeld(b), car: carOf(d, b.vehicleId) }))
    .filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const unpaid = d.companyExpenses.filter((e) => e.status === 'approved');
  return { owners, deposits, unpaid };
}

/** Each account's balance worked out: opening + money in − money out since the opening date; and the unassigned money */
export function balanceDetail(d: Books, ledger: LedgerEntry[]) {
  const accounts = d.accounts.map((a) => {
    const es = ledger.filter((e) => e.amount && e.accountId === a.id && e.date >= a.openingDate);
    const moneyIn = es.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const moneyOut = -es.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
    return { a, moneyIn, moneyOut, count: es.length, balance: a.openingBalance + moneyIn - moneyOut };
  });
  const loose = ledger.filter((e) => e.amount && e.date >= d.from && !(e.accountId && d.accounts.some((a) => a.id === e.accountId)));
  const byKind = new Map<LedgerKind, { kind: LedgerKind; amount: number; count: number }>();
  loose.forEach((e) => { const k = byKind.get(e.kind) ?? { kind: e.kind, amount: 0, count: 0 }; k.amount += e.amount; k.count++; byKind.set(e.kind, k); });
  return { accounts, unassigned: [...byKind.values()].sort((a, b) => b.amount - a.amount), looseEntries: loose };
}

/** Money to come in: balances on finished trips (aged), agreed credit, and trips on rent */
export function receivables(d: Books, today = new Date()) {
  const t = today.toISOString().slice(0, 10);
  const age = (since: string) => Math.max(0, Math.round((new Date(t).getTime() - new Date(since).getTime()) / 864e5));
  const done = d.bookings.filter((b) => b.status === 'Completed' && bookingDue(b) > 0 && completedOn(b) >= d.from)
    .map((b) => ({ b, due: bookingDue(b) - (b.badDebt ?? 0), credit: bookingCredit(b), days: age(completedOn(b)) })).filter((x) => x.due > 0)
    .sort((a, b) => b.days - a.days);
  const onRent = d.bookings.filter((b) => b.status === 'Ongoing' && bookingDue(b) > 0).map((b) => ({ b, due: bookingDue(b) }));
  const bucket = (lo: number, hi: number) => done.filter((x) => x.days >= lo && x.days <= hi).reduce((s, x) => s + x.due, 0);
  return { done, onRent, total: done.reduce((s, x) => s + x.due, 0), onRentTotal: onRent.reduce((s, x) => s + x.due, 0),
    aged: { '0–7 days': bucket(0, 7), '8–30 days': bucket(8, 30), 'Over 30 days': bucket(31, 100000) } };
}

/** 12 months of company income (rental profit) and running costs, oldest first */
export function monthlyTrend(d: Books, ledger: LedgerEntry[], months = 12, withPrivate = false) {
  const now = new Date();
  return Array.from({ length: months }, (_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const p = periodOf(m);
    const end = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    const f = periodFigures(d, ledger, `${p}-01`, `${p}-${String(end.getDate()).padStart(2, '0')}`, withPrivate);
    return { month: m.toLocaleDateString('en-GB', { month: 'short' }), period: p, income: Math.round(f.rentalProfit), costs: Math.round(f.running + f.runningPrivate + f.badDebt), profit: Math.round(f.profit) };
  });
}

/** Company income on completed trips, grouped (by car / owner / trip type / channel) */
export function incomeBy(d: Books, start: string, end: string, key: 'car' | 'owner' | 'type' | 'channel') {
  const m = new Map<string, { name: string; income: number; trips: number }>();
  d.bookings.forEach((b) => {
    if (b.status !== 'Completed') return;
    const on = completedOn(b);
    if (on < start || on > end) return;
    const v = d.vehicles.find((x) => x.id === b.vehicleId);
    const name = key === 'car' ? (v ? `${v.brand} ${v.model} ${v.vehicleNumber}` : 'Vehicle removed')
      : key === 'owner' ? (d.owners.find((o) => o.id === v?.ownerId)?.name ?? 'No owner')
      : key === 'type' ? (b.rentalType ?? 'Daily')
      : (channelOf(b) ?? 'Not recorded');
    const e = m.get(name) ?? { name, income: 0, trips: 0 };
    e.income += bookingProfit(b, d.commissions).gross; e.trips += 1;
    m.set(name, e);
  });
  return [...m.values()].sort((a, b) => b.income - a.income);
}

/** Days each car was out on rent in the period ÷ days in the period */
export function utilisation(d: Books, start: string, end: string) {
  const s = new Date(`${start}T00:00:00`).getTime(), e = new Date(`${end}T23:59:59`).getTime();
  const days = Math.max(1, Math.round((e - s) / 864e5));
  return d.vehicles.map((v) => {
    let used = 0;
    d.bookings.forEach((b) => {
      if (b.vehicleId !== v.id || (b.status !== 'Completed' && b.status !== 'Ongoing')) return;
      const a = Math.max(s, new Date(`${b.startDate}T00:00:00`).getTime());
      const z = Math.min(e, new Date(`${(b.status === 'Completed' ? completedOn(b) : b.endDate) || b.endDate}T23:59:59`).getTime());
      if (z > a) used += (z - a) / 864e5;
    });
    return { name: `${v.brand} ${v.model} ${v.vehicleNumber}`, pct: Math.min(100, Math.round((used / days) * 100)), days: Math.round(used) };
  }).sort((a, b) => b.pct - a.pct);
}

/** Things to fix: the "something's wrong" box */
export function checks(d: Books, ledger: LedgerEntry[], payoutDue: Date | null) {
  const t = Date.now(), week = 7 * 864e5;
  const out: { level: 'warn' | 'info'; text: string; count: number; bookingIds?: string[] }[] = [];
  const add = (level: 'warn' | 'info', text: string, ids: string[]) => { if (ids.length) out.push({ level, text, count: ids.length, bookingIds: ids }); };
  add('warn', 'Bank / card payments with no reference number', ledger.filter((e) => e.kind === 'payment' && e.method && e.method !== 'Cash' && !e.ref && e.date >= d.from).map((e) => e.bookingId!).filter(Boolean));
  add('warn', 'Finished trips still unpaid after 7 days', d.bookings.filter((b) => b.status === 'Completed' && completedOn(b) >= d.from && bookingDue(b) - (b.badDebt ?? 0) > 0 && t - new Date(completedOn(b)).getTime() > week).map((b) => b.id));
  add('warn', 'Deposits still held more than 7 days after the return', d.bookings.filter((b) => b.status === 'Completed' && depositHeld(b) > 0 && t - new Date(completedOn(b)).getTime() > week).map((b) => b.id));
  add('warn', 'Commission / owner share out of date — fix it in the profit box', staleShares(d).filter((x) => x.check.fixable && (x.b.status !== 'Completed' || completedOn(x.b) >= d.from)).map((x) => x.b.id));
  add('info', 'Bookings with no company commission', d.bookings.filter((b) => !b.companyShareType && b.status !== 'Cancelled' && (b.status !== 'Completed' || completedOn(b) >= d.from)).map((b) => b.id));
  add('info', 'Payments not assigned to a company account', ledger.filter((e) => e.amount && !e.accountId && e.kind !== 'vehicle_expense' && e.date >= d.from).map((e) => e.bookingId ?? e.id));
  const vexp = d.expenses.filter((e) => !e.paidBy);
  if (vexp.length) out.push({ level: 'info', text: 'Vehicle expenses with no "who paid"', count: vexp.length });
  const pend = d.companyExpenses.filter((e) => e.status === 'pending');
  if (pend.length) out.push({ level: 'warn', text: 'Company expenses waiting for Brian\'s approval', count: pend.length });
  if (payoutDue && Date.now() > payoutDue.getTime()) {
    const late = d.settlements.filter((s) => !['paid', 'confirmed'].includes(s.status)).length;
    if (late) out.push({ level: 'warn', text: 'Owner payouts past the payout day', count: late });
  }
  return out;
}
