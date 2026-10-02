import { Booking, Vehicle, Expense, Inquiry } from '../types';
import { bookingNet, vehicleNetRevenue } from './revenue';

/* ─────────────────────────────────────────────────────────────────────────
   Dashboard analytics — pure, side-effect-free derivations.
   Every function takes already-scoped data (owner scope is applied by the
   caller) so the same helpers serve both the admin and owner dashboards.
   ──────────────────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const toTime = (d: string) => new Date(d).getTime();
const isActive = (b: Booking) => b.status !== 'Cancelled';

/* ── 1. Fleet utilization ──────────────────────────────────────────────────
   How busy each vehicle has been over a trailing window. Rented time is the
   overlap between each non-cancelled booking and the window, clamped to today
   so an ongoing rental only counts the days that have actually elapsed. */
export interface VehicleUtil { vehicle: Vehicle; rentedDays: number; windowDays: number; rate: number; }
export function fleetUtilization(
  vehicles: Vehicle[],
  bookings: Booking[],
  windowDays = 30,
): { perVehicle: VehicleUtil[]; fleetRate: number } {
  const now = Date.now();
  const winStart = now - windowDays * DAY;
  const perVehicle = vehicles
    .map((v) => {
      const rentedMs = bookings
        .filter((b) => b.vehicleId === v.id && isActive(b))
        .reduce((sum, b) => {
          const s = Math.max(toTime(b.startDate), winStart);
          const e = Math.min(toTime(b.endDate) + DAY, now); // endDate is inclusive
          return sum + Math.max(0, e - s);
        }, 0);
      const rentedDays = rentedMs / DAY;
      return { vehicle: v, rentedDays, windowDays, rate: Math.min(1, rentedDays / windowDays) };
    })
    .sort((a, b) => b.rate - a.rate);
  const fleetRate = perVehicle.length
    ? perVehicle.reduce((s, x) => s + x.rate, 0) / perVehicle.length
    : 0;
  return { perVehicle, fleetRate };
}

/* ── 2. Profit per vehicle ─────────────────────────────────────────────────
   Revenue (already rolled up on the vehicle) minus every expense logged
   against it. Surfaces cars that earn well but bleed on maintenance. */
export interface VehicleProfit { vehicle: Vehicle; revenue: number; expenses: number; profit: number; }
export function vehicleProfit(vehicles: Vehicle[], expenses: Expense[], bookings: Booking[]): VehicleProfit[] {
  const expByV = new Map<string, number>();
  expenses.forEach((e) => expByV.set(e.vehicleId, (expByV.get(e.vehicleId) ?? 0) + e.amount));
  return vehicles
    .map((v) => {
      const ex = expByV.get(v.id) ?? 0;
      const revenue = vehicleNetRevenue(v, bookings); // net of discounts
      return { vehicle: v, revenue, expenses: ex, profit: revenue - ex };
    })
    .sort((a, b) => b.profit - a.profit);
}

/* ── 3. Inquiry conversion funnel ──────────────────────────────────────────
   Conversion rate is measured over *decided* leads (Converted + Lost) so
   still-pending leads don't drag the rate down. */
