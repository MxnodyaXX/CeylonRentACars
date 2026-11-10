import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import Modal from '../components/ui/Modal';
import Select from '../components/ui/Select';
import DateInput from '../components/ui/DateInput';
import { Plus, Trash2, Receipt } from 'lucide-react';
import { Expense, ExpenseCategory } from '../types';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const CATEGORIES: ExpenseCategory[] = ['Service', 'Repair', 'Fine', 'Damage', 'Tire', 'Insurance', 'Fuel', 'Other'];
const CAT_COLORS: Record<ExpenseCategory, string> = {
  Service:   '#111114',
  Repair:    '#EF4444',
  Fine:      '#F59E0B',
  Damage:    '#EC4899',
  Tire:      '#8B5CF6',
  Insurance: '#10B981',
  Fuel:      '#06B6D4',
  Other:     '#6B7280',
};

const emptyForm = (): Omit<Expense, 'id' | 'createdAt'> => ({
  vehicleId: '',
  category: 'Service',
  amount: 0,
  description: '',
  date: new Date().toISOString().slice(0, 10),
});

export default function Expenses() {
  const { expenses, vehicles, owners, addExpense, deleteExpense, updateExpense } = useStore();
  const { currentUser, isAdmin } = useAuthStore();
  const [filter, setFilter] = useState<ExpenseCategory | 'All'>('All');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [modal, setModal] = useState(false);
  const isOwnerRole = !isAdmin() && currentUser?.role === 'owner';
  // the company paid → taken off the car owner's next monthly payout; an owner's own entry is their own cost
  const [form, setForm] = useState({ ...emptyForm(), paidBy: (currentUser?.role === 'owner' ? 'owner' : 'company') as Expense['paidBy'] });
  const mayEdit = isAdmin() || currentUser?.role === 'staff';
  const myVehicleIds = isOwnerRole
    ? new Set(vehicles.filter((v) => v.ownerId === currentUser?.ownerId).map((v) => v.id))
    : null;
  const scopedExpenses = myVehicleIds ? expenses.filter((e) => myVehicleIds.has(e.vehicleId)) : expenses;
  const scopedVehicles = myVehicleIds ? vehicles.filter((v) => myVehicleIds.has(v.id)) : vehicles;

  const filtered = scopedExpenses.filter((e) => {
    if (filter !== 'All' && e.category !== filter) return false;
    if (vehicleFilter && e.vehicleId !== vehicleFilter) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalExpense = scopedExpenses.reduce((s, e) => s + e.amount, 0);

  // Category breakdown for pie chart
  const catMap: Partial<Record<ExpenseCategory, number>> = {};
  scopedExpenses.forEach((e) => { catMap[e.category] = (catMap[e.category] ?? 0) + e.amount; });
  const pieData = Object.entries(catMap).map(([name, value]) => ({ name, value }));

  const set = (field: string, value: unknown) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = () => {
    if (!form.vehicleId || !form.description || form.amount <= 0) return;
    addExpense(form);
    setModal(false);
    setForm({ ...emptyForm(), paidBy: form.paidBy });
  };

  return (
    <div>
      <Header title="Expenses" subtitle="Track all vehicle-related costs" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Summary */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <p className="section-title">Expense by Category</p>
            <span className="text-sm font-bold text-navy-800">Total: Rs {totalExpense.toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {CATEGORIES.map((cat) => {
              const amount = catMap[cat] ?? 0;
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(filter === cat ? 'All' : cat)}
                  className={`rounded-xl p-3 text-center transition-all ${
                    filter === cat ? 'ring-2 ring-navy-400 bg-navy-50' : 'bg-navy-50/60 hover:bg-navy-100/60'
                  }`}
                >
                  <div className="w-2.5 h-2.5 rounded-full mx-auto mb-1.5" style={{ background: CAT_COLORS[cat] }} />
                  <p className="text-xs font-medium text-navy-700">{cat}</p>
                  <p className="text-xs text-navy-400 mt-0.5">Rs {amount.toLocaleString()}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Pie chart */}
        <div className="card flex flex-col items-center">
          <p className="section-title mb-2 self-start">Breakdown</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={2} dataKey="value">
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={CAT_COLORS[entry.name as ExpenseCategory] ?? '#6B7280'} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filters + Add */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Select searchable searchPlaceholder="Search model or number…"
            className="w-40 sm:w-48"
            value={vehicleFilter}
            onChange={setVehicleFilter}
            placeholder="All Vehicles"
            nullable
            options={scopedVehicles.map((v) => ({ value: v.id, label: `${v.brand} ${v.model} · ${v.vehicleNumber}` }))}
          />
          {filter !== 'All' && (
            <button onClick={() => setFilter('All')} className="text-xs text-navy-400 hover:text-navy-700 px-2 py-1 rounded-lg hover:bg-navy-50">
              Clear filter ×
            </button>
          )}
        </div>
        <button onClick={() => { setForm((f) => ({ ...emptyForm(), paidBy: f.paidBy })); setModal(true); }} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus size={15} /> Add Expense
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr>
              <th className="table-head text-left pb-3">Date</th>
              <th className="table-head text-left pb-3">Vehicle</th>
              <th className="table-head text-left pb-3">Category</th>
              <th className="table-head text-left pb-3">Description</th>
              <th className="table-head text-right pb-3">Amount</th>
              <th className="table-head text-right pb-3"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const vehicle = vehicles.find((v) => v.id === e.vehicleId);
              return (
                <tr key={e.id} className="table-row">
                  <td className="py-3 text-sm text-navy-600">{e.date}</td>
                  <td className="py-3">
                    <p className="text-sm text-navy-700">{vehicle?.brand} {vehicle?.model}</p>
                    <p className="text-xs text-navy-400">{vehicle?.vehicleNumber}</p>
                  </td>
                  <td className="py-3">
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                      style={{ background: CAT_COLORS[e.category] + '18', color: CAT_COLORS[e.category] }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: CAT_COLORS[e.category] }} />
                      {e.category}
                    </span>
                  </td>
                  <td className="py-3 text-sm text-navy-700">
                    {e.description}
                    <PaidByTag e={e} mayEdit={mayEdit && !e.settlementId} ownerName={owners.find((o) => o.id === vehicle?.ownerId)?.name}
                               onSet={(paidBy) => updateExpense(e.id, { paidBy })} />
                  </td>
                  <td className="py-3 text-right text-sm font-bold text-navy-800">Rs {e.amount.toLocaleString()}</td>
                  <td className="py-3 text-right">
                    {currentUser?.role !== 'staff' && !e.settlementId && <button
                      onClick={() => { if (confirm('Delete this expense?')) deleteExpense(e.id); }}
                      className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-navy-300 hover:text-red-500 transition-colors ml-auto"
                    >
                      <Trash2 size={13} />
                    </button>}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-navy-400 text-sm">No expenses found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Expense Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Add Expense">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <p className="label">Vehicle *</p>
            <Select searchable searchPlaceholder="Search model or number…" value={form.vehicleId} onChange={(v) => set('vehicleId', v)} placeholder="Select vehicle" nullable
              options={scopedVehicles.map((v) => ({ value: v.id, label: `${v.brand} ${v.model} — ${v.vehicleNumber}` }))} />
          </div>
          <div>
            <p className="label">Category</p>
            <Select value={form.category} onChange={(v) => set('category', v as ExpenseCategory)}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </div>
          <div>
            <p className="label">Amount (Rs) *</p>
            <input className="input" type="number" value={form.amount} onChange={(e) => set('amount', +e.target.value)} />
          </div>
          <div>
            <p className="label">Date</p>
            <DateInput value={form.date} onChange={(v) => set('date', v)} />
          </div>
          <div>
            <p className="label">Description *</p>
            <input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Brief description" />
          </div>
          {!isOwnerRole && (
            <div className="sm:col-span-2">
              <p className="label">Who paid it?</p>
              <div className="grid grid-cols-2 gap-2">
                {([['company', 'The company', "Taken off the owner's next monthly payout"], ['owner', 'The vehicle owner', 'Recorded only — nothing taken off']] as const).map(([k, label, hint]) => (
                  <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, paidBy: k }))}
                          className={`rounded-xl border p-2.5 text-left ${form.paidBy === k ? 'border-navy-800 bg-navy-50' : 'border-navy-100 hover:border-navy-300'}`}>
                    <span className="block text-sm font-semibold text-navy-800">{label}</span>
                    <span className="block text-[11px] text-navy-400">{hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary">Save Expense</button>
        </div>
      </Modal>
    </div>
  );
}

/** Who paid the expense and whether it was taken off the owner's payout */
function PaidByTag({ e, mayEdit, ownerName, onSet }: { e: Expense; mayEdit: boolean; ownerName?: string; onSet: (p: 'company' | 'owner') => void }) {
  if (e.settlementId) return <span className="block text-[11px] font-semibold text-emerald-700">Taken off {ownerName ?? "the owner"}'s payout · settled</span>;
  if (e.paidBy === 'company') return <span className="block text-[11px] text-amber-700">Company paid · comes off {ownerName ?? "the owner"}'s next payout</span>;
  if (e.paidBy === 'owner') return <span className="block text-[11px] text-navy-400">Paid by the owner</span>;
  if (!mayEdit) return <span className="block text-[11px] text-navy-300">Who paid: not recorded</span>;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-navy-400 mt-0.5">Who paid?
      <button type="button" onClick={() => onSet('company')} className="rounded px-1.5 py-0.5 bg-navy-50 hover:bg-navy-100 font-semibold text-navy-600">Company</button>
      <button type="button" onClick={() => onSet('owner')} className="rounded px-1.5 py-0.5 bg-navy-50 hover:bg-navy-100 font-semibold text-navy-600">Owner</button>
    </span>
  );
}
