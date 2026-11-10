import { create } from 'zustand';
import { supabase, supabaseEnabled } from './supabase';
import { bookingNo, rs } from './bookingRecord';
import { nameKey, referrerOf } from './channels';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import type { Booking, Commission, Expense, Owner, OwnerSettlement, SettlementLine, Vehicle } from '../types';

/*
 * Monthly owner settlements. Every booking is paid to the company; once a month the company pays
 * each owner for the rentals COMPLETED that month — whether or not the customer has paid in full:
 *   their share of each rental − amounts they owe back − company-paid expenses on their cars
 *   + referral fees they earned = net payout.
 * Anything completed earlier and not settled yet is carried into the month (marked as such).
 * Approval, payment and the owner's confirmation are database functions (17_owner_settlements.sql).
 */

export const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const periodLabel = (p: string) => new Date(`${p}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
export const periodEnd = (p: string) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
export const shiftPeriod = (p: string, by: number) => { const [y, m] = p.split('-').map(Number); return periodOf(new Date(y, m - 1 + by, 1)); };

/** The day a rental was completed: the return handover, else the booked return */
export const completedOn = (b: Booking) => (b.checklists?.return?.at ?? b.returnAt ?? b.endDate ?? '').slice(0, 10);

const dShort = (d: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const carName = (v?: Vehicle) => (v ? `${v.brand} ${v.model} ${v.vehicleNumber}` : 'Vehicle removed');

/** Owner payouts start with rentals completed on or after this day — older ones were settled before */
export const DEFAULT_FROM = '2026-10-01';
const INCLUDE_REFERRAL_FEES = false;

export interface MonthData { bookings: Booking[]; commissions: Commission[]; expenses: Expense[]; vehicles: Vehicle[]; owners: Owner[] }

/** Every line an owner is due for a month (and anything earlier not settled yet) */
export function linesFor(ownerId: string, period: string, d: MonthData, from = DEFAULT_FROM): SettlementLine[] {
  const end = periodEnd(period), start = `${period}-01`;
  if (end < from) return [];
  const owner = d.owners.find((o) => o.id === ownerId);
  const lines: SettlementLine[] = [];

  d.commissions.forEach((c) => {
    if (c.ownerId !== ownerId || c.status === 'Paid' || c.settlementId || !c.ownerPayout) return;
    const b = d.bookings.find((x) => x.id === c.bookingId);
    if (!b || b.status !== 'Completed') return;
    const on = completedOn(b);
    if (!on || on > end || on < from) return;
    const v = d.vehicles.find((x) => x.id === c.vehicleId);
    const neg = c.ownerPayout < 0;
    lines.push({
      kind: neg ? 'deduction' : 'rental', id: c.id, bookingId: b.id, date: on, amount: c.ownerPayout, carriedOver: on < start,
      label: neg ? (c.note ?? 'Owed back') : `${carName(v)} · ${b.customerName}`,
      detail: neg ? `${bookingNo(b)} · ${carName(v)}`
        : `${bookingNo(b)} · ${dShort(b.startDate)} – ${dShort(b.endDate)} · ${c.commissionAmount ? "final bill" : "rental"} ${rs(c.totalIncome)}${c.totalIncome !== c.ownerPayout ? ` − ${c.commissionAmount ? `company commission ${rs(c.commissionAmount)}${c.totalIncome - c.ownerPayout - c.commissionAmount > 0 ? ` − other ${rs(c.totalIncome - c.ownerPayout - c.commissionAmount)}` : ''}` : `company / fees ${rs(c.totalIncome - c.ownerPayout)}`}` : ''}${c.note ? ` · ${c.note}` : ''}`,
    });
  });

  // referral fees are no longer paid (all commission is the company's) — kept off the payouts
  if (owner && INCLUDE_REFERRAL_FEES) {
    d.bookings.forEach((b) => {
      const who = referrerOf(b.referral);
      if (!who || nameKey(who) !== nameKey(owner.name) || b.status !== 'Completed' || b.referralPaid || !(b.referralFee ?? 0)) return;
      const on = completedOn(b);
      if (!on || on > end || on < from) return;
      const v = d.vehicles.find((x) => x.id === b.vehicleId);
      lines.push({ kind: 'referral', id: b.id, bookingId: b.id, date: on, amount: b.referralFee!, carriedOver: on < start,
        label: `Referral fee · ${b.customerName}`, detail: `${bookingNo(b)} · ${carName(v)} · ${dShort(b.startDate)} – ${dShort(b.endDate)}` });
    });
  }

  d.expenses.forEach((e) => {
    if (e.paidBy !== 'company' || e.settlementId || !e.amount || (e.date ?? '') > end || (e.date ?? '') < from) return;
    const v = d.vehicles.find((x) => x.id === e.vehicleId);
    if (!v || v.ownerId !== ownerId) return;
    lines.push({ kind: 'expense', id: e.id, date: e.date, amount: -Math.abs(e.amount), carriedOver: e.date < start,
      label: `${e.category} · ${carName(v)}`, detail: `${e.description || 'Paid by the company'}${e.receipt ? ' · receipt on file' : ''}` });
  });

  const order = { rental: 0, referral: 1, deduction: 2, expense: 3 };
  return lines.sort((a, b) => order[a.kind] - order[b.kind] || a.date.localeCompare(b.date));
}

/** Rentals of a month that are NOT in the owner payouts, and why — so nothing goes missing silently */
export interface LeftOut { booking: Booking; ownerId?: string; reason: 'paid-by-hand' | 'not-completed' | 'no-payout-line'; payoutIds: string[]; amount: number }
export function leftOutOf(period: string, d: MonthData, from = DEFAULT_FROM): LeftOut[] {
  const start = `${period}-01`, end = periodEnd(period);
  if (end < from) return [];
  const lo = start < from ? from : start;
  const today = new Date().toISOString().slice(0, 10);
  const out: LeftOut[] = [];
  d.bookings.forEach((b) => {
    const owner = d.vehicles.find((v) => v.id === b.vehicleId)?.ownerId;
    if (b.status === 'Completed') {
      const on = completedOn(b);
      if (!on || on < lo || on > end) return;
      const lines = d.commissions.filter((c) => c.bookingId === b.id && c.ownerPayout);
      if (!lines.length) { out.push({ booking: b, ownerId: owner, reason: 'no-payout-line', payoutIds: [], amount: 0 }); return; }
      const byHand = lines.filter((c) => c.status === 'Paid' && !c.settlementId);
      if (byHand.length) out.push({ booking: b, ownerId: byHand[0].ownerId || owner, reason: 'paid-by-hand', payoutIds: byHand.map((c) => c.id), amount: byHand.reduce((s, c) => s + c.ownerPayout, 0) });
    } else if ((b.status === 'Ongoing' || b.status === 'Confirmed') && b.endDate >= lo && b.endDate <= end && b.endDate <= today) {
      out.push({ booking: b, ownerId: owner, reason: 'not-completed', payoutIds: [], amount: 0 });
    }
  });
  return out.sort((a, b) => a.booking.endDate.localeCompare(b.booking.endDate));
}

export function totalsOf(lines: SettlementLine[]) {
  const sum = (k: SettlementLine['kind']) => lines.filter((l) => l.kind === k).reduce((s, l) => s + l.amount, 0);
  const rentals = sum('rental'), deductions = sum('deduction'), expenses = -sum('expense'), referralFees = sum('referral');
  return { rentals, deductions, expenses, referralFees, net: rentals + deductions - expenses + referralFees };
}

/* ---------- reading and saving ---------- */

const fromDb = (r: Record<string, unknown>): OwnerSettlement => ({
  id: r.id as string, ownerId: r.owner_id as string, period: r.period as string, status: r.status as OwnerSettlement['status'],
  lines: (r.lines as SettlementLine[]) ?? [], rentals: Number(r.rentals ?? 0), deductions: Number(r.deductions ?? 0),
  expenses: Number(r.expenses ?? 0), referralFees: Number(r.referral_fees ?? 0), net: Number(r.net ?? 0),
  preparedBy: (r.prepared_by as string) ?? undefined, preparedAt: (r.prepared_at as string) ?? undefined,
  reviewNote: (r.review_note as string) ?? undefined, approvedBy: (r.approved_by as string) ?? undefined, approvedAt: (r.approved_at as string) ?? undefined,
  paidBy: (r.paid_by as string) ?? undefined, paidAt: (r.paid_at as string) ?? undefined, payMethod: (r.pay_method as string) ?? undefined,
  payRef: (r.pay_ref as string) ?? undefined, slipPath: (r.slip_path as string) ?? undefined, payAccountId: (r.pay_account_id as string) ?? undefined,
  ownerConfirmedAt: (r.owner_confirmed_at as string) ?? undefined, ownerNote: (r.owner_note as string) ?? undefined,
  createdAt: (r.created_at as string) ?? undefined,
});

// Offline demo: settlements live in this browser
const DEMO_KEY = 'crac-demo-settlements';
const demoRead = (): OwnerSettlement[] => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) ?? '[]'); } catch { return []; } };
const demoWrite = (l: OwnerSettlement[]) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(l)); } catch { /* private mode */ } };
const me = () => useAuthStore.getState().currentUser?.name ?? 'Admin';

const uid = () => 'st' + Math.random().toString(36).slice(2, 10);
const check = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

interface SettlementState {
  list: OwnerSettlement[];
  loaded: boolean;
  payoutDay: number;
  /** first day included in owner payouts (app_settings owner_payouts.from) */
  from: string;
  refresh: () => Promise<void>;
  /** Finance: send an owner's month for approval (or re-send one that was returned) */
  prepare: (ownerId: string, period: string, lines: SettlementLine[]) => Promise<void>;
  withdraw: (id: string) => Promise<void>;
  /** Admin: approve, or send back with a note */
  review: (id: string, approve: boolean, note?: string) => Promise<void>;
  /** Finance / admin: the transfer was made */
  pay: (id: string, p: { method: string; ref: string; paidAt?: string; slip?: string }) => Promise<void>;
  /** The owner: received */
  confirm: (id: string, note?: string) => Promise<void>;
  setPayoutDay: (day: number) => Promise<void>;
}

export const useSettlements = create<SettlementState>()((set, get) => ({
  list: [],
  loaded: false,
  payoutDay: 5,
  from: DEFAULT_FROM,

  refresh: async () => {
    if (!supabaseEnabled) { set({ list: demoRead(), loaded: true }); return; }
    const [r, s] = await Promise.all([
      supabase.from('owner_settlements').select('*').order('period', { ascending: false }),
      supabase.from('app_settings').select('value').eq('key', 'owner_payouts').maybeSingle(),
    ]);
    // before 17_owner_settlements.sql is run the table doesn't exist — show nothing rather than fail
    const v = (s.data?.value ?? {}) as { day?: number; from?: string };
    set({ list: r.error ? [] : (r.data ?? []).map(fromDb), loaded: true, payoutDay: Number(v.day ?? 5) || 5,
          from: /^\d{4}-\d{2}-\d{2}$/.test(v.from ?? '') ? v.from! : DEFAULT_FROM });
    if (r.error) console.warn('[settlements]', r.error.message);
  },

  prepare: async (ownerId, period, lines) => {
    const t = totalsOf(lines);
    const existing = get().list.find((x) => x.ownerId === ownerId && x.period === period);
    if (!supabaseEnabled) {
      const row: OwnerSettlement = { id: existing?.id ?? uid(), ownerId, period, status: 'pending_approval', lines, ...t, preparedBy: me(), preparedAt: new Date().toISOString() };
      demoWrite([row, ...demoRead().filter((x) => x.id !== row.id)]);
      return get().refresh();
    }
    const row = { owner_id: ownerId, period, status: 'pending_approval', lines, rentals: t.rentals, deductions: t.deductions, expenses: t.expenses, referral_fees: t.referralFees, net: t.net, review_note: null };
    check(existing ? await supabase.from('owner_settlements').update(row).eq('id', existing.id) : await supabase.from('owner_settlements').insert({ id: uid(), ...row }));
    return get().refresh();
  },

  withdraw: async (id) => {
    if (!supabaseEnabled) { demoWrite(demoRead().filter((x) => x.id !== id)); return get().refresh(); }
    check(await supabase.from('owner_settlements').delete().eq('id', id));
    return get().refresh();
  },

  review: async (id, approve, note) => {
    if (!supabaseEnabled) {
      demoWrite(demoRead().map((x) => (x.id === id ? { ...x, status: approve ? 'approved' : 'returned', reviewNote: note, approvedBy: approve ? me() : undefined, approvedAt: approve ? new Date().toISOString() : undefined } : x)));
      return get().refresh();
    }
    check(await supabase.rpc('review_owner_settlement', { p_id: id, p_approve: approve, p_note: note ?? null }));
    return get().refresh();
  },

  pay: async (id, p) => {
    const s = get().list.find((x) => x.id === id);
    if (!supabaseEnabled) {
      // what the database function does: lines Paid and linked, expenses and referral fees settled
      const st = useStore.getState();
      const ids = (k: SettlementLine['kind'][]) => new Set(s?.lines.filter((l) => k.includes(l.kind)).map((l) => l.id));
      const comm = ids(['rental', 'deduction']), exp = ids(['expense']), ref = ids(['referral']);
      useStore.setState({
        commissions: st.commissions.map((c) => (comm.has(c.id) ? { ...c, status: 'Paid' as const, settlementId: id } : c)),
        expenses: st.expenses.map((e) => (exp.has(e.id) ? { ...e, settlementId: id } : e)),
        bookings: st.bookings.map((b) => (ref.has(b.id) ? { ...b, referralPaid: true, referralPaidAt: new Date().toISOString() } : b)),
      });
      demoWrite(demoRead().map((x) => (x.id === id ? { ...x, status: 'paid', paidBy: me(), paidAt: p.paidAt ?? new Date().toISOString(), payMethod: p.method, payRef: p.ref, slipPath: p.slip } : x)));
      return get().refresh();
    }
    check(await supabase.rpc('pay_owner_settlement', { p_id: id, p_method: p.method, p_ref: p.ref, p_paid_at: p.paidAt ?? null, p_slip: p.slip ?? null }));
    await Promise.all([get().refresh(), useStore.getState().loadAll()]);
  },

  confirm: async (id, note) => {
    if (!supabaseEnabled) {
      demoWrite(demoRead().map((x) => (x.id === id ? { ...x, status: 'confirmed', ownerConfirmedAt: new Date().toISOString(), ownerNote: note } : x)));
      return get().refresh();
    }
    check(await supabase.rpc('confirm_owner_settlement', { p_id: id, p_note: note ?? null }));
    return get().refresh();
  },

  setPayoutDay: async (day) => {
    const d = Math.min(28, Math.max(1, Math.round(day)));
    set({ payoutDay: d });
    if (!supabaseEnabled) return;
    check(await supabase.from('app_settings').upsert({ key: 'owner_payouts', value: { day: d, from: get().from }, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
  },
}));

/** The month to pay now: last month (payouts for a month are made in the next one) */
export const dueMonth = (today = new Date()) => shiftPeriod(periodOf(today), -1);

/** "5 November 2026" — the payout date for a month */
export const payoutDate = (period: string, day: number) => {
  const [y, m] = shiftPeriod(period, 1).split('-').map(Number);
  return new Date(y, m - 1, day);
};

export const STATUS_INFO: Record<OwnerSettlement['status'] | 'not_prepared', { label: string; cls: string }> = {
  not_prepared:     { label: 'Not prepared',       cls: 'bg-navy-50 text-navy-500' },
  pending_approval: { label: 'Waiting for Brian',  cls: 'bg-amber-50 text-amber-700' },
  returned:         { label: 'Sent back',          cls: 'bg-red-50 text-red-600' },
  approved:         { label: 'Approved — to pay',  cls: 'bg-sky-50 text-sky-700' },
  paid:             { label: 'Paid',               cls: 'bg-emerald-50 text-emerald-700' },
  confirmed:        { label: 'Received ✓',         cls: 'bg-emerald-100 text-emerald-800' },
};