export interface InquiryFunnel {
  total: number; pending: number; converted: number; lost: number;
  conversionRate: number; lostReasons: { reason: string; count: number }[];
}
export function inquiryFunnel(inquiries: Inquiry[]): InquiryFunnel {
  const pending = inquiries.filter((i) => i.status === 'Pending').length;
  const converted = inquiries.filter((i) => i.status === 'Converted').length;
  const lost = inquiries.filter((i) => i.status === 'Lost').length;
  const decided = converted + lost;
  const reasons = new Map<string, number>();
  inquiries
    .filter((i) => i.status === 'Lost')
    .forEach((i) => {
      const r = i.lostReason?.trim() || 'Unspecified';
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    });
  return {
    total: inquiries.length, pending, converted, lost,
    conversionRate: decided ? converted / decided : 0,
    lostReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/* ── 4. Lead source performance ────────────────────────────────────────────
   Where the business actually comes from, by booking count and revenue. */
export interface LeadSource { source: string; bookings: number; revenue: number; }
export function leadSources(bookings: Booking[]): LeadSource[] {
  const m = new Map<string, { bookings: number; revenue: number }>();
  bookings.filter(isActive).forEach((b) => {
    const key = b.referral?.trim() || 'Direct';
    const cur = m.get(key) ?? { bookings: 0, revenue: 0 };
    cur.bookings += 1;
    cur.revenue += bookingNet(b); // net of discounts
    m.set(key, cur);
  });
  return [...m.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
}

/* ── 5. Expense breakdown by category ──────────────────────────────────────*/
export interface ExpenseCat { category: string; amount: number; count: number; }
export function expensesByCategory(expenses: Expense[]): ExpenseCat[] {
  const m = new Map<string, { amount: number; count: number }>();
  expenses.forEach((e) => {
    const cur = m.get(e.category) ?? { amount: 0, count: 0 };
    cur.amount += e.amount;
    cur.count += 1;
    m.set(e.category, cur);
  });
  return [...m.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount);
}

/* ── 6. Overdue returns ────────────────────────────────────────────────────
   Ongoing rentals whose end date has already passed. */
export function overdueReturns(bookings: Booking[]): { booking: Booking; daysLate: number }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = today.getTime();
  return bookings
    .filter((b) => b.status === 'Ongoing' && toTime(b.endDate) < t)
    .map((b) => ({ booking: b, daysLate: Math.floor((t - toTime(b.endDate)) / DAY) }))
    .sort((a, b) => b.daysLate - a.daysLate);
}

/* ── 7. Upcoming pickups & returns ─────────────────────────────────────────*/
export interface Upcoming { pickups: Booking[]; returns: Booking[]; }
export function upcoming(bookings: Booking[], days = 7): Upcoming {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = now.getTime();
  const end = start + days * DAY;
  const inWin = (d: string) => toTime(d) >= start && toTime(d) <= end;
  return {
    pickups: bookings
      .filter((b) => b.status === 'Confirmed' && inWin(b.startDate))
      .sort((a, b) => toTime(a.startDate) - toTime(b.startDate)),
    returns: bookings
      .filter((b) => b.status === 'Ongoing' && inWin(b.endDate))
      .sort((a, b) => toTime(a.endDate) - toTime(b.endDate)),
  };
}

/* ── 8. Insurance expiry ───────────────────────────────────────────────────
   Vehicles whose policy expires within the window, plus any with no expiry
   date recorded at all (treated as needing attention). */
export interface InsuranceAlert { vehicle: Vehicle; expiryDate: string; daysLeft: number | null; missing: boolean; }
export function insuranceExpiring(vehicles: Vehicle[], withinDays = 30): InsuranceAlert[] {
  const now = Date.now();
  return vehicles
    .map((v) => {
      const exp = v.insurance?.expiryDate?.trim();
      if (!exp) return { vehicle: v, expiryDate: '', daysLeft: null, missing: true };
      return { vehicle: v, expiryDate: exp, daysLeft: Math.ceil((toTime(exp) - now) / DAY), missing: false };
    })
    .filter((a) => a.missing || (a.daysLeft !== null && a.daysLeft <= withinDays))
    .sort((a, b) => (a.daysLeft ?? -99999) - (b.daysLeft ?? -99999));
}

/* ── 9. Repeat vs new customers ────────────────────────────────────────────
   Customers are keyed by phone (the stable identifier across bookings). */
export interface CustomerStats {
  total: number; repeat: number; repeatRate: number;
  top: { name: string; phone: string; bookings: number; spend: number }[];
}
export function customerStats(bookings: Booking[]): CustomerStats {
  const m = new Map<string, { name: string; bookings: number; spend: number }>();
  bookings.filter(isActive).forEach((b) => {
    const cur = m.get(b.customerPhone) ?? { name: b.customerName, bookings: 0, spend: 0 };
    cur.bookings += 1;
    cur.spend += b.totalAmount;
    cur.name = b.customerName;
    m.set(b.customerPhone, cur);
  });
  const all = [...m.entries()].map(([phone, v]) => ({ phone, ...v }));
  const repeat = all.filter((c) => c.bookings > 1).length;
  return {
    total: all.length,
    repeat,
    repeatRate: all.length ? repeat / all.length : 0,
    top: [...all].sort((a, b) => b.spend - a.spend).slice(0, 5),
  };
}

/* ── 10. Rental averages ───────────────────────────────────────────────────*/
export interface RentalAverages { avgValue: number; avgDuration: number; count: number; }
export function rentalAverages(bookings: Booking[]): RentalAverages {
  const active = bookings.filter(isActive);
  const count = active.length;
  return {
    avgValue: count ? active.reduce((s, b) => s + b.totalAmount, 0) / count : 0,
    avgDuration: count ? active.reduce((s, b) => s + (b.totalDays || 0), 0) / count : 0,
    count,
  };
}

/* ── 11. Month-over-month revenue growth ───────────────────────────────────
   growth is null when there's no prior-month baseline to compare against. */
export function momGrowth(bookings: Booking[]): { thisMonth: number; lastMonth: number; growth: number | null } {
  const now = new Date();
  const sumMonth = (y: number, mo: number) =>
    bookings
      .filter((b) => {
        if (b.status === 'Cancelled') return false;
        const d = new Date(b.startDate);
        return d.getFullYear() === y && d.getMonth() === mo;
      })
      .reduce((s, b) => s + b.totalAmount, 0);
  const thisMonth = sumMonth(now.getFullYear(), now.getMonth());
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = sumMonth(prev.getFullYear(), prev.getMonth());
  return { thisMonth, lastMonth, growth: lastMonth > 0 ? (thisMonth - lastMonth) / lastMonth : null };
}

/* ── 12. Payment method mix ────────────────────────────────────────────────
   Distribution of money actually collected, by recorded payment method. */
export interface PayMethod { method: string; amount: number; count: number; }
export function paymentMethods(bookings: Booking[]): PayMethod[] {
  const m = new Map<string, { amount: number; count: number }>();
  bookings.filter(isActive).forEach((b) => {
    const key = b.paymentMethod?.trim() || 'Unspecified';
    const cur = m.get(key) ?? { amount: 0, count: 0 };
    cur.amount += b.paidAmount;
    cur.count += 1;
    m.set(key, cur);
  });
  return [...m.entries()]
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.amount - a.amount);
}

/* ── 13. Deposit liability & bad debt ──────────────────────────────────────
   Deposits held = money owed back to customers on live bookings.
   Bad debt = amounts written off as unrecoverable. */
export function depositAndDebt(bookings: Booking[]): { depositsHeld: number; badDebt: number } {
  let depositsHeld = 0;
  let badDebt = 0;
  bookings.forEach((b) => {
    if (b.status === 'Ongoing' || b.status === 'Confirmed') {
      depositsHeld += Math.max(0, (b.depositAmount ?? 0) - (b.depositReturned ?? 0));
    }
    badDebt += b.badDebt ?? 0;
  });
  return { depositsHeld, badDebt };
}
