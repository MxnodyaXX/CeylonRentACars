import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, MessageSquare, MessageSquareOff } from 'lucide-react';
import { getSmsSetting, saveSmsSetting, SmsSetting } from '../../lib/appSettings';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';

const fmt = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** Settings → turn every SMS on or off (e.g. while waiting for a new sender ID) */
export default function SmsSettingCard() {
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Admin';
  const [setting, setSetting] = useState<SmsSetting | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSmsSetting(true)
      .then((s) => { setSetting(s); setNote(s.note ?? ''); })
      .catch((e) => setError((e as Error).message));
  }, []);

  const change = async (enabled: boolean) => {
    const question = enabled
      ? 'Turn SMS sending back on? Texts will go out again using the sender ID set on the server.'
      : 'Pause ALL SMS? No booking confirmations, payment receipts, reminders or alerts will be texted until you turn it back on.';
    if (!confirm(question)) return;
    setSaving(true);
    try {
      const s = await saveSmsSetting(enabled, note, by);
      setSetting(s);
      toast.success(enabled ? 'SMS sending is on' : 'SMS sending is paused', enabled ? 'Texts will be sent again.' : 'No texts will be sent until you turn it back on.');
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  };

  const missingTable = /app_settings|schema cache|does not exist/i.test(error);
  const on = setting?.enabled !== false;

  return (
    <div className={`p-4 bg-white rounded-2xl shadow-card border ${setting && !on ? 'border-red-200' : 'border-gray-100'}`}>
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${!setting ? 'bg-navy-200' : on ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {on ? <MessageSquare size={20} className="text-white" /> : <MessageSquareOff size={20} className="text-white" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-navy-800 text-sm">SMS sending</p>
            {setting && (
              <button type="button" role="switch" aria-checked={on} aria-label="SMS sending" disabled={saving} onClick={() => change(!on)}
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-navy-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
              </button>
            )}
          </div>

          {!setting && !error && <p className="text-xs text-navy-400 mt-1 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading…</p>}
          {error && (
            <p className="text-xs text-red-600 mt-1">
              {missingTable ? 'Run admin/supabase/fix-missing-columns.sql in the Supabase SQL Editor to enable this switch.' : `Could not load the SMS setting: ${error}`}
            </p>
          )}

          {setting && (
            <>
              <p className={`text-xs mt-1 leading-relaxed ${on ? 'text-navy-400' : 'text-red-700 font-medium'}`}>
                {on
                  ? 'Booking confirmations, payment receipts, reminders and alerts are texted to customers, owners and you.'
                  : 'Paused — no SMS is sent to anyone, including the daily reminders. Verification codes are shown on screen instead.'}
              </p>
              <input className="input !py-1.5 text-xs mt-2" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120}
                     placeholder={on ? 'Reason if you pause it, e.g. Waiting for our own sender ID' : 'Reason (optional)'} />
              {setting.updated_by && (
                <p className="text-[11px] text-navy-400 mt-1.5">
                  {on ? 'Turned on' : 'Paused'} by {setting.updated_by}{setting.updated_at ? ` · ${fmt(setting.updated_at)}` : ''}{setting.note ? ` — ${setting.note}` : ''}
                </p>
              )}
              {!on && (
                <p className="text-[11px] text-amber-700 mt-1.5 flex gap-1"><AlertTriangle size={12} className="flex-shrink-0 mt-px" /> Remember to turn it back on once the new sender ID is set on the server.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
