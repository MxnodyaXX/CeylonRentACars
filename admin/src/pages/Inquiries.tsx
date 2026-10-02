import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import Header from '../components/layout/Header';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import Select from '../components/ui/Select';
import DateInput from '../components/ui/DateInput';
import { Plus, MessageSquare, AlertTriangle } from 'lucide-react';
import { Inquiry } from '../types';

const REFERRAL_SOURCES = [
  { value: 'Direct',        label: 'Direct',        sub: 'Customer contacted us directly' },
  { value: 'Walk-in',       label: 'Walk-in',        sub: 'Came in without prior contact' },
  { value: 'Phone Call',    label: 'Phone Call',     sub: 'Inbound call' },
  { value: 'WhatsApp',      label: 'WhatsApp',       sub: 'Via WhatsApp message' },
  { value: 'Facebook',      label: 'Facebook',       sub: 'Facebook page or ads' },
  { value: 'Instagram',     label: 'Instagram',      sub: 'Instagram page or ads' },
  { value: 'TikTok',        label: 'TikTok',         sub: 'TikTok video or ads' },
  { value: 'Google',        label: 'Google',         sub: 'Google search or Maps' },
  { value: 'YouTube',       label: 'YouTube',        sub: 'YouTube channel or ads' },
  { value: 'Word of Mouth', label: 'Word of Mouth',  sub: 'Referred by a past customer' },
  { value: 'Website',       label: 'Website',        sub: 'Found us online' },
];

type IStatus = 'Pending' | 'Converted' | 'Lost';
const TABS: ('All' | IStatus)[] = ['All', 'Pending', 'Converted', 'Lost'];

const LOST_REASONS = [
  'No vehicle available',
  'Dates not available',
  'Budget mismatch',
  'Customer cancelled',
  'Found elsewhere',
  'Other',
];

const emptyForm = (): Omit<Inquiry, 'id' | 'createdAt'> => ({
  customerName: '',
  customerPhone: '',
  requestedVehicle: '',
  preferredBrand: '',
  startDate: '',
  endDate: '',
  referral: '',
  status: 'Pending',
  notes: '',
});

