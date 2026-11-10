import { useState } from 'react';
import { ChevronDown, Copy, Key, Loader2, ShieldCheck, ShieldOff, ToggleLeft, ToggleRight, UserPlus, RotateCcw } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import { cleanUsername } from '../../lib/staffAuth';
import { ABILITIES, JOBS, jobLabel, jobOf, presetFor } from '../../lib/staffRoles';
import type { AppUser, StaffAbility, StaffJob } from '../../types/auth';

/*
 * Permissions → Team: one login per employee. The job fills in the usual abilities; the admin can
 * tick more or fewer for one person (e.g. while covering for a colleague). Changes apply the next
 * time the person signs in or their session refreshes (within an hour).
 */

type Perms = Partial<Record<StaffAbility, boolean>>;
const GROUPS = ['Bookings', 'Fleet', 'Money', 'People'] as const;

function Credentials({ username, password, onDone }: { username: string; password: string; onDone: () => void }) {
  const text = `Ceylon Rent A Cars admin login\nUsername: ${username}\nTemporary password: ${password}\n(You will be asked to choose your own password when you first sign in.)`;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs">
      <p className="font-semibold text-emerald-800 mb-2">Give these to the person now — the password can't be shown again. They choose their own when they first sign in.</p>
      <div className="grid grid-cols-[8rem_1fr] gap-y-1 font-mono text-navy-800">
        <span className="font-sans text-navy-500">Username</span><span className="select-all">{username}</span>
        <span className="font-sans text-navy-500">Temporary password</span><span className="select-all text-base font-bold tracking-wide">{password}</span>
      </div>
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success('Copied', 'Login details copied.'))}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-emerald-700 border border-emerald-200"><Copy size={12} /> Copy</button>
        <button type="button" onClick={onDone} className="rounded-lg px-2.5 py-1 font-semibold text-navy-500 hover:text-navy-800">Done</button>
      </div>
    </div>
  );
}

