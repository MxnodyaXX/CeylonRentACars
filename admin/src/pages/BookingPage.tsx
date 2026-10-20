import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BookingDetailsModal from '../components/ui/BookingDetailsModal';
import EditBookingModal from '../components/ui/EditBookingModal';
import CancelBookingModal from '../components/ui/CancelBookingModal';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { bookingNo } from '../lib/bookingRecord';
import type { Booking } from '../types';

/** /bookings/:id — the booking details as a full page (opened from the pop-up's "open in a new tab") */
export default function BookingPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const b = useStore((s) => s.bookings.find((x) => x.id === id));
  const isAdmin = useAuthStore((s) => s.isAdmin)();
  const [editing, setEditing] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);

  // the browser tab shows which booking this is
  const title = b ? `${bookingNo(b)} · ${b.customerName}` : '';
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = `${title} — Ceylon Rent A Cars`;
    return () => { document.title = before; };
  }, [title]);

  if (!b) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-navy-500">Booking not found — it may have been removed, or you don't have access to it.</p>
        <Link to="/bookings" className="btn-secondary inline-flex">Back to bookings</Link>
      </div>
    );
  }

  return (
    <>
      <BookingDetailsModal page bookingId={b.id} onClose={() => navigate('/bookings')}
        onEdit={(x) => isAdmin && setEditing(x)} onCancel={(x) => setCancelling(x)} />
      {editing && <EditBookingModal booking={editing} onClose={() => setEditing(null)} />}
      {cancelling && <CancelBookingModal booking={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}
