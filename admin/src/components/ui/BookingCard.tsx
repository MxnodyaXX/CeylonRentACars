import type { ReactNode } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import {
  AlertTriangle, CalendarClock, CalendarDays, CalendarRange, CheckCircle, ChevronRight, ClipboardEdit, MapPin, Phone, PlayCircle, Users,
} from 'lucide-react';
import VehicleImage from './VehicleImage';
import { vehicleBodyColor } from './CarSVG';
import { bookingStartMs, bookingEndMs } from '../../lib/availability';
import { bookingBill, bookingDue, bookingPaid } from '../../lib/credit';
import { durationLabel } from '../../lib/rentalPeriod';
import { missingInfo } from '../../lib/bookingRecord';
import type { Booking, Owner, Vehicle } from '../../types';

/* ---------- formatting ---------- */

const fmtDate = (d?: string, withYear = true) => {
  if (!d) return '—';
  const t = parseISO(d);
  if (isNaN(t.getTime())) return d;
  return format(t, withYear && t.getFullYear() !== new Date().getFullYear() ? 'd MMM yyyy' : 'EEE, d MMM');
};
const fmtTime = (t?: string) => {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

/* ---------- status & timing ---------- */

const STATUS: Record<Booking['status'], { pill: string; dot: string }> = {
  Confirmed: { pill: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500' },
  Ongoing:   { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500 animate-pulse' },
  Completed: { pill: 'bg-navy-50 text-navy-500 ring-navy-100', dot: 'bg-navy-300' },
  Cancelled: { pill: 'bg-red-50 text-red-600 ring-red-200', dot: 'bg-red-400' },
};
const TYPE_ICON = { Hourly: CalendarClock, Daily: CalendarDays, Monthly: CalendarRange };

export function StatusPill({ status }: { status: Booking['status'] }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{status}
    </span>
  );
}

type Tone = 'live' | 'soon' | 'warn' | 'muted';
/** Where the rental is right now: progress through a live rental, time until it starts, or overdue */
export function bookingTiming(b: Booking, now = Date.now()): { text: string; tone: Tone; pct?: number } {
  if (b.status === 'Cancelled') return { text: 'Cancelled', tone: 'muted' };
  if (b.status === 'Completed') return { text: `Returned ${fmtDate(b.endDate)}`, tone: 'muted' };
  const s = bookingStartMs(b), e = bookingEndMs(b);
  const today = new Date(now);
  const hourly = b.rentalType === 'Hourly';
  if (now < s) {
    const d = differenceInCalendarDays(parseISO(b.startDate), today);
    const text = d <= 0 ? `Starts today${fmtTime(b.startTime) ? ` at ${fmtTime(b.startTime)}` : ''}` : d === 1 ? 'Starts tomorrow' : `Starts in ${d} days`;
    return { text, tone: 'soon' };
  }
  if (b.status === 'Confirmed') {
    const d = differenceInCalendarDays(today, parseISO(b.startDate));
    return { text: d <= 0 ? 'Pickup due today' : `Pickup was due ${d} day${d === 1 ? '' : 's'} ago`, tone: 'warn' };
  }
  if (now > e) {
    const d = differenceInCalendarDays(today, parseISO(b.endDate));
    return { text: d <= 0 ? 'Return overdue' : `Overdue by ${d} day${d === 1 ? '' : 's'}`, tone: 'warn', pct: 100 };
  }
  const pct = Math.min(100, Math.max(2, ((now - s) / Math.max(1, e - s)) * 100));
  if (hourly) {
    const h = Math.max(1, Math.ceil((e - now) / 3_600_000));
    return { text: `${h} hour${h === 1 ? '' : 's'} left`, tone: 'live', pct };
  }
  const left = differenceInCalendarDays(parseISO(b.endDate), today);
  return { text: left <= 0 ? 'Returns today' : left === 1 ? 'Returns tomorrow' : `${left} days left`, tone: 'live', pct };
}
const TONE: Record<Tone, { text: string; bar: string }> = {
  live:  { text: 'text-emerald-700', bar: 'bg-emerald-500' },
  soon:  { text: 'text-sky-700', bar: 'bg-sky-400' },
  warn:  { text: 'text-red-600', bar: 'bg-red-500' },
  muted: { text: 'text-navy-400', bar: 'bg-navy-200' },
};

/* ---------- pieces ---------- */

function Period({ b }: { b: Booking }) {
  const Icon = TYPE_ICON[b.rentalType ?? 'Daily'];
  const anyTime = !!(fmtTime(b.startTime) || fmtTime(b.endTime));   // keep both sides aligned, but no empty line when neither has a time
  const end = (label: string, date: string, time: string | undefined, right?: boolean) => (
    <div className={`min-w-0 ${right ? 'text-right' : ''}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">{label}</p>
      <p className="text-sm font-semibold text-navy-800 truncate">{fmtDate(date)}</p>
      {anyTime && <p className="text-[11px] text-navy-400 h-4">{fmtTime(time)}</p>}
    </div>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      {end('Pickup', b.startDate, b.startTime)}
      <span className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-1 text-[11px] font-semibold text-navy-600 whitespace-nowrap">
        <Icon size={12} className="text-navy-400" />{durationLabel(b)}
      </span>
      {end('Return', b.endDate, b.endTime, true)}
    </div>
  );
}

function Timing({ b }: { b: Booking }) {
  const t = bookingTiming(b);
  const tone = TONE[t.tone];
  return (
    <div>
      {t.pct !== undefined && (
        <div className="h-1 rounded-full bg-navy-100 overflow-hidden mb-1.5">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${t.pct}%` }} />
        </div>
      )}
      <p className={`text-[11px] font-semibold ${tone.text}`}>{t.text}</p>
    </div>
  );
}

