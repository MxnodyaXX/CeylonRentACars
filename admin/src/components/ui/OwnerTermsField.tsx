import { useEffect } from 'react';
import DateInput from './DateInput';
import Select from './Select';
import type { OwnerShare, OwnerTerms } from '../../types';
import { shareSummary, termsSummary } from '../../lib/ownerTerms';
import { SHARE_TYPES, useCompanyShare } from '../../lib/companyShare';

/**
 * Share of each rental: the commission agreed with this owner. New bookings on the car start with it, and
 * "Complete rental" offers it as the owner's agreed rate. Not set = the company default.
 */
function AgreedShare({ share, onChange, disabled }: { share: OwnerShare | null; onChange: (s: OwnerShare | null) => void; disabled?: boolean }) {
  const { method, loaded, load } = useCompanyShare();
  useEffect(() => { if (!loaded) load(); }, [loaded, load]);
  const none = share?.type === 'fixed' && share.value === 0;
  const pctLike = share?.type === 'percent' || share?.type === 'percent_min';
  const pick = (v: string) => {
    if (v === 'default') return onChange(null);
    if (v === 'none') return onChange({ type: 'fixed', value: 0 });
    const t = v as OwnerShare['type'];
    onChange(t === 'percent_min' ? { type: t, value: method.value, min: method.min ?? 1000 }
      : t === 'percent' ? { type: t, value: method.value }
      : t === 'per_day' ? { type: t, value: method.min ?? 1000 }
      : { type: t, value: 5000 });
  };
  return (
    <div className="rounded-xl border border-navy-100 p-3 space-y-2">
      <p className="text-xs font-semibold text-navy-700">Commission agreed with this owner</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem_9rem]">
        <Select value={!share ? 'default' : none ? 'none' : share.type} onChange={pick} disabled={disabled}
                options={[
                  { value: 'default', label: 'Company default', sub: shareSummary({ type: method.type, value: method.value, min: method.min }) },
                  ...SHARE_TYPES.map((s) => ({ value: s.value, label: s.label, sub: s.sub })),
                  { value: 'none', label: 'No commission', sub: 'the owner gets the whole rental' },
                ]} />
        {share && !none && (
          <label className="text-[11px] text-navy-400">{pctLike ? 'Percent' : share.type === 'per_day' ? 'Rs per day' : 'Rs per trip'}
            <input className="input !py-1.5 mt-0.5" type="number" min={0} max={pctLike ? 100 : undefined} step={pctLike ? 0.5 : 100} disabled={disabled}
                   value={share.value} onChange={(e) => onChange({ ...share, value: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        )}
        {share?.type === 'percent_min' && (
          <label className="text-[11px] text-navy-400">Minimum per day (Rs)
            <input className="input !py-1.5 mt-0.5" type="number" min={0} step={100} disabled={disabled}
                   value={share.min ?? 0} onChange={(e) => onChange({ ...share, min: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        )}
      </div>
      <p className="text-[11px] text-navy-400">
        {share ? <>The company takes <b className="text-navy-700">{shareSummary(share)}</b> on this car's rentals; the owner gets the rest of each final bill.</>
          : <>Uses the company default ({shareSummary({ type: method.type, value: method.value, min: method.min })}).</>}
        {' '}New bookings start with it, and "Complete rental" offers it as the owner's agreed rate.
      </p>
    </div>
  );
}

/**
 * How the car's owner is paid: a share of each rental (the usual way) or a fixed amount
 * (every month, or once for the whole term) whether the car is rented or not.
 */
export default function OwnerTermsField({ value, onChange, disabled, share, onShareChange }: {
  value: OwnerTerms | null | undefined; onChange: (t: OwnerTerms | null) => void; disabled?: boolean;
  /** share of each rental: the commission agreed with this owner (null = the company default) */
  share?: OwnerShare | null; onShareChange?: (s: OwnerShare | null) => void;
}) {
  const t = value ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const set = (p: Partial<OwnerTerms>) => onChange({ type: 'fixed', schedule: 'monthly', amount: 0, start: today, ...(t ?? {}), ...p });

  const Opt = ({ on, title, sub, onClick }: { on: boolean; title: string; sub: string; onClick: () => void }) => (
    <button type="button" disabled={disabled} onClick={onClick}
            className={`rounded-xl border p-2.5 text-left disabled:opacity-60 ${on ? 'border-navy-800 bg-navy-50' : 'border-navy-100 hover:border-navy-300'}`}>
      <span className="block text-sm font-semibold text-navy-800">{title}</span>
      <span className="block text-[11px] text-navy-400">{sub}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Opt on={!t} title="Share of each rental" sub="The company keeps its commission, the owner gets the rest" onClick={() => onChange(null)} />
        <Opt on={!!t} title="Fixed amount" sub="Paid whether the car is rented or not · no commission" onClick={() => { if (!t) set({}); }} />
      </div>

      {!t && onShareChange && <AgreedShare share={share ?? null} onChange={onShareChange} disabled={disabled} />}

      {t && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Opt on={t.schedule === 'monthly'} title="Every month" sub="Part months paid by days" onClick={() => set({ schedule: 'monthly' })} />
            <Opt on={t.schedule === 'term'} title="At the end of the term" sub="One amount for the whole term" onClick={() => set({ schedule: 'term' })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <p className="label">{t.schedule === 'monthly' ? 'Amount a month' : 'Amount for the term'}</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy-400">Rs</span>
                <input className="input pl-10" type="number" min="0" disabled={disabled} value={t.amount || ''}
                       onChange={(e) => set({ amount: Math.max(0, Math.round(+e.target.value || 0)) })} placeholder="80000" />
              </div>
            </div>
            <div>
              <p className="label">From</p>
              <DateInput value={t.start} disabled={disabled} onChange={(v) => set({ start: v })} />
            </div>
            <div>
              <p className="label">{t.schedule === 'monthly' ? 'Until (optional)' : 'Until'}</p>
              <DateInput value={t.end ?? ''} disabled={disabled} minDate={t.start} onChange={(v) => set({ end: v || null })} />
            </div>
          </div>
          <div>
            <p className="label">Note (optional)</p>
            <input className="input" maxLength={160} disabled={disabled} value={t.note ?? ''} placeholder="e.g. agreement signed 1 Dec · insurance by the owner"
                   onChange={(e) => set({ note: e.target.value })} />
          </div>
          {t.amount > 0 && t.start && (t.schedule === 'monthly' || t.end) ? (
            <p className="text-xs text-navy-500 bg-violet-50/70 rounded-lg px-3 py-2">
              The owner gets <b className="text-navy-800">{termsSummary(t)}</b>, whether the car is rented or not. It's added to the owner's
              monthly payout{t.schedule === 'term' ? ' for the month the term ends' : ''}. Bookings starting in this period have no commission split —
              the company keeps the whole bill. Each car expense asks whether it comes off the owner.
            </p>
          ) : (
            <p className="text-xs text-amber-700">Enter the amount{t.schedule === 'term' ? ' and the end date' : ''} — until then the car stays on the share of each rental.</p>
          )}
        </>
      )}
    </div>
  );
}
