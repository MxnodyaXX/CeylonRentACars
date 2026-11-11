import type { Booking, Commission, Expense, Inquiry, Notification, Owner, Vehicle, VehicleHandover } from '../types';
import { legsOf } from './exchange';

/*
 * The admin shows records from 1 October 2026 only. Older records are NOT deleted — they stay in the database and
 * are just left out when the data is loaded, together with every figure worked out from them (vehicle revenue and
 * rentals, owner earnings and pending payouts). An admin can show them again from Settings (this browser only).
 */
export const RECORDS_FROM = '2026-10-01';
const KEY = 'crc.showOlderRecords';

export function showingOlder(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setShowingOlder(on: boolean) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* storage blocked: stays hidden */ }
}

interface Loaded {
  vehicles: Vehicle[]; owners: Owner[]; bookings: Booking[]; inquiries: Inquiry[]; commissions: Commission[];
  expenses: Expense[]; notifications: Notification[]; handovers: VehicleHandover[];
}

/** a booking that belongs to the shown period: still live, or ended on / after the start date */
export const isShown = (b: Booking, from = RECORDS_FROM) =>
  b.status === 'Ongoing' || b.status === 'Confirmed' || (b.endDate ?? '') >= from;

/** the loaded data without the older records, and the totals worked out again from what's left (nothing is saved) */
export function withoutOlder<T extends Loaded>(d: T, from = RECORDS_FROM): T & { hiddenCount: number } {
  if (showingOlder()) return { ...d, hiddenCount: 0 };
  const day = (s?: string) => (s ?? '').slice(0, 10);
  const bookings = d.bookings.filter((b) => isShown(b, from));
  const ids = new Set(bookings.map((b) => b.id));
  const commissions = d.commissions.filter((c) => ids.has(c.bookingId));
  const expenses = d.expenses.filter((e) => day(e.date) >= from);
  const handovers = d.handovers.filter((h) => ids.has(h.bookingId));
  const inquiries = d.inquiries.filter((i) => day(i.createdAt) >= from || i.status === 'Pending');
  const notifications = d.notifications.filter((n) => day(n.createdAt) >= from);

  // the totals the rest of the admin reads, from the shown records only (as "Recalculate statistics" does)
  const live = bookings.filter((b) => b.status !== 'Cancelled');
  const liveIds = new Set(live.map((b) => b.id));
  const vAgg: Record<string, { revenue: number; count: number }> = {};
  live.forEach((b) => legsOf(b).forEach((leg) => { const a = (vAgg[leg.vehicleId] ??= { revenue: 0, count: 0 }); a.revenue += leg.revenue; a.count += 1; }));
  const oAgg: Record<string, { total: number; pending: number }> = {};
  commissions.forEach((c) => {
    if (!liveIds.has(c.bookingId)) return;
    const a = (oAgg[c.ownerId] ??= { total: 0, pending: 0 });
    a.total += c.ownerPayout; if (c.status !== 'Paid') a.pending += c.ownerPayout;
  });
  const vehicles = d.vehicles.map((v) => ({ ...v, revenue: vAgg[v.id]?.revenue ?? 0, rentCount: vAgg[v.id]?.count ?? 0 }));
  const owners = d.owners.map((o) => ({ ...o, totalEarnings: oAgg[o.id]?.total ?? 0, pendingPayout: oAgg[o.id]?.pending ?? 0 }));

  return { ...d, vehicles, owners, bookings, commissions, expenses, handovers, inquiries, notifications,
    hiddenCount: d.bookings.length - bookings.length };
}
