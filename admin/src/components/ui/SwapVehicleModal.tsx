import { useState } from 'react';
import { AlertCircle, ArrowLeftRight } from 'lucide-react';
import Modal from './Modal';
import Select from './Select';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { Booking } from '../../types';

const REASONS = ['Breakdown', 'Accident', 'Customer asked for a different vehicle', 'Upgrade', 'Vehicle needed elsewhere', 'Other'];

/** Move a booking to another vehicle (breakdown, upgrade…) — only vehicles free for the dates are offered */
export default function SwapVehicleModal({ booking: b, onClose, onDone }: { booking: Booking; onClose: () => void; onDone?: () => void }) {
  const { vehicles, editBooking, isVehicleAvailable } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const current = vehicles.find((v) => v.id === b.vehicleId);
  const [vehicleId, setVehicleId] = useState('');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');

  const free = vehicles.filter((v) => v.id !== b.vehicleId && v.status !== 'Maintenance'
    && isVehicleAvailable(v.id, b.startDate, b.endDate, b.id, b.startTime, b.endTime));
  const name = (id: string) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : '—'; };

  const save = () => {
    if (!vehicleId) return setError('Choose the new vehicle.');
    if (!reason) return setError('Choose the reason for the swap.');
    editBooking(b.id, { vehicleId }, {
      by, type: 'Swapped',
      changes: [`Vehicle: ${name(b.vehicleId)} → ${name(vehicleId)}`],
      reason: [reason, details.trim()].filter(Boolean).join(' — '),
    });
    onDone?.();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Swap vehicle" width="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-navy-500">Current: <b className="text-navy-800">{current ? `${current.brand} ${current.model} (${current.vehicleNumber})` : '—'}</b> · {b.startDate} → {b.endDate}</p>
        <div>
          <p className="label">New vehicle (free for these dates)</p>
          <Select searchable searchPlaceholder="Search model or number…" value={vehicleId} onChange={setVehicleId} placeholder={free.length ? 'Choose a vehicle…' : 'No other vehicle is free for these dates'}
            options={free.map((v) => ({ value: v.id, label: `${v.brand} ${v.model}`, sub: `${v.vehicleNumber} · Rs ${v.dailyRent.toLocaleString()}/day` }))} />
        </div>
        <div>
          <p className="label">Reason</p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${reason === r ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100'}`}>{r}</button>
            ))}
          </div>
          <input className="input mt-2" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Details (optional)" />
        </div>
        <p className="text-[11px] text-navy-400">The price stays the same — use Edit if it should change. Revenue and the owner payout move to the new vehicle; the old one becomes available.</p>
        {error && <p className="text-sm text-red-600 flex gap-2"><AlertCircle size={15} className="mt-0.5 flex-shrink-0" />{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={save} className="btn-primary inline-flex items-center gap-1.5"><ArrowLeftRight size={15} /> Swap vehicle</button>
        </div>
      </div>
    </Modal>
  );
}
