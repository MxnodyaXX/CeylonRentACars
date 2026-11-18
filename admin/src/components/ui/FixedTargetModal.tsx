import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Target, CalendarDays, TrendingUp, Wallet } from 'lucide-react';
import Modal from './Modal';
import { useStore } from '../../store/useStore';
import { bookingNo, rs } from '../../lib/bookingRecord';
import { shareBaseOf } from '../../lib/companyShare';
import { termsSummary } from '../../lib/ownerTerms';
import type { Booking, Vehicle } from '../../types';

/*
 * A fixed-amount car's month against its target: the owner's fixed amount for the month is what the car
 * has to earn back. Each booking counts for the days of it inside the month (its final bill split by days).
 * Completed and on-rent trips are "earned"; confirmed ones still ahead are "booked".
 */

const DAY = 86400000;
const toMs = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).getTime();
const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shift = (p: string, by: number) => { const [y, m] = p.split('-').map(Number); return periodOf(new Date(y, m - 1 + by, 1)); };
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const dShort = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const overlapDays = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.round((Math.min(a2, b2) - Math.max(a1, b1)) / DAY));

interface Row { b: Booking; days: number; amount: number; state: 'earned' | 'booked' }

export default function FixedTargetModal({ vehicle, onClose, onOpenBooking }: { vehicle: Vehicle | null; onClose: () => void; onOpenBooking?: (id: string) => void }) {
  const { bookings, owners, expenses } = useStore();
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const t = vehicle?.ownerTerms ?? null;

  const data = useMemo(() => {
    if (!vehicle || !t) return null;
    const [y, m] = period.split('-').map(Number);
    const mStart = new Date(y, m - 1, 1).getTime(), mEnd = new Date(y, m, 1).getTime();   // [start, end)
    const monthDays = Math.round((mEnd - mStart) / DAY);
    const tStart = toMs(t.start), tEnd = t.end ? toMs(t.end) + DAY : Infinity;

    // the target: the owner's amount for this month (term cars: the term amount spread over its days)
    const termDaysInMonth = overlapDays(mStart, mEnd, tStart, tEnd);
    const target = t.schedule === 'monthly'
      ? Math.round((t.amount * termDaysInMonth) / monthDays)
      : Math.round((t.amount * termDaysInMonth) / Math.max(1, Math.round((tEnd - tStart) / DAY)));

    const rows: Row[] = bookings
      .filter((b) => b.vehicleId === vehicle.id && b.status !== 'Cancelled' && b.startDate && b.endDate)
      .map((b) => {
        const s = toMs(b.startDate), e = Math.max(toMs(b.endDate), s + DAY);   // a same-day hire counts as a day
        const days = overlapDays(mStart, mEnd, s, e);
        const span = Math.max(1, Math.round((e - s) / DAY));
        const amount = Math.round((shareBaseOf(b) * days) / span);
        return { b, days, amount, state: b.status === 'Confirmed' ? 'booked' as const : 'earned' as const };
      })
      .filter((r) => r.days > 0)
      .sort((a, b) => a.b.startDate.localeCompare(b.b.startDate));

    const earned = rows.filter((r) => r.state === 'earned').reduce((s, r) => s + r.amount, 0);
    const booked = rows.filter((r) => r.state === 'booked').reduce((s, r) => s + r.amount, 0);
    const rentedDays = Math.min(monthDays, rows.reduce((s, r) => s + r.days, 0));
    const costs = expenses.filter((e) => e.vehicleId === vehicle.id && e.paidBy === 'company_cost' && e.date >= ymd(mStart) && e.date < ymd(mEnd))
      .reduce((s, e) => s + e.amount, 0);
    const today = Date.now();
    const daysLeft = today >= mStart && today < mEnd ? Math.max(0, Math.round((mEnd - toMs(ymd(today))) / DAY)) : today < mStart ? monthDays : 0;
    return { rows, target, earned, booked, rentedDays, monthDays, costs, daysLeft, inTerm: termDaysInMonth > 0 };
  }, [vehicle, t, bookings, expenses, period]);

  if (!vehicle || !t || !data) return null;
  const owner = owners.find((o) => o.id === vehicle.ownerId);
  const { rows, target, earned, booked, rentedDays, monthDays, costs, daysLeft, inTerm } = data;
  const total = earned + booked;
  const gap = target - total;
  const met = target > 0 && gap <= 0;
  const pct = (n: number) => (target > 0 ? Math.min(100, (n / target) * 100) : 0);
  const profit = total - target - costs;

  return (
    <Modal open onClose={onClose} title="Fixed amount target" width="max-w-5xl" closeOnOutside>
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 px-1 pb-4 border-b border-navy-100 -mt-1">
        <div className="w-11 h-11 rounded-xl bg-navy-50 flex items-center justify-center text-sm font-bold text-navy-700 flex-shrink-0">
          {vehicle.brand.slice(0, 1)}{vehicle.model.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy-800 truncate">{vehicle.brand} {vehicle.model}</p>
          <p className="text-xs text-navy-400 sm:truncate">{vehicle.vehicleNumber} · Owner {owner?.name ?? '—'} · {termsSummary(t)}</p>
        </div>
        <div className="flex items-center justify-between gap-1 rounded-xl border border-navy-100 p-1 w-full sm:w-auto">
          <button type="button" aria-label="Previous month" onClick={() => setPeriod((p) => shift(p, -1))} className="w-8 h-8 rounded-lg hover:bg-navy-50 flex items-center justify-center"><ChevronLeft size={15} /></button>
          <span className="text-sm font-semibold text-navy-800 w-32 text-center">{monthLabel(period)}</span>
          <button type="button" aria-label="Next month" onClick={() => setPeriod((p) => shift(p, 1))} className="w-8 h-8 rounded-lg hover:bg-navy-50 flex items-center justify-center"><ChevronRight size={15} /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-0 md:divide-x divide-navy-100">
        {/* left: the target */}
        <div className="py-4 md:pr-5 space-y-4 min-w-0">
          {!inTerm ? (
            <div className="rounded-2xl border border-navy-100 bg-navy-50/60 p-4 text-sm text-navy-500">{monthLabel(period)} is outside this car's fixed term — no target.</div>
          ) : (
            <div className={`rounded-2xl border p-4 ${met ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white' : 'border-red-200 bg-gradient-to-br from-red-50 to-white'}`}>
              <p className="text-[11px] font-semibold tracking-wide uppercase text-navy-400">Target · owner's fixed amount</p>
              <p className={`text-3xl font-extrabold mt-1 ${met ? 'text-emerald-700' : 'text-red-600'}`}>{rs(target)}</p>
              <div className="mt-3 h-2 rounded-full bg-navy-100 overflow-hidden flex">
                <span className="h-full bg-emerald-600" style={{ width: `${pct(earned)}%` }} />
                <span className="h-full bg-emerald-300" style={{ width: `${Math.max(0, pct(total) - pct(earned))}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-navy-500">
                <span>Earned {rs(earned)}{booked ? ` + booked ${rs(booked)}` : ''}</span>
                <span>{Math.round(target > 0 ? (total / target) * 100 : 0)}%</span>
              </div>
              <p className={`mt-3 text-sm font-semibold ${met ? 'text-emerald-700' : 'text-red-600'}`}>
                {met ? `Target covered · ${rs(-gap)} above it` : `Still to earn ${rs(gap)}`}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Stat icon={<CalendarDays size={14} />} label="Days rented" value={`${rentedDays} of ${monthDays}`} sub={`${Math.round((rentedDays / monthDays) * 100)}% of the month`} />
            <Stat icon={<TrendingUp size={14} />} label="Per rented day" value={rentedDays ? rs(total / rentedDays) : '—'} sub={`${rows.length} booking${rows.length === 1 ? '' : 's'}`} />
            <Stat icon={<Target size={14} />} label="Needed a day" value={!met && inTerm && daysLeft ? rs(gap / daysLeft) : '—'}
                  sub={!met && inTerm && daysLeft ? `for the ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : met ? 'Target covered' : 'Month over'} />
            <Stat icon={<Wallet size={14} />} label="Company profit" value={profit < 0 ? `− ${rs(-profit)}` : rs(profit)} tone={profit >= 0 ? 'good' : 'bad'}
                  sub={costs ? `after ${rs(costs)} of our own costs` : 'bills − fixed amount'} />
          </div>
          {t.note && <p className="text-xs text-navy-500 bg-navy-50/70 rounded-lg px-3 py-2">{t.note}</p>}
          <p className="text-[11px] text-navy-400">A booking counts for its days inside the month (its final bill split by days). Confirmed trips still ahead show as booked.</p>
        </div>

        {/* right: the bookings */}
        <div className="min-w-0 flex flex-col border-t md:border-t-0 border-navy-100">
          <div className="py-4 md:pl-5">
            <p className="font-semibold text-navy-800">Bookings in {monthLabel(period)}</p>
            <p className="text-xs text-navy-400">{rows.length} booking{rows.length === 1 ? '' : 's'} · {rs(total)}</p>
          </div>
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_90px_110px] gap-3 md:pl-5 py-2 border-y border-navy-100 text-[11px] font-semibold tracking-wide uppercase text-navy-400">
            <span>Booking</span><span className="text-right">Days</span><span className="text-right">Counts</span>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[52vh]">
            {rows.length === 0 && <p className="text-sm text-navy-400 text-center py-12">No bookings this month{inTerm && target ? ` — ${rs(target)} still to earn` : ''}.</p>}
            {rows.map((r) => (
              <button key={r.b.id} type="button" onClick={() => onOpenBooking?.(r.b.id)}
                      className="w-full text-left grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_90px_110px] gap-x-3 gap-y-1 items-center md:pl-5 py-3 border-b border-navy-100 hover:bg-navy-50/50">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-navy-800">{bookingNo(r.b)}</span>
                    <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${r.state === 'booked' ? 'bg-sky-50 text-sky-700' : r.b.status === 'Ongoing' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {r.state === 'booked' ? 'Booked' : r.b.status === 'Ongoing' ? 'On rent' : 'Done'}
                    </span>
                  </span>
                  <span className="block text-xs text-navy-400 truncate">{r.b.customerName} · {dShort(r.b.startDate)} – {dShort(r.b.endDate)}</span>
                  <span className="block mt-1.5 h-1.5 rounded-full bg-navy-100 overflow-hidden max-w-[22rem]">
                    <span className={`block h-full ${r.state === 'booked' ? 'bg-emerald-300' : 'bg-emerald-600'}`} style={{ width: `${pct(r.amount)}%` }} />
                  </span>
                </span>
                <span className="hidden sm:block text-right text-sm text-navy-500">{r.days}</span>
                <span className="text-right">
                  <span className="block text-sm font-bold text-navy-800">{rs(r.amount)}</span>
                  <span className="block text-[11px] text-navy-400">{target ? `${Math.round((r.amount / target) * 100)}% of target` : ''}<span className="sm:hidden"> · {r.days}d</span></span>
                </span>
              </button>
            ))}
          </div>
          <div className="md:pl-5 pt-3 text-xs text-navy-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>Earned <b className="text-emerald-700">{rs(earned)}</b></span>
            {booked > 0 && <span>Booked <b className="text-emerald-600">{rs(booked)}</b></span>}
            {inTerm && <span>{met ? 'Above target' : 'Still to earn'} <b className={met ? 'text-emerald-700' : 'text-red-600'}>{rs(Math.abs(gap))}</b></span>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-navy-100 p-3 min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-navy-400">{icon}{label}</p>
      <p className={`mt-1 text-base font-bold truncate ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700' : 'text-navy-800'}`}>{value}</p>
      {sub && <p className="text-[11px] text-navy-400 truncate">{sub}</p>}
    </div>
  );
}
