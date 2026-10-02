import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import Header from '../components/layout/Header';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import LocationInput from '../components/ui/LocationInput';
import {
  Plus, Search, User, Phone, Mail, MapPin, CreditCard,
  ChevronDown, Edit2, Trash2, CalendarDays, Car, AlertTriangle, Info,
} from 'lucide-react';
import { Customer, Booking } from '../types';
import { customerCredit, bookingBill, bookingPaid, bookingDue, bookingCredit } from '../lib/credit';

const emptyForm = (): Omit<Customer, 'id' | 'createdAt'> => ({
  name: '',
  phone: '',
  email: '',
  nic: '',
  address: '',
  notes: '',
  smsOptIn: true,
});

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500',  'bg-cyan-500',   'bg-indigo-500',  'bg-teal-500',
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function Customers() {
  const { customers, bookings, vehicles, owners, addCustomer, updateCustomer, deleteCustomer } = useStore();

  const [search,     setSearch]     = useState('');
  const [modal,      setModal]      = useState<'add' | 'edit' | 'delete' | null>(null);
  const [selected,   setSelected]   = useState<Customer | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailBooking, setDetailBooking] = useState<Booking | null>(null);
  const [form,       setForm]       = useState(emptyForm());
  const [error,      setError]      = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return [...customers]
      .filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.nic ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [customers, search]);

  const set = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const openAdd = () => {
    setForm(emptyForm());
    setError('');
    setModal('add');
  };

  const openEdit = (c: Customer) => {
    setSelected(c);
    setForm({ name: c.name, phone: c.phone, email: c.email ?? '', nic: c.nic ?? '', address: c.address ?? '', notes: c.notes ?? '', smsOptIn: c.smsOptIn ?? true });
    setError('');
    setModal('edit');
  };

  const openDelete = (c: Customer) => {
    setSelected(c);
    setModal('delete');
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Name and phone are required.');
      return;
    }
    // Prevent duplicate phone
    const duplicate = customers.find(
      (c) => c.phone === form.phone.trim() && c.id !== selected?.id
    );
    if (duplicate) {
      setError('A customer with this phone number already exists.');
      return;
    }
    if (modal === 'add') {
      addCustomer({ ...form, name: form.name.trim(), phone: form.phone.trim() });
    } else if (modal === 'edit' && selected) {
      updateCustomer(selected.id, { ...form, name: form.name.trim(), phone: form.phone.trim() });
    }
    setModal(null);
  };

  const handleDelete = () => {
    if (selected) deleteCustomer(selected.id);
    setModal(null);
    setSelected(null);
  };

  // Match bookings by phone number
  const getHistory = (c: Customer) =>
    bookings
      .filter((b) => b.customerPhone === c.phone)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalSpend = (c: Customer) =>
    getHistory(c).reduce((sum, b) => sum + b.paidAmount, 0);

  // Summary stats
  const totalCustomers = customers.length;
  const activeCustomers = customers.filter((c) =>
    bookings.some((b) => b.customerPhone === c.phone && (b.status === 'Confirmed' || b.status === 'Ongoing'))
  ).length;
  const totalRevenue = customers.reduce((sum, c) => sum + totalSpend(c), 0);

  return (
    <div>
      <Header title="Customers" subtitle="Manage customer profiles and rental history" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center py-4">
          <p className="text-2xl font-black text-navy-800">{totalCustomers}</p>
          <p className="text-xs text-navy-400 mt-0.5">Total Customers</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-black text-emerald-600">{activeCustomers}</p>
          <p className="text-xs text-navy-400 mt-0.5">Active Renters</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-black text-navy-800">Rs {totalRevenue.toLocaleString()}</p>
          <p className="text-xs text-navy-400 mt-0.5">Total Revenue</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
          <input
            className="input pl-9"
            placeholder="Search by name, phone, email or NIC…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus size={15} /> Add Customer
        </button>
      </div>

      {/* Customer list */}
      {filtered.length === 0 ? (
        <div className="card text-center py-16 text-navy-400 text-sm">
          {search ? 'No customers match your search.' : 'No customers yet. Click "Add Customer" to get started.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const history  = getHistory(c);
            const spend    = totalSpend(c);
            const credit   = customerCredit(c, bookings);
            const expanded = expandedId === c.id;

            return (
              <div key={c.id} className="card overflow-hidden transition-shadow hover:shadow-card-hover">
                {/* ── Customer row ── */}
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${avatarColor(c.name)}`}>
                    {initials(c.name)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-navy-800">{c.name}</p>
                      {history.some((b) => b.status === 'Confirmed' || b.status === 'Ongoing') && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          Active
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      <span className="flex items-center gap-1 text-xs text-navy-400">
                        <Phone size={10} /> {c.phone}
                      </span>
                      {c.email && (
                        <span className="flex items-center gap-1 text-xs text-navy-400">
                          <Mail size={10} /> {c.email}
                        </span>
                      )}
                      {c.nic && (
                        <span className="flex items-center gap-1 text-xs text-navy-400">
                          <CreditCard size={10} /> {c.nic}
                        </span>
                      )}
                      {c.address && (
                        <span className="flex items-center gap-1 text-xs text-navy-400">
                          <MapPin size={10} /> {c.address}
                        </span>
                      )}
                    </div>

                    {c.notes && (
                      <p className="text-xs text-navy-400 mt-1 truncate italic">{c.notes}</p>
                    )}
                  </div>

                  {/* Right side — stats + actions */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(c)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-navy-50 hover:text-navy-700 transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => openDelete(c)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-xs font-bold text-navy-800">{history.length} booking{history.length !== 1 ? 's' : ''}</p>
                        <p className="text-[10px] text-navy-400">Rs {spend.toLocaleString()} paid</p>
                      </div>
                    </div>
                    {credit.outstanding > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-100 px-2 py-1 rounded-lg">
                        <CreditCard size={11} /> Credit Rs {credit.outstanding.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Accordion toggle ── */}
                <button
                  onClick={() => setExpandedId(expanded ? null : c.id)}
                  className="flex items-center gap-2 mt-3 pt-3 border-t border-navy-50 w-full text-left group"
                >
                  <CalendarDays size={13} className="text-navy-400" />
                  <span className="text-xs font-semibold text-navy-500 group-hover:text-navy-700 transition-colors flex-1">
                    Rental History
                    {history.length > 0 && (
                      <span className="ml-1.5 text-navy-400 font-normal">({history.length})</span>
                    )}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`text-navy-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* ── Accordion content ── */}
                {expanded && (
                  <div className="mt-2">
                    {/* Credit summary */}
                    {credit.outstanding > 0 && (
                      <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                            <CreditCard size={13} /> Outstanding Credit
                          </span>
                          <span className="text-sm font-bold text-red-700">Rs {credit.outstanding.toLocaleString()}</span>
                        </div>
                        <p className="text-[10px] text-red-500 mb-2">{credit.count} unpaid booking{credit.count !== 1 ? 's' : ''}</p>
                        <div className="space-y-1">
                          {credit.bookings.map(({ booking: b, amount }) => {
                            const v = vehicles.find((x) => x.id === b.vehicleId);
                            return (
                              <div key={b.id} className="flex items-center justify-between text-[11px]">
                                <span className="text-navy-600 truncate">
                                  {v ? `${v.brand} ${v.model}` : 'Booking'} <span className="text-navy-400">· {b.startDate}</span>
                                </span>
                                <span className="font-semibold text-red-600 flex-shrink-0">Rs {amount.toLocaleString()}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {history.length === 0 ? (
                      <div className="text-center py-6 text-xs text-navy-400">
                        No rental history found for this customer.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {history.map((b) => {
                          const vehicle = vehicles.find((v) => v.id === b.vehicleId);
                          const balance = b.totalAmount - (b.discount ?? 0) - b.paidAmount;
                          return (
                            <div
                              key={b.id}
                              className="flex items-center gap-3 bg-navy-50/60 rounded-xl px-3 py-2.5"
                            >
                              {/* Vehicle icon */}
                              <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                                <Car size={14} className="text-navy-500" />
                              </div>

                              {/* Details */}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-navy-800 truncate">
                                  {vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Unknown Vehicle'}
                                  {vehicle && (
                                    <span className="font-normal text-navy-400 ml-1">· {vehicle.vehicleNumber}</span>
                                  )}
                                </p>
                                <p className="text-[10px] text-navy-400 mt-0.5">
                                  {b.startDate} → {b.endDate}
                                  <span className="mx-1">·</span>
                                  {b.totalDays}d
                                </p>
                              </div>

                              {/* Amount */}
                              <div className="text-right flex-shrink-0 mr-2">
                                <p className="text-xs font-bold text-navy-800">Rs {b.totalAmount.toLocaleString()}</p>
                                {balance > 0 ? (
                                  <p className="text-[10px] text-red-500">Bal: Rs {balance.toLocaleString()}</p>
                                ) : (
                                  <p className="text-[10px] text-emerald-600">Settled</p>
                                )}
                              </div>

                              {/* Status */}
                              <StatusBadge status={b.status} size="sm" />

                              {/* More info */}
                              <button
                                onClick={() => setDetailBooking(b)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-navy-400 hover:bg-white hover:text-navy-700 transition-colors flex-shrink-0"
                                title="View full booking details"
                              >
                                <Info size={15} />
                              </button>
                            </div>
                          );
                        })}

                        {/* History summary row */}
                        <div className="flex items-center justify-between px-3 py-2 border-t border-navy-100 mt-1">
                          <span className="text-xs text-navy-400">{history.length} rental{history.length !== 1 ? 's' : ''} total</span>
                          <span className="text-xs font-bold text-navy-700">
                            Rs {history.reduce((s, b) => s + b.totalAmount, 0).toLocaleString()} gross
                            <span className="font-normal text-navy-400 ml-1">
                              · Rs {spend.toLocaleString()} paid
                            </span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      <Modal
        open={modal === 'add' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add Customer' : 'Edit Customer'}
      >
        {error && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="label">Full Name *</p>
            <div className="relative">
              <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input
                className="input pl-8"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Amila Jayasinghe"
              />
            </div>
          </div>
          <div>
            <p className="label">Phone *</p>
            <div className="relative">
              <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input
                className="input pl-8"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="07X XXXXXXX"
              />
            </div>
          </div>
          <div>
            <p className="label">Email</p>
            <div className="relative">
              <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input
                className="input pl-8"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="customer@email.com"
              />
            </div>
          </div>
          <div>
            <p className="label">NIC</p>
            <div className="relative">
              <CreditCard size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input
                className="input pl-8"
                value={form.nic}
                onChange={(e) => set('nic', e.target.value)}
                placeholder="901234567V"
              />
            </div>
          </div>
          <div className="col-span-2">
            <p className="label">Address</p>
            <LocationInput value={form.address ?? ''} onChange={(v) => set('address', v)} placeholder="No. 12, Temple Road, Kandy" />
          </div>
          <div className="col-span-2">
            <p className="label">Notes</p>
            <textarea
              className="input resize-none"
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Any notes about this customer…"
            />
          </div>
          <div className="col-span-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, smsOptIn: !(f.smsOptIn ?? true) }))}
              className="w-full flex items-center justify-between gap-3 bg-navy-50/60 rounded-xl px-3.5 py-3 hover:bg-navy-50 transition-colors"
            >
              <span className="text-left">
                <span className="block text-sm font-medium text-navy-700">Receive SMS notifications</span>
                <span className="block text-xs text-navy-400">Booking, payment and reminder texts</span>
              </span>
              <span className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${form.smsOptIn ?? true ? 'bg-emerald-500' : 'bg-navy-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.smsOptIn ?? true ? 'translate-x-5' : ''}`} />
              </span>
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!form.name.trim() || !form.phone.trim()}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {modal === 'add' ? 'Save Customer' : 'Update Customer'}
          </button>
        </div>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal open={modal === 'delete'} onClose={() => setModal(null)} title="Delete Customer">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-red-50 rounded-xl p-4">
              <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">Delete {selected.name}?</p>
                <p className="text-xs text-red-600 mt-1">
                  This removes the customer profile only. Their booking history will remain intact.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={handleDelete}
                className="px-5 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Full booking detail ── */}
      <Modal open={!!detailBooking} onClose={() => setDetailBooking(null)} title="Booking Details" width="max-w-lg">
        {detailBooking && (() => {
          const b = detailBooking;
          const v = vehicles.find((x) => x.id === b.vehicleId);
          const owner = owners.find((o) => o.id === v?.ownerId);
          const startTime = b.pickupAt?.includes('T') ? b.pickupAt.split('T')[1] : undefined;
          const endTime = b.returnAt?.includes('T') ? b.returnAt.split('T')[1] : undefined;
          const credit = bookingCredit(b);
          const due = bookingDue(b);
          const Row = ({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) => (
            <div className="flex items-start justify-between gap-4 py-1.5 border-b border-navy-50 last:border-0">
              <span className="text-xs text-navy-400">{label}</span>
              <span className={`text-xs font-medium text-right ${accent ?? 'text-navy-800'}`}>{value}</span>
            </div>
          );
          const money = (n?: number) => `Rs ${(n ?? 0).toLocaleString()}`;
          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-navy-700 flex items-center justify-center text-white flex-shrink-0">
                  <Car size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-navy-800 truncate">{v ? `${v.brand} ${v.model}` : 'Vehicle'} <span className="font-normal text-navy-400">· {v?.vehicleNumber}</span></p>
                  <p className="text-xs text-navy-400">{owner ? `Owner: ${owner.name}` : ''}</p>
                </div>
                <StatusBadge status={b.status} />
              </div>

              {/* Rental */}
              <div>
                <p className="text-[11px] font-semibold text-navy-400 uppercase tracking-wide mb-1">Rental</p>
                <Row label="Customer" value={b.customerName} />
                <Row label="Phone" value={b.customerPhone} />
                <Row label="Start" value={`${b.startDate}${startTime ? ` · ${startTime}` : ''}`} />
                <Row label="End" value={`${b.endDate}${endTime ? ` · ${endTime}` : ''}`} />
                <Row label="Duration" value={`${b.totalDays} day${b.totalDays !== 1 ? 's' : ''}`} />
                {b.pickupLocation && <Row label="Pickup" value={b.pickupLocation} />}
                {b.dropLocation && <Row label="Drop" value={b.dropLocation} />}
              </div>

              {/* Payment */}
              <div>
                <p className="text-[11px] font-semibold text-navy-400 uppercase tracking-wide mb-1">Payment</p>
                <Row label="Total Amount" value={money(b.totalAmount)} />
                {(b.extraCharges ?? 0) > 0 && <Row label="Extra Charges" value={money(b.extraCharges)} />}
                {(b.discount ?? 0) > 0 && <Row label="Discount" value={`− ${money(b.discount)}`} accent="text-emerald-600" />}
                <Row label="Bill" value={money(bookingBill(b))} />
                <Row label="Paid" value={money(b.paidAmount)} accent="text-blue-700" />
                {(b.advanceAmount ?? 0) > 0 && <Row label="Advance" value={money(b.advanceAmount)} accent="text-blue-700" />}
                <Row label="Total Received" value={money(bookingPaid(b))} accent="text-blue-700" />
                {(b.depositAmount ?? 0) > 0 && <Row label="Deposit" value={money(b.depositAmount)} />}
                {b.paymentMethod && <Row label="Payment Method" value={b.paymentMethod} />}
                {due > 0 && <Row label="Balance Due" value={money(due)} accent="text-red-600" />}
                {credit > 0 && <Row label="Credit (unsettled)" value={money(credit)} accent="text-amber-600" />}
                {(b.creditAmount ?? 0) > 0 && b.creditSettled && <Row label="Credit" value="Settled" accent="text-emerald-600" />}
                {b.creditResponsibility && <Row label="Credit Liability" value={b.creditResponsibility === 'self' ? 'Vehicle owner' : b.creditResponsibility === 'owner' ? 'Referring owner' : 'Company'} />}
              </div>

              {/* Referral */}
              {(b.referral && b.referral !== 'Direct') && (
                <div>
                  <p className="text-[11px] font-semibold text-navy-400 uppercase tracking-wide mb-1">Referral</p>
                  <Row label="Referred by" value={b.referral} />
                  {(b.referralFee ?? 0) > 0 && <Row label="Referral Fee" value={money(b.referralFee)} accent="text-amber-700" />}
                  {(b.referralFee ?? 0) > 0 && <Row label="Fee Status" value={b.referralPaid ? 'Paid' : 'Pending'} accent={b.referralPaid ? 'text-emerald-600' : 'text-amber-600'} />}
                </div>
              )}

              {b.notes && (
                <div>
                  <p className="text-[11px] font-semibold text-navy-400 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-xs text-navy-600 bg-navy-50/60 rounded-lg px-3 py-2">{b.notes}</p>
                </div>
              )}

              <p className="text-[10px] text-navy-300 text-center">Booking ID: {b.id} · created {new Date(b.createdAt).toLocaleString()}</p>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
