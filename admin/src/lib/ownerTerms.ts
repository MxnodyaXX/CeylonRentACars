import type { OwnerShare, OwnerTerms, Vehicle } from '../types';

/*
 * Fixed-amount cars: the owner gets a fixed amount (every month, or once at the end of the term) whether
 * the car is rented or not, and the company keeps each rental in full — no commission split.
 * Part months are paid by days (joins 16 Nov → 15/30 of the monthly amount for November).
 */

const rsN = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
const dNice = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000) + 1;

/** Cleans what comes from the database: anything unusable → null */
export function readOwnerTerms(raw: unknown): OwnerTerms | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const amount = Number(r.amount);
  const start = typeof r.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.start) ? r.start : '';
  const end = typeof r.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.end) ? r.end : null;
  const schedule = r.schedule === 'term' ? 'term' : 'monthly';
  if (r.type !== 'fixed' || !start || !(amount > 0) || (schedule === 'term' && !end)) return null;
  return { type: 'fixed', schedule, amount: Math.round(amount), start, end, ...(typeof r.note === 'string' && r.note.trim() ? { note: r.note.trim() } : {}) };
}

/** The agreed commission on a car (vehicles.owner_share) — anything unusable → null (the company default applies) */
export function readOwnerShare(raw: unknown): OwnerShare | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as OwnerShare['type'];
  const value = Number(r.value);
  if (!['percent', 'percent_min', 'per_day', 'fixed'].includes(type) || !(value >= 0)) return null;
  if ((type === 'percent' || type === 'percent_min') && value > 100) return null;
  const min = Number(r.min);
  if (type === 'percent_min') return { type, value, min: min >= 0 ? min : 0 };
  return { type, value };
}

/** "15%, at least Rs 1,000 a day" · "12% of the rental" · "Rs 1,000 a day" · "Rs 5,000 a trip" · "No commission" */
export function shareSummary(s: OwnerShare): string {
  switch (s.type) {
    case 'percent': return `${s.value}% of the rental`;
    case 'percent_min': return `${s.value}%, at least ${rsN(s.min ?? 0)} a day`;
    case 'per_day': return `${rsN(s.value)} a day`;
    case 'fixed': return s.value === 0 ? 'No commission' : `${rsN(s.value)} a trip`;
  }
}

/** The car's fixed terms if they cover this day */
export function fixedTermsOn(v: Pick<Vehicle, 'ownerTerms'> | undefined, day: string): OwnerTerms | undefined {
  const t = v?.ownerTerms;
  if (!t || t.type !== 'fixed' || !(t.amount > 0) || !t.start || !day) return undefined;
  const d = day.slice(0, 10);
  if (d < t.start || (t.end && d > t.end)) return undefined;
  return t;
}

/** "Rs 80,000 a month from 1 Dec 2026" / "Rs 450,000 for 1 Dec 2026 – 31 May 2027" */
export function termsSummary(t: OwnerTerms): string {
  return t.schedule === 'monthly'
    ? `${rsN(t.amount)} a month from ${dNice(t.start)}${t.end ? ` to ${dNice(t.end)}` : ''}`
    : `${rsN(t.amount)} for ${dNice(t.start)} – ${dNice(t.end!)}, paid at the end`;
}

export interface FixedDue { id: string; period: string; date: string; amount: number; label: string; detail: string }

/**
 * What the owner is due for a fixed-amount car, for every month up to and including `period`
 * (a monthly car: one line a month; a term car: one line in the month the term ends). `from` cuts off older months.
 */
export function fixedDues(v: Vehicle, period: string, from: string): FixedDue[] {
  const t = v.ownerTerms;
  if (!t || t.type !== 'fixed' || !(t.amount > 0) || !t.start) return [];
  const car = `${v.brand} ${v.model} ${v.vehicleNumber}`;
  const [py, pm] = period.split('-').map(Number);
  const periodEnd = `${period}-${String(daysIn(py, pm)).padStart(2, '0')}`;

  if (t.schedule === 'term') {
    if (!t.end || t.end > periodEnd || t.end < from) return [];
    return [{ id: `fixed:${v.id}:term:${t.start}`, period: t.end.slice(0, 7), date: t.end, amount: t.amount,
      label: `Fixed amount · ${car}`, detail: `Whole term ${dNice(t.start)} – ${dNice(t.end)} · ${rsN(t.amount)}` }];
  }

  const out: FixedDue[] = [];
  let [y, m] = t.start.slice(0, 7).split('-').map(Number);
  for (let guard = 0; guard < 240; guard++) {
    const p = `${y}-${String(m).padStart(2, '0')}`;
    if (p > period) break;
    const mStart = `${p}-01`, mEnd = `${p}-${String(daysIn(y, m)).padStart(2, '0')}`;
    if (t.end && t.end < mStart) break;
    const a = t.start > mStart ? t.start : mStart;
    const b = t.end && t.end < mEnd ? t.end : mEnd;
    if (b >= from && a <= b) {
      const days = dayDiff(a, b), full = daysIn(y, m);
      const amount = days >= full ? t.amount : Math.round((t.amount * days) / full);
      out.push({ id: `fixed:${v.id}:${p}`, period: p, date: b, amount,
        label: `Fixed amount · ${car}`,
        detail: days >= full ? `${new Date(`${mStart}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · ${rsN(t.amount)} a month`
          : `${dNice(a)} – ${dNice(b)} · ${days} of ${full} days × ${rsN(t.amount)} a month` });
    }
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
