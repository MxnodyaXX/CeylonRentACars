import { useEffect, useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import Select from './Select';
import { toast } from '../../store/useToast';
import { useAuthStore } from '../../store/useAuthStore';
import { SHARE_TYPES, companyShareOf, useCompanyShare, type ShareMethod, type ShareType } from '../../lib/companyShare';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
const EXAMPLES = [3500, 5000, 6500, 10000, 15000];

/** Owner payouts → the company's default commission (admin changes it; every new booking starts with it) */
export default function CompanyShareSettings() {
  const admin = useAuthStore((s) => s.isAdmin());
  const { method, loaded, load, save } = useCompanyShare();
  const [draft, setDraft] = useState<ShareMethod>(method);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!loaded) load(); }, [loaded, load]);
  useEffect(() => { setDraft(method); }, [method]);

  const pctLike = draft.type === 'percent' || draft.type === 'percent_min';
  const changed = JSON.stringify(draft) !== JSON.stringify(method);
  const sample = (perDay: number) => companyShareOf({ companyShareType: draft.type, companyShareValue: draft.value, companyShareMin: draft.min, rentalType: 'Daily', totalDays: 1 }, perDay, 1);
  const store = async () => {
    setBusy(true);
    try { await save(draft); toast.success('Company commission saved', 'New bookings start with it. Existing bookings keep their own.'); }
    catch (e) { toast.error('Not saved', (e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="card mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="section-title flex items-center gap-1.5"><Building2 size={16} /> Company commission</p>
          <p className="text-xs text-navy-400 mt-0.5">What the company keeps from each rental — the rest is the owner's. Every new booking starts with this (it can be changed on the booking). No referral fees are paid.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto] items-end">
        <label className="text-xs text-navy-500">Method
          <div className="mt-1"><Select value={draft.type} disabled={!admin} onChange={(v) => setDraft((d) => ({ ...d, type: v as ShareType, ...(v === 'percent_min' && !d.min ? { min: 1000 } : {}) }))}
            options={SHARE_TYPES.map((s) => ({ value: s.value, label: s.label, sub: s.sub }))} /></div>
        </label>
        <label className="text-xs text-navy-500">{pctLike ? 'Percent' : draft.type === 'per_day' ? 'Rs per day' : 'Rs per trip'}
          <input className="input mt-1" type="number" min={0} step={pctLike ? 0.1 : 100} disabled={!admin} value={draft.value}
                 onChange={(e) => setDraft((d) => ({ ...d, value: Math.max(0, Number(e.target.value) || 0) }))} />
        </label>
        {draft.type === 'percent_min' ? (
          <label className="text-xs text-navy-500">Minimum per day (Rs)
            <input className="input mt-1" type="number" min={0} step={100} disabled={!admin} value={draft.min ?? 0}
                   onChange={(e) => setDraft((d) => ({ ...d, min: Math.max(0, Number(e.target.value) || 0) }))} />
          </label>
        ) : <span />}
        {admin && (
          <button type="button" onClick={store} disabled={!changed || busy} className="btn-primary !py-2 disabled:opacity-40 inline-flex items-center gap-1.5">
            {busy && <Loader2 size={14} className="animate-spin" />} Save
          </button>
        )}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="text-xs text-navy-600 min-w-[28rem]">
          <thead><tr className="text-navy-400"><td className="pr-4 py-1">Car's rate per day</td>{EXAMPLES.map((n) => <td key={n} className="px-3 text-right">{rs(n)}</td>)}</tr></thead>
          <tbody>
            <tr><td className="pr-4 py-1 font-semibold text-navy-800">Company per day</td>{EXAMPLES.map((n) => <td key={n} className="px-3 text-right font-semibold text-navy-800">{rs(sample(n))}</td>)}</tr>
            <tr><td className="pr-4 py-1">Owner per day</td>{EXAMPLES.map((n) => <td key={n} className="px-3 text-right">{rs(n - sample(n))}</td>)}</tr>
          </tbody>
        </table>
      </div>
      {!admin && <p className="text-[11px] text-navy-400 mt-2">Only Brian (admin) can change the company commission.</p>}
    </div>
  );
}
