import clsx from 'clsx';
import { VehicleStatus } from '../../types';

const map: Record<string, string> = {
  Available:   'bg-emerald-50 text-emerald-700',
  Reserved:    'bg-blue-50 text-blue-700',
  Ongoing:     'bg-amber-50 text-amber-700',
  Maintenance: 'bg-red-50 text-red-700',
  Confirmed:   'bg-blue-50 text-blue-700',
  Completed:   'bg-emerald-50 text-emerald-700',
  Cancelled:   'bg-slate-100 text-slate-500',
  Pending:     'bg-amber-50 text-amber-700',
  Converted:   'bg-emerald-50 text-emerald-700',
  Lost:        'bg-red-50 text-red-600',
  Paid:        'bg-emerald-50 text-emerald-700',
  Received:    'bg-emerald-50 text-emerald-700',
  Credit:      'bg-purple-50 text-purple-700',
  'On Duty':   'bg-blue-50 text-blue-700',
  Off:         'bg-slate-100 text-slate-500',
};

const dot: Record<string, string> = {
  Available:   'bg-emerald-500',
  Reserved:    'bg-blue-500',
  Ongoing:     'bg-amber-500',
  Maintenance: 'bg-red-500',
  Confirmed:   'bg-blue-500',
  Completed:   'bg-emerald-500',
  Cancelled:   'bg-slate-400',
  Pending:     'bg-amber-500',
  Converted:   'bg-emerald-500',
  Lost:        'bg-red-500',
  Paid:        'bg-emerald-500',
  Received:    'bg-emerald-500',
  Credit:      'bg-purple-500',
  'On Duty':   'bg-blue-500',
  Off:         'bg-slate-400',
};

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        map[status] ?? 'bg-slate-100 text-slate-600'
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', dot[status] ?? 'bg-slate-400')} />
      {status}
    </span>
  );
}
