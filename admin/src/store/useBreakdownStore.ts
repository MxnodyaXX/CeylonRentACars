import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabaseEnabled } from '../lib/supabase';
import {
  BdAllocation, BdData, BdDocument, BdEvent, BdExpense, BdIncident, BdPayment, BdSolution, ExpenseCategory, Party, PaymentKind,
  SolutionKind, SolutionStatus, TableKey, bdId, insertRow, loadBreakdowns, newRef, updateRow, CATEGORY_LABEL, SOLUTION_LABEL, PARTY_LABEL,
  markReadyOnServer,
} from '../lib/breakdowns';
import { fmt, ledgerFor, resolveShares, sharesProblem, terminationProposal, vehicleHistory } from '../lib/breakdownLedger';
import { legsOf } from '../lib/exchange';
import { useStore } from './useStore';
import { toast } from './useToast';

/*
 * Breakdown management state. Records are written to the breakdown_* tables (Supabase) or kept in
 * this browser in offline demo mode. Every change adds a line to the incident's timeline.
 * Money that touches the booking goes through the booking itself, so its bill, payouts and
 * history stay in step:
 *   customer share      → a charge on the booking bill (once per decision)
 *   owner share         → a payout adjustment on the booking (owner earns less; reversible)
 *   price difference    → a booking charge (surcharge) or discount (credit) — the price is not rewritten
 *   termination         → the booking is shortened to the used days (audited) and the refund recorded
 *                         in the booking's payment ledger
 */

export interface ReportInput {
  bookingId: string;
  occurredAt?: string; location?: string; lat?: number; lng?: number;
  reportedBy: BdIncident['reportedBy']; contactPhone?: string; mileage?: number; fuel?: string;
  category: BdIncident['category']; description: string;
  driveable: BdIncident['driveable']; passengersSafe: BdIncident['passengersSafe']; urgency: BdIncident['urgency'];
  notes?: string; by: string;
}
export interface ExpenseInput {
  incidentId: string; solutionId?: string; category: ExpenseCategory; description: string;
  quantity: number; unitCost: number; vendor?: string; by: string;
  paidNow?: { payer: Party; method?: string; reference?: string; receiptPath?: string; key: string };
}
export interface PaymentInput {
  incidentId: string; expenseId?: string; kind: PaymentKind; payer: Party; payee: string; amount: number;
  method?: string; reference?: string; receiptPath?: string; paidAt?: string; key: string; by: string;
}

interface BdState extends BdData {
  ready: boolean;
  missing: boolean;            // Supabase tables not created yet
  load: () => Promise<void>;
  report: (x: ReportInput) => { incident?: BdIncident; error?: string };
  updateIncident: (id: string, patch: Partial<BdIncident>, by: string, text?: string) => void;
  note: (incidentId: string, by: string, text: string, type?: string, data?: Record<string, unknown>) => void;
  addSolution: (incidentId: string, kind: SolutionKind, by: string) => { solution?: BdSolution; error?: string };
  updateSolution: (id: string, patch: Partial<BdSolution>, by: string, text?: string) => void;
  setSolutionStatus: (id: string, status: SolutionStatus, by: string, extra?: Partial<BdSolution>) => string | null;
  addExpense: (x: ExpenseInput) => string | null;
  voidExpense: (id: string, reason: string, by: string) => string | null;
  decideResponsibility: (incidentId: string, rows: { party: Party; mode: 'percent' | 'amount'; value: number }[], reason: string, by: string) => string | null;
  postPayment: (x: PaymentInput) => string | null;
  reversePayment: (id: string, reason: string, by: string) => string | null;
  chargeCustomerShare: (incidentId: string, by: string, key: string) => string | null;
  offsetOwnerShare: (incidentId: string, amount: number, by: string, key: string) => string | null;
  approveQuote: (solutionId: string, by: string) => string | null;
  confirmRoadworthy: (solutionId: string, by: string) => string | null;
  /** The active maintenance hold on a vehicle (the incident that placed it), if any */
  activeHold: (vehicleId?: string) => BdIncident | undefined;
  /** Explicit return to service: outcome + safety confirmation; checked again by the database */
  markVehicleReady: (incidentId: string, x: { outcome: string; safe: boolean; comments?: string; approvedAt?: string; by: string; isAdmin: boolean }) => Promise<string | null>;
  linkLatestExchange: (solutionId: string, by: string) => string | null;
  applyPriceDifference: (solutionId: string, amount: number, by: string) => string | null;
  applyOwnerShareAdjustment: (solutionId: string, amount: number, by: string) => string | null;
  proposeTermination: (solutionId: string, x: { terminateAt: string; reason: string; deductions?: number; deductionsNote?: string; credits?: number }, by: string) => string | null;
  approveRefund: (solutionId: string, amount: number, by: string) => string | null;
  amendBookingForTermination: (solutionId: string, by: string) => string | null;
  payRefund: (solutionId: string, x: { method: string; reference?: string; key: string }, by: string) => string | null;
  setRecovery: (solutionId: string, status: NonNullable<BdSolution['recoveryStatus']>, by: string) => string | null;
  addDocument: (d: Omit<BdDocument, 'id' | 'uploadedAt'>) => void;
  resolve: (incidentId: string, resolution: string, by: string) => string | null;
  close: (incidentId: string, by: string) => string | null;
  setDisputed: (incidentId: string, on: boolean, reason: string, by: string) => void;
  reopen: (incidentId: string, reason: string, by: string) => void;
}

const nowIso = () => new Date().toISOString();
const rs = (n: number) => `Rs ${fmt(n)}`;
const EMPTY: BdData = { incidents: [], events: [], solutions: [], expenses: [], allocations: [], payments: [], documents: [] };

