import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import Modal from './Modal';
import DateInput from './DateInput';
import StatusBadge from './StatusBadge';
import { CheckCircle, Clock, XCircle, Search } from 'lucide-react';
import { parseISO, addDays, isValid } from 'date-fns';
import { Vehicle, Booking, Owner } from '../../types';
import { blocksAvailability } from '../../lib/availability';

interface AvailabilityResult {
  vehicle:         Vehicle;
  status:          'available' | 'option' | 'unavailable';
  availableFrom?:  string;
  blockingBooking?: Booking;
}

interface Props {
  open:    boolean;
  onClose: () => void;
}

function nextFreeDate(vehicleId: string, requestStart: string, allBookings: Booking[]): string {
  const active = allBookings
    .filter((b) => b.vehicleId === vehicleId && blocksAvailability(b))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  let nf = requestStart;
  let changed = true;
  let iter = 0;
  while (changed && iter++ < 200) {
    changed = false;
    for (const b of active) {
      if (b.startDate <= nf && b.endDate >= nf) {
        try {
          const parsed = parseISO(b.endDate);
          if (isValid(parsed)) {
            nf = addDays(parsed, 1).toISOString().slice(0, 10);
            changed = true;
          }
        } catch { /* skip */ }
        break;
      }
    }
  }
  return nf;
}

function SectionHeader({
  label, count, colorClass, icon,
}: { label: string; count: number; colorClass: string; icon: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold ${colorClass}`}>
      {icon}
      {label}
      <span className="ml-auto opacity-70">{count} vehicle{count !== 1 ? 's' : ''}</span>
    </div>
  );
}

function VehicleRow({ result, owners }: { result: AvailabilityResult; owners: Owner[] }) {
  const { vehicle, status, availableFrom, blockingBooking } = result;
  const owner = owners.find((o) => o.id === vehicle.ownerId);

  return (
    <div className={`rounded-xl border px-4 py-3 text-xs ${
      status === 'available'   ? 'border-emerald-100 bg-emerald-50/40' :
      status === 'option'      ? 'border-amber-100 bg-amber-50/40' :
                                 'border-red-100 bg-red-50/30'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy-800 truncate">
            {vehicle.brand} {vehicle.model}
            <span className="text-navy-400 font-normal ml-1">· {vehicle.vehicleNumber}</span>
          </p>
          <p className="text-navy-400 mt-0.5">Owner: {owner?.name ?? '—'}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          {status === 'available' && (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
              <CheckCircle size={13} /> Available
            </span>
          )}
          {status === 'option' && (
            <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
              <Clock size={13} /> Available from {availableFrom}
            </span>
          )}
          {status === 'unavailable' && (
            <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
              <XCircle size={13} /> Unavailable
            </span>
          )}
        </div>
      </div>

      {blockingBooking && (status === 'option' || status === 'unavailable') && (
        <div className="mt-2 pt-2 border-t border-navy-100/60 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1">
          <div>
            <p className="text-navy-400">Carrying</p>
            <p className="font-medium text-navy-700">{blockingBooking.customerName}</p>
          </div>
          <div>
            <p className="text-navy-400">Phone</p>
            <p className="font-medium text-navy-700">{blockingBooking.customerPhone || '—'}</p>
          </div>
          <div>
            <p className="text-navy-400">Trip dates</p>
            <p className="font-medium text-navy-700">{blockingBooking.startDate} → {blockingBooking.endDate}</p>
          </div>
          <div className="sm:col-span-3">
            <StatusBadge status={blockingBooking.status} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function AvailabilityModal({ open, onClose }: Props) {
  const { vehicles, bookings, owners } = useStore();
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [checked,   setChecked]   = useState(false);

  const results = useMemo<AvailabilityResult[]>(() => {
    if (!checked || !startDate || !endDate || startDate > endDate) return [];

    return vehicles.map((vehicle) => {
      const overlapping = bookings.filter(
        (b) =>
          b.vehicleId === vehicle.id &&
          blocksAvailability(b) &&
          b.startDate <= endDate &&
          b.endDate >= startDate,
      );

      if (overlapping.length === 0) return { vehicle, status: 'available' as const };

      const blockingBooking = [...overlapping].sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
      const nf = nextFreeDate(vehicle.id, startDate, bookings);

      if (nf > endDate) return { vehicle, status: 'unavailable' as const, blockingBooking };
      return { vehicle, status: 'option' as const, availableFrom: nf, blockingBooking };
    });
  }, [checked, startDate, endDate, vehicles, bookings]);

  const available   = results.filter((r) => r.status === 'available');
  const options     = results.filter((r) => r.status === 'option');
  const unavailable = results.filter((r) => r.status === 'unavailable');

  const handleCheck = () => {
    if (!startDate || !endDate || startDate > endDate) return;
    setChecked(true);
  };

  const handleClose = () => {
    setStartDate('');
    setEndDate('');
    setChecked(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Check Vehicle Availability" width="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="label">Start Date *</p>
            <DateInput value={startDate} onChange={(v) => { setStartDate(v); setChecked(false); }} />
          </div>
          <div>
            <p className="label">End Date *</p>
            <DateInput value={endDate} minDate={startDate} onChange={(v) => { setEndDate(v); setChecked(false); }} />
          </div>
        </div>

        <button
          onClick={handleCheck}
          disabled={!startDate || !endDate || startDate > endDate}
          className="btn-primary flex items-center gap-2 w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Search size={15} /> Check Availability
        </button>

        {checked && results.length > 0 && (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {available.length > 0 && (
              <div className="space-y-2">
                <SectionHeader
                  label="Available"
                  count={available.length}
                  colorClass="text-emerald-700 bg-emerald-50"
                  icon={<CheckCircle size={14} />}
                />
                {available.map((r) => <VehicleRow key={r.vehicle.id} result={r} owners={owners} />)}
              </div>
            )}

            {options.length > 0 && (
              <div className="space-y-2">
                <SectionHeader
                  label="Options — vehicle returns during your period"
                  count={options.length}
                  colorClass="text-amber-700 bg-amber-50"
                  icon={<Clock size={14} />}
                />
                {options.map((r) => <VehicleRow key={r.vehicle.id} result={r} owners={owners} />)}
              </div>
            )}

            {unavailable.length > 0 && (
              <div className="space-y-2">
                <SectionHeader
                  label="Unavailable"
                  count={unavailable.length}
                  colorClass="text-red-600 bg-red-50"
                  icon={<XCircle size={14} />}
                />
                {unavailable.map((r) => <VehicleRow key={r.vehicle.id} result={r} owners={owners} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
