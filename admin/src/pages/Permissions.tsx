import { useState } from 'react';
import { useAuthStore, DEFAULT_PERMS } from '../store/useAuthStore';
import { useStore } from '../store/useStore';
import Header from '../components/layout/Header';
import { ShieldCheck, ShieldOff, ToggleLeft, ToggleRight, Eye, EyeOff, UserPlus, Key } from 'lucide-react';
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

// ── Credential reveal component ───────────────────────────────────────────────

function CredentialRow({ label, value }: { label: string; value: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-navy-400 w-16">{label}</span>
      <span className="font-mono text-navy-700 bg-navy-50 px-2 py-1 rounded-lg select-all flex-1">
        {show ? value : '••••••••'}
      </span>
      <button
        onClick={() => setShow((v) => !v)}
        className="p-1 rounded-lg hover:bg-navy-50 text-navy-400 hover:text-navy-600"
        title={show ? 'Hide' : 'Reveal'}
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
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
  const { users, permissions, getOwnerPermissions, updatePermissions, createOwnerAccount } = useAuthStore();
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
                    onClick={() => createOwnerAccount(owner.id, owner.name)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-navy-50 text-navy-600 hover:bg-navy-100 transition-all flex-shrink-0"
                  >
                    <UserPlus size={14} />
                    Create Login Account
                  </button>
                )}
              </div>

              {/* ── Login credentials (shown when account exists) ── */}
              {hasAccount && (
                <div className="bg-navy-50/50 rounded-xl px-4 py-3 mb-5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-navy-500 font-medium mb-1">
                    <Key size={12} />
                    Login Credentials
                  </div>
                  <CredentialRow label="Username" value={user.username} />
                  <CredentialRow label="Password" value={user.password} />
                </div>
              )}

              {!hasAccount && (
                <p className="text-xs text-navy-400 bg-amber-50 rounded-xl px-3 py-2 mb-4">
                  No login account yet. Click "Create Login Account" to generate credentials for this owner.
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
