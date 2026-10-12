import { useState } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import Modal from './Modal';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { Booking } from '../../types';

export const CANCEL_REASONS = [
  'Customer changed plans',
  'Customer did not show up',
  'Customer found another vehicle',
  'Price / payment issue',
  'Vehicle unavailable or broken down',
  'Duplicate / entered by mistake',
  'Other',
] as const;

/** Asks why a booking is being cancelled before cancelling it; the reason goes into the booking notes */
export default function CancelBookingModal({ booking, onClose, onCancelled }: { booking: Booking; onClose: () => void; onCancelled?: () => void }) {
  const { cancelBooking, vehicles } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const vehicle = vehicles.find((v) => v.id === booking.vehicleId);
  const needsDetails = reason === 'Other';

  const confirm = () => {
    if (!reason) return setError('Choose a reason for the cancellation.');
    if (needsDetails && !details.trim()) return setError('Write the reason in the box below.');
    cancelBooking(booking.id, { reason: needsDetails ? details.trim() : reason, details: needsDetails ? undefined : details.trim() || undefined, by });
    onCancelled?.();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Cancel booking" width="max-w-md">
      <div className="space-y-4">
        <div className="rounded-xl bg-navy-50/70 px-3 py-2.5 text-sm">
          <p className="font-semibold text-navy-800">{booking.customerName}</p>
          <p className="text-xs text-navy-500">
            {vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})` : 'Vehicle'} · {booking.startDate} → {booking.endDate}
          </p>
        </div>

        <div>
          <p className="label">Why is it being cancelled? *</p>
          <div className="space-y-1.5" role="radiogroup" aria-label="Cancellation reason">
            {CANCEL_REASONS.map((r) => (
              <label key={r} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm cursor-pointer transition-colors ${reason === r ? 'border-red-300 bg-red-50 text-red-800' : 'border-navy-100 text-navy-700 hover:bg-navy-50'}`}>
                <input type="radio" name="cancel-reason" className="accent-red-500" checked={reason === r} onChange={() => { setReason(r); setError(''); }} />
                {r}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="label">{needsDetails ? 'Reason *' : 'Details (optional)'}</p>
          <textarea className="input min-h-[70px]" value={details} onChange={(e) => { setDetails(e.target.value); setError(''); }}
                    placeholder={needsDetails ? 'Write the reason' : 'e.g. Flight moved to next month'} />
        </div>

        {(booking.paidAmount > 0 || (booking.advanceAmount ?? 0) > 0) && (
          <p className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2 flex gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            The customer has paid Rs {(booking.paidAmount + (booking.advanceAmount ?? 0)).toLocaleString()} — remember to arrange a refund if one is due.
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Keep booking</button>
          <button type="button" onClick={confirm} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 transition-colors">
            <XCircle size={15} /> Cancel booking
          </button>
        </div>
      </div>
    </Modal>
  );
}
