import type { KmMeter } from '../../types';

/** Short labels for the picker; METER_LABEL (lib/tripKm) has the long ones */
const OPTIONS: [KmMeter, string][] = [['odo', 'ODO'], ['A', 'Trip A'], ['B', 'Trip B'], ['C', 'Trip C']];

/**
 * A km reading with the meter it was read from: the main odometer (ODO) or a trip meter (Trip A/B/C).
 * Km are only worked out between readings of the same meter.
 */
export default function KmReading({ value, onChange, meter, onMeter, placeholder, small, className = '' }: {
  value: string | number; onChange: (v: string) => void;
  meter?: KmMeter; onMeter: (m: KmMeter) => void;
  placeholder?: string; small?: boolean; className?: string;
}) {
  const m = meter ?? 'odo';
  return (
    <div className={`flex items-stretch ${className}`}>
      <input className={`input flex-1 min-w-0 !rounded-r-none ${small ? '!py-1 text-sm' : ''}`} type="number" min="0" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
      <select aria-label="Read from" title="Which meter on the dashboard: the odometer (ODO) or a trip meter"
              className={`input !w-auto !rounded-l-none !border-l-0 !pl-2 !pr-6 text-xs font-medium ${m === 'odo' ? 'text-navy-500' : '!bg-amber-50 text-amber-800'} ${small ? '!py-1' : ''}`}
              value={m} onChange={(e) => onMeter(e.target.value as KmMeter)}>
        {OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </div>
  );
}
