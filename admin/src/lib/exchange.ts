import type { Booking, Commission } from '../types';
import { rentalDays } from './availability';

/*
 * Mid-trip vehicle exchange — how a booking's money is split between the cars it used.
 *
 *   • The car that was booked earns the agreed price for the days it was used (pro rata),
 *     minus the referral fee.
 *   • A replacement car earns its own daily rent × the days it was with the customer.
 *   • The customer still pays the booking price; the difference is the company's.
 *
 * Each car's part of the trip is a "leg". Past legs are fixed when the exchange is saved;
 * the current car's leg is the rest of the booking, so extending the trip only adds days to it.
 */

export interface Leg {
  vehicleId: string;
  days: number;
  revenue: number;       // share of the booking price
  payout: number;        // what the car's owner earns (incl. any compensation for lost days)
  referralFee: number;
  from?: string;         // ISO — when this car's part began (undefined = the booking start)
  until?: string;        // ISO — when it was exchanged (undefined = still with the customer)
  commissionId?: string; // past legs: their own commission row
}

/** Live payout adjustments (owner offsets) per car on this booking */
export const adjustmentsFor = (b: Booking, vehicleId: string) =>
  (b.payoutAdjustments ?? []).filter((a) => !a.reversedAt && a.vehicleId === vehicleId).reduce((s, a) => s + a.amount, 0);

export function legsOf(b: Booking): Leg[] {
  const legs = baseLegs(b);
  // an adjustment applies once, to that car's latest part of the booking
  const seen = new Set<string>();
  for (let i = legs.length - 1; i >= 0; i--) {
    const l = legs[i];
    if (seen.has(l.vehicleId)) continue;
    seen.add(l.vehicleId);
    const adj = adjustmentsFor(b, l.vehicleId);
    if (adj) legs[i] = { ...l, payout: Math.max(0, Math.round((l.payout - adj) * 100) / 100) };
  }
  return legs;
}

function baseLegs(b: Booking): Leg[] {
  const ex = b.exchanges ?? [];
  const fee = b.referralFee ?? 0;
  if (!ex.length) {
    return [{ vehicleId: b.vehicleId, days: b.totalDays, revenue: b.totalAmount, payout: Math.max(0, b.totalAmount - fee), referralFee: fee }];
  }
  const past: Leg[] = ex.map((e, i) => ({
    vehicleId: e.fromVehicleId, days: e.fromDays, revenue: e.fromRevenue,
    payout: e.fromPayout + (e.compensation?.amount ?? 0), referralFee: i === 0 ? fee : 0,
    from: i === 0 ? undefined : ex[i - 1].at, until: e.at, commissionId: e.commissionId,
  }));
  const usedDays = ex.reduce((s, e) => s + e.fromDays, 0);
  const usedRevenue = ex.reduce((s, e) => s + e.fromRevenue, 0);
  const last = ex[ex.length - 1];
  const days = Math.max(0, b.totalDays - usedDays);
  return [...past, {
    vehicleId: b.vehicleId, days, revenue: Math.max(0, b.totalAmount - usedRevenue),
    payout: Math.round(last.toRate * days), referralFee: 0, from: last.at,
  }];
}

/** The commission row for the car the customer has now (past legs have their own rows) */
export function mainCommission(commissions: Commission[], b: Booking): Commission | undefined {
  const legIds = new Set((b.exchanges ?? []).map((e) => e.commissionId));
  // breakdown swap rows ("sw-…": a replacement's earnings, or an amount an owner owes back) are never the main one
  const rows = commissions.filter((c) => c.bookingId === b.id && !legIds.has(c.id) && !c.id.startsWith('sw-'));
  return rows.find((c) => c.vehicleId === b.vehicleId) ?? rows[0];
}

/** The payout row that a car's part of this booking is paid from (its latest leg) */
export function payoutRowFor(commissions: Commission[], b: Booking, vehicleId?: string): Commission | undefined {
  const leg = [...legsOf(b)].reverse().find((l) => l.vehicleId === vehicleId);
  if (!leg) return undefined;
  return leg.commissionId ? commissions.find((c) => c.id === leg.commissionId) : mainCommission(commissions, b);
}

