import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useStore } from '../store/useStore';
import Header from '../components/layout/Header';
import { ShieldCheck, ShieldOff, ToggleLeft, ToggleRight, UserPlus, Key, RotateCcw, Copy, Loader2 } from 'lucide-react';
import { toast } from '../store/useToast';
import { OwnerPermissions } from '../types/auth';

// ── Permission definitions ────────────────────────────────────────────────────

const ACTION_PERMS: { key: keyof Omit<OwnerPermissions, 'disabled'>; label: string; desc: string }[] = [
  { key: 'canBook',          label: 'Create Bookings',  desc: 'Can add new bookings for their vehicles'       },
  { key: 'canEditVehicle',   label: 'Edit Vehicles',    desc: 'Can edit details of their own vehicles'        },
  { key: 'canChangeStatus',  label: 'Change Status',    desc: 'Can update booking and vehicle status'         },
  { key: 'canAddExpenses',   label: 'Log Expenses',     desc: 'Can record vehicle expenses'                   },
];

const PAGE_PERMS: { key: keyof Omit<OwnerPermissions, 'disabled'>; label: string; desc: string }[] = [
  { key: 'canViewExpenses',   label: 'Expenses Page',   desc: 'See the Expenses section'                      },
  { key: 'canViewHandovers',  label: 'Handovers Page',  desc: 'See vehicle handover records'                  },
  { key: 'canViewDrivers',    label: 'Drivers Page',    desc: 'See the Drivers section'                       },
  { key: 'canViewCustomers',  label: 'Customers Page',  desc: 'See the Customers section'                     },
  { key: 'canViewReferrals',  label: 'Referrals Page',  desc: 'See the Referrals section'                     },
  { key: 'canViewInquiries',  label: 'Inquiries Page',  desc: 'See customer inquiries'                        },
  { key: 'canViewIncomplete', label: 'Incomplete Page', desc: 'See incomplete / draft processes'              },
];

// ── New credentials (shown once — passwords are hashed and can't be looked up later) ──

function NewCredentials({ username, password, onDone }: { username: string; password: string; onDone: () => void }) {
  const text = `Ceylon Rent A Cars admin login\nUsername: ${username}\nPIN: ${password}`;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-5 text-xs">
      <p className="font-semibold text-emerald-800 mb-2">Give these to the owner now — the PIN can't be shown again.</p>
      <div className="grid grid-cols-[4.5rem_1fr] gap-y-1 font-mono text-navy-800">
        <span className="font-sans text-navy-500">Username</span><span className="select-all">{username}</span>
        <span className="font-sans text-navy-500">PIN</span><span className="select-all text-base font-bold tracking-widest">{password}</span>
      </div>
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success('Copied', 'Login details copied.'))}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-emerald-700 border border-emerald-200"><Copy size={12} /> Copy</button>
        <button type="button" onClick={onDone} className="rounded-lg px-2.5 py-1 font-semibold text-navy-500 hover:text-navy-800">Done</button>
      </div>
    </div>
  );
}

// ── Permission toggle row ─────────────────────────────────────────────────────

