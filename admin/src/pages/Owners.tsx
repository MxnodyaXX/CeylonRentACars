import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import Select from '../components/ui/Select';
import { Plus, Car, Lock, FileText, Printer } from 'lucide-react';
import LocationInput from '../components/ui/LocationInput';
import { vehicleNetRevenue } from '../lib/revenue';
import { Owner } from '../types';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const emptyOwner = (): Omit<Owner, 'id' | 'createdAt' | 'totalEarnings' | 'pendingPayout'> => ({
  name: '',
  phone: '',
  email: '',
  address: '',
  bankName: '',
  branchName: '',
  accountNumber: '',
  accountHolderName: '',
  commissionRate: 0,
  smsOptIn: true,
});

export default function Owners() {
  const { owners, vehicles, bookings, commissions, addOwner, updateOwner } = useStore();
  const { currentUser, isAdmin } = useAuthStore();

  const [modal, setModal]       = useState<'add' | 'edit' | 'view' | 'statement' | null>(null);
  const [selected, setSelected] = useState<Owner | null>(null);
  const [form, setForm]         = useState(emptyOwner());
  const [stmtMonth, setStmtMonth] = useState(() => new Date().getMonth() + 1);
  const [stmtYear,  setStmtYear]  = useState(() => new Date().getFullYear());

  const isOwnerRole  = !isAdmin() && currentUser?.role === 'owner';
  const myOwnerId    = currentUser?.ownerId ?? '';

  const set = (field: string, value: unknown) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = () => {
    if (modal === 'add') addOwner(form);
    else if (modal === 'edit' && selected) updateOwner(selected.id, form);
    setModal(null);
  };

  const openView      = (o: Owner) => { setSelected(o); setModal('view'); };
  const openEdit      = (o: Owner) => { setSelected(o); setForm({ ...o }); setModal('edit'); };
  const openStatement = (o: Owner) => { setSelected(o); setModal('statement'); };

  const OwnerCard = ({ o, clickable = true }: { o: Owner; clickable?: boolean }) => {
    const ownerVehicles = vehicles.filter((v) => v.ownerId === o.id);
    const ownerBookings = bookings.filter((b) => ownerVehicles.some((v) => v.id === b.vehicleId));
    const ownerRevenue  = ownerVehicles.reduce((s, v) => s + vehicleNetRevenue(v, ownerBookings), 0); // net of discounts
    const ownerComms    = commissions.filter((c) => c.ownerId === o.id);
    const pendingPayout = ownerComms.filter((c) => c.status === 'Pending').reduce((s, c) => s + c.ownerPayout, 0);
    const isMine        = o.id === myOwnerId;

    return (
      <div
        className={`card transition-shadow ${clickable ? 'hover:shadow-card-hover cursor-pointer' : 'cursor-default'}`}
        onClick={() => clickable && openView(o)}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${isMine ? 'bg-navy-700' : 'bg-navy-400'}`}>
            {o.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-navy-800 truncate">{o.name}</p>
            <p className="text-xs text-navy-400">{isMine || isAdmin() ? o.phone : '••••••••••'}</p>
            {(isMine || isAdmin()) && o.email && <p className="text-xs text-navy-400 truncate">{o.email}</p>}
          </div>
          {!(isMine || isAdmin()) && (
            <div className="flex-shrink-0">
              <Lock size={14} className="text-navy-300" />
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-navy-50/60 rounded-xl p-2.5 text-center">
            <p className="text-base font-bold text-navy-800">{ownerVehicles.length}</p>
            <p className="text-xs text-navy-400">Vehicles</p>
          </div>
          <div className="bg-navy-50/60 rounded-xl p-2.5 text-center">
            <p className="text-base font-bold text-navy-800">{ownerBookings.length}</p>
            <p className="text-xs text-navy-400">Bookings</p>
          </div>
          <div className="bg-navy-50/60 rounded-xl p-2.5 text-center">
            <p className="text-base font-bold text-navy-800">
              Rs {(ownerRevenue / 1000).toFixed(0)}k
            </p>
            <p className="text-xs text-navy-400">Revenue</p>
          </div>
        </div>

        {/* Vehicles list */}
        <div className="space-y-1.5 mb-3">
          {ownerVehicles.map((v) => (
            <div key={v.id} className="flex items-center gap-2">
              <Car size={12} className="text-navy-400 flex-shrink-0" />
              <span className="text-xs text-navy-600 flex-1 truncate">{v.brand} {v.model} · {v.vehicleNumber}</span>
              <StatusBadge status={v.status} />
            </div>
          ))}
        </div>

        {/* Pending payout */}
        {(isMine || isAdmin()) && pendingPayout > 0 && (
          <div className="flex items-center justify-between bg-amber-50 rounded-xl px-3 py-2 mt-2">
            <span className="text-xs text-amber-700">Pending payout</span>
            <span className="text-xs font-bold text-amber-700">Rs {pendingPayout.toLocaleString()}</span>
          </div>
        )}

        {/* Action buttons */}
        {(isAdmin() || isMine) && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(o); }}
              className="flex-1 text-xs py-2 rounded-xl bg-navy-50 text-navy-600 hover:bg-navy-100 font-medium transition-colors"
            >
              Edit Profile
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openStatement(o); }}
              className="flex items-center gap-1 text-xs py-2 px-3 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors flex-shrink-0"
            >
              <FileText size={11} /> Statement
            </button>
          </div>
        )}
      </div>
    );
  };

  const SectionLabel = ({ children, count }: { children: string; count: number }) => (
    <div className="flex items-center gap-3 mb-4 mt-2">
      <p className="text-xs font-semibold text-navy-500 uppercase tracking-widest">{children}</p>
      <span className="text-xs bg-navy-100 text-navy-500 px-2 py-0.5 rounded-full font-medium">{count}</span>
      <div className="flex-1 h-px bg-navy-100" />
    </div>
  );

  const myOwner    = owners.find((o) => o.id === myOwnerId);
  const otherOwners = owners.filter((o) => o.id !== myOwnerId);

  return (
    <div>
      <Header
        title="Owners"
        subtitle={isAdmin() ? 'Per-owner fleet, earnings, and payout summary' : 'Your profile and fleet co-owners'}
      />

      {isAdmin() && (
        <div className="flex justify-end mb-5">
          <button onClick={() => { setForm(emptyOwner()); setModal('add'); }} className="btn-primary flex items-center gap-2">
            <Plus size={15} /> Add Owner
          </button>
        </div>
      )}

      {/* Owner role: "My Profile" then "Other Owners" */}
      {isOwnerRole ? (
        <>
          {myOwner && (
            <>
              <SectionLabel count={1}>My Profile</SectionLabel>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
                <OwnerCard o={myOwner} clickable={true} />
              </div>
            </>
          )}

          {otherOwners.length > 0 && (
            <>
              <SectionLabel count={otherOwners.length}>Other Owners</SectionLabel>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {otherOwners.map((o) => (
                  <OwnerCard key={o.id} o={o} clickable={false} />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        /* Admin view: show all owners */
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {owners.map((o) => <OwnerCard key={o.id} o={o} clickable={true} />)}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modal === 'add' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add Owner' : 'Edit Profile'}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <p className="label">Full Name *</p>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <p className="label">Phone</p>
            <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div>
            <p className="label">Email</p>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <p className="label">Address</p>
            <LocationInput value={form.address ?? ''} onChange={(v) => set('address', v)} placeholder="Owner's address…" />
          </div>
          <div className="sm:col-span-2 border-t border-navy-100 pt-4 mt-1">
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">Banking Details</p>
          </div>
          <div>
            <p className="label">Bank Name</p>
            <input className="input" placeholder="e.g. Commercial Bank" value={form.bankName ?? ''} onChange={(e) => set('bankName', e.target.value)} />
          </div>
          <div>
            <p className="label">Branch Name</p>
            <input className="input" placeholder="e.g. Colombo 07" value={form.branchName ?? ''} onChange={(e) => set('branchName', e.target.value)} />
          </div>
          <div>
            <p className="label">Account Number</p>
            <input className="input" placeholder="e.g. 1200034567890" value={form.accountNumber ?? ''} onChange={(e) => set('accountNumber', e.target.value)} />
          </div>
          <div>
            <p className="label">Account Holder Name</p>
            <input className="input" placeholder="As on bank passbook" value={form.accountHolderName ?? ''} onChange={(e) => set('accountHolderName', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={() => set('smsOptIn', !(form.smsOptIn ?? true))}
              className="w-full flex items-center justify-between gap-3 bg-navy-50/60 rounded-xl px-3.5 py-3 hover:bg-navy-50 transition-colors"
            >
              <span className="text-left">
                <span className="block text-sm font-medium text-navy-700">Receive SMS notifications</span>
                <span className="block text-xs text-navy-400">Booking, payout and referral texts</span>
              </span>
              <span className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${form.smsOptIn ?? true ? 'bg-emerald-500' : 'bg-navy-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.smsOptIn ?? true ? 'translate-x-5' : ''}`} />
              </span>
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary">{modal === 'add' ? 'Add Owner' : 'Save'}</button>
        </div>
      </Modal>

      {/* Monthly Statement Modal */}
      <Modal open={modal === 'statement'} onClose={() => setModal(null)} title="Monthly Statement" width="max-w-2xl">
        {selected && (() => {
          const ownerComms = commissions.filter((c) => {
            if (c.ownerId !== selected.id) return false;
            const d = new Date(c.createdAt);
            return d.getFullYear() === stmtYear && d.getMonth() + 1 === stmtMonth;
          });
          const totalIncome     = ownerComms.reduce((s, c) => s + c.totalIncome, 0);
          const totalReferral   = ownerComms.reduce((s, c) => s + (c.coordinatorFee ?? 0), 0);
          const totalPayout     = ownerComms.reduce((s, c) => s + c.ownerPayout, 0);
          const yearOptions = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

          return (
            <div className="space-y-4">
              {/* Owner header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-navy-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {selected.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="font-bold text-navy-800">{selected.name}</p>
                  <p className="text-xs text-navy-400">Monthly payout statement</p>
                </div>
              </div>

              {/* Month / Year selector */}
              <div className="flex gap-3 items-center">
                <Select className="flex-1" value={String(stmtMonth)} onChange={(v) => setStmtMonth(Number(v))}
                  options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
                <Select className="w-28" value={String(stmtYear)} onChange={(v) => setStmtYear(Number(v))}
                  options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))} />
                <button
                  className="flex items-center gap-1.5 text-xs bg-navy-700 text-white px-3 py-2 rounded-xl hover:bg-navy-800 transition-colors flex-shrink-0"
                  onClick={() => window.print()}
                >
                  <Printer size={13} /> Print
                </button>
              </div>

              {/* Commission table */}
              {ownerComms.length === 0 ? (
                <div className="text-center text-navy-400 text-sm py-8">No bookings in {MONTHS[stmtMonth - 1]} {stmtYear}.</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-navy-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-navy-50 text-navy-500 uppercase tracking-wide text-[10px]">
                        <th className="text-left px-4 py-2.5">Vehicle</th>
                        <th className="text-left px-4 py-2.5">Referral</th>
                        <th className="text-right px-4 py-2.5">Total Income</th>
                        <th className="text-right px-4 py-2.5">Referral Fee</th>
                        <th className="text-right px-4 py-2.5">Owner Payout</th>
                        <th className="text-center px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-50">
                      {ownerComms.map((c) => {
                        const v = vehicles.find((vv) => vv.id === c.vehicleId);
                        return (
                          <tr key={c.id} className="hover:bg-navy-50/40">
                            <td className="px-4 py-2.5 font-medium text-navy-800">{v ? `${v.brand} ${v.model}` : '—'}</td>
                            <td className="px-4 py-2.5 text-navy-500">{c.referral}</td>
                            <td className="px-4 py-2.5 text-right text-navy-700">Rs {c.totalIncome.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right text-amber-600">{(c.coordinatorFee ?? 0) > 0 ? `Rs ${(c.coordinatorFee ?? 0).toLocaleString()}` : '—'}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">Rs {c.ownerPayout.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {c.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals */}
              {ownerComms.length > 0 && (
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="bg-navy-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-navy-400">Total Income</p>
                    <p className="text-base font-bold text-navy-800">Rs {totalIncome.toLocaleString()}</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-amber-500">Referral Fees</p>
                    <p className="text-base font-bold text-amber-700">Rs {totalReferral.toLocaleString()}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-emerald-500">Owner Payout</p>
                    <p className="text-base font-bold text-emerald-700">Rs {totalPayout.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* View Modal — only shown to admin or own profile */}
      <Modal open={modal === 'view'} onClose={() => setModal(null)} title="Owner Details" width="max-w-lg">
        {selected && (isAdmin() || selected.id === myOwnerId) && (() => {
          const ownerVehicles = vehicles.filter((v) => v.ownerId === selected.id);
          const ownerComms    = commissions.filter((c) => c.ownerId === selected.id);
          const pendingPayout = ownerComms.filter((c) => c.status === 'Pending').reduce((s, c) => s + c.ownerPayout, 0);
          const totalPaid     = ownerComms.filter((c) => c.status === 'Paid').reduce((s, c) => s + c.ownerPayout, 0);

          return (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-navy-700 flex items-center justify-center text-white font-bold text-lg">
                  {selected.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="text-lg font-bold text-navy-800">{selected.name}</p>
                  <p className="text-sm text-navy-400">{selected.phone} · {selected.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-navy-700 rounded-xl p-3 text-white text-center">
                  <p className="text-xs opacity-70">Paid Out</p>
                  <p className="text-base font-bold">Rs {(totalPaid / 1000).toFixed(0)}k</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-amber-600">Pending</p>
                  <p className="text-base font-bold text-amber-700">Rs {(pendingPayout / 1000).toFixed(0)}k</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-blue-500">Vehicles</p>
                  <p className="text-base font-bold text-blue-700">{ownerVehicles.length}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="section-title">Vehicles</p>
                {ownerVehicles.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 bg-navy-50/60 rounded-xl p-3">
                    <Car size={16} className="text-navy-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-navy-800">{v.brand} {v.model}</p>
                      <p className="text-xs text-navy-400">{v.vehicleNumber} · Rs {v.dailyRent.toLocaleString()}/day</p>
                    </div>
                    <StatusBadge status={v.status} />
                  </div>
                ))}
              </div>

              {(selected.bankName || selected.accountNumber) && (
                <div className="bg-navy-50/60 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Banking Details</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {selected.bankName && (
                      <div>
                        <p className="text-xs text-navy-400">Bank</p>
                        <p className="font-medium text-navy-800">{selected.bankName}</p>
                      </div>
                    )}
                    {selected.branchName && (
                      <div>
                        <p className="text-xs text-navy-400">Branch</p>
                        <p className="font-medium text-navy-800">{selected.branchName}</p>
                      </div>
                    )}
                    {selected.accountNumber && (
                      <div>
                        <p className="text-xs text-navy-400">Account Number</p>
                        <p className="font-medium text-navy-800 font-mono tracking-wide">{selected.accountNumber}</p>
                      </div>
                    )}
                    {selected.accountHolderName && (
                      <div>
                        <p className="text-xs text-navy-400">Account Holder</p>
                        <p className="font-medium text-navy-800">{selected.accountHolderName}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
