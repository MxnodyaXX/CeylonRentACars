import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { passwordProblem } from '../../lib/staffAuth';
import { toast } from '../../store/useToast';

/**
 * Change your own password. The server checks the current password and the rules again
 * (Edge Function staff-users → change-password); this only gives quick feedback.
 */
export default function ChangePasswordForm({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const { currentUser, changePassword } = useAuthStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const hint = next ? passwordProblem(next, currentUser?.username) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const problem = passwordProblem(next, currentUser?.username);
    if (problem) { setError(problem); return; }
    if (next !== confirm) { setError('The new passwords do not match.'); return; }
    setSaving(true);
    const failed = await changePassword(current, next);
    setSaving(false);
    if (failed) { setError(failed); return; }
    setCurrent(''); setNext(''); setConfirm('');
    toast.success('Password changed', 'Use your new password next time you sign in.');
    onDone?.();
  };

  const type = show ? 'text' : 'password';
  return (
    <form onSubmit={submit} className={compact ? 'space-y-2.5' : 'space-y-3'}>
      <div>
        <label className="label">Current password</label>
        <input className="input" type={type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div>
        <label className="label">New password</label>
        <div className="relative">
          <input className="input pr-9" type={type} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-700"
                  aria-label={show ? 'Hide passwords' : 'Show passwords'}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <p className={`text-[11px] mt-1 ${next && hint ? 'text-amber-600' : 'text-navy-400'}`}>
          {next && hint ? hint : next ? 'Looks good.' : 'At least 10 characters, with letters and numbers.'}
        </p>
      </div>
      <div>
        <label className="label">Repeat new password</label>
        <input className="input" type={type} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Change password
      </button>
    </form>
  );
}
