import type { ReactNode } from 'react';
import { CalendarClock, CalendarDays, CalendarRange } from 'lucide-react';
import DateInput from './DateInput';
import TimePicker from './TimePicker';
import { rentalDays } from '../../lib/availability';
import { RENTAL_TYPES, RentalType, UNIT, periodFor, unitLabel } from '../../lib/rentalPeriod';

export interface PeriodValue {
  rentalType?: RentalType;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  rentalUnits?: number;
  unitRate?: number;
  totalDays: number;
  totalAmount: number;
  waiveExtraDay?: boolean;
}

const ICON = { Hourly: CalendarClock, Daily: CalendarDays, Monthly: CalendarRange };
const CHIPS: Record<'Hourly' | 'Monthly', number[]> = { Hourly: [1, 2, 3, 4, 6, 8, 12], Monthly: [1, 2, 3, 6, 12] };
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
const nice = (d: string, t?: string) => {
  if (!d) return '—';
  const date = new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (!t) return date;
  const [h, m] = t.split(':').map(Number);
  return `${date}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/**
 * Hourly / Daily / Monthly selector for every booking form.
 * Daily shows the form's own date fields (`daily`) unchanged; hourly and monthly
 * ask for a start, a number of hours / months and a rate, and work out the rest.
 * `onChange` receives the changed fields plus the computed end date, days and total.
 */
export default function RentalPeriodFields({ value, onChange, daily, dailyRate = 0, minDate }: {
  value: PeriodValue;
  onChange: (patch: Partial<PeriodValue>) => void;
  daily: ReactNode;
  dailyRate?: number;      // the vehicle's daily rate — used when switching back to Daily and to suggest a monthly rate
  minDate?: string;
}) {
  const type: RentalType = value.rentalType ?? 'Daily';

  /** Apply a change and recalculate the end, days and total */
  const change = (c: Partial<PeriodValue>) => {
    const next = { ...value, ...c };
    const p = periodFor({ rentalType: next.rentalType ?? 'Daily', startDate: next.startDate, startTime: next.startTime, rentalUnits: next.rentalUnits, unitRate: next.unitRate });
    onChange({ ...c, ...(p ?? {}) });
  };

  const pickType = (t: RentalType) => {
    if (t === type) return;
    if (t === 'Daily') {
      // back to the normal date-based calculation
      const days = value.startDate && value.endDate && value.startDate <= value.endDate
        ? rentalDays(value.startDate, value.endDate, value.startTime, value.endTime, value.waiveExtraDay) : value.totalDays;
      return onChange({ rentalType: 'Daily', rentalUnits: undefined, unitRate: undefined, totalDays: days, totalAmount: days * dailyRate });
    }
    change({ rentalType: t, rentalUnits: t === 'Monthly' ? 1 : undefined, unitRate: undefined, ...(t === 'Hourly' && !value.startTime ? { startTime: '' } : {}) });
  };

  const units = value.rentalUnits ?? 0;
  const rate = value.unitRate ?? 0;
  const ready = type !== 'Daily' && !!value.startDate && units > 0 && (type === 'Monthly' || !!value.startTime);

  return (
    <div className="space-y-3">
      <div>
        <p className="label">Rental type</p>
        <div className="grid grid-cols-3 gap-1 bg-navy-50 rounded-xl p-1">
          {RENTAL_TYPES.map((t) => {
            const I = ICON[t];
            const on = t === type;
            return (
              <button key={t} type="button" onClick={() => pickType(t)} aria-pressed={on}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${on ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-800'}`}>
                <I size={15} /> {t}
              </button>
            );
          })}
        </div>
      </div>

      {type === 'Daily' ? daily : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="label">{type === 'Hourly' ? 'Date *' : 'Start date *'}</p>
              <DateInput value={value.startDate} onChange={(v) => change({ startDate: v })} minDate={minDate} />
            </div>
            <div>
              <p className="label">{type === 'Hourly' ? 'Pickup time *' : 'Pickup time'}</p>
              <TimePicker value={value.startTime} onChange={(v) => change({ startTime: v })} placeholder="Pickup time" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="label">Number of {UNIT[type].many} *</p>
              <input className="input" type="number" min="1" step="1" value={units || ''} placeholder={type === 'Hourly' ? 'e.g. 5' : 'e.g. 6'}
                     onChange={(e) => change({ rentalUnits: Math.max(0, Math.floor(Number(e.target.value) || 0)) || undefined })} />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {CHIPS[type].map((n) => (
                  <button key={n} type="button" onClick={() => change({ rentalUnits: n })}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${units === n ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>
                    {unitLabel(type, n)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Rate {UNIT[type].rate} (Rs) *</p>
              <input className="input" type="number" min="0" value={rate || ''} onChange={(e) => change({ unitRate: Math.max(0, Number(e.target.value) || 0) || undefined })}
                     placeholder={type === 'Hourly' ? 'e.g. 1,500' : 'e.g. 90,000'} />
              {type === 'Monthly' && dailyRate > 0 && !rate && (
                <button type="button" onClick={() => change({ unitRate: dailyRate * 30 })} className="text-[11px] text-navy-500 underline mt-1">
                  Use daily rate × 30 = {rs(dailyRate * 30)}
                </button>
              )}
            </div>
          </div>

          {ready ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900 space-y-0.5">
              <p className="flex flex-wrap justify-between gap-2">
                <span>{type === 'Hourly' ? 'Returns' : 'Ends'}</span>
                <b>{nice(value.endDate, value.endTime || undefined)}</b>
              </p>
              {type === 'Monthly' && (
                <p className="text-[11px] text-sky-800/80">Calendar months — {nice(value.startDate)} → {nice(value.endDate)} ({value.totalDays} days)</p>
              )}
              <p className="flex flex-wrap justify-between gap-2 border-t border-sky-200 pt-1 mt-1">
                <span>{unitLabel(type, units)} × {rate ? rs(rate) : 'rate?'}</span>
                <b>{rate ? rs(units * rate) : '—'}</b>
              </p>
            </div>
          ) : (
            <p className="text-xs text-navy-400">
              {type === 'Hourly' ? 'Enter the date, pickup time and number of hours — the return time is worked out for you.'
                : 'Enter the start date and number of months — the end date is worked out (5 Jan → 5 Feb counts as one month).'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