function Money({ b, align = 'left' }: { b: Booking; align?: 'left' | 'right' }) {
  const bill = bookingBill(b), paid = bookingPaid(b), due = bookingDue(b);
  const pct = bill > 0 ? Math.min(100, (paid / bill) * 100) : 100;
  const cancelled = b.status === 'Cancelled';
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className={`text-lg font-bold leading-tight ${cancelled ? 'text-navy-300 line-through' : 'text-navy-900'}`}>{rs(bill)}</p>
      {!cancelled && (
        <>
          <div className="h-1 rounded-full bg-navy-100 overflow-hidden my-1.5">
            <div className={`h-full rounded-full ${due > 0 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className={`text-[11px] font-semibold ${due > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {due > 0 ? `${rs(due)} due${paid > 0 ? ` · ${rs(paid)} paid` : ''}` : 'Paid in full'}
          </p>
        </>
      )}
    </div>
  );
}

/** "⚠ 4 missing" — red when something is needed before handover; hover / focus lists what */
export function MissingChip({ b, compact }: { b: Booking; compact?: boolean }) {
  const items = missingInfo(b);
  if (!items.length) return null;
  const critical = items.some((i) => i.critical);
  return (
    <span className="relative group/miss inline-flex" tabIndex={0} onClick={(e) => e.stopPropagation()} aria-label={`Missing: ${items.map((i) => i.label).join(', ')}`}>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${critical ? 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200' : 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'}`}>
        <AlertTriangle size={10} /> {items.length}{compact ? '' : ' missing'}
      </span>
      <span className={`pointer-events-none absolute ${compact ? 'right-0 top-full mt-1.5' : 'left-0 bottom-full mb-1.5'} z-30 w-56 rounded-xl bg-navy-900 p-2.5 text-[11px] text-white shadow-lg opacity-0 translate-y-1 transition-all group-hover/miss:opacity-100 group-hover/miss:translate-y-0 group-focus/miss:opacity-100 group-focus/miss:translate-y-0`}>
        <span className="block font-semibold mb-1">Still to fill in</span>
        {items.map((i) => (
          <span key={i.label} className="flex items-center gap-1.5 py-0.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i.critical ? 'bg-red-400' : 'bg-amber-300'}`} />{i.label}
          </span>
        ))}
        <span className="block mt-1 text-white/60">Open the booking to complete them</span>
      </span>
    </span>
  );
}