/** The abilities, grouped, as switches */
function AbilitySwitches({ perms, onToggle, disabled }: { perms: Perms; onToggle: (k: StaffAbility) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {GROUPS.map((g) => (
        <div key={g}>
          <p className="text-[11px] font-semibold text-navy-400 uppercase tracking-wider mb-1.5">{g}</p>
          <div className="space-y-1.5">
            {ABILITIES.filter((a) => a.group === g).map((a) => {
              const on = !!perms[a.key];
              return (
                <button key={a.key} type="button" disabled={disabled} onClick={() => onToggle(a.key)}
                        className="w-full flex items-center justify-between gap-3 bg-navy-50/60 rounded-xl px-3 py-2 text-left hover:bg-navy-50 disabled:opacity-50 transition-colors">
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${on ? 'text-navy-800' : 'text-navy-400'}`}>{a.label}</span>
                    <span className="block text-[11px] text-navy-400 leading-snug">{a.hint}</span>
                  </span>
                  {on ? <ToggleRight size={22} className="text-navy-700 flex-shrink-0" /> : <ToggleLeft size={22} className="text-navy-300 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewTeamLogin({ taken, onCreated }: { taken: Set<string>; onCreated: (c: { username: string; password: string }) => void }) {
  const createTeamLogin = useAuthStore((s) => s.createTeamLogin);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [touchedUser, setTouchedUser] = useState(false);
  const [job, setJob] = useState<StaffJob>('operations');
  const [perms, setPerms] = useState<Perms>(presetFor('operations'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const suggested = cleanUsername(name.split(/\s+/)[0] ?? '').replace(/[._-]/g, '');
  const user = touchedUser ? cleanUsername(username) : suggested;

  const pickJob = (j: StaffJob) => { setJob(j); setPerms(presetFor(j)); };
  const save = async () => {
    setError('');
    if (name.trim().length < 2) return setError("Enter the person's name.");
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(user)) return setError('Username: 3–32 characters — lowercase letters, numbers, . _ -');
    if (taken.has(user)) return setError('That username is already taken — choose another.');
    setBusy(true);
    const r = await createTeamLogin({ username: user, name: name.trim(), job, permissions: perms });
    setBusy(false);
    if (typeof r === 'string') return setError(r);
    toast.success('Login created', `${name.trim()} — ${jobLabel(job)}`);
    onCreated(r);
    setName(''); setUsername(''); setTouchedUser(false); pickJob('operations');
  };

  return (
    <div className="card space-y-4">
      <p className="font-semibold text-navy-800 text-sm flex items-center gap-2"><UserPlus size={16} /> Add a team member</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-navy-500">Name
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thisaga Perera" />
        </label>
        <label className="text-xs font-medium text-navy-500">Username (to sign in)
          <input className="input mt-1 font-mono" value={user} onChange={(e) => { setTouchedUser(true); setUsername(e.target.value); }} placeholder="e.g. thisaga" />
        </label>
      </div>
      <div>
        <p className="text-xs font-medium text-navy-500 mb-1.5">Job</p>
        <div className="grid gap-2 md:grid-cols-3">
          {JOBS.map((j) => (
            <button key={j.key} type="button" onClick={() => pickJob(j.key)}
                    className={`rounded-xl border p-3 text-left transition-colors ${job === j.key ? 'border-navy-800 bg-navy-50' : 'border-navy-100 hover:border-navy-300'}`}>
              <span className="block text-sm font-semibold text-navy-800">{j.label}</span>
              <span className="block text-[11px] text-navy-400 mb-1">usually {j.person}</span>
              <span className="block text-xs text-navy-500 leading-snug">{j.summary}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-navy-500 mb-2">What they can do — set from the job, change any switch for this person</p>
        <AbilitySwitches perms={perms} onToggle={(k) => setPerms((p) => ({ ...p, [k]: !p[k] }))} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Create login
        </button>
      </div>
    </div>
  );
}

function TeamCard({ u, onCredentials }: { u: AppUser; onCredentials: (c: { username: string; password: string }) => void }) {
  const { updateTeamLogin, resetPassword } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const perms = (u.permissions ?? {}) as Perms;
  const job = jobOf(u.job);
  const preset = u.job ? presetFor(u.job) : {};
  const differs = ABILITIES.some((a) => !!perms[a.key] !== !!preset[a.key]);

  const save = async (p: Parameters<typeof updateTeamLogin>[1], done?: string) => {
    setBusy(true);
    const err = await updateTeamLogin(u.id, p);
    setBusy(false);
    if (err) toast.error('Not saved', err);
    else if (done) toast.success(done, `${u.name}: it applies the next time they sign in or within an hour.`);
  };
  const reset = async () => {
    if (!confirm(`Give ${u.username} a new temporary password? Their current password stops working.`)) return;
    setBusy(true);
    const pw = await resetPassword(u.id);
    setBusy(false);
    if (pw) onCredentials({ username: u.username, password: pw });
  };

  const on = ABILITIES.filter((a) => perms[a.key]).length;
  const initials = u.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className={`card !p-0 overflow-hidden ${u.disabled ? 'opacity-70' : ''}`}>
      {/* the summary row opens and closes the profile */}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-navy-50/50 transition-colors">
        <div className="w-11 h-11 rounded-xl bg-navy-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{initials}</div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy-800 text-sm truncate">{u.name} <span className="font-mono text-xs font-normal text-navy-400">@{u.username}</span></p>
          <p className="text-xs text-navy-400 truncate">
            {job?.label ?? 'No job'}{u.lastSignIn ? ` · last signed in ${new Date(u.lastSignIn).toLocaleDateString('en-GB')}` : ' · not signed in yet'}
            {u.mustChangePassword && ' · temporary password'}
          </p>
        </div>
        <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
          {u.disabled && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">Switched off</span>}
          {differs && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Custom</span>}
          <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-600">{on} of {ABILITIES.length} abilities</span>
        </span>
        {busy && <Loader2 size={15} className="animate-spin text-navy-400 flex-shrink-0" />}
        <ChevronDown size={18} className={`text-navy-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 pt-4 space-y-4 border-t border-navy-100">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-medium text-navy-500 flex items-center gap-2">Job
              <select className="input !py-1.5 !w-auto text-xs" value={u.job ?? ''} disabled={busy}
                      onChange={(e) => {
                        const j = e.target.value as StaffJob;
                        if (confirm(`Make ${u.name} ${jobLabel(j)}? Their switches are reset to that job's usual abilities.`)) save({ job: j, permissions: presetFor(j) }, 'Job changed');
                      }}>
                {JOBS.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
              </select>
            </label>
            <span className="flex-1" />
            <button type="button" onClick={reset} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-semibold text-navy-600 hover:bg-navy-100"><Key size={12} /> New password</button>
            <button type="button" disabled={busy}
                    onClick={() => { if (u.disabled || confirm(`Switch off ${u.name}'s login? They can't sign in until you switch it back on.`)) save({ disabled: !u.disabled }, u.disabled ? 'Login switched on' : 'Login switched off'); }}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${u.disabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
              {u.disabled ? <><ShieldCheck size={12} /> Switch on</> : <><ShieldOff size={12} /> Switch off</>}
            </button>
          </div>
          <AbilitySwitches perms={perms} disabled={busy || u.disabled} onToggle={(k) => save({ permissions: { ...perms, [k]: !perms[k] } })} />
          {differs && u.job && (
            <button type="button" disabled={busy} onClick={() => save({ permissions: presetFor(u.job!) }, 'Abilities reset')}
                    className="text-xs font-semibold text-navy-500 hover:text-navy-800 inline-flex items-center gap-1"><RotateCcw size={12} /> Back to the usual {job?.label} abilities</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TeamLogins() {
  const users = useAuthStore((s) => s.users);
  const [fresh, setFresh] = useState<{ username: string; password: string } | null>(null);
  const team = users.filter((u) => u.role === 'staff').sort((a, b) => a.name.localeCompare(b.name));
  const admins = users.filter((u) => u.role === 'admin');

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-navy-50/70 px-4 py-3 text-xs text-navy-600 space-y-1">
        <p><b>One login per person.</b> Everything done in the admin is recorded under the name of whoever signed in, so shared logins hide who did what.</p>
        <p>Admins (full access): {admins.length ? admins.map((a) => `${a.name} (@${a.username})`).join(', ') : '—'}. Admin logins are made in the Supabase dashboard only.</p>
      </div>
      {fresh && <Credentials username={fresh.username} password={fresh.password} onDone={() => setFresh(null)} />}
      {team.map((u) => <TeamCard key={u.id} u={u} onCredentials={setFresh} />)}
      {team.length === 0 && <p className="text-sm text-navy-400">No team logins yet — add Buddhi, Dinithi and Thisaga below.</p>}
      <NewTeamLogin taken={new Set(users.map((u) => u.username))} onCreated={setFresh} />
    </div>
  );
}
