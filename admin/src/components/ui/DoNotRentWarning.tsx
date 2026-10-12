import { AlertTriangle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { bookingDue } from '../../lib/credit';

/** Shown in booking forms when the phone number belongs to a flagged customer or one who still owes money */
export default function DoNotRentWarning({ phone }: { phone?: string }) {
  const { customers, bookings } = useStore();
  const p = (phone ?? '').replace(/\D/g, '');
  if (p.length < 9) return null;
  const same = (x?: string) => (x ?? '').replace(/\D/g, '').slice(-9) === p.slice(-9);
  const c = customers.find((x) => same(x.phone));
  const owed = bookings.filter((b) => same(b.customerPhone) && b.status !== 'Cancelled').reduce((s, b) => s + bookingDue(b), 0);
  if (!c?.doNotRent && owed <= 0) return null;
  return (
    <div className={`mt-2 rounded-xl border px-3 py-2 text-xs flex gap-2 ${c?.doNotRent ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
      <span>
        {c?.doNotRent && <><b>Do not rent:</b> {c.name} is flagged{c.doNotRentReason ? ` — ${c.doNotRentReason}` : ''}. </>}
        {owed > 0 && <>Still owes <b>Rs {owed.toLocaleString()}</b> on earlier bookings.</>}
      </span>
    </div>
  );
}
