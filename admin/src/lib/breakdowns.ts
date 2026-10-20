import { supabase, supabaseEnabled } from './supabase';

/*
 * Breakdown management — data model and database access (tables in
 * supabase/security/06_breakdowns.sql). Column names are the snake_case form of these fields.
 * Nothing is ever deleted: expenses are voided, payments reversed, allocations superseded.
 */

export type BdCategory = 'mechanical' | 'electrical' | 'battery' | 'tyre' | 'overheating' | 'accident' | 'fuel' | 'other';
export type BdStatus = 'open' | 'resolved' | 'closed' | 'disputed' | 'cancelled';
export type BdUrgency = 'low' | 'normal' | 'high' | 'emergency';
export type SolutionKind = 'onsite_repair' | 'replacement' | 'partner_vehicle' | 'towing_garage' | 'alt_transport' | 'termination';
export type SolutionStatus = 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type Party = 'owner' | 'customer' | 'company' | 'insurance';
export type ExpenseCategory = 'callout' | 'labour' | 'parts' | 'transport' | 'towing' | 'garage' | 'replacement' | 'partner' | 'alt_transport' | 'tax' | 'discount' | 'other';
export type PaymentKind = 'vendor_payment' | 'reimbursement' | 'owner_offset' | 'customer_charge' | 'refund';

export interface BdIncident {
  id: string; ref: string; bookingId: string; vehicleId?: string; ownerId?: string;
  reportedAt: string; occurredAt?: string; location?: string; lat?: number; lng?: number;
  reportedBy: 'customer' | 'owner' | 'admin' | 'driver'; contactPhone?: string;
  mileage?: number; fuel?: string; category: BdCategory; description: string;
  driveable: 'yes' | 'limited' | 'no' | 'unknown'; passengersSafe: 'safe' | 'at_risk' | 'unknown'; urgency: BdUrgency;
  causeStatus: 'pending' | 'assessed'; cause?: string; status: BdStatus; assignedTo?: string;
  resolution?: string; resolvedAt?: string; closedAt?: string; notes?: string;
  createdBy: string; createdAt: string; updatedAt: string;
  // maintenance hold on the vehicle (07_breakdown_holds.sql) — cleared only by "Mark vehicle as ready"
  holdVehicleId?: string; holdPlacedAt?: string; holdClearedAt?: string; holdClearedBy?: string;
  readyOutcome?: string; readySafeConfirmed?: boolean; readyComments?: string; readyApprovedAt?: string;
}

export interface BdEvent { id: string; incidentId: string; at: string; by: string; type: string; text: string; data?: Record<string, unknown> }

