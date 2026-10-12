/* =====================================================================
   Rental type — hourly, daily or monthly.
   Daily keeps the original behaviour (dates + times → days × daily rate).
   Hourly: a start date + time and a number of hours → the return time.
   Monthly: a start date and a number of months → the end date, counted as
   CALENDAR months (5 Jan → 5 Feb → 5 Mar), never as 30 / 31 days.
   ===================================================================== */
import { addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns';

export type RentalType = 'Hourly' | 'Daily' | 'Monthly';
export const RENTAL_TYPES: RentalType[] = ['Hourly', 'Daily', 'Monthly'];
export const UNIT: Record<RentalType, { one: string; many: string; rate: string }> = {
  Hourly:  { one: 'hour',  many: 'hours',  rate: 'per hour' },
  Daily:   { one: 'day',   many: 'days',   rate: 'per day' },
  Monthly: { one: 'month', many: 'months', rate: 'per month' },
};
export const unitLabel = (t: RentalType, n: number) => `${n} ${n === 1 ? UNIT[t].one : UNIT[t].many}`;

const isTime = (t?: string): t is string => !!t && /^\d{1,2}:\d{2}$/.test(t);
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Same day-of-month, n calendar months later: 5 Jan + 1 → 5 Feb, 5 Jan + 6 → 5 Jul.
 * When the month is shorter the last day is used (31 Jan + 1 → 28 / 29 Feb).
 */
export function addCalendarMonths(date: string, months: number): string {
  return format(addMonths(parseISO(date), months), 'yyyy-MM-dd');
}

/** Hourly: start + n hours (may run past midnight into the next day) */
export function addHours(date: string, time: string, hours: number): { endDate: string; endTime: string } {
  const d = new Date(`${date}T${time.padStart(5, '0')}:00`);
  d.setTime(d.getTime() + hours * 3_600_000);
  return { endDate: format(d, 'yyyy-MM-dd'), endTime: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export interface PeriodInput {
  rentalType: RentalType;
  startDate: string;
  startTime?: string;
  rentalUnits?: number;   // hours (hourly) or months (monthly)
  unitRate?: number;      // price per hour / per month
}
export interface Period { endDate: string; endTime: string; totalDays: number; totalAmount: number }

/**
 * End date / time, days held and price for an hourly or monthly rental.
 * Returns null until everything needed is filled in (hourly also needs a start time).
 */
export function periodFor(p: PeriodInput): Period | null {
  const units = p.rentalUnits ?? 0;
  if (!p.startDate || units <= 0 || p.rentalType === 'Daily') return null;
  const totalAmount = Math.round(units * (p.unitRate ?? 0));
  if (p.rentalType === 'Hourly') {
    if (!isTime(p.startTime)) return null;
    const { endDate, endTime } = addHours(p.startDate, p.startTime, units);
    return { endDate, endTime, totalDays: Math.max(1, Math.ceil(units / 24)), totalAmount };
  }
  const endDate = addCalendarMonths(p.startDate, units);
  return { endDate, endTime: isTime(p.startTime) ? p.startTime : '', totalDays: differenceInCalendarDays(parseISO(endDate), parseISO(p.startDate)), totalAmount };
}

/** Length of a booking: "6 months", "5 hours", or days for daily rentals */
export function durationLabel(b: { rentalType?: string; rentalUnits?: number; totalDays: number }) {
  const t = (b.rentalType as RentalType) ?? 'Daily';
  if (t !== 'Daily' && b.rentalUnits) return unitLabel(t, b.rentalUnits);
  return unitLabel('Daily', b.totalDays);
}

/** Price line for invoices / receipts: "6 months × Rs 90,000" or "5d × Rs 5,000" */
export function rateLine(b: { rentalType?: string; rentalUnits?: number; unitRate?: number; totalDays: number }, dailyRent?: number, short = true) {
  const t = (b.rentalType as RentalType) ?? 'Daily';
  if (t !== 'Daily' && b.rentalUnits) return `${unitLabel(t, b.rentalUnits)} × Rs ${(b.unitRate ?? 0).toLocaleString()}`;
  return `${short ? `${b.totalDays}d` : unitLabel('Daily', b.totalDays)} × Rs ${(dailyRent ?? 0).toLocaleString()}`;
}
