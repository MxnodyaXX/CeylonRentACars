import { Tag, RotateCcw, Sunset } from 'lucide-react';
import { rentFor } from '../../lib/partDay';

export type PriceMode = 'standard' | 'perDay' | 'total';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

/** The total for a daily booking in each price mode (one day may be a part day at its own amount) */
export function priceFor(mode: PriceMode, days: number, standardRate: number, customRate: number, customTotal: number, partDay?: number) {
  if (mode === 'perDay') return rentFor(days, customRate, partDay);
  if (mode === 'total') return customTotal;
  return rentFor(days, standardRate, partDay);
}

/** "First day is a part day (e.g. picked up in the evening): Rs __" — one of the days charged a smaller amount */
export function PartDayToggle({ value, onChange, days, rate }: { value?: number; onChange: (v: number | undefined) => void; days: number; rate: number }) {
  const on = value !== undefined;
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${on ? 'border-amber-200 bg-amber-50/70' : 'border-navy-100 bg-white'}`}>
      <label className="flex items-center gap-2 text-navy-700">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? Math.round(rate * 5 / 7 / 500) * 500 || 0 : undefined)} />
        <Sunset size={14} className="text-amber-600" /> One day is a part day (e.g. picked up in the evening)
      </label>
      {on && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pl-6">
          <span className="text-navy-500">Charge that day</span>
          <span className="text-navy-500">Rs</span>
          <input className="input !py-1 !w-28" type="number" min={0} step={500} value={value || ''} autoFocus
                 onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          <span className="text-xs text-navy-400">instead of {`Rs ${Math.round(rate).toLocaleString('en-LK')}`}{days > 1 ? ` · the other ${days - 1} day${days === 2 ? '' : 's'} at the full rate` : ''}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Rental amount for a daily booking: shows the standard price (days × the vehicle's daily rent)
 * and lets staff agree a different price — either a custom rate per day (the total follows the
 * dates) or a fixed total for the whole trip.
 */
export default function RentalPriceField({ days, standardRate, mode, customRate, customTotal, onChange, partDay, onPartDay }: {
  days: number;
  standardRate: number;
  mode: PriceMode;
  customRate: number;
  customTotal: number;
  onChange: (p: { mode: PriceMode; customRate?: number; customTotal?: number }) => void;
  /** a part day's amount (undefined = none) */
  partDay?: number;
  onPartDay?: (v: number | undefined) => void;
}) {
  const part = mode === 'total' ? undefined : partDay;
  const standard = rentFor(days, standardRate, part);
  const total = priceFor(mode, days, standardRate, customRate, customTotal, part);
  const diff = total - standard;
  const custom = mode !== 'standard';

  const pick = (m: PriceMode) => {
    if (m === mode) return;
    // start the custom fields from the current price, so switching never jumps the amount
    if (m === 'perDay') onChange({ mode: m, customRate: days ? Math.round(total / days) : standardRate });
    else if (m === 'total') onChange({ mode: m, customTotal: total });
    else onChange({ mode: m });
  };

  return (
    <div data-price-field className={`rounded-xl border px-4 py-3 space-y-3 ${custom ? 'border-amber-200 bg-amber-50/60' : 'border-navy-100 bg-navy-50/40'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label !mb-0 flex items-center gap-1.5"><Tag size={13} /> Rental amount</p>
        <div className="grid grid-cols-3 gap-0.5 bg-white rounded-lg p-0.5 border border-navy-100 text-xs font-semibold">
          {([['standard', 'Standard'], ['perDay', 'Custom / day'], ['total', 'Custom total']] as [PriceMode, string][]).map(([m, label]) => (
            <button key={m} type="button" onClick={() => pick(m)} aria-pressed={mode === m}
                    className={`px-2.5 py-1 rounded-md transition-colors ${mode === m ? 'bg-navy-700 text-white' : 'text-navy-500 hover:text-navy-800'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-400">Standard price</p>
          <p className={`text-sm ${custom ? 'text-navy-400 line-through decoration-navy-300' : 'text-navy-800'}`}>
            {part !== undefined && part > 0 ? <>{days - 1} day{days - 1 === 1 ? '' : 's'} × {rs(standardRate)} + part day {rs(part)}</> : <>{days} day{days === 1 ? '' : 's'} × {rs(standardRate)}</>} = <b>{rs(standard)}</b>
          </p>
        </div>
        {mode === 'perDay' && (
          <div>
            <p className="label">Custom rate per day (Rs)</p>
            <input className="input" type="number" min="0" value={customRate || ''} autoFocus
                   onChange={(e) => onChange({ mode, customRate: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
        )}
        {mode === 'total' && (
          <div>
            <p className="label">Custom total for the trip (Rs)</p>
            <input className="input" type="number" min="0" value={customTotal || ''} autoFocus
                   onChange={(e) => onChange({ mode, customTotal: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
        )}
      </div>

      {onPartDay && mode !== 'total' && days >= 1 && <PartDayToggle value={partDay} onChange={onPartDay} days={days} rate={mode === 'perDay' ? customRate : standardRate} />}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-100 pt-2">
        <div className="text-sm">
          <span className="text-navy-500">Total to charge </span>
          <b className="text-navy-900 text-base">{rs(total)}</b>
          {custom && days > 0 && total > 0 && <span className="text-navy-400 text-xs"> · {rs(total / days)} / day</span>}
        </div>
        {custom && (
          <div className="flex items-center gap-3">
            {diff !== 0 && standard > 0 && (
              <span className={`text-xs font-semibold ${diff < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {diff < 0 ? `${rs(-diff)} below standard` : `${rs(diff)} above standard`} ({Math.round((Math.abs(diff) / standard) * 100)}%)
              </span>
            )}
            <button type="button" onClick={() => onChange({ mode: 'standard' })} className="inline-flex items-center gap-1 text-xs text-navy-500 hover:text-navy-800 underline">
              <RotateCcw size={11} /> Use standard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