function Tags({ b, owner }: { b: Booking; owner?: Owner }) {
  const chip = 'inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 text-[10px] font-medium text-navy-500 max-w-[10rem] truncate';
  return (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      <MissingChip b={b} />
      <span className={chip} title="Referral"><Users size={10} />{b.referral || 'Direct'}</span>
      {owner && <span className={chip} title="Vehicle owner">{owner.name}</span>}
      {b.rentalType && b.rentalType !== 'Daily' && <span className={`${chip} bg-violet-50 text-violet-600`}>{b.rentalType}</span>}
      {b.insertedByAdmin && <span className={`${chip} bg-amber-50 text-amber-700`}><ClipboardEdit size={10} />Admin</span>}
    </div>
  );
}

function Action({ b, onStart, onComplete }: { b: Booking; onStart: () => void; onComplete: () => void }) {
  const btn = 'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors flex-shrink-0';
  if (b.status === 'Confirmed') {
    return <button type="button" onClick={(e) => { e.stopPropagation(); onStart(); }} className={`${btn} bg-navy-800 text-white hover:bg-navy-700`}><PlayCircle size={13} /> Start</button>;
  }
  if (b.status === 'Ongoing') {
    return <button type="button" onClick={(e) => { e.stopPropagation(); onComplete(); }} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><CheckCircle size={13} /> Complete</button>;
  }
  return <span className={`${btn} text-navy-400 group-hover:text-navy-700`}>Details <ChevronRight size={13} /></span>;
}

function VehicleThumb({ vehicle, size = 'md' }: { vehicle?: Vehicle; size?: 'md' | 'lg' }) {
  return (
    <div className={`${size === 'lg' ? 'w-20 h-14' : 'w-16 h-12'} rounded-xl overflow-hidden bg-navy-50 flex-shrink-0`}>
      <VehicleImage brand={vehicle?.brand ?? ''} model={vehicle?.model ?? ''} color={vehicle?.color} imageUrl={vehicle?.imageUrl}
                    bodyColor={vehicleBodyColor(vehicle?.color)} className="w-full h-full" />
    </div>
  );
}

function Customer({ b }: { b: Booking }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="w-8 h-8 rounded-full bg-navy-100 text-navy-600 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{initials(b.customerName)}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-navy-800 truncate">{b.customerName}</p>
        <p className="text-[11px] text-navy-400 truncate flex items-center gap-1"><Phone size={10} />{b.customerPhone}</p>
      </div>
    </div>
  );
}

interface CardProps {
  booking: Booking;
  vehicle?: Vehicle;
  owner?: Owner;
  onOpen: () => void;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

const shell = (b: Booking) =>
  `group bg-white rounded-2xl border transition-all cursor-pointer hover:shadow-card-hover ${
    b.status === 'Ongoing' ? 'border-emerald-200' : 'border-navy-100 hover:border-navy-200'
  } ${b.status === 'Cancelled' ? 'opacity-70' : ''}`;

function Frame({ b, onOpen, children, className = '' }: { b: Booking; onOpen: () => void; children: ReactNode; className?: string }) {
  return (
    <article role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} className={`${shell(b)} ${className}`}>
      {children}
    </article>
  );
}

/** One-line period for the compact card: "7 Jan → 22 Feb 2027 · 46 days" (times underneath when set) */
function PeriodLine({ b }: { b: Booking }) {
  const Icon = TYPE_ICON[b.rentalType ?? 'Daily'];
  const st = fmtTime(b.startTime), et = fmtTime(b.endTime);
  const sameYear = b.startDate.slice(0, 4) === b.endDate.slice(0, 4);
  const d = (x: string, year: boolean) => {
    const t = parseISO(x);
    return isNaN(t.getTime()) ? x : format(t, year && t.getFullYear() !== new Date().getFullYear() ? 'd MMM yyyy' : 'd MMM');
  };
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-semibold text-navy-800 truncate">
        {d(b.startDate, !sameYear)} <span className="text-navy-300">→</span> {d(b.endDate, true)}
        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-navy-500"><Icon size={11} className="text-navy-400" />{durationLabel(b)}</span>
      </p>
      {(st || et) && <p className="text-[10px] text-navy-400 truncate">{st || '—'} → {et || '—'}</p>}
    </div>
  );
}

