import type { Booking } from '../types';
import { rentalDays } from './availability';
import { legsOf } from './exchange';
import type { BdAllocation, BdData, BdExpense, BdIncident, BdPayment, BdSolution, Party } from './breakdowns';

/*
 * Money for one breakdown incident, worked out from its records — never stored as totals,
 * so nothing can drift or be counted twice.
 *
 *   cost          all non-void expense lines (discounts negative) — each counted once
 *   allocated     who is responsible for that cost (the current decision); the company
 *                 carries anything not yet decided ("pending investigation")
 *   contributed   what each party has actually put in: paid a provider, reimbursed the company,
 *                 had it deducted from their payout (owner) or added to their booking bill (customer);
 *                 money the company paid BACK to a party counts against that party
 *   outstanding   allocated − contributed  (+ = still owes, − = is owed money back)
 *   companyNet    what the company has really spent after everything it got back
 *
 * Example: repair Rs 15,000 paid by the company; owner responsible for Rs 10,000.
 *   owner outstanding 10,000 → the owner reimburses 10,000 → outstanding 0, companyNet 5,000.
 */

const PARTIES: Party[] = ['owner', 'customer', 'company', 'insurance'];
const zero = (): Record<Party, number> => ({ owner: 0, customer: 0, company: 0, insurance: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Ledger {
  cost: number;
  allocated: Record<Party, number>;
  unallocated: number;
  pendingInvestigation: boolean;
  vendorPaid: number;
  vendorUnpaid: number;
  contributed: Record<Party, number>;
  outstanding: Record<Party, number>;
  companyNet: number;
  refundsPaid: number;
  refundPending: number;
  settled: boolean;
  blockers: string[];          // why the incident can't be financially closed yet
}

export function ledgerFor(incidentId: string, d: Pick<BdData, 'expenses' | 'allocations' | 'payments' | 'solutions'>): Ledger {
  const expenses = d.expenses.filter((e) => e.incidentId === incidentId && !e.voidedAt);
  const allocations = d.allocations.filter((a) => a.incidentId === incidentId && !a.supersededAt);
  const payments = d.payments.filter((p) => p.incidentId === incidentId && p.status === 'posted');
  const solutions = d.solutions.filter((s) => s.incidentId === incidentId);

  const cost = r2(expenses.reduce((s, e) => s + e.amount, 0));
  const allocated = zero();
  allocations.forEach((a) => { allocated[a.party] += a.amount; });
  const allocatedTotal = PARTIES.reduce((s, p) => s + allocated[p], 0);
  const unallocated = r2(Math.max(0, cost - allocatedTotal));

  const contributed = zero();
  let vendorPaid = 0, received = 0, paidBack = 0, refundsPaid = 0;
  payments.forEach((p) => {
    if (p.kind === 'vendor_payment') { vendorPaid += p.amount; contributed[p.payer] += p.amount; }
    else if (p.kind === 'reimbursement') {
      if (p.payee === 'company') { contributed[p.payer] += p.amount; if (p.payer !== 'company') received += p.amount; }
      else if (p.payer === 'company' && PARTIES.includes(p.payee as Party)) { contributed[p.payee as Party] -= p.amount; paidBack += p.amount; }
    } else if (p.kind === 'owner_offset') { contributed.owner += p.amount; received += p.amount; }
    else if (p.kind === 'customer_charge') { contributed.customer += p.amount; received += p.amount; }
    else if (p.kind === 'refund') refundsPaid += p.amount;
  });

  const outstanding = zero();
  (['owner', 'customer', 'insurance'] as Party[]).forEach((p) => { outstanding[p] = r2(allocated[p] - contributed[p]); });
  const companyNet = r2(contributed.company + paidBack - received);
  const vendorUnpaid = r2(Math.max(0, cost - vendorPaid));

  const refundPending = solutions
    .filter((s) => s.kind === 'termination' && s.status !== 'cancelled' && (s.refundStatus === 'pending_approval' || s.refundStatus === 'approved'))
    .reduce((s, x) => s + (x.refundApproved ?? x.refundProposed ?? 0), 0);

  const blockers: string[] = [];
  if (vendorUnpaid > 0.5) blockers.push(`Rs ${fmt(vendorUnpaid)} not yet paid to providers`);
  if (cost > 0 && unallocated > 0.5) blockers.push('Responsibility not decided for the whole cost');
  (['owner', 'customer', 'insurance'] as Party[]).forEach((p) => {
    if (outstanding[p] > 0.5) blockers.push(`${label(p)} still owes Rs ${fmt(outstanding[p])}`);
    if (outstanding[p] < -0.5) blockers.push(`Rs ${fmt(-outstanding[p])} still to pay back to the ${label(p).toLowerCase()}`);
  });
  if (refundPending > 0) blockers.push(`Refund of Rs ${fmt(refundPending)} not paid yet`);
  if (solutions.some((s) => s.kind === 'termination' && s.status !== 'cancelled' && s.refundStatus === 'pending_approval')) blockers.push('Refund waiting for approval');

  return {
    cost, allocated, unallocated, pendingInvestigation: cost > 0 && unallocated > 0.5, vendorPaid: r2(vendorPaid), vendorUnpaid,
    contributed, outstanding, companyNet, refundsPaid: r2(refundsPaid), refundPending: r2(refundPending),
    settled: blockers.length === 0, blockers,
  };
}

const label = (p: Party) => ({ owner: 'Owner', customer: 'Customer', company: 'Company', insurance: 'Insurance' }[p]);
export const fmt = (n: number) => Math.round(n).toLocaleString('en-LK');

/** Paid so far against one expense line (all payers) */
export const expensePaid = (e: BdExpense, payments: BdPayment[]) =>
  payments.filter((p) => p.expenseId === e.id && p.status === 'posted' && p.kind === 'vendor_payment').reduce((s, p) => s + p.amount, 0);
export const expenseStatus = (e: BdExpense, payments: BdPayment[]): 'unpaid' | 'partly_paid' | 'paid' => {
  if (e.amount <= 0) return 'paid';
  const paid = expensePaid(e, payments);
  return paid <= 0 ? 'unpaid' : paid + 0.5 < e.amount ? 'partly_paid' : 'paid';
};

/** Turn percent / amount shares into amounts of the cost (rounded; percentages may leave a remainder) */
export function resolveShares(cost: number, rows: { party: Party; mode: 'percent' | 'amount'; value: number }[]) {
  return rows.map((r) => ({ ...r, amount: r2(r.mode === 'percent' ? (cost * r.value) / 100 : r.value) }));
}
export function sharesProblem(cost: number, rows: { party: Party; mode: 'percent' | 'amount'; value: number }[]): string | null {
  if (!rows.length) return 'Add at least one responsible party.';
  if (rows.some((r) => !(r.value >= 0))) return 'Shares cannot be negative.';
  if (rows.some((r) => r.mode === 'percent' && r.value > 100)) return 'A share cannot be more than 100%.';
  if (new Set(rows.map((r) => r.party)).size !== rows.length) return 'Each party can appear only once.';
  const total = resolveShares(cost, rows).reduce((s, r) => s + r.amount, 0);
  if (total > cost + 0.5) return `The shares add up to Rs ${fmt(total)} — more than the cost of Rs ${fmt(cost)}.`;
  return null;
}

/* ── Termination & refund ──────────────────────────────────────────────────── */

/**
 * Refund policy for ending a booking early because of a breakdown (shown as a proposal —
 * an admin approves the final amount):
 *   used value  = booking price × used days ÷ booked days   (at least one day)
 *   refund      = paid so far − used value − approved deductions + credits   (never below zero)
 */
export const REFUND_POLICY = 'Pro rata: the customer pays for the days used (at least one), less approved deductions, plus any credits.';

export function terminationProposal(b: Booking, terminateAtIso: string, deductions = 0, credits = 0) {
  const at = new Date(terminateAtIso);
  const date = at.toLocaleDateString('en-CA'), time = at.toTimeString().slice(0, 5);
  const booked = Math.max(1, b.totalDays || 1);
  const used = Math.min(booked, Math.max(1, b.startTime
    ? rentalDays(b.startDate, date, b.startTime, time)
    : Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${b.startDate}T00:00:00`).getTime()) / 864e5) || 1));
  const usedValue = r2((b.totalAmount * used) / booked);
  const paid = Math.max(0, (b.paidAmount ?? 0) + (b.advanceAmount ?? 0));
  const refund = r2(Math.max(0, paid - usedValue - deductions + credits));
  return { usedDays: used, unusedDays: booked - used, usedValue, originalTotal: b.totalAmount, previouslyPaid: paid, refund, date, time };
}

/* ── Dashboard ─────────────────────────────────────────────────────────────── */

export type FinanceFilter = 'all' | 'settled' | 'partial' | 'pending' | 'no_cost';

export function incidentStage(i: BdIncident, sols: BdSolution[]) {
  const live = sols.filter((s) => s.incidentId === i.id && s.status !== 'cancelled' && s.status !== 'failed');
  const active = live.filter((s) => s.status === 'planned' || s.status === 'in_progress');
  return {
    awaitingTechnician: active.some((s) => s.kind === 'onsite_repair' && !s.arriveAt),
    awaitingReplacement: active.some((s) => (s.kind === 'replacement' && !s.exchangeId) || (s.kind === 'partner_vehicle' && !s.deliveredAt)),
    underRepair: active.some((s) => (s.kind === 'onsite_repair' && !!s.arriveAt) || s.kind === 'towing_garage'),
    unassigned: !i.assignedTo && !live.length,
  };
}

export function dashboard(d: BdData) {
  const ledgers = new Map(d.incidents.map((i) => [i.id, ledgerFor(i.id, d)]));
  const live = d.incidents.filter((i) => i.status === 'open' || i.status === 'disputed');
  const count = (f: (i: BdIncident) => boolean) => live.filter(f).length;
  const st = (i: BdIncident) => incidentStage(i, d.solutions);
  return {
    total: d.incidents.length,
    active: live.length,
    emergency: count((i) => i.urgency === 'emergency' || st(i).unassigned),
    awaitingTechnician: count((i) => st(i).awaitingTechnician),
    awaitingReplacement: count((i) => st(i).awaitingReplacement),
    underRepair: count((i) => st(i).underRepair),
    awaitingSettlement: d.incidents.filter((i) => i.status === 'resolved' && !ledgers.get(i.id)!.settled).length,
    resolved: d.incidents.filter((i) => i.status === 'resolved' || i.status === 'closed').length,
    vehiclesOnHold: new Set(d.incidents.filter((i) => i.holdVehicleId && !i.holdClearedAt).map((i) => i.holdVehicleId)).size,
    cost: d.incidents.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + ledgers.get(i.id)!.cost, 0),
    ownerOutstanding: d.incidents.reduce((s, i) => s + Math.max(0, ledgers.get(i.id)!.outstanding.owner), 0),
    customerOutstanding: d.incidents.reduce((s, i) => s + Math.max(0, ledgers.get(i.id)!.outstanding.customer), 0),
    ledgers,
  };
}

/** Money for one incident: PENDING (nothing paid yet) / PARTIAL / SETTLED — or no costs at all */
export const financeStatus = (l: Ledger): Exclude<FinanceFilter, 'all'> => {
  if (l.cost === 0 && l.refundPending === 0 && l.refundsPaid === 0) return 'no_cost';
  if (l.settled) return 'settled';
  const anyPaid = l.vendorPaid > 0 || l.refundsPaid > 0 || (['owner', 'customer', 'insurance', 'company'] as Party[]).some((p) => l.contributed[p] > 0);
  return anyPaid ? 'partial' : 'pending';
};
export const FINANCE_LABEL: Record<Exclude<FinanceFilter, 'all'>, string> = { pending: 'Pending', partial: 'Partly paid', settled: 'Settled', no_cost: 'No costs' };

/** Earlier breakdowns of the same vehicle and whether they form a pattern that needs a full inspection */
export function vehicleHistory(vehicleId: string | undefined, incidents: BdIncident[], beforeIso?: string) {
  if (!vehicleId) return { previous: [] as BdIncident[], repeat: false, reason: '' };
  const all = incidents.filter((x) => x.vehicleId === vehicleId).sort((a, c) => (a.occurredAt ?? a.reportedAt).localeCompare(c.occurredAt ?? c.reportedAt));
  const previous = beforeIso ? all.filter((x) => (x.occurredAt ?? x.reportedAt) < beforeIso) : all;
  const recent = all.filter((x) => Date.now() - new Date(x.occurredAt ?? x.reportedAt).getTime() < 180 * 864e5);
  const repeat = all.length >= 3 || recent.length >= 2;
  return { previous, repeat, reason: repeat ? (recent.length >= 2 ? `${recent.length} breakdowns in the last 6 months` : `${all.length} breakdowns in total`) : '' };
}

/**
 * Money when a breakdown replacement comes back (fleet cars only — a partner car is paid through the
 * partner expense). The replacement's owner earns its daily rent × the days it served; the original
 * owner's payout is reduced for those days at the agreed booking rate (never below zero).
 */
export function swapMoney(b: Booking, originalVehicleId: string | undefined, rate: number, days: number) {
  const leg = legsOf(b).filter((l) => l.vehicleId === originalVehicleId).pop();
  const perDay = leg && leg.days ? Math.max(0, leg.revenue - leg.referralFee) / leg.days : 0;
  const originalDeduction = Math.min(Math.round(perDay * days), Math.round(leg?.payout ?? 0));
  const replacementPayout = Math.round(Math.max(0, rate) * days);
  return { perDay: Math.round(perDay), originalDeduction, replacementPayout, companyNet: originalDeduction - replacementPayout };
}
