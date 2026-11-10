import { useEffect } from 'react';
import { Building2 } from 'lucide-react';
import Select from './Select';
import { SHARE_TYPES, companyShareOf, shareWorking, useCompanyShare, type ShareType } from '../../lib/companyShare';
import type { Booking } from '../../types';

type ShareFields = Pick<Booking, 'companyShareType' | 'companyShareValue' | 'companyShareMin'>;
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

/** On every booking form: how the company's commission is taken, with what the owner gets */
export default function CompanyShareField({ value, onChange, total, days, rentalType, className = '', autoDefault = true }: {
  value: ShareFields; onChange: (v: ShareFields) => void; total: number; days: number; rentalType?: Booking['rentalType']; className?: string;
  /** new bookings start with the company default; existing ones keep what they have */
  autoDefault?: boolean;
}) {
  const { method, loaded, load } = useCompanyShare();
  useEffect(() => { if (!loaded) load(); }, [loaded, load]);
  // a new booking starts with the company default
  useEffect(() => {
    if (autoDefault && loaded && !value.companyShareType) onChange({ companyShareType: method.type, companyShareValue: method.value, companyShareMin: method.min });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const type = value.companyShareType ?? method.type;
  const b = { ...value, companyShareType: type, rentalType, totalDays: days };
  const company = companyShareOf(b, total);
  const pctLike = type === 'percent' || type === 'percent_min';
  const set = (p: Partial<ShareFields>) => onChange({ ...value, companyShareType: type, ...p });

  return (
    <div className={`rounded-xl border border-navy-100 p-3 space-y-2 ${className}`}>
      <p className="label !mb-0 flex items-center gap-1.5"><Building2 size={14} /> Company commission</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem_9rem]">
        <Select value={type} onChange={(v) => {
          const t = v as ShareType;
          // sensible starting numbers when the method changes
          set({ companyShareType: t, companyShareValue: t === 'percent' || t === 'percent_min' ? method.value : t === 'per_day' ? (method.min ?? 1000) : 5000, companyShareMin: t === 'percent_min' ? (method.min ?? 1000) : undefined });
        }} options={SHARE_TYPES.map((s) => ({ value: s.value, label: s.label, sub: s.sub }))} />
        <label className="text-[11px] text-navy-400">{pctLike ? 'Percent' : type === 'per_day' ? (rentalType === 'Hourly' ? 'Rs per trip' : 'Rs per day') : 'Rs for the trip'}
          <input className="input !py-1.5 mt-0.5" type="number" min={0} step={pctLike ? 0.1 : 100} value={value.companyShareValue ?? ''}
                 onChange={(e) => set({ companyShareValue: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        {type === 'percent_min' && (
          <label className="text-[11px] text-navy-400">Minimum {rentalType === 'Hourly' ? 'per trip' : 'per day'} (Rs)
            <input className="input !py-1.5 mt-0.5" type="number" min={0} step={100} value={value.companyShareMin ?? ''}
                   onChange={(e) => set({ companyShareMin: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        )}
      </div>
      {total > 0 ? (
        <p className="text-xs text-navy-600">
          Company <b>{rs(company)}</b> · owner gets <b>{rs(total - company)}</b>
          <span className="block text-navy-400">{shareWorking(b, total)}</span>
          <span className="block text-navy-400">Estimate on the rental — worked out again on the final bill at the end of the trip (extra km and other charges included).</span>
        </p>
      ) : <p className="text-xs text-navy-400">Enter the dates and price to see the split.</p>}
    </div>
  );
}
