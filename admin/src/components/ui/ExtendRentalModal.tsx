import { useMemo, useState } from 'react';
import { AlertCircle, CalendarPlus } from 'lucide-react';
import Modal from './Modal';
import DateInput from './DateInput';
import TimePicker from './TimePicker';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { rentalDays } from '../../lib/availability';
import { addCalendarMonths, addHours, RentalType, UNIT, unitLabel } from '../../lib/rentalPeriod';
import { rs } from '../../lib/bookingRecord';
import type { Booking } from '../../types';

/** Extend a rental: later return (daily) or more months / hours — the price follows the same rate */
export default function ExtendRentalModal({ booking: b, onClose, onDone }: { booking: Booking; onClose: () => void; onDone?: () => void }) {
  const { editBooking, isVehicleAvailable } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const type = (b.rentalType ?? 'Daily') as RentalType;
  const dailyRate = b.totalDays ? Math.round(b.totalAmount / b.totalDays) : 0;

  const [endDate, setEndDate] = useState(b.endDate);
  const [endTime, setEndTime] = useState(b.endTime ?? '');
  const [rate, setRate] = useState(type === 'Daily' ? dailyRate : b.unitRate ?? 0);
  const [more, setMore] = useState(1);           // extra months / hours
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  // The new end, length and price
  const next = useMemo(() => {
    if (type === 'Daily') {
      const days = endDate >= b.startDate ? rentalDays(b.startDate, endDate, b.startTime, endTime, b.waiveExtraDay) : b.totalDays;
      return { endDate, endTime, totalDays: days, totalAmount: days * rate, rentalUnits: undefined, label: unitLabel('Daily', days) };
    }
    if (type === 'Monthly') {
      const units = (b.rentalUnits ?? 0) + more;
      const end = addCalendarMonths(b.endDate, more);
      const days = Math.round((new Date(end).getTime() - new Date(b.startDate).getTime()) / 864e5);
      return { endDate: end, endTime: b.endTime ?? '', totalDays: days, totalAmount: units * rate, rentalUnits: units, label: unitLabel('Monthly', units) };
    }
    const units = (b.rentalUnits ?? 0) + more;
    const e = addHours(b.endDate, b.endTime || '00:00', more);
    return { endDate: e.endDate, endTime: e.endTime, totalDays: Math.max(1, Math.ceil(units / 24)), totalAmount: units * rate, rentalUnits: units, label: unitLabel('Hourly', units) };
  }, [type, endDate, endTime, rate, more, b]);

  const extra = next.totalAmount - b.totalAmount;
  const later = next.endDate > b.endDate || (next.endDate === b.endDate && (next.endTime || '') > (b.endTime || ''));

  const save = () => {
    setError('');
    if (!later) return setError('The new return must be after the current one.');
    if (rate <= 0) return setError('Enter the rate.');
    // the vehicle must be free for the added time (this booking itself doesn't count)
    if (!isVehicleAvailable(b.vehicleId, b.startDate, next.endDate, b.id, b.startTime, next.endTime || undefined)) {
      return setError('The vehicle has another booking in the extra period — swap the vehicle or choose an earlier return.');
    }
    const changes = [
      `Return: ${b.endDate}${b.endTime ? ` ${b.endTime}` : ''} → ${next.endDate}${next.endTime ? ` ${next.endTime}` : ''}`,
      `Length: ${type === 'Daily' ? unitLabel('Daily', b.totalDays) : unitLabel(type, b.rentalUnits ?? 0)} → ${next.label}`,
      `Total: ${rs(b.totalAmount)} → ${rs(next.totalAmount)}`,
    ];
    editBooking(b.id, {
      endDate: next.endDate, endTime: next.endTime || undefined, totalDays: next.totalDays, totalAmount: next.totalAmount,
      ...(type !== 'Daily' ? { rentalUnits: next.rentalUnits, unitRate: rate } : {}),
      ...(b.returnAt ? { returnAt: next.endTime ? `${next.endDate}T${next.endTime}` : undefined } : {}),
    }, { by, changes, reason: reason.trim() || undefined, type: 'Extended' });
    onDone?.();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Extend rental" width="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-navy-500">
          Now: {b.startDate} → <b className="text-navy-800">{b.endDate}{b.endTime ? ` ${b.endTime}` : ''}</b> · {type === 'Daily' ? unitLabel('Daily', b.totalDays) : unitLabel(type, b.rentalUnits ?? 0)} · {rs(b.totalAmount)}
        </p>

        {type === 'Daily' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-navy-500">New return date<div className="mt-1"><DateInput value={endDate} onChange={setEndDate} minDate={b.endDate} /></div></label>
            <label className="text-xs font-medium text-navy-500">Return time<div className="mt-1"><TimePicker value={endTime} onChange={setEndTime} placeholder="Return time" /></div></label>
          </div>
        ) : (
          <label className="text-xs font-medium text-navy-500 block">Add {UNIT[type].many}
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {(type === 'Monthly' ? [1, 2, 3, 6] : [1, 2, 3, 4, 6, 12]).map((n) => (
                <button key={n} type="button" onClick={() => setMore(n)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${more === n ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100'}`}>
                  +{unitLabel(type, n)}
                </button>
              ))}
              <input className="input !w-24 !py-1.5" type="number" min="1" value={more} onChange={(e) => setMore(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </div>
          </label>
        )}

        <label className="text-xs font-medium text-navy-500 block">Rate {UNIT[type].rate} (Rs)
          <input className="input mt-1" type="number" min="0" value={rate || ''} onChange={(e) => setRate(Math.max(0, Number(e.target.value) || 0))} />
        </label>

        <div className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-2.5 text-sm text-sky-900 space-y-0.5">
          <p className="flex justify-between"><span>New return</span><b>{next.endDate}{next.endTime ? ` ${next.endTime}` : ''}</b></p>
          <p className="flex justify-between"><span>Length</span><b>{next.label}</b></p>
          <p className="flex justify-between border-t border-sky-200 pt-1 mt-1"><span>New total</span><b>{rs(next.totalAmount)}{extra > 0 ? ` (+${rs(extra)})` : ''}</b></p>
        </div>

        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Note (optional), e.g. Customer staying 3 more days" />
        {error && <p className="text-sm text-red-600 flex gap-2"><AlertCircle size={15} className="mt-0.5 flex-shrink-0" />{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={save} className="btn-primary inline-flex items-center gap-1.5"><CalendarPlus size={15} /> Extend rental</button>
        </div>
      </div>
    </Modal>
  );
}
