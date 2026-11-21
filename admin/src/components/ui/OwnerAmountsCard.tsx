import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { saveOwnerAmountsSetting } from '../../lib/appSettings';
import { useOwnerAmounts } from '../../lib/ownerMoney';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import { askConfirm } from '../../lib/dialog';

const fmt = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** Settings → may owner logins see rental amounts, or only their own payouts (pending / received)? */
export default function OwnerAmountsCard() {
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Admin';
  const { setting, loaded, load, set } = useOwnerAmounts();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setNote(setting?.note ?? ''); }, [setting?.note]);

  const on = setting?.show !== false;

  const change = async (show: boolean) => {
    const question = show
      ? 'Open the full owner portal again? Owners will see the bookings and handovers on their cars, the rents, final bills and revenue (fixed-amount cars stay without amounts).'
      : 'Switch ALL owners to payouts only? They will see their cars and what they are paid (pending or received) — no bookings, handovers, expenses, rents, bills or revenue.';
    if (!await askConfirm(question)) return;
    setSaving(true);
    setError('');
    try {
      set(await saveOwnerAmountsSetting(show, note, by));
      toast.success(show ? 'Full owner portal' : 'Owners see payouts only', show ? 'Bookings, handovers and amounts are shown to owners again.' : 'Owners now see only their cars and payouts.');
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <div className={`p-4 bg-white rounded-2xl shadow-card border ${loaded && !on ? 'border-violet-200' : 'border-gray-100'}`}>
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${!loaded ? 'bg-navy-200' : on ? 'bg-emerald-600' : 'bg-violet-600'}`}>
          {on ? <Eye size={20} className="text-white" /> : <EyeOff size={20} className="text-white" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-navy-800 text-sm">Show bookings and rental amounts to owners</p>
            {loaded && (
              <button type="button" role="switch" aria-checked={on} aria-label="Show bookings and rental amounts to owners" disabled={saving} onClick={() => change(!on)}
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-navy-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
              </button>
            )}
          </div>

          {!loaded && <p className="text-xs text-navy-400 mt-1 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading…</p>}
          {error && <p className="text-xs text-red-600 mt-1">Could not save: {error}</p>}

          {loaded && (
            <>
              <p className={`text-xs mt-1 leading-relaxed ${on ? 'text-navy-400' : 'text-violet-800 font-medium'}`}>
                {on
                  ? 'Full owner portal — owners see the bookings and handovers on their cars, the rents, final bills and revenue, plus their payouts. Fixed-amount cars never show amounts.'
                  : 'Payouts only — owners see their cars and what they are paid (pending or received). No bookings, handovers, expenses, rents, bills or revenue.'}
              </p>
              <input className="input !py-1.5 text-xs mt-2" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120}
                     placeholder="Reason (optional), e.g. Keep our prices private" />
              {setting?.updated_by && (
                <p className="text-[11px] text-navy-400 mt-1.5">
                  {on ? 'Shown' : 'Hidden'} by {setting.updated_by}{setting.updated_at ? ` · ${fmt(setting.updated_at)}` : ''}{setting.note ? ` — ${setting.note}` : ''}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