/** Grid card — compact: vehicle, customer, period and payment in a few lines */
export function BookingCard({ booking: b, vehicle, owner, onOpen, onStart, onComplete, onCancel }: CardProps) {
  const t = bookingTiming(b);
  const tone = TONE[t.tone];
  const due = bookingDue(b);
  const cancelled = b.status === 'Cancelled';
  return (
    <Frame b={b} onOpen={onOpen} className="p-3 flex flex-col gap-2.5">
      {/* vehicle · status */}
      <div className="flex items-center gap-2.5">
        <div className="w-11 h-8 rounded-lg overflow-hidden bg-navy-50 flex-shrink-0">
          <VehicleImage brand={vehicle?.brand ?? ''} model={vehicle?.model ?? ''} color={vehicle?.color} imageUrl={vehicle?.imageUrl}
                        bodyColor={vehicleBodyColor(vehicle?.color)} className="w-full h-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-navy-900 truncate leading-tight">
            {vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Vehicle removed'}
            <span className="ml-1.5 font-mono text-[10px] font-medium text-navy-400">{vehicle?.vehicleNumber}</span>
          </p>
          <p className="text-[11px] text-navy-500 truncate">{b.customerName}<span className="text-navy-300"> · {b.customerPhone}</span></p>
        </div>
        <StatusPill status={b.status} />
      </div>

      {/* period · timing */}
      <div className="rounded-lg bg-navy-50/60 px-2.5 py-1.5">
        <PeriodLine b={b} />
        {t.pct !== undefined && (
          <div className="h-0.5 rounded-full bg-navy-100 overflow-hidden mt-1">
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${t.pct}%` }} />
          </div>
        )}
        <p className={`text-[10px] font-semibold mt-0.5 ${tone.text}`}>{t.text}</p>
      </div>

      {/* money · action */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className={`text-base font-bold ${cancelled ? 'text-navy-300 line-through' : 'text-navy-900'}`}>{rs(bookingBill(b))}</span>
          {!cancelled && (
            <span className={`ml-1.5 text-[11px] font-semibold ${due > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {due > 0 ? `${rs(due)} due` : 'Paid'}
            </span>
          )}
        </div>
        <Action b={b} onStart={onStart} onComplete={onComplete} />
      </div>

      {/* tags */}
      <div className="flex items-center justify-between gap-2">
        <Tags b={b} owner={owner} />
        {b.status === 'Confirmed' && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onCancel(); }} className="text-[10px] font-medium text-navy-400 hover:text-red-600 flex-shrink-0">Cancel</button>
        )}
      </div>
    </Frame>
  );
}

/** Full-width row — the same information laid out across the page */
export function BookingRow({ booking: b, vehicle, owner, onOpen, onStart, onComplete, onCancel }: CardProps) {
  return (
    <Frame b={b} onOpen={onOpen} className="p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,12rem)_minmax(0,1fr)_minmax(0,11rem)_auto] lg:items-center">
        <div className="flex items-center gap-3 min-w-0">
          <VehicleThumb vehicle={vehicle} size="lg" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-navy-900 truncate">{vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Vehicle removed'}</p>
            <span className="inline-block mt-0.5 rounded-md bg-navy-50 px-1.5 py-0.5 font-mono text-[11px] text-navy-500">{vehicle?.vehicleNumber ?? '—'}</span>
            <div className="mt-1"><StatusPill status={b.status} /></div>
          </div>
        </div>

        <Customer b={b} />

        <div className="rounded-xl bg-navy-50/50 px-3 py-2.5 space-y-2 min-w-0">
          <Period b={b} />
          {(b.pickupLocation || b.dropLocation) && (
            <p className="text-[11px] text-navy-400 flex items-center gap-1 truncate">
              <MapPin size={10} className="flex-shrink-0" />
              <span className="truncate">{b.pickupLocation || '—'}{b.dropLocation && b.dropLocation !== b.pickupLocation ? ` → ${b.dropLocation}` : ''}</span>
            </p>
          )}
          <Timing b={b} />
        </div>

        <Money b={b} align="right" />

        <div className="flex lg:flex-col items-center lg:items-end justify-between gap-2">
          <Action b={b} onStart={onStart} onComplete={onComplete} />
          {b.status === 'Confirmed' && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onCancel(); }} className="text-[11px] font-medium text-navy-400 hover:text-red-600">Cancel</button>
          )}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-navy-50"><Tags b={b} owner={owner} /></div>
    </Frame>
  );
}
