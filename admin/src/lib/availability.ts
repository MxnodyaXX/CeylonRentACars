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

/* ---------- Does the status match the dates? ---------- */

type StatusDates = { startDate: string; endDate: string; startTime?: string; endTime?: string };
const isHm = (t?: string): t is string => !!t && /^\d{1,2}:\d{2}$/.test(t);
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nice = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The status the dates point to right now. On the start / end day itself the time decides; without a time it stays open. */
export function statusForDates(b: StatusDates, now = Date.now()): 'Confirmed' | 'Ongoing' | 'Completed' {
  const today = localDay(now);
  if (b.endDate < today) return 'Completed';
  if (b.startDate > today) return 'Confirmed';
  if (b.startDate === today && (!isHm(b.startTime) || bookingStartMs(b) > now)) return 'Confirmed';
  if (b.endDate === today && isHm(b.endTime) && bookingEndMs(b) <= now) return 'Completed';
  return 'Ongoing';
}

/**
 * Why a status can't be right for these dates — e.g. "Completed" for a rental that hasn't
 * ended yet. Returns null when the status is possible. Boundary days are allowed unless a
 * time proves otherwise (a car returned this morning can be Completed today).
 */
export function statusDateProblem(status: string, b: StatusDates, now = Date.now()): string | null {
  if (!b.startDate || !b.endDate || status === 'Cancelled') return null;
  const today = localDay(now);
  const started = b.startDate < today || (b.startDate === today && isHm(b.startTime) && bookingStartMs(b) <= now);
  const notStartedYet = b.startDate > today || (b.startDate === today && isHm(b.startTime) && bookingStartMs(b) > now);
  const ended = b.endDate < today || (b.endDate === today && isHm(b.endTime) && bookingEndMs(b) <= now);
  const notEndedYet = b.endDate > today || (b.endDate === today && isHm(b.endTime) && bookingEndMs(b) > now);

  switch (status) {
    case 'Completed':
      if (notEndedYet) return `This rental runs until ${nice(b.endDate)}${isHm(b.endTime) ? ` ${b.endTime}` : ''} — it can't be Completed yet. Use ${notStartedYet ? 'Confirmed' : 'Ongoing'}.`;
      return null;
    case 'Ongoing':
      if (notStartedYet) return `This rental starts on ${nice(b.startDate)}${isHm(b.startTime) ? ` ${b.startTime}` : ''} — it can't be Ongoing yet. Use Confirmed.`;
      if (ended) return `This rental ended on ${nice(b.endDate)} — it can't still be Ongoing. Use Completed, or change the end date if the customer still has the vehicle.`;
      return null;
    case 'Confirmed':
      if (ended) return `This rental ended on ${nice(b.endDate)} — use Completed (or Cancelled if it never happened).`;
      if (started) return `This rental started on ${nice(b.startDate)} — use Ongoing if the customer has the vehicle.`;
      return null;
    default:
      return null;
  }
}

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
