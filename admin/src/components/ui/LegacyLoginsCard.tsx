import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { migrateLegacyLogins } from '../../lib/staffAuth';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';

/**
 * One-time move of the old logins (public.users, plain-text passwords) to Supabase Auth.
 * Owners keep their username + PIN. Afterwards security-lockdown.sql deletes the old table.
 */
export default function LegacyLoginsCard() {
  const refreshUsers = useAuthStore((s) => s.refreshUsers);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>('');

  const run = async () => {
    if (!confirm('Copy the old owner logins to the new secure login system? Owners keep the same username and PIN.')) return;
    setBusy(true);
    try {
      const r = await migrateLegacyLogins();
      const parts = [
        r.created.length ? `moved ${r.created.length} (${r.created.join(', ')})` : '',
        r.skipped.length ? `${r.skipped.length} already moved` : '',
        r.failed.length ? `${r.failed.length} failed: ${r.failed.join('; ')}` : '',
      ].filter(Boolean);
      setResult(parts.join(' · ') || 'No old logins found.');
      if (r.failed.length) toast.error('Some logins were not moved', r.failed.join('; '));
      else toast.success('Old logins moved', 'Owners can sign in with their usual username and PIN.');
      refreshUsers();
    } catch (e) {
      const msg = (e as Error).message;
      setResult(/users/i.test(msg) && /exist|find|relation/i.test(msg) ? 'The old login table is already gone — nothing to move.' : msg);
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 bg-white rounded-2xl shadow-card border border-gray-100">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-navy-700 flex items-center justify-center flex-shrink-0">
          <KeyRound size={20} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy-800 text-sm">Move old logins</p>
          <p className="text-xs text-navy-400 mt-1 leading-relaxed">
            One-time step: copies owner logins from the old system (passwords stored in plain text) to the secure login system.
            Owners keep their username and PIN. Then run <code className="text-[11px]">security-lockdown.sql</code> to delete the old table.
          </p>
          <button type="button" onClick={run} disabled={busy}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-700 disabled:opacity-50">
            {busy && <Loader2 size={12} className="animate-spin" />} Move old logins
          </button>
          {result && <p className="text-[11px] text-navy-500 mt-2">{result}</p>}
        </div>
      </div>
    </div>
  );
}