/** Every commission row of a booking that belongs to one owner (an owner can own two of its cars) */
export const ownerCommissions = (commissions: Commission[], bookingId: string, ownerId: string) =>
  commissions.filter((c) => c.bookingId === bookingId && c.ownerId === ownerId);

/** True when the owner had any car on this booking (booked car or a replacement) */
export const bookingTouchesVehicles = (b: Booking, vehicleIds: Set<string>) =>
  vehicleIds.has(b.vehicleId) || (b.exchanges ?? []).some((e) => vehicleIds.has(e.fromVehicleId));

/** When the current car's part of the booking began (the start, or the last exchange) */
export const currentLegStart = (b: Booking): { date: string; time?: string } => {
  const last = b.exchanges?.[b.exchanges.length - 1];
  if (!last) return { date: b.startDate, time: b.startTime };
  const d = new Date(last.at);
  return { date: d.toLocaleDateString('en-CA'), time: d.toTimeString().slice(0, 5) };
};

/** Suggested days for the car being taken back: from its part's start to the exchange time (24h rule) */
export function suggestedDays(b: Booking, atIso: string): number {
  const start = currentLegStart(b);
  const at = new Date(atIso);
  const date = at.toLocaleDateString('en-CA'), time = at.toTimeString().slice(0, 5);
  const remaining = Math.max(1, b.totalDays - (b.exchanges ?? []).reduce((s, e) => s + e.fromDays, 0));
  const days = start.time
    ? rentalDays(start.date, date, start.time, time)
    : Math.max(1, Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${start.date}T00:00:00`).getTime()) / 864e5));
  // the replacement is with the customer for at least part of a day — leave it at least one
  return Math.max(1, Math.min(remaining > 1 ? remaining - 1 : 1, days));
}

/** km driven over the whole trip so far: earlier cars + the current car */
export const earlierKm = (b: Booking) => (b.exchanges ?? []).reduce((s, e) => s + (e.kmDriven ?? 0), 0);

/**
 * What an exchange would do to the money — shown on the screen before saving and used to save it.
 * `fromDays` is how long the old car was with the customer (this part of the trip).
 */
export function previewExchange(b: Booking, fromDays: number, toRate: number) {
  const legs = legsOf(b);
  const cur = legs[legs.length - 1];
  const isFirst = !(b.exchanges ?? []).length;
  const days = Math.max(0, Math.min(fromDays, cur.days));
  const fromRevenue = cur.days > 0 ? Math.round((cur.revenue * days) / cur.days) : 0;
  const prevRate = isFirst ? 0 : b.exchanges![b.exchanges!.length - 1].toRate;
  const fromPayout = isFirst ? Math.max(0, fromRevenue - (b.referralFee ?? 0)) : Math.round(prevRate * days);
  const toDays = Math.max(0, cur.days - days);
  const toRevenue = Math.max(0, cur.revenue - fromRevenue);
  const toPayout = Math.round(toRate * toDays);
  // the company's part of the whole booking after the exchange (price − all owner payouts − referral fee)
  const otherPayouts = legs.slice(0, -1).reduce((s, l) => s + l.payout, 0);
  const company = b.totalAmount - (b.referralFee ?? 0) - otherPayouts - fromPayout - toPayout;
  return { isFirst, fromDays: days, fromRevenue, fromPayout, toDays, toRevenue, toPayout, company };
}

/** "Breakdown replacement: CBU-0649 replaced …" → ["Breakdown replacement", "CBU-0649 replaced …"] (payout notes) */
export function splitNote(note?: string): [string | undefined, string | undefined] {
  if (!note) return [undefined, undefined];
  const i = note.indexOf(': ');
  return i > 0 && i < 40 ? [note.slice(0, i), note.slice(i + 2)] : ['Payout note', note];
}