export default function Inquiries() {
  const navigate = useNavigate();
  const location = useLocation();
  const { inquiries, owners, addInquiry, updateInquiry } = useStore();
  const [tab, setTab] = useState<'All' | IStatus>('All');

  // Deep-link from dashboard analytics: /inquiries?status=Lost focuses that tab
  useEffect(() => {
    const status = new URLSearchParams(location.search).get('status');
    if (status && ['All', 'Pending', 'Converted', 'Lost'].includes(status)) {
      setTab(status as 'All' | IStatus);
    }
  }, [location.search]);
  const [modal, setModal] = useState<'add' | 'view' | 'lost' | null>(null);
  const [selected, setSelected] = useState<Inquiry | null>(null);
  const [form, setForm] = useState(emptyForm());

  // Lost reason state
  const [lostTarget, setLostTarget] = useState<Inquiry | null>(null);
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  const [lostCustom, setLostCustom] = useState('');

  const filtered = tab === 'All' ? inquiries : inquiries.filter((i) => i.status === tab);
  const sorted = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const set = (field: string, value: unknown) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = () => {
    if (!form.customerName || !form.requestedVehicle) return;
    addInquiry(form);
    setModal(null);
    setForm(emptyForm());
  };

  const openLostModal = (inq: Inquiry) => {
    setLostTarget(inq);
    setLostReason(LOST_REASONS[0]);
    setLostCustom('');
    setModal('lost');
  };

  const confirmLost = () => {
    if (!lostTarget) return;
    const reason = lostReason === 'Other' ? (lostCustom.trim() || 'Other') : lostReason;
    updateInquiry(lostTarget.id, { status: 'Lost', lostReason: reason });
    if (selected?.id === lostTarget.id) setSelected((s) => s ? { ...s, status: 'Lost', lostReason: reason } : s);
    setModal(null);
    setLostTarget(null);
  };

  const convertInquiry = (inq: Inquiry) => {
    updateInquiry(inq.id, { status: 'Converted' });
    if (selected?.id === inq.id) setSelected((s) => s ? { ...s, status: 'Converted' } : s);
    setModal(null);
    navigate('/bookings', {
      state: {
        fromInquiry: {
          customerName:  inq.customerName,
          customerPhone: inq.customerPhone,
          startDate:     inq.startDate,
          endDate:       inq.endDate,
          notes:         inq.requestedVehicle ? `Requested: ${inq.requestedVehicle}` : '',
        },
      },
    });
  };

  return (
    <div>
      <Header title="Inquiries" subtitle="Track every customer inquiry and lead" />

      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex-shrink-0 ${
                tab === t ? 'bg-navy-700 text-white' : 'bg-white text-navy-500 hover:bg-navy-50 shadow-card'
              }`}
            >
              {t}
              {t !== 'All' && <span className="ml-1.5 opacity-70">{inquiries.filter((i) => i.status === t).length}</span>}
            </button>
          ))}
        </div>
        <button onClick={() => { setForm(emptyForm()); setModal('add'); }} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus size={15} /> Add Inquiry
        </button>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((inq) => (
          <div
            key={inq.id}
            className="card hover:shadow-card-hover transition-shadow cursor-pointer"
            onClick={() => { setSelected(inq); setModal('view'); }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-navy-50 flex items-center justify-center">
                  <MessageSquare size={16} className="text-navy-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-navy-800">{inq.customerName}</p>
                  <p className="text-xs text-navy-400">{inq.customerPhone}</p>
                </div>
              </div>
              <StatusBadge status={inq.status} />
            </div>

            <div className="grid grid-cols-2 gap-y-2 text-xs mb-3">
              <div>
                <p className="text-navy-400">Requested</p>
                <p className="font-medium text-navy-700">{inq.requestedVehicle}</p>
              </div>
              <div>
                <p className="text-navy-400">Referral</p>
                <p className="font-medium text-navy-700">{inq.referral || '—'}</p>
              </div>
              <div>
                <p className="text-navy-400">From</p>
                <p className="font-medium text-navy-700">{inq.startDate || '—'}</p>
              </div>
              <div>
                <p className="text-navy-400">To</p>
                <p className="font-medium text-navy-700">{inq.endDate || '—'}</p>
              </div>
            </div>

            {inq.status === 'Lost' && inq.lostReason && (
              <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">
                <AlertTriangle size={11} />
                {inq.lostReason}
              </div>
            )}

            {inq.notes && (
              <p className="text-xs text-navy-400 bg-navy-50/60 rounded-lg px-3 py-2 mb-3 truncate">{inq.notes}</p>
            )}

            {/* Quick status actions */}
            {inq.status === 'Pending' && (
              <div className="flex gap-2 border-t border-navy-50 pt-3" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => convertInquiry(inq)}
                  className="flex-1 text-xs py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium transition-colors"
                >
                  ✓ Convert
                </button>
                <button
                  onClick={() => openLostModal(inq)}
                  className="flex-1 text-xs py-1.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors"
                >
                  ✕ Mark Lost
                </button>
              </div>
            )}
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="col-span-3 text-center py-16 text-navy-400 text-sm">No inquiries found.</div>
        )}
      </div>

      {/* Add Modal */}
      <Modal open={modal === 'add'} onClose={() => setModal(null)} title="Add Inquiry">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="label">Customer Name *</p>
            <input className="input" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
          </div>
          <div>
            <p className="label">Phone</p>
            <input className="input" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} />
          </div>
          <div>
            <p className="label">Requested Vehicle *</p>
            <input className="input" value={form.requestedVehicle} onChange={(e) => set('requestedVehicle', e.target.value)} placeholder="Axio, Prius, Van..." />
          </div>
          <div>
            <p className="label">Referral / Source</p>
            <Select
              value={form.referral}
              onChange={(val) => set('referral', val)}
              placeholder="How did they hear about us?"
              options={[
                ...REFERRAL_SOURCES,
                ...owners.map((o) => ({
                  value: o.name,
                  label: o.name,
                  sub: 'Owner referral',
                })),
              ]}
            />
          </div>
          <div>
            <p className="label">Start Date</p>
            <DateInput value={form.startDate} onChange={(v) => set('startDate', v)} />
          </div>
          <div>
            <p className="label">End Date</p>
            <DateInput value={form.endDate} onChange={(v) => set('endDate', v)} />
          </div>
          <div className="sm:col-span-2">
            <p className="label">Notes</p>
            <textarea className="input resize-none" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary" disabled={!form.customerName || !form.requestedVehicle}>Save Inquiry</button>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal open={modal === 'view'} onClose={() => setModal(null)} title="Inquiry Details">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-navy-800">{selected.customerName}</p>
                <p className="text-sm text-navy-400">{selected.customerPhone}</p>
              </div>
              <StatusBadge status={selected.status} size="md" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Requested', selected.requestedVehicle],
                ['Referral', selected.referral || '—'],
                ['Start Date', selected.startDate || '—'],
                ['End Date', selected.endDate || '—'],
              ].map(([l, v]) => (
                <div key={l} className="bg-navy-50/60 rounded-xl p-3">
                  <p className="text-xs text-navy-400">{l}</p>
                  <p className="text-sm font-semibold text-navy-800">{v}</p>
                </div>
              ))}
            </div>

            {selected.status === 'Lost' && selected.lostReason && (
              <div className="flex items-center gap-2 bg-red-50 rounded-xl p-3">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <div>
                  <p className="text-xs text-red-400">Lost Reason</p>
                  <p className="text-sm font-semibold text-red-700">{selected.lostReason}</p>
                </div>
              </div>
            )}

            {selected.notes && (
              <div className="bg-navy-50/60 rounded-xl p-3">
                <p className="text-xs text-navy-400 mb-1">Notes</p>
                <p className="text-sm text-navy-700">{selected.notes}</p>
              </div>
            )}
            {selected.status === 'Pending' && (
              <div className="flex gap-3">
                <button
                  onClick={() => convertInquiry(selected)}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                >
                  ✓ Convert to Booking
                </button>
                <button
                  onClick={() => { openLostModal(selected); }}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100"
                >
                  ✕ Mark as Lost
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Lost Reason Modal */}
      <Modal open={modal === 'lost'} onClose={() => setModal(null)} title="Mark as Lost">
        <div className="space-y-4">
          <p className="text-sm text-navy-600">
            Why was <span className="font-semibold text-navy-800">{lostTarget?.customerName}</span>'s inquiry lost?
          </p>

          <div>
            <p className="label">Reason *</p>
            <Select
              value={lostReason}
              onChange={(v) => { setLostReason(v); if (v !== 'Other') setLostCustom(''); }}
              options={LOST_REASONS.map((r) => ({ value: r, label: r }))}
            />
          </div>

          {lostReason === 'Other' && (
            <div>
              <p className="label">Custom Reason</p>
              <input
                className="input"
                value={lostCustom}
                onChange={(e) => setLostCustom(e.target.value)}
                placeholder="Describe why this inquiry was lost..."
                autoFocus
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
            <button
              onClick={confirmLost}
              disabled={lostReason === 'Other' && !lostCustom.trim()}
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm Lost
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