export interface BdSolution {
  id: string; incidentId: string; kind: SolutionKind; status: SolutionStatus; result?: string;
  startedAt?: string; completedAt?: string; notes?: string; createdBy: string; createdAt: string; updatedAt: string;
  // provider
  providerName?: string; providerCompany?: string; providerPhone?: string; providerArea?: string;
  assignedBy?: string; assignedAt?: string; acceptance?: 'pending' | 'accepted' | 'declined';
  departAt?: string; arriveAt?: string; workStartAt?: string; workEndAt?: string; travelKm?: number;
  // on-site repair
  repairLocation?: string; diagnosis?: string; workDone?: string; partsReplaced?: string; remarks?: string;
  repairResult?: 'repaired' | 'partial' | 'unsuccessful' | 'unsafe' | 'inspection_needed' | 'needs_tow_or_replacement';
  clearanceBy?: string; clearanceAt?: string; customerConfirmedBy?: string; customerConfirmedAt?: string;
  // towing & garage
  pickupLocation?: string; destination?: string; garageName?: string; garageContact?: string; mechanic?: string;
  inspectionReport?: string; quoteAmount?: number; quoteApprovedBy?: string; quoteApprovedAt?: string; estCompletion?: string;
  invoiceAmount?: number; roadworthyBy?: string; roadworthyAt?: string; dispatchAt?: string; collectedAt?: string; deliveredAt?: string;
  // replacement
  exchangeId?: string; fromVehicleId?: string; toVehicleId?: string; rateScenario?: 'same' | 'higher' | 'lower'; rateDifference?: number;
  customerAdjustment?: number; adjustmentApprovedBy?: string; adjustmentApprovedAt?: string;
  deliveryDriver?: string; deliveryDriverPhone?: string; deliveryLocation?: string; deliveryAt?: string;
  collectionPerson?: string; collectionLocation?: string; collectionAt?: string;
  insuranceChecked?: boolean; driverChecked?: boolean; customerAckAt?: string;
  // partner vehicle
  partnerVehicle?: string; partnerReg?: string; partnerCategory?: string; periodStart?: string; periodEnd?: string;
  quotedAmount?: number; agreedAmount?: number; depositAmount?: number; ownerShareAdjustment?: number; companySubsidy?: number;
  // alternative transport
  transportType?: string; passengers?: number; fare?: number;
  // termination & refund
  terminateAt?: string; terminationReason?: string; customerAgreedAt?: string; usedDays?: number; unusedDays?: number;
  originalTotal?: number; previouslyPaid?: number; deductions?: number; deductionsNote?: string; credits?: number;
  refundProposed?: number; refundApproved?: number; refundApprovedBy?: string; refundApprovedAt?: string;
  refundStatus?: 'not_required' | 'pending_approval' | 'approved' | 'paid'; refundMethod?: string; refundReference?: string;
  refundPaidAt?: string; refundPaidBy?: string; bookingAmendedAt?: string; recoveryStatus?: 'pending' | 'in_progress' | 'recovered';
}

export interface BdExpense {
  id: string; incidentId: string; solutionId?: string; category: ExpenseCategory; description: string;
  quantity: number; unitCost: number; amount: number; vendor?: string;
  createdBy: string; createdAt: string; voidedAt?: string; voidedBy?: string; voidReason?: string;
}

export interface BdAllocation {
  id: string; incidentId: string; party: Party; mode: 'percent' | 'amount'; value: number; amount: number;
  reason: string; decidedBy: string; decidedAt: string; supersededAt?: string; customerChargeId?: string;
}

export interface BdPayment {
  id: string; incidentId: string; expenseId?: string; kind: PaymentKind; payer: Party; payee: string; amount: number;
  method?: string; reference?: string; receiptPath?: string; paidAt: string; status: 'posted' | 'reversed';
  reversedBy?: string; reversedAt?: string; reverseReason?: string; idempotencyKey: string; bookingRef?: string;
  createdBy: string; createdAt: string;
}

export interface BdDocument {
  id: string; incidentId: string; solutionId?: string; kind: 'photo' | 'video' | 'receipt' | 'report' | 'agreement' | 'other';
  name: string; path: string; uploadedBy: string; uploadedAt: string;
}

/** A replacement period (08_breakdown_swaps.sql) — separate from the booking's "Exchange vehicle" records */
export interface BdSwap {
  id: string; incidentId: string; solutionId: string; bookingId: string; originalVehicleId?: string;
  source: 'fleet' | 'partner'; replacementVehicleId?: string; partnerName?: string; partnerVehicle?: string; partnerReg?: string;
  status: 'active' | 'closed';
  outAt: string; outBy: string; outLocation?: string;
  originalOdometer?: number; originalFuel?: string; replacementOdometerOut?: number; replacementFuelOut?: string;
  replacementRate?: number; outNotes?: string;
  outcome?: 'swapped_back' | 'customer_kept'; backAt?: string; backBy?: string; backLocation?: string;
  replacementOdometerIn?: number; replacementFuelIn?: string; originalOdometerBack?: number; originalFuelBack?: string;
  replacementTo?: string; days?: number; replacementPayout?: number; originalDeduction?: number;
  commissionId?: string; adjustmentId?: string; backNotes?: string;
  createdAt: string; updatedAt: string;
}

export interface BdData {
  incidents: BdIncident[]; events: BdEvent[]; solutions: BdSolution[]; expenses: BdExpense[];
  allocations: BdAllocation[]; payments: BdPayment[]; documents: BdDocument[];
}

