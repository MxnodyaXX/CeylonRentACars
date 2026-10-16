import { Tag, RotateCcw } from 'lucide-react';

export type PriceMode = 'standard' | 'perDay' | 'total';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

/** The total for a daily booking in each price mode */
export function priceFor(mode: PriceMode, days: number, standardRate: number, customRate: number, customTotal: number) {
  if (mode === 'perDay') return days * customRate;
  if (mode === 'total') return customTotal;
  return days * standardRate;
}

/**
 * Rental amount for a daily booking: shows the standard price (days × the vehicle's daily rent)
 * and lets staff agree a different price — either a custom rate per day (the total follows the
 * dates) or a fixed total for the whole trip.
 */
export default function RentalPriceField({ days, standardRate, mode, customRate, customTotal, onChange }: {
  days: number;
  standardRate: number;
  mode: PriceMode;
  customRate: number;
  customTotal: number;
  onChange: (p: { mode: PriceMode; customRate?: number; customTotal?: number }) => void;
}) {
  const standard = days * standardRate;
  const total = priceFor(mode, days, standardRate, customRate, customTotal);
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
            {days} day{days === 1 ? '' : 's'} × {rs(standardRate)} = <b>{rs(standard)}</b>
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
