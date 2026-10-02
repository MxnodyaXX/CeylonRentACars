import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import { Bell, CalendarDays, AlertTriangle, Wrench, Shield, CheckCheck, HandCoins } from 'lucide-react';
import { Notification } from '../types';
import clsx from 'clsx';

const iconMap: Record<Notification['type'], React.ReactNode> = {
  BookingReminder:  <CalendarDays size={16} className="text-blue-600" />,
  ReturnReminder:   <CalendarDays size={16} className="text-amber-600" />,
  Overdue:          <AlertTriangle size={16} className="text-red-600" />,
  ServiceReminder:  <Wrench size={16} className="text-purple-600" />,
  InsuranceExpiry:  <Shield size={16} className="text-orange-600" />,
  ReferralPayout:   <HandCoins size={16} className="text-amber-600" />,
  General:          <Bell size={16} className="text-navy-600" />,
};

const bgMap: Record<Notification['type'], string> = {
  BookingReminder:  'bg-blue-50',
  ReturnReminder:   'bg-amber-50',
  Overdue:          'bg-red-50',
  ServiceReminder:  'bg-purple-50',
  InsuranceExpiry:  'bg-orange-50',
  ReferralPayout:   'bg-amber-50',
  General:          'bg-navy-50',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Notifications() {
  const { notifications, markNotificationRead, markAllRead } = useStore();
  const { currentUser, isAdmin } = useAuthStore();

  // Owners only see global alerts + alerts addressed to them; admin sees everything.
  const visible = notifications.filter((n) =>
    isAdmin() || !n.ownerId || n.ownerId === currentUser?.ownerId,
  );
  const unread = visible.filter((n) => !n.read);
  const read = visible.filter((n) => n.read);

  return (
    <div>
      <Header title="Notifications" subtitle="Alerts, reminders, and system updates" />

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-navy-700 font-medium">{unread.length} unread</span>
        </div>
        {unread.length > 0 && (
          <button onClick={markAllRead} className="btn-secondary flex items-center gap-2 text-xs">
            <CheckCheck size={14} /> Mark all read
          </button>
        )}
      </div>

      {unread.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">Unread</p>
          <div className="space-y-3">
            {unread.map((n) => (
              <NotifCard key={n.id} n={n} onRead={markNotificationRead} />
            ))}
          </div>
        </div>
      )}

      {read.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-3">Earlier</p>
          <div className="space-y-2">
            {read.map((n) => (
              <NotifCard key={n.id} n={n} onRead={markNotificationRead} />
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 && (
        <div className="card text-center py-16">
          <Bell size={40} className="text-navy-200 mx-auto mb-3" />
          <p className="text-navy-400 text-sm">No notifications yet.</p>
        </div>
      )}
    </div>
  );
}

function NotifCard({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  return (
    <div
      className={clsx(
        'flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-all',
        n.read ? 'bg-white shadow-sm opacity-70' : 'bg-white shadow-card border-l-4',
        !n.read && {
          'border-blue-400': n.type === 'BookingReminder',
          'border-amber-400': n.type === 'ReturnReminder' || n.type === 'ReferralPayout',
          'border-red-400': n.type === 'Overdue',
          'border-purple-400': n.type === 'ServiceReminder',
          'border-orange-400': n.type === 'InsuranceExpiry',
          'border-navy-400': n.type === 'General',
        }
      )}
      onClick={() => !n.read && onRead(n.id)}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${bgMap[n.type]}`}>
        {iconMap[n.type]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-semibold ${n.read ? 'text-navy-600' : 'text-navy-800'}`}>{n.title}</p>
          <span className="text-xs text-navy-400 flex-shrink-0">{timeAgo(n.createdAt)}</span>
        </div>
        <p className="text-sm text-navy-500 mt-0.5 leading-relaxed">{n.message}</p>
      </div>
      {!n.read && (
        <div className="w-2 h-2 bg-brand-500 rounded-full flex-shrink-0 mt-1.5" />
      )}
    </div>
  );
}