/* ── Labels ────────────────────────────────────────────────────────────────── */

export const CATEGORY_LABEL: Record<BdCategory, string> = {
  mechanical: 'Mechanical failure', electrical: 'Electrical failure', battery: 'Battery problem', tyre: 'Tyre problem',
  overheating: 'Overheating', accident: 'Accident', fuel: 'Fuel-related problem', other: 'Other',
};
/** Categories where the vehicle must not be driven until a professional says it is safe */
export const UNSAFE_CATEGORIES: BdCategory[] = ['mechanical', 'overheating', 'accident', 'electrical'];

export const SOLUTION_LABEL: Record<SolutionKind, string> = {
  onsite_repair: 'On-site repair', replacement: 'Vehicle replacement', partner_vehicle: 'Partner vehicle',
  towing_garage: 'Towing & garage repair', alt_transport: 'Alternative transport', termination: 'Termination & refund',
};
export const SOLUTION_HINT: Record<SolutionKind, string> = {
  onsite_repair: 'Send a technician to fix it where it stopped',
  replacement: 'Give the customer another car from our fleet',
  partner_vehicle: 'Hire a car from an outside partner when none of ours is free',
  towing_garage: 'Tow the car to a garage and track the repair',
  alt_transport: 'Taxi / van / driver while the customer waits',
  termination: 'End the booking early and work out the refund',
};
export const SOLUTION_STATUS_LABEL: Record<SolutionStatus, string> = {
  planned: 'Pending', in_progress: 'In progress', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
};
export const STATUS_LABEL: Record<BdStatus, string> = {
  open: 'Open', resolved: 'Resolved', closed: 'Closed', disputed: 'Disputed', cancelled: 'Cancelled',
};
export const PARTY_LABEL: Record<Party, string> = { owner: 'Vehicle owner', customer: 'Customer', company: 'Ceylon Rent A Cars', insurance: 'Insurance' };
export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  callout: 'Call-out charge', labour: 'Labour', parts: 'Parts', transport: 'Transport / fuel', towing: 'Towing',
  garage: 'Garage repair', replacement: 'Replacement delivery / recovery', partner: 'Partner vehicle', alt_transport: 'Alternative transport',
  tax: 'Tax', discount: 'Discount', other: 'Other',
};
export const PAYMENT_LABEL: Record<PaymentKind, string> = {
  vendor_payment: 'Paid to provider', reimbursement: 'Reimbursement', owner_offset: 'Deducted from owner payout',
  customer_charge: 'Added to customer bill', refund: 'Refund to customer',
};
export const REPAIR_RESULT_LABEL: Record<NonNullable<BdSolution['repairResult']>, string> = {
  repaired: 'Successfully repaired', partial: 'Partially repaired', unsuccessful: 'Repair unsuccessful', unsafe: 'Vehicle unsafe to operate',
  inspection_needed: 'Further inspection needed', needs_tow_or_replacement: 'Needs towing or replacement',
};

/** Incident lifecycle shown to staff: OPEN → IN PROGRESS → RESOLVED (closed = resolved and money settled) */
export type IncidentPhase = 'open' | 'in_progress' | 'resolved' | 'closed' | 'disputed' | 'cancelled';
export const PHASE_LABEL: Record<IncidentPhase, string> = {
  open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Resolved · closed', disputed: 'Disputed', cancelled: 'Cancelled',
};
export function phaseOf(i: BdIncident, solutions: BdSolution[]): IncidentPhase {
  if (i.status !== 'open') return i.status;
  return solutions.some((s) => s.incidentId === i.id && s.status !== 'cancelled') ? 'in_progress' : 'open';
}
export const READY_OUTCOMES = ['Repaired', 'Inspected — no fault found', 'Part replaced', 'Garage repair completed', 'Other'];

