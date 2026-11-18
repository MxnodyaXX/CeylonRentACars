import DateInput from './DateInput';
import type { OwnerTerms } from '../../types';
import { termsSummary } from '../../lib/ownerTerms';

/**
 * How the car's owner is paid: a share of each rental (the usual way) or a fixed amount
 * (every month, or once for the whole term) whether the car is rented or not.
 */
export default function OwnerTermsField({ value, onChange, disabled }: {
  value: OwnerTerms | null | undefined; onChange: (t: OwnerTerms | null) => void; disabled?: boolean;
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
