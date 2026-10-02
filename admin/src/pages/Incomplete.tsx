import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AlertTriangle, RotateCcw, FileText, CreditCard, Trash2, Play, Clock } from 'lucide-react';
import { useStore } from '../store/useStore';
import Header from '../components/layout/Header';
import { ProcessDraft } from '../types';

const TYPE_META: Record<ProcessDraft['type'], { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  return: {
    label: 'Vehicle Return',
    icon: <RotateCcw size={16} />,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  booking: {
    label: 'Manual Booking',
    icon: <FileText size={16} />,
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  payment: {
    label: 'Payment Settlement',
    icon: <CreditCard size={16} />,
    color: 'text-purple-700',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
  },
};

const RESUME_PATH: Record<ProcessDraft['type'], (id: string) => string> = {
  return:  (id) => `/handovers?resume=${id}`,
  payment: (id) => `/handovers?resume=${id}`,
  booking: (id) => `/settings?resume=${id}`,
};

function DraftCard({ draft, onDiscard }: { draft: ProcessDraft; onDiscard: () => void }) {
  const navigate = useNavigate();
  const meta     = TYPE_META[draft.type];
  const age      = formatDistanceToNow(parseISO(draft.updatedAt), { addSuffix: true });

  return (
    <div className={`bg-white rounded-2xl border ${meta.border} shadow-card p-4`}>
      <div className="flex items-start gap-3">
        {/* Type badge */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg} ${meta.color}`}>
          {meta.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
              {meta.label}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-navy-400">
              <Clock size={9} />
              {age}
            </span>
          </div>
          <p className="text-sm font-semibold text-navy-800 truncate">{draft.label}</p>
          {draft.sublabel && (
            <p className="text-xs text-navy-400 truncate mt-0.5">{draft.sublabel}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onDiscard}
            className="p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Discard draft"
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={() => navigate(RESUME_PATH[draft.type](draft.id))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-navy-700 text-white hover:bg-navy-800 transition-colors"
          >
            <Play size={11} />
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Incomplete() {
  const { drafts, discardDraft } = useStore();

  const byType = (type: ProcessDraft['type']) => drafts.filter((d) => d.type === type);
  const returns  = byType('return');
  const bookings = byType('booking');
  const payments = byType('payment');

  return (
    <div>
      <Header
        title="Incomplete Processes"
        subtitle="Abandoned or skipped processes — continue them or discard"
      />

      {drafts.length === 0 ? (
        <div className="card text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-emerald-500" />
          </div>
          <p className="text-sm font-semibold text-navy-700">No incomplete processes</p>
          <p className="text-xs text-navy-400 mt-1">Everything is up to date.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary banner */}
          <div className="flex flex-wrap gap-3">
            {([
              { type: 'return' as const,  list: returns,  },
              { type: 'booking' as const, list: bookings, },
              { type: 'payment' as const, list: payments, },
            ]).filter(({ list }) => list.length > 0).map(({ type, list }) => {
              const meta = TYPE_META[type];
              return (
                <div key={type} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${meta.bg} ${meta.color} text-xs font-semibold`}>
                  {meta.icon}
                  {list.length} incomplete {meta.label}{list.length !== 1 ? 's' : ''}
                </div>
              );
            })}
          </div>

          {/* Return drafts */}
          {returns.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <RotateCcw size={14} className="text-amber-600" />
                <h2 className="text-sm font-semibold text-navy-700">Incomplete Vehicle Returns</h2>
                <span className="text-xs text-navy-400">({returns.length})</span>
              </div>
              <div className="space-y-3">
                {returns.map((d) => (
                  <DraftCard key={d.id} draft={d} onDiscard={() => discardDraft(d.id)} />
                ))}
              </div>
            </section>
          )}

          {/* Booking drafts */}
          {bookings.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <FileText size={14} className="text-blue-600" />
                <h2 className="text-sm font-semibold text-navy-700">Incomplete Bookings</h2>
                <span className="text-xs text-navy-400">({bookings.length})</span>
              </div>
              <div className="space-y-3">
                {bookings.map((d) => (
                  <DraftCard key={d.id} draft={d} onDiscard={() => discardDraft(d.id)} />
                ))}
              </div>
            </section>
          )}

          {/* Payment drafts */}
          {payments.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <CreditCard size={14} className="text-purple-600" />
                <h2 className="text-sm font-semibold text-navy-700">Incomplete Payment Settlements</h2>
                <span className="text-xs text-navy-400">({payments.length})</span>
              </div>
              <div className="space-y-3">
                {payments.map((d) => (
                  <DraftCard key={d.id} draft={d} onDiscard={() => discardDraft(d.id)} />
                ))}
              </div>
            </section>
          )}

          {/* Discard all */}
          {drafts.length > 1 && (
            <div className="flex justify-end pt-2">
              <button
                onClick={() => drafts.forEach((d) => discardDraft(d.id))}
                className="flex items-center gap-2 text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                <Trash2 size={13} />
                Discard all incomplete processes
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