/** Server-side "Mark vehicle as ready" (public.breakdown_mark_vehicle_ready) — returns the vehicle's new status */
export async function markReadyOnServer(x: { incidentId: string; outcome: string; safe: boolean; comments?: string; approvedAt?: string; by: string }): Promise<string> {
  const { data, error } = await supabase.rpc('breakdown_mark_vehicle_ready', {
    p_incident_id: x.incidentId, p_outcome: x.outcome, p_safe: x.safe, p_comments: x.comments ?? null, p_approved_at: x.approvedAt ?? null, p_by: x.by,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/* ── Mapping (camelCase ⇄ snake_case) ─────────────────────────────────────── */

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** Insert: unset fields are left out (column defaults apply). Update (clear = true): a field set to
 *  undefined / '' in the patch is cleared in the database. */
export function toRow(o: Record<string, unknown>, clear = false): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) { if (clear) row[snake(k)] = null; continue; }
    row[snake(k)] = v === '' ? null : v;
  }
  return row;
}
export function fromRow<T>(r: Record<string, unknown>): T {
  const o: Record<string, unknown> = {};
  // numeric / integer columns arrive as numbers already; text (e.g. a reference "00123") stays text
  for (const [k, v] of Object.entries(r)) if (v !== null) o[camel(k)] = v;
  return o as T;
}

export const TABLES = {
  incidents: 'breakdown_incidents', events: 'breakdown_events', solutions: 'breakdown_solutions', expenses: 'breakdown_expenses',
  allocations: 'breakdown_allocations', payments: 'breakdown_payments', documents: 'breakdown_documents',
  swaps: 'breakdown_vehicle_swaps',
} as const;
export type TableKey = keyof typeof TABLES;

/** Every breakdown record. null = the tables are not set up yet (run 06_breakdowns.sql) */
export async function loadBreakdowns(): Promise<BdData | null> {
  if (!supabaseEnabled) return null;
  const keys = (Object.keys(TABLES) as TableKey[]).filter((k) => k !== 'swaps');   // swaps load on their own (08 may not be run yet)
  const results = await Promise.all(keys.map((k) => supabase.from(TABLES[k]).select('*')));
  const missing = results.find((r) => r.error && /breakdown_|does not exist|schema cache/i.test(r.error.message));
  if (missing) return null;
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  const out = {} as Record<TableKey, unknown[]>;
  keys.forEach((k, i) => { out[k] = (results[i].data ?? []).map((r) => fromRow(r as Record<string, unknown>)); });
  return out as unknown as BdData;
}

/** Breakdown vehicle swaps. null = 08_breakdown_swaps.sql not run yet */
export async function loadSwaps(): Promise<BdSwap[] | null> {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase.from(TABLES.swaps).select('*');
  if (error) {
    if (/breakdown_vehicle_swaps|does not exist|schema cache/i.test(error.message)) return null;
    throw error;
  }
  return (data ?? []).map((r) => fromRow<BdSwap>(r as Record<string, unknown>));
}

/** Days a replacement served: started 24-hour periods, at least one */
export const swapDays = (outAt: string, backAt: string) =>
  Math.max(1, Math.ceil((new Date(backAt).getTime() - new Date(outAt).getTime()) / 864e5 - 0.01));

export async function insertRow(table: TableKey, o: object) {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from(TABLES[table]).insert(toRow(o as Record<string, unknown>));
  if (error) throw error;
}
export async function updateRow(table: TableKey, id: string, patch: object) {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from(TABLES[table]).update(toRow(patch as Record<string, unknown>, true)).eq('id', id);
  if (error) throw error;
}