/** Write to Supabase in the background; a failure is shown (the screen already has the change) */
function save(table: TableKey, op: 'insert' | 'update', row: { id: string } & object, patch?: object) {
  if (!supabaseEnabled) return;
  const p = op === 'insert' ? insertRow(table, row) : updateRow(table, row.id, patch ?? row);
  p.catch((e: { message?: string }) => {
    console.error(`[breakdowns] ${table} ${op} failed:`, e);
    toast.error('Breakdown not saved', e?.message ?? 'Please check your connection and try again.');
  });
}

export const useBreakdownStore = create<BdState>()(persist((set, get) => {
  const event = (incidentId: string, by: string, type: string, text: string, data?: Record<string, unknown>) => {
    const e: BdEvent = { id: bdId(), incidentId, at: nowIso(), by, type, text, ...(data ? { data } : {}) };
    set((s) => ({ events: [...s.events, e] }));
    save('events', 'insert', e);
  };
  const incidentOf = (id: string) => get().incidents.find((i) => i.id === id);
  /** Admin alert (Alerts page) for a step in an incident — internal only, never sent to the customer */
  const notify = (incidentId: string, title: string, message: string) => {
    const i = incidentOf(incidentId);
    if (i) useStore.getState().addNotification({ type: 'General', title: `${title} · ${i.ref}`, message, relatedId: i.bookingId });
  };
  const solutionOf = (id: string) => get().solutions.find((s) => s.id === id);
  const bookingOf = (incidentId: string) => useStore.getState().bookings.find((b) => b.id === incidentOf(incidentId)?.bookingId);
  const patchSolution = (id: string, patch: Partial<BdSolution>) => {
    const p = { ...patch, updatedAt: nowIso() };
    set((s) => ({ solutions: s.solutions.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
    save('solutions', 'update', { id }, patch);
  };
  const patchIncident = (id: string, patch: Partial<BdIncident>) => {
    const p = { ...patch, updatedAt: nowIso() };
    set((s) => ({ incidents: s.incidents.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
    save('incidents', 'update', { id }, patch);
  };
  /** The one-time key was used before → the action already happened */
  const used = (key: string) => get().payments.some((p) => p.idempotencyKey === key);
  const insertPayment = (p: BdPayment) => { set((s) => ({ payments: [...s.payments, p] })); save('payments', 'insert', p); };

  return {
    ...EMPTY,
    ready: !supabaseEnabled,
    missing: false,

    load: async () => {
      if (!supabaseEnabled) { set({ ready: true }); return; }
      try {
        const d = await loadBreakdowns();
        if (!d) { set({ ...EMPTY, ready: true, missing: true }); return; }
        set({ ...d, ready: true, missing: false });
      } catch (e) {
        console.error('[breakdowns] load failed:', e);
        toast.error('Breakdowns not loaded', (e as Error).message);
        set({ ready: true });
      }
    },

    report: (x) => {
      const b = useStore.getState().bookings.find((v) => v.id === x.bookingId);
      if (!b) return { error: 'Choose the booking this breakdown belongs to.' };
      if (!x.description.trim()) return { error: 'Describe the problem.' };
      if (x.mileage !== undefined && !(x.mileage >= 0)) return { error: 'Mileage cannot be negative.' };
      const vehicle = useStore.getState().vehicles.find((v) => v.id === b.vehicleId);
      // one maintenance hold per vehicle: a second breakdown while it is held is linked to that hold
      const existingHold = get().activeHold(b.vehicleId);
      const history = vehicleHistory(b.vehicleId, get().incidents);
      const i: BdIncident = {
        id: bdId(), ref: newRef(), bookingId: b.id, vehicleId: b.vehicleId, ownerId: vehicle?.ownerId,
        reportedAt: nowIso(), occurredAt: x.occurredAt, location: x.location?.trim() || undefined, lat: x.lat, lng: x.lng,
        reportedBy: x.reportedBy, contactPhone: x.contactPhone?.trim() || b.customerPhone, mileage: x.mileage, fuel: x.fuel,
        category: x.category, description: x.description.trim(), driveable: x.driveable, passengersSafe: x.passengersSafe,
        urgency: x.urgency, causeStatus: 'pending', status: 'open', notes: x.notes?.trim() || undefined,
        createdBy: x.by, createdAt: nowIso(), updatedAt: nowIso(),
        ...(existingHold || !b.vehicleId ? {} : { holdVehicleId: b.vehicleId, holdPlacedAt: nowIso() }),
      };
      set((s) => ({ incidents: [...s.incidents, i] }));
      save('incidents', 'insert', i);
      event(i.id, x.by, 'created', `Breakdown reported — ${CATEGORY_LABEL[i.category]}${i.location ? ` at ${i.location}` : ''} (${i.urgency} urgency)`);
      if (i.holdVehicleId) {
        // the database does this too (same transaction as the insert); keep this screen in step
        if (vehicle && vehicle.status !== 'Maintenance') useStore.getState().updateVehicle(vehicle.id, { status: 'Maintenance' });
        event(i.id, x.by, 'hold', `${vehicle?.vehicleNumber ?? 'Vehicle'} placed under maintenance — no new bookings until an admin confirms it is safe`);
      } else if (existingHold) {
        event(i.id, x.by, 'hold', `${vehicle?.vehicleNumber ?? 'Vehicle'} is already under maintenance (hold from ${existingHold.ref}) — it returns to service from there`);
      }
      if (history.previous.length) {
        const after = vehicleHistory(b.vehicleId, [...get().incidents]);
        event(i.id, x.by, 'note', `This vehicle had ${history.previous.length} earlier breakdown${history.previous.length === 1 ? '' : 's'} (last: ${history.previous[history.previous.length - 1].ref})${after.repeat ? ` — repeated breakdowns (${after.reason}): full inspection recommended` : ''}`);
        if (after.repeat) {
          useStore.getState().addNotification({ type: 'General', title: `⚠ Repeated breakdowns · ${vehicle?.vehicleNumber ?? 'vehicle'}`, message: `${after.reason} — schedule a full inspection before renting it again.`, relatedId: b.id });
        }
      }
      useStore.getState().addNotification({
        type: 'General', title: `${i.urgency === 'emergency' ? '🚨 ' : ''}Breakdown reported · ${i.ref}`,
        message: `${b.customerName} · ${vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})` : 'vehicle'} — ${CATEGORY_LABEL[i.category]}${i.location ? ` at ${i.location}` : ''}`,
        relatedId: b.id,
      });
      useStore.getState().logBookingActivity(b.id, { by: x.by, type: 'Note', text: `Breakdown ${i.ref} reported — ${CATEGORY_LABEL[i.category]}` });
      return { incident: i };
    },

    updateIncident: (id, patch, by, text) => {
      if (!incidentOf(id)) return;
      patchIncident(id, patch);
      if (text) event(id, by, 'update', text);
    },

    note: (incidentId, by, text, type = 'note', data) => { if (text.trim()) event(incidentId, by, type, text.trim(), data); },

    addSolution: (incidentId, kind, by) => {
      const i = incidentOf(incidentId);
      if (!i) return { error: 'Incident not found.' };
      if (i.status === 'closed' || i.status === 'cancelled') return { error: 'This incident is closed — reopen it first.' };
      if (kind === 'termination' && get().solutions.some((s) => s.incidentId === incidentId && s.kind === 'termination' && s.status !== 'cancelled')) {
        return { error: 'This incident already has a termination — open it below.' };
      }
      const s: BdSolution = {
        id: bdId(), incidentId, kind, status: 'planned', createdBy: by, createdAt: nowIso(), updatedAt: nowIso(),
        ...(kind === 'replacement' || kind === 'partner_vehicle' ? { fromVehicleId: i.vehicleId } : {}),
        ...(kind === 'termination' ? { refundStatus: 'pending_approval' as const, recoveryStatus: 'pending' as const } : {}),
      };
      set((st) => ({ solutions: [...st.solutions, s] }));
      save('solutions', 'insert', s);
      event(incidentId, by, 'solution', `${SOLUTION_LABEL[kind]} started`, { solutionId: s.id });
      return { solution: s };
    },

    updateSolution: (id, patch, by, text) => {
      const s = solutionOf(id);
      if (!s) return;
      patchSolution(id, patch);
      if (text) event(s.incidentId, by, 'solution', `${SOLUTION_LABEL[s.kind]}: ${text}`, { solutionId: id });
      if (patch.providerName && patch.providerName !== s.providerName) {
        patchIncident(s.incidentId, { assignedTo: patch.providerName });
        notify(s.incidentId, s.kind === 'onsite_repair' ? 'Technician assigned' : s.kind === 'partner_vehicle' ? 'Partner assigned' : 'Provider assigned', `${patch.providerName}${patch.providerPhone ? ` (${patch.providerPhone})` : ''} — ${SOLUTION_LABEL[s.kind]}`);
      }
      if (patch.arriveAt && !s.arriveAt && s.kind === 'onsite_repair') notify(s.incidentId, 'Technician arrived', s.providerName ?? 'Technician on site');
      if (patch.deliveredAt && !s.deliveredAt && s.kind === 'partner_vehicle') notify(s.incidentId, 'Partner vehicle delivered', `${s.partnerVehicle ?? patch.partnerVehicle ?? 'Vehicle'} handed to the customer`);
    },

    setSolutionStatus: (id, status, by, extra = {}) => {
      const s = solutionOf(id);
      if (!s) return 'Solution not found.';
      if (status === 'completed') {
        if (s.kind === 'onsite_repair' && (extra.repairResult ?? s.repairResult) === 'repaired' && !((extra.clearanceAt ?? s.clearanceAt) && (extra.customerConfirmedAt ?? s.customerConfirmedAt))) {
          return 'Before the rental continues, record the technician’s safety clearance and the customer’s confirmation.';
        }
        if (s.kind === 'replacement' && !s.exchangeId) return 'Exchange the vehicle first (Start vehicle exchange).';
        if (s.kind === 'towing_garage' && !s.roadworthyAt && !(extra.roadworthyAt)) return 'Confirm the vehicle is roadworthy before completing the garage repair.';
        if (s.kind === 'termination' && s.recoveryStatus !== 'recovered') return 'The vehicle has not been recovered yet.';
        if (s.kind === 'termination' && s.refundStatus !== 'paid' && s.refundStatus !== 'not_required') return 'Pay (or mark as not required) the refund first.';
      }
      const patch: Partial<BdSolution> = {
        ...extra, status,
        ...(status === 'in_progress' && !s.startedAt ? { startedAt: nowIso() } : {}),
        ...(status === 'completed' || status === 'failed' ? { completedAt: nowIso() } : {}),
      };
      patchSolution(id, patch);
      event(s.incidentId, by, 'solution', `${SOLUTION_LABEL[s.kind]} — ${status.replace('_', ' ')}${extra.result ? `: ${extra.result}` : ''}`, { solutionId: id });
      if (status === 'completed' && s.kind === 'onsite_repair') notify(s.incidentId, 'Repair completed', extra.result ?? 'On-site repair finished');
      if (status === 'failed') notify(s.incidentId, `${SOLUTION_LABEL[s.kind]} failed`, extra.result ?? 'Another solution is needed');
      return null;
    },

    addExpense: (x) => {
      const i = incidentOf(x.incidentId);
      if (!i) return 'Incident not found.';
      if (i.status === 'closed') return 'This incident is closed — reopen it to add costs.';
      if (!x.description.trim()) return 'Describe the expense.';
      if (!(x.quantity > 0)) return 'Quantity must be more than zero.';
      if (!(x.unitCost >= 0)) return 'Unit cost cannot be negative.';
      const amount = Math.round(x.quantity * x.unitCost * (x.category === 'discount' ? -1 : 1) * 100) / 100;
      if (x.category !== 'discount' && amount === 0) return 'Enter the cost.';
      if (x.paidNow && used(x.paidNow.key)) return null;   // double submit
      const e: BdExpense = {
        id: bdId(), incidentId: x.incidentId, solutionId: x.solutionId, category: x.category, description: x.description.trim(),
        quantity: x.quantity, unitCost: x.unitCost, amount, vendor: x.vendor?.trim() || undefined, createdBy: x.by, createdAt: nowIso(),
      };
      set((s) => ({ expenses: [...s.expenses, e] }));
      save('expenses', 'insert', e);
      event(x.incidentId, x.by, 'expense', `Expense: ${e.description} — ${rs(amount)}${e.vendor ? ` (${e.vendor})` : ''}`, { expenseId: e.id });
      if (x.paidNow && amount > 0) {
        return get().postPayment({
          incidentId: x.incidentId, expenseId: e.id, kind: 'vendor_payment', payer: x.paidNow.payer, payee: e.vendor || 'Provider',
          amount, method: x.paidNow.method, reference: x.paidNow.reference, receiptPath: x.paidNow.receiptPath, key: x.paidNow.key, by: x.by,
        });
      }
      return null;
    },

    voidExpense: (id, reason, by) => {
      const e = get().expenses.find((x) => x.id === id);
      if (!e || e.voidedAt) return null;
      if (!reason.trim()) return 'Say why this expense is removed.';
      if (get().payments.some((p) => p.expenseId === id && p.status === 'posted')) return 'Reverse the payments for this expense first.';
      const patch = { voidedAt: nowIso(), voidedBy: by, voidReason: reason.trim() };
      set((s) => ({ expenses: s.expenses.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      save('expenses', 'update', { id }, patch);
      event(e.incidentId, by, 'expense', `Expense removed: ${e.description} (${rs(e.amount)}) — ${reason.trim()}`, { expenseId: id });
      return null;
    },

    decideResponsibility: (incidentId, rows, reason, by) => {
      const l = ledgerFor(incidentId, get());
      const problem = sharesProblem(l.cost, rows);
      if (problem) return problem;
      if (!reason.trim()) return 'Record the reason for this decision (evidence, agreement, insurance cover…).';
      const current = get().allocations.filter((a) => a.incidentId === incidentId && !a.supersededAt);
      // shares already settled through the booking (customer charged / owner deducted) must not shrink below that
      const charged = l.contributed.customer, offset = l.contributed.owner;
      const next = resolveShares(l.cost, rows);
      const amountOf = (p: Party) => next.find((r) => r.party === p)?.amount ?? 0;
      if (amountOf('customer') + 0.5 < charged) return `The customer has already been charged ${rs(charged)} — reverse that first to lower their share.`;
      if (amountOf('owner') + 0.5 < offset) return `The owner has already paid / been deducted ${rs(offset)} — reverse that first to lower their share.`;
      const at = nowIso();
      current.forEach((a) => {
        set((s) => ({ allocations: s.allocations.map((x) => (x.id === a.id ? { ...x, supersededAt: at } : x)) }));
        save('allocations', 'update', { id: a.id }, { supersededAt: at });
      });
      const prevCharge = current.find((a) => a.party === 'customer')?.customerChargeId;
      const fresh: BdAllocation[] = next.filter((r) => r.value > 0).map((r) => ({
        id: bdId(), incidentId, party: r.party, mode: r.mode, value: r.value, amount: r.amount, reason: reason.trim(),
        decidedBy: by, decidedAt: at, ...(r.party === 'customer' && prevCharge ? { customerChargeId: prevCharge } : {}),
      }));
      set((s) => ({ allocations: [...s.allocations, ...fresh] }));
      fresh.forEach((a) => save('allocations', 'insert', a));
      event(incidentId, by, 'allocation',
        `Responsibility decided: ${fresh.map((a) => `${PARTY_LABEL[a.party]} ${rs(a.amount)}${a.mode === 'percent' ? ` (${a.value}%)` : ''}`).join(', ')}${l.cost - fresh.reduce((s, a) => s + a.amount, 0) > 0.5 ? ' — rest pending investigation' : ''}. Reason: ${reason.trim()}`);
      return null;
    },

    postPayment: (x) => {
      if (used(x.key)) return null;    // already posted (double click / retry)
      const i = incidentOf(x.incidentId);
      if (!i) return 'Incident not found.';
      if (!(x.amount > 0)) return 'Enter an amount above zero.';
      if (x.kind === 'vendor_payment' && x.expenseId) {
        const e = get().expenses.find((v) => v.id === x.expenseId);
        const paid = get().payments.filter((p) => p.expenseId === x.expenseId && p.status === 'posted' && p.kind === 'vendor_payment').reduce((s, p) => s + p.amount, 0);
        if (e && x.amount > e.amount - paid + 0.5) return `Only ${rs(e.amount - paid)} is left to pay on this expense.`;
      }
      const p: BdPayment = {
        id: bdId(), incidentId: x.incidentId, expenseId: x.expenseId, kind: x.kind, payer: x.payer, payee: x.payee, amount: Math.round(x.amount * 100) / 100,
        method: x.method, reference: x.reference?.trim() || undefined, receiptPath: x.receiptPath, paidAt: x.paidAt ?? nowIso(),
        status: 'posted', idempotencyKey: x.key, createdBy: x.by, createdAt: nowIso(),
      };
      insertPayment(p);
      event(x.incidentId, x.by, 'payment', `${({ vendor_payment: 'Paid', reimbursement: 'Reimbursed', owner_offset: 'Deducted from owner payout', customer_charge: 'Added to customer bill', refund: 'Refunded' } as const)[x.kind]}: ${rs(p.amount)} — ${PARTY_LABEL[p.payer]} → ${p.payee}${p.method ? ` by ${p.method}` : ''}${p.reference ? ` (ref ${p.reference})` : ''}`, { paymentId: p.id });
      return null;
    },

    reversePayment: (id, reason, by) => {
      const p = get().payments.find((x) => x.id === id);
      if (!p || p.status === 'reversed') return null;
      if (!reason.trim()) return 'Say why this payment is reversed.';
      const b = bookingOf(p.incidentId);
      if (p.kind === 'refund') return 'A refund is reversed in the booking’s payments (Booking → Payments).';
      if (p.kind === 'customer_charge' && b && p.bookingRef) useStore.getState().waiveCharge(b.id, p.bookingRef, by);
      if (p.kind === 'owner_offset' && b && p.bookingRef) {
        const err = useStore.getState().reverseOwnerPayoutAdjustment(b.id, p.bookingRef, by);
        if (err) return err;
      }
      const patch = { status: 'reversed' as const, reversedBy: by, reversedAt: nowIso(), reverseReason: reason.trim() };
      set((s) => ({ payments: s.payments.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      save('payments', 'update', { id }, patch);
      if (p.kind === 'customer_charge') {
        const a = get().allocations.find((x) => x.incidentId === p.incidentId && !x.supersededAt && x.party === 'customer' && x.customerChargeId === p.bookingRef);
        if (a) {
          set((s) => ({ allocations: s.allocations.map((x) => (x.id === a.id ? { ...x, customerChargeId: undefined } : x)) }));
          save('allocations', 'update', { id: a.id }, { customerChargeId: null });
        }
      }
      event(p.incidentId, by, 'payment', `Reversed: ${rs(p.amount)} (${p.kind.replace('_', ' ')}) — ${reason.trim()}`, { paymentId: id });
      return null;
    },

    chargeCustomerShare: (incidentId, by, key) => {
      if (used(key)) return null;
      const i = incidentOf(incidentId); const b = bookingOf(incidentId);
      if (!i || !b) return 'Booking not found.';
      const l = ledgerFor(incidentId, get());
      const due = Math.round(l.outstanding.customer * 100) / 100;
      if (!(due > 0.5)) return 'Nothing is outstanding from the customer.';
      const chargeId = bdId();
      useStore.getState().addCharge(b.id, { id: chargeId, kind: 'Damage', amount: due, date: nowIso().slice(0, 10), note: `Breakdown ${i.ref} — customer's share`, by });
      const p: BdPayment = {
        id: bdId(), incidentId, kind: 'customer_charge', payer: 'customer', payee: 'company', amount: due, paidAt: nowIso(),
        status: 'posted', idempotencyKey: key, bookingRef: chargeId, createdBy: by, createdAt: nowIso(),
      };
      insertPayment(p);
      const a = get().allocations.find((x) => x.incidentId === incidentId && !x.supersededAt && x.party === 'customer');
      if (a) {
        set((s) => ({ allocations: s.allocations.map((x) => (x.id === a.id ? { ...x, customerChargeId: chargeId } : x)) }));
        save('allocations', 'update', { id: a.id }, { customerChargeId: chargeId });
      }
      event(incidentId, by, 'approval', `Customer's share ${rs(due)} approved and added to the booking bill`, { paymentId: p.id });
      return null;
    },

    offsetOwnerShare: (incidentId, amount, by, key) => {
      if (used(key)) return null;
      const i = incidentOf(incidentId); const b = bookingOf(incidentId);
      if (!i || !b || !i.vehicleId) return 'Booking not found.';
      const l = ledgerFor(incidentId, get());
      if (!(amount > 0)) return 'Enter the amount to deduct.';
      if (amount > l.outstanding.owner + 0.5) return `The owner owes ${rs(Math.max(0, l.outstanding.owner))} — you can't deduct more.`;
      const adjId = bdId();
      const err = useStore.getState().adjustOwnerPayout(b.id, { id: adjId, vehicleId: i.vehicleId, amount, reason: `Breakdown ${i.ref} — owner's share`, source: i.ref, by });
      if (err) return err;
      insertPayment({
        id: bdId(), incidentId, kind: 'owner_offset', payer: 'owner', payee: 'company', amount, paidAt: nowIso(),
        status: 'posted', idempotencyKey: key, bookingRef: adjId, createdBy: by, createdAt: nowIso(),
      });
      event(incidentId, by, 'payment', `${rs(amount)} deducted from the owner's payout for this booking`);
      return null;
    },

    approveQuote: (solutionId, by) => {
      const s = solutionOf(solutionId);
      if (!s) return 'Solution not found.';
      if (!(s.quoteAmount && s.quoteAmount > 0)) return 'Enter the garage quotation amount first.';
      patchSolution(solutionId, { quoteApprovedBy: by, quoteApprovedAt: nowIso(), status: s.status === 'planned' ? 'in_progress' : s.status });
      event(s.incidentId, by, 'approval', `Garage quotation ${rs(s.quoteAmount)} approved`, { solutionId });
      return null;
    },

    // The garage's statement — the vehicle stays under maintenance until "Mark vehicle as ready"
    confirmRoadworthy: (solutionId, by) => {
      const s = solutionOf(solutionId);
      if (!s) return 'Solution not found.';
      patchSolution(solutionId, { roadworthyBy: by, roadworthyAt: nowIso() });
      event(s.incidentId, by, 'approval', 'Garage confirmed the vehicle roadworthy — waiting for admin confirmation to return it to service', { solutionId });
      return null;
    },

    activeHold: (vehicleId) => (vehicleId ? get().incidents.find((x) => x.holdVehicleId === vehicleId && !x.holdClearedAt) : undefined),

    markVehicleReady: async (incidentId, x) => {
      const i = incidentOf(incidentId);
      if (!i) return 'Breakdown not found.';
      if (!x.isAdmin) return 'Only an admin can return a vehicle to service.';
      if (!i.holdVehicleId || i.holdClearedAt) return 'This breakdown has no active maintenance hold.';
      if (!x.outcome.trim()) return 'Record the repair or inspection outcome.';
      if (!x.safe) return 'Confirm the vehicle is safe for rental.';
      if (x.approvedAt && new Date(x.approvedAt).getTime() > Date.now() + 5 * 60e3) return 'The approval time cannot be in the future.';
      const st = useStore.getState();
      const vid = i.holdVehicleId;
      let status: string;
      if (supabaseEnabled) {
        try { status = await markReadyOnServer({ incidentId, outcome: x.outcome.trim(), safe: x.safe, comments: x.comments, approvedAt: x.approvedAt, by: x.by }); }
        catch (e) { return (e as Error).message; }
      } else {
        status = st.bookings.some((b) => b.vehicleId === vid && b.status === 'Ongoing') ? 'Ongoing'
          : st.bookings.some((b) => b.vehicleId === vid && b.status === 'Confirmed') ? 'Reserved' : 'Available';
      }
      const patch: Partial<BdIncident> = {
        holdClearedAt: nowIso(), holdClearedBy: x.by, readyOutcome: x.outcome.trim(), readySafeConfirmed: true,
        readyComments: x.comments?.trim() || undefined, readyApprovedAt: x.approvedAt ?? nowIso(), updatedAt: nowIso(),
      };
      set((s) => ({ incidents: s.incidents.map((v) => (v.id === incidentId ? { ...v, ...patch } : v)) }));
      // the database already set the status (and keeps it in step); update this screen without writing again
      useStore.setState((s) => ({ vehicles: s.vehicles.map((v) => (v.id === vid ? { ...v, status: status as typeof v.status } : v)) }));
      // timeline (with Supabase the server already saved this entry — shown here without writing it twice)
      const e: BdEvent = { id: bdId(), incidentId, at: nowIso(), by: x.by, type: 'ready', text: `Vehicle confirmed safe and returned to service (${status}) — ${x.outcome.trim()}` };
      set((s) => ({ events: [...s.events, e] }));
      notify(incidentId, 'Vehicle ready', `${st.vehicles.find((v) => v.id === vid)?.vehicleNumber ?? 'Vehicle'} back in service (${status})`);
      return null;
    },

    linkLatestExchange: (solutionId, by) => {
      const s = solutionOf(solutionId);
      const b = s && bookingOf(s.incidentId);
      const ex = b?.exchanges?.[b.exchanges.length - 1];
      if (!s || !b || !ex) return 'No vehicle exchange found on the booking.';
      if (get().solutions.some((x) => x.exchangeId === ex.id)) return null;   // already linked
      const st = useStore.getState();
      const from = st.vehicles.find((v) => v.id === ex.fromVehicleId), to = st.vehicles.find((v) => v.id === ex.toVehicleId);
      const diff = (to?.dailyRent ?? 0) - (from?.dailyRent ?? 0);
      patchSolution(solutionId, {
        exchangeId: ex.id, fromVehicleId: ex.fromVehicleId, toVehicleId: ex.toVehicleId, deliveryAt: ex.at,
        rateScenario: diff > 0 ? 'higher' : diff < 0 ? 'lower' : 'same', rateDifference: diff, status: 'in_progress', startedAt: s.startedAt ?? nowIso(),
      });
      patchIncident(s.incidentId, { vehicleId: s.fromVehicleId ?? ex.fromVehicleId });
      notify(s.incidentId, 'Replacement arranged', `${from?.vehicleNumber ?? '—'} → ${to?.vehicleNumber ?? '—'}`);
      event(s.incidentId, by, 'solution', `Vehicle exchanged: ${from?.vehicleNumber ?? '—'} → ${to?.vehicleNumber ?? '—'} (${diff === 0 ? 'same daily rate' : diff > 0 ? `${rs(diff)}/day more` : `${rs(-diff)}/day less`})`, { solutionId, exchangeId: ex.id });
      return null;
    },

    applyPriceDifference: (solutionId, amount, by) => {
      const s = solutionOf(solutionId);
      const b = s && bookingOf(s.incidentId);
      const i = s && incidentOf(s.incidentId);
      if (!s || !b || !i) return 'Booking not found.';
      if (s.adjustmentApprovedAt) return 'A price change was already applied for this solution.';
      if (!amount) return 'Enter the agreed amount (+ the customer pays more, − a credit to the customer).';
      if (amount > 0) {
        useStore.getState().addCharge(b.id, { kind: 'Other', amount, date: nowIso().slice(0, 10), note: `Breakdown ${i.ref} — ${SOLUTION_LABEL[s.kind].toLowerCase()} price difference (customer approved)`, by });
      } else {
        useStore.getState().editBooking(b.id, { discount: (b.discount ?? 0) + -amount }, {
          by, changes: [`Credit ${rs(-amount)} for the replacement vehicle`], reason: `Breakdown ${i.ref}`,
        });
      }
      patchSolution(solutionId, { customerAdjustment: amount, adjustmentApprovedBy: by, adjustmentApprovedAt: nowIso() });
      event(s.incidentId, by, 'approval', amount > 0 ? `Customer agreed to pay ${rs(amount)} more — added to the booking bill` : `Credit of ${rs(-amount)} given to the customer`, { solutionId });
      return null;
    },

    applyOwnerShareAdjustment: (solutionId, amount, by) => {
      const s = solutionOf(solutionId);
      const b = s && bookingOf(s.incidentId);
      const i = s && incidentOf(s.incidentId);
      if (!s || !b || !i || !s.fromVehicleId) return 'Booking not found.';
      if (s.ownerShareAdjustment) return 'The owner share was already adjusted for this solution.';
      if (!(amount > 0)) return 'Enter the amount to take off the original owner’s payout.';
      const err = useStore.getState().adjustOwnerPayout(b.id, { vehicleId: s.fromVehicleId, amount, reason: `Breakdown ${i.ref} — days covered by a partner vehicle`, source: i.ref, by });
      if (err) return err;
      patchSolution(solutionId, { ownerShareAdjustment: amount });
      event(s.incidentId, by, 'approval', `Original owner's payout reduced by ${rs(amount)} for the days the partner vehicle covered`, { solutionId });
      return null;
    },

    proposeTermination: (solutionId, x, by) => {
      const s = solutionOf(solutionId);
      const b = s && bookingOf(s.incidentId);
      if (!s || !b) return 'Booking not found.';
      if (s.refundStatus === 'paid') return 'The refund is already paid.';
      if (!x.reason.trim()) return 'Enter the termination reason.';
      if (new Date(x.terminateAt).getTime() < new Date(`${b.startDate}T00:00:00`).getTime()) return 'The termination time is before the booking started.';
      const p = terminationProposal(b, x.terminateAt, x.deductions ?? 0, x.credits ?? 0);
      patchSolution(solutionId, {
        terminateAt: x.terminateAt, terminationReason: x.reason.trim(), usedDays: p.usedDays, unusedDays: p.unusedDays,
        originalTotal: s.originalTotal ?? p.originalTotal, previouslyPaid: p.previouslyPaid, deductions: x.deductions ?? 0,
        deductionsNote: x.deductionsNote, credits: x.credits ?? 0, refundProposed: p.refund,
        refundStatus: p.refund > 0 ? 'pending_approval' : 'not_required', refundApproved: undefined, refundApprovedBy: undefined, refundApprovedAt: undefined,
        status: s.status === 'planned' ? 'in_progress' : s.status,
      });
      event(s.incidentId, by, 'solution', `Termination proposed: ${p.usedDays} day(s) used, ${p.unusedDays} unused — proposed refund ${rs(p.refund)}`, { solutionId });
      return null;
    },

    approveRefund: (solutionId, amount, by) => {
      const s = solutionOf(solutionId);
      if (!s) return 'Solution not found.';
      if (s.refundStatus === 'paid') return 'The refund is already paid.';
      if (s.refundProposed === undefined) return 'Work out the termination first.';
      if (!(amount >= 0)) return 'Enter the refund amount.';
      if (amount > (s.previouslyPaid ?? 0) + 0.5) return `The customer has only paid ${rs(s.previouslyPaid ?? 0)}.`;
      patchSolution(solutionId, { refundApproved: amount, refundApprovedBy: by, refundApprovedAt: nowIso(), refundStatus: amount > 0 ? 'approved' : 'not_required' });
      if (amount > 0) notify(s.incidentId, 'Refund approved', `${rs(amount)} to pay the customer`);
      event(s.incidentId, by, 'approval', amount > 0 ? `Refund of ${rs(amount)} approved${Math.abs(amount - (s.refundProposed ?? 0)) > 0.5 ? ` (proposed ${rs(s.refundProposed ?? 0)})` : ''}` : 'No refund due — approved', { solutionId });
      return null;
    },

    amendBookingForTermination: (solutionId, by) => {
      const s = solutionOf(solutionId);
      const b = s && bookingOf(s.incidentId);
      const i = s && incidentOf(s.incidentId);
      if (!s || !b || !i) return 'Booking not found.';
      if (s.bookingAmendedAt) return null;
      if (!s.terminateAt || s.usedDays === undefined) return 'Work out the termination first.';
      if (!s.refundApprovedAt && s.refundStatus !== 'not_required') return 'Approve the refund first.';
      const at = new Date(s.terminateAt);
      const usedValue = Math.round(((s.originalTotal ?? b.totalAmount) * s.usedDays) / Math.max(1, (s.usedDays ?? 0) + (s.unusedDays ?? 0)) * 100) / 100;
      const earlierDays = (b.exchanges ?? []).reduce((sum, e) => sum + e.fromDays, 0);
      if (s.usedDays < earlierDays) return 'The used days are fewer than the days already counted for exchanged vehicles — check the termination time.';
      useStore.getState().editBooking(b.id, {
        endDate: at.toLocaleDateString('en-CA'), endTime: at.toTimeString().slice(0, 5), totalDays: s.usedDays, totalAmount: usedValue,
      }, {
        by, changes: [`Ended early on ${at.toLocaleDateString('en-GB')}: ${s.usedDays} day(s) used of ${(s.usedDays ?? 0) + (s.unusedDays ?? 0)}`, `Price Rs ${fmt(s.originalTotal ?? b.totalAmount)} → Rs ${fmt(usedValue)}`],
        reason: `Breakdown ${i.ref} — ${s.terminationReason ?? 'terminated'}`,
      });
      patchSolution(solutionId, { bookingAmendedAt: nowIso() });
      event(s.incidentId, by, 'approval', `Booking shortened to the used period (${s.usedDays} day(s), ${rs(usedValue)}) — original price ${rs(s.originalTotal ?? b.totalAmount)} kept on record`, { solutionId });
      return null;
    },

    payRefund: (solutionId, x, by) => {
      if (used(x.key)) return null;
      const s = solutionOf(solutionId);
      const b = s && bookingOf(s.incidentId);
      if (!s || !b) return 'Booking not found.';
      if (s.refundStatus === 'paid') return 'The refund is already paid.';
      if (s.refundStatus !== 'approved' || !(s.refundApproved && s.refundApproved > 0)) return 'Approve the refund amount first.';
      if (!s.bookingAmendedAt) return 'Shorten the booking to the used period first.';
      if (!x.method) return 'Choose how the refund was paid.';
      const entryId = bdId();
      useStore.getState().recordPayment(b.id, { id: entryId, kind: 'Refund', amount: s.refundApproved, method: x.method, receiptNo: x.reference, note: 'Breakdown termination refund', by });
      insertPayment({
        id: bdId(), incidentId: s.incidentId, kind: 'refund', payer: 'company', payee: 'customer', amount: s.refundApproved,
        method: x.method, reference: x.reference, paidAt: nowIso(), status: 'posted', idempotencyKey: x.key, bookingRef: entryId,
        createdBy: by, createdAt: nowIso(),
      });
      patchSolution(solutionId, { refundStatus: 'paid', refundMethod: x.method, refundReference: x.reference, refundPaidAt: nowIso(), refundPaidBy: by });
      event(s.incidentId, by, 'payment', `Refund paid: ${rs(s.refundApproved)} by ${x.method}${x.reference ? ` (ref ${x.reference})` : ''}`, { solutionId });
      return null;
    },

    setRecovery: (solutionId, status, by) => {
      const s = solutionOf(solutionId);
      const b = s && bookingOf(s.incidentId);
      if (!s || !b) return 'Booking not found.';
      patchSolution(solutionId, { recoveryStatus: status });
      event(s.incidentId, by, 'update', `Vehicle recovery: ${status.replace('_', ' ')}`, { solutionId });
      if (status === 'recovered' && s.bookingAmendedAt && b.status === 'Ongoing') {
        useStore.getState().editBooking(b.id, { status: 'Completed', returnAt: nowIso() }, { by, changes: ['Status: Ongoing → Completed (terminated after breakdown)'] });
      }
      return null;
    },

    addDocument: (d) => {
      const doc: BdDocument = { ...d, id: bdId(), uploadedAt: nowIso() };
      set((s) => ({ documents: [...s.documents, doc] }));
      save('documents', 'insert', doc);
      event(d.incidentId, d.uploadedBy, 'document', `${d.kind === 'photo' ? 'Photo' : 'Document'} added: ${d.name}`);
    },

    resolve: (incidentId, resolution, by) => {
      const i = incidentOf(incidentId);
      if (!i) return 'Incident not found.';
      const sols = get().solutions.filter((s) => s.incidentId === incidentId && s.status !== 'cancelled');
      if (!sols.some((s) => s.status === 'completed')) return 'Complete at least one solution before resolving.';
      if (sols.some((s) => s.status === 'planned' || s.status === 'in_progress')) return 'Finish or cancel the solutions still in progress.';
      const term = sols.find((s) => s.kind === 'termination');
      if (term && term.recoveryStatus !== 'recovered') return 'The vehicle has not been recovered yet.';
      if (!resolution.trim()) return 'Write how the breakdown was resolved.';
      patchIncident(incidentId, { status: 'resolved', resolution: resolution.trim(), resolvedAt: nowIso() });
      event(incidentId, by, 'status', `Resolved — ${resolution.trim()}`);
      notify(incidentId, 'Incident resolved', resolution.trim());
      const l = ledgerFor(incidentId, get());
      if (!l.settled) {
        useStore.getState().addNotification({ type: 'General', title: `Breakdown ${i.ref}: payments outstanding`, message: l.blockers.join(' · '), relatedId: i.bookingId });
      }
      return null;
    },

    close: (incidentId, by) => {
      const i = incidentOf(incidentId);
      if (!i) return 'Incident not found.';
      if (i.status !== 'resolved') return 'Resolve the incident first.';
      const l = ledgerFor(incidentId, get());
      if (!l.settled) return `Not settled yet: ${l.blockers.join(' · ')}`;
      patchIncident(incidentId, { status: 'closed', closedAt: nowIso() });
      event(incidentId, by, 'status', `Closed — all costs settled (total ${rs(l.cost)}, company paid ${rs(l.companyNet)})`);
      return null;
    },

    setDisputed: (incidentId, on, reason, by) => {
      const i = incidentOf(incidentId);
      if (!i) return;
      patchIncident(incidentId, { status: on ? 'disputed' : 'open' });
      event(incidentId, by, 'status', on ? `Marked as disputed — ${reason || 'under investigation'}` : `Dispute settled — ${reason || 'back to open'}`);
    },

    reopen: (incidentId, reason, by) => {
      const i = incidentOf(incidentId);
      if (!i) return;
      patchIncident(incidentId, { status: 'open', closedAt: undefined });
      event(incidentId, by, 'status', `Reopened — ${reason || 'more work needed'}`);
    },
  };
}, {
  name: 'emrac-breakdowns-v1',
  // With Supabase the records live in the database; offline demo mode keeps them in this browser
  partialize: (s) => (supabaseEnabled ? {} : {
    incidents: s.incidents, events: s.events, solutions: s.solutions, expenses: s.expenses,
    allocations: s.allocations, payments: s.payments, documents: s.documents,
  }),
}));

/* ── Selectors ─────────────────────────────────────────────────────────────── */
export const forIncident = <T extends { incidentId: string }>(list: T[], id: string) => list.filter((x) => x.incidentId === id);
export const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export { legsOf };
