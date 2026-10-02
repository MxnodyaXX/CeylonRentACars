import { Booking } from '../types';

/**
 * Does a booking hold the vehicle for its dates?
 *
 * A vehicle is only tied up while a booking is live — i.e. it is still
 * upcoming (`Confirmed`) or currently out (`Ongoing`). Once a rental is
 * `Completed` the car is back, and a `Cancelled` booking never happened, so
 * neither should block new bookings on those dates.
 *
 * This is the single source of truth for availability checks across the app
 * (store `isVehicleAvailable`, the booking form conflict banner, and the
 * availability lookup modal) so the rule can never drift between them.
 */
export const blocksAvailability = (b: Pick<Booking, 'status'>): boolean =>
  b.status === 'Confirmed' || b.status === 'Ongoing';

/**
 * Combine a yyyy-MM-dd date with an optional HH:mm time into epoch milliseconds.
 *
 * When the time is missing/blank we fall back to the given default. Start times
 * default to the very start of the day and end times to the very end, so a
 * legacy date-only booking (no times recorded) still reserves the whole day —
 * exactly as it did before times existed. Bookings that DO carry times unlock
 * same-day turnaround (e.g. returned 08:00, re-hired 12:00 the same date).
 */
function toMs(date: string, time: string | undefined, fallback: string): number {
  if (!date) return NaN;
  const t = time && /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, '0') : fallback;
  return new Date(`${date}T${t}:00`).getTime();
}

export const bookingStartMs = (b: { startDate: string; startTime?: string }): number =>
  toMs(b.startDate, b.startTime, '00:00');

export const bookingEndMs = (b: { endDate: string; endTime?: string }): number =>
  toMs(b.endDate, b.endTime, '23:59');

/**
 * Do two date-time ranges overlap? Boundaries that merely touch do NOT overlap,
 * so a vehicle returned at 08:00 is free to hand to the next hire from 08:00 on.
 */
export const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && aEnd > bStart;

const HOUR_MS = 3_600_000;
const isTime = (t?: string): t is string => !!t && /^\d{1,2}:\d{2}$/.test(t);

/**
 * Billable rental days.
 *
 * When both a pickup and return time are given, billing follows the actual time
 * the customer holds the vehicle: elapsed hours rounded UP to whole 24-hour days
 * (minimum 1). So 07:00 → next-day 07:00 is exactly 24h = 1 day, while
 * 07:00 → next-day 09:00 (26h) rolls over to 2 days.
 *
 * `waiveExtraDay` (owner-approved, per booking) switches that rounding from UP
 * to DOWN: a partial day past a whole 24h multiple is not billed, so
 * 07:00 → next-day 09:00 (26h, "1 day + 3 extra hours") stays 1 day instead of
 * rolling over. A rental under 24h is still always at least 1 day.
 *
 * Without times we fall back to the inclusive calendar-day count used before
 * times existed, so legacy/quick bookings bill exactly as they always did.
 */
export function rentalDays(
  startDate: string,
  endDate: string,
  startTime?: string,
  endTime?: string,
  waiveExtraDay?: boolean,
): number {
  if (!startDate || !endDate) return 0;

  if (isTime(startTime) && isTime(endTime)) {
    const start = new Date(`${startDate}T${startTime.padStart(5, '0')}:00`).getTime();
    const end   = new Date(`${endDate}T${endTime.padStart(5, '0')}:00`).getTime();
    const hours = (end - start) / HOUR_MS;
    if (!(hours > 0)) return 1;
    // Epsilon guards against floating-point drift right at a 24h boundary
    // (e.g. 24.0000001h should still read as exactly 1 day either way).
    if (waiveExtraDay) return Math.max(1, Math.floor(hours / 24 + 1e-6));
    return Math.max(1, Math.ceil(hours / 24 - 1e-6));
  }

  const ms = new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / (24 * HOUR_MS)) + 1);
}