export const bdId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
/** BD-YYMMDD-XXXX */
export const newRef = (d = new Date()) =>
  `BD-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/**
 * Leftover solutions — picked but never used (still Pending, never edited, no costs or documents):
 *  • once another solution is being worked on, every untouched one added BEFORE that work is a leftover
 *    (one added afterwards on purpose with "Add another solution" is kept, even before it is filled in);
 *  • while nothing is in use yet, only the newest pick of each kind is kept.
 */
export function leftoverSolutions(sols: BdSolution[], expenses: { solutionId?: string; voidedAt?: string }[], documents: { solutionId?: string }[]): BdSolution[] {
  const untouched = (s: BdSolution) => s.status === 'planned'
    && Math.abs(Date.parse(s.updatedAt) - Date.parse(s.createdAt)) < 2000
    && !expenses.some((e) => e.solutionId === s.id && !e.voidedAt)
    && !documents.some((d) => d.solutionId === s.id);
  const open = sols.filter((s) => s.status !== 'cancelled').sort((a, c) => a.createdAt.localeCompare(c.createdAt));
  const idle = open.filter(untouched);
  const inUse = open.filter((s) => !untouched(s));
  if (inUse.length) {
    const lastWork = inUse.map((s) => s.updatedAt).sort().pop()!;
    return idle.filter((s) => s.createdAt < lastWork);
  }
  return idle.filter((s) => idle.some((x) => x.kind === s.kind && x.createdAt > s.createdAt));
}

/* ── What changed (timeline) ───────────────────────────────────────────────── */

const FIELD_LABEL: Record<string, string> = {
  result: 'Result', notes: 'Notes', providerName: 'Provider', providerCompany: 'Company / contact', providerPhone: 'Phone',
  providerArea: 'Service area', acceptance: 'Acceptance', departAt: 'Departed', arriveAt: 'Arrived', workStartAt: 'Work started',
  workEndAt: 'Work finished', travelKm: 'Travel km', repairLocation: 'Repair location', diagnosis: 'Diagnosis', workDone: 'Work done',
  partsReplaced: 'Parts replaced', remarks: 'Remarks', repairResult: 'Repair result', clearanceBy: 'Safety clearance by',
  clearanceAt: 'Safety clearance at', customerConfirmedBy: 'Customer confirmed by', customerConfirmedAt: 'Customer confirmed at',
  pickupLocation: 'Pickup location', destination: 'Destination', garageName: 'Garage', garageContact: 'Garage contact', mechanic: 'Mechanic',
  inspectionReport: 'Inspection report', quoteAmount: 'Quotation (Rs)', estCompletion: 'Estimated completion', invoiceAmount: 'Invoice (Rs)',
  dispatchAt: 'Tow dispatched', collectedAt: 'Collected', deliveredAt: 'Delivered', deliveryDriver: 'Delivery driver',
  deliveryDriverPhone: 'Driver phone', deliveryLocation: 'Delivery location', deliveryAt: 'Delivered at', collectionPerson: 'Collected by',
  collectionLocation: 'Collected from', collectionAt: 'Collected at', insuranceChecked: 'Insurance checked', driverChecked: 'Driver / licence checked',
  customerAckAt: 'Customer acknowledged', partnerVehicle: 'Partner vehicle', partnerReg: 'Registration', partnerCategory: 'Category',
  periodStart: 'Rental start', periodEnd: 'Rental end', quotedAmount: 'Partner quoted (Rs)', agreedAmount: 'Agreed amount (Rs)',
  depositAmount: 'Deposit (Rs)', transportType: 'Transport type', passengers: 'Passengers', fare: 'Fare (Rs)',
  terminateAt: 'Terminate at', terminationReason: 'Termination reason', customerAgreedAt: 'Customer agreed at', deductionsNote: 'Deductions note',
  refundMethod: 'Refund method', refundReference: 'Refund reference',
};
// bookkeeping fields set by the system — not shown as edits
const SKIP = new Set(['id', 'incidentId', 'kind', 'status', 'createdBy', 'createdAt', 'updatedAt', 'assignedBy', 'assignedAt']);

const showValue = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return v.toLocaleString('en-LK');
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
};

/** The fields a save really changed, with readable labels and values (for the timeline) */
export function describeChanges(before: object, patch: object): { label: string; from: string; to: string }[] {
  const b = before as Record<string, unknown>;
  return Object.entries(patch)
    .filter(([k, v]) => !SKIP.has(k) && showValue(v) !== showValue(b[k]))
    .map(([k, v]) => ({ label: FIELD_LABEL[k] ?? k.replace(/[A-Z]/g, (c) => ' ' + c.toLowerCase()), from: showValue(b[k]), to: showValue(v) }));
}
