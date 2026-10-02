import { Search, SlidersHorizontal, Bell, LogOut } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useNavigate } from 'react-router-dom';

interface Props { title: string; subtitle?: string; }

export default function Header({ title, subtitle }: Props) {
  const unread      = useStore((s) => s.notifications.filter((n) => !n.read).length);
  const navigate    = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout      = useAuthStore((s) => s.logout);

  const initials = currentUser?.name
    .split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'CR';

  const roleColor = currentUser?.role === 'admin'
    ? 'bg-brand-500 text-white'
    : 'bg-emerald-100 text-emerald-700';

  return (
    <div className="flex items-center justify-between mb-4 md:mb-6 gap-3">
      <div className="min-w-0">
        <span className="eyebrow hidden md:inline-flex mb-1">Ceylon Rent A Cars</span>
        <h1 className="page-title truncate">{title}</h1>
        {subtitle && <p className="text-xs md:text-sm text-navy-400 mt-0.5 truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        {/* Search — desktop only */}
        <div className="hidden md:flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-card border border-navy-100/70 w-52 focus-within:border-navy-700 transition-colors">
          <Search size={15} className="text-navy-300" />
          <input
            type="text"
            placeholder="Search..."
            className="bg-transparent text-sm text-navy-700 placeholder-navy-300 outline-none w-full"
          />
        </div>

        {/* Filter — desktop only */}
        <button className="hidden md:flex w-9 h-9 bg-white rounded-xl shadow-card items-center justify-center text-navy-400 hover:text-navy-700 transition-colors">
          <SlidersHorizontal size={16} />
        </button>

        {/* Bell */}
        <button
          onClick={() => navigate('/notifications')}
          className="relative w-9 h-9 bg-white rounded-xl shadow-card flex items-center justify-center text-navy-400 hover:text-navy-700 transition-colors"
        >
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>

        {/* User info */}
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-xs font-semibold text-navy-800 leading-none">{currentUser?.name}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full mt-0.5 ${roleColor}`}>
            {currentUser?.role === 'admin' ? 'Admin' : 'Owner'}
          </span>
        </div>

        {/* Avatar */}
        <div className="w-9 h-9 rounded-xl bg-navy-700 ring-2 ring-brand-500/80 ring-offset-2 ring-offset-bg flex items-center justify-center text-white text-xs font-bold">
          {initials}
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          title="Sign out"
          className="w-9 h-9 bg-white rounded-xl shadow-card flex items-center justify-center text-navy-400 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
}
