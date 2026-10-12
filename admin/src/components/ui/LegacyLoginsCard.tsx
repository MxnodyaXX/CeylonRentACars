import { useState } from 'react';
import { Copy, KeyRound, Loader2 } from 'lucide-react';
import { LegacyPlan, MovedLogin, migrateLegacy, migratePreview } from '../../lib/staffAuth';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';

/**
 * One-time move of the old logins (public.users, plain-text passwords) to Supabase Auth.
 * 1. Check: the server lists what would happen (only valid owner logins are moved — never admins).
 * 2. Move: each owner gets a NEW temporary password, shown here once, and must change it on first sign-in.
 * Afterwards security/03_remove_legacy_logins.sql deletes the old table.
 */
export default function LegacyLoginsCard() {
  const refreshUsers = useAuthStore((s) => s.refreshUsers);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<LegacyPlan[] | null>(null);
  const [moved, setMoved] = useState<MovedLogin[]>([]);
  const [note, setNote] = useState('');

  const notFound = (msg: string) => (/users/i.test(msg) && /exist|find|relation/i.test(msg) ? 'The old login table is already gone — nothing to move.' : msg);

  const check = async () => {
    setBusy(true); setNote(''); setMoved([]);
    try {
      const p = await migratePreview();
      setPlan(p);
      if (!p.length) setNote('No old logins found.');
    } catch (e) { setPlan(null); setNote(notFound((e as Error).message)); } finally { setBusy(false); }
  };

  const toMove = plan?.filter((p) => p.status === 'move') ?? [];

  const move = async () => {
    if (!confirm(`Create secure logins for ${toMove.length} owner(s)? Each gets a new temporary password — you'll see them once, to pass on.`)) return;
    setBusy(true);
    try {
      const r = await migrateLegacy();
      setMoved(r.moved); setPlan(r.plan);
      if (r.failed.length) toast.error('Some logins were not moved', r.failed.join('; '));
      else toast.success('Logins moved', 'Give each owner their temporary password now.');
      refreshUsers();
    } catch (e) { setNote(notFound((e as Error).message)); } finally { setBusy(false); }
  };

  const copyAll = () => {
    const text = moved.map((m) => `${m.ownerName ?? m.username}\nUsername: ${m.username}\nTemporary password: ${m.tempPassword}`).join('\n\n');
    navigator.clipboard?.writeText(text).then(() => toast.success('Copied', 'Login details copied.'));
  };

  const badge = (s: LegacyPlan['status']) =>
    s === 'move' ? 'bg-emerald-50 text-emerald-700' : s === 'already-moved' ? 'bg-navy-50 text-navy-500' : 'bg-red-50 text-red-700';

  return (
    <div className="p-4 bg-white rounded-2xl shadow-card border border-gray-100">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-navy-700 flex items-center justify-center flex-shrink-0">
          <KeyRound size={20} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy-800 text-sm">Move old logins</p>
          <p className="text-xs text-navy-400 mt-1 leading-relaxed">
            One-time step: creates secure logins for the owners in the old system (passwords stored in plain text).
            Each owner keeps their username and gets a new temporary password. Admin logins are never moved.
          </p>

          {moved.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 mt-3 text-xs">
              <p className="font-semibold text-emerald-800 mb-2">Give these to each owner now — they can't be shown again.</p>
              <div className="space-y-1.5 font-mono text-navy-800">
                {moved.map((m) => (
                  <div key={m.username} className="grid grid-cols-[1fr_auto] gap-x-3">
                    <span className="truncate"><span className="font-sans text-navy-500">{m.ownerName ?? '—'} · </span>{m.username}</span>
                    <span className="select-all font-bold">{m.tempPassword}</span>
                  </div>
                ))}
              </div>
              <button type="button" onClick={copyAll}
                      className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-emerald-700 border border-emerald-200"><Copy size={12} /> Copy all</button>
            </div>
          )}

          {plan && plan.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px]">
              {plan.map((p) => (
                <li key={p.username} className="flex items-start gap-2">
                  <span className={`rounded px-1.5 py-0.5 font-semibold flex-shrink-0 ${badge(p.status)}`}>
                    {p.status === 'move' ? 'will move' : p.status === 'already-moved' ? 'done' : 'skipped'}
                  </span>
                  <span className="text-navy-600 min-w-0">
                    <b>{p.username}</b>{p.ownerName ? ` → ${p.ownerName}` : ''}{p.reason ? <span className="text-navy-400"> — {p.reason}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2 mt-3">
            <button type="button" onClick={check} disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50">
              {busy && !plan && <Loader2 size={12} className="animate-spin" />} {plan ? 'Check again' : 'Check old logins'}
            </button>
            {toMove.length > 0 && (
              <button type="button" onClick={move} disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-700 disabled:opacity-50">
                {busy && <Loader2 size={12} className="animate-spin" />} Move {toMove.length} login{toMove.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
          {note && <p className="text-[11px] text-navy-500 mt-2">{note}</p>}
        </div>
      </div>
    </div>
  );
}