function PermToggle({
  label, desc, on, onClick,
}: { label: string; desc: string; on: boolean; onClick: () => void }) {
  return (
    <div
      className="flex items-center justify-between bg-navy-50/60 rounded-xl px-4 py-3 cursor-pointer hover:bg-navy-50 transition-colors"
      onClick={onClick}
    >
      <div>
        <p className={`text-sm font-medium ${on ? 'text-navy-800' : 'text-navy-400'}`}>{label}</p>
        <p className="text-xs text-navy-400">{desc}</p>
      </div>
      {on
        ? <ToggleRight size={22} className="text-navy-700 flex-shrink-0" />
        : <ToggleLeft  size={22} className="text-navy-300 flex-shrink-0" />
      }
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Permissions() {
  const { users, getOwnerPermissions, updatePermissions, createOwnerAccount, resetPassword } = useAuthStore();
  // credentials just created / reset, keyed by owner id (shown once)
  const [fresh, setFresh] = useState<Record<string, { username: string; password: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const create = async (ownerId: string, name: string) => {
    setBusy(ownerId);
    const c = await createOwnerAccount(ownerId, name);
    if (c) setFresh((x) => ({ ...x, [ownerId]: c }));
    setBusy(null);
  };
  const reset = async (ownerId: string, userId: string, username: string) => {
    if (!confirm(`Give ${username} a new PIN? Their current PIN stops working.`)) return;
    setBusy(ownerId);
    const pin = await resetPassword(userId);
    if (pin) setFresh((x) => ({ ...x, [ownerId]: { username, password: pin } }));
    setBusy(null);
  };
  const owners = useStore((s) => s.owners);

  return (
    <div>
      <Header
        title="Permission Manager"
        subtitle="Control what each owner can access and do in the system"
      />

      {owners.length === 0 && (
        <p className="text-sm text-navy-400 text-center py-12">No owners registered yet.</p>
      )}

      <div className="space-y-6">
        {owners.map((owner) => {
          const user  = users.find((u) => u.ownerId === owner.id);
          const perms = getOwnerPermissions(owner.id);
          const hasAccount = !!user;

          return (
            <div key={owner.id} className="card">
              {/* ── Owner header ── */}
              <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-navy-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {owner.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <p className="font-semibold text-navy-800 text-sm">{owner.name}</p>
                    <p className="text-xs text-navy-400">{owner.phone}</p>
                  </div>
                </div>

                {/* Account status / disable toggle */}
                {hasAccount ? (
                  <button
                    onClick={() => updatePermissions(owner.id, { disabled: !perms.disabled })}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 ${
                      perms.disabled
                        ? 'bg-red-50 text-red-700 hover:bg-red-100'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {perms.disabled ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                    {perms.disabled ? 'Account Disabled' : 'Account Active'}
                  </button>
                ) : (
                  <button
                    onClick={() => create(owner.id, owner.name)}
                    disabled={busy === owner.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-navy-50 text-navy-600 hover:bg-navy-100 transition-all flex-shrink-0 disabled:opacity-50"
                  >
                    {busy === owner.id ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                    Create Login Account
                  </button>
                )}
              </div>

              {/* ── Login (passwords are hashed — they can be reset, never shown) ── */}
              {fresh[owner.id] && (
                <NewCredentials {...fresh[owner.id]} onDone={() => setFresh((x) => { const n = { ...x }; delete n[owner.id]; return n; })} />
              )}
              {hasAccount && !fresh[owner.id] && (
                <div className="bg-navy-50/50 rounded-xl px-4 py-3 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <span className="flex items-center gap-1.5 text-navy-500 font-medium"><Key size={12} /> Login</span>
                  <span className="font-mono text-navy-800 bg-white px-2 py-1 rounded-lg select-all">{user.username}</span>
                  <span className="text-navy-400">{user.lastSignIn ? `Last signed in ${new Date(user.lastSignIn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Not signed in yet'}</span>
                  <button type="button" onClick={() => reset(owner.id, user.id, user.username)} disabled={busy === owner.id}
                          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-navy-600 border border-navy-100 hover:bg-navy-50 disabled:opacity-50">
                    {busy === owner.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Reset PIN
                  </button>
                </div>
              )}

              {!hasAccount && (
                <p className="text-xs text-navy-400 bg-amber-50 rounded-xl px-3 py-2 mb-4">
                  No login account yet. Click "Create Login Account" — you'll see the username and PIN once, to give to the owner.
                </p>
              )}

              {/* ── Permission toggles (only if account exists) ── */}
              {hasAccount && (
                <div className={perms.disabled ? 'opacity-40 pointer-events-none space-y-4' : 'space-y-4'}>
                  {/* Actions */}
                  <div>
                    <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">Actions</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ACTION_PERMS.map(({ key, label, desc }) => (
                        <PermToggle
                          key={key}
                          label={label}
                          desc={desc}
                          on={perms[key] as boolean}
                          onClick={() => updatePermissions(owner.id, { [key]: !perms[key] })}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Page visibility */}
                  <div>
                    <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">Pages</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {PAGE_PERMS.map(({ key, label, desc }) => (
                        <PermToggle
                          key={key}
                          label={label}
                          desc={desc}
                          on={perms[key] as boolean}
                          onClick={() => updatePermissions(owner.id, { [key]: !perms[key] })}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Always-off notice */}
                  <p className="text-xs text-navy-400 pt-1">
                    Owners never see: Owners list, Permissions, Credit Management, Settings — these are admin-only.
                  </p>
                </div>
              )}

              {perms.disabled && hasAccount && (
                <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 mt-3">
                  This account is disabled — the owner cannot log in.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
