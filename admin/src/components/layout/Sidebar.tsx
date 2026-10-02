import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Car, CalendarDays, MessageSquare,
  Percent, Users, Receipt, UserCheck, Bell, Settings, ShieldCheck, Truck, Contact, HandCoins, CreditCard, AlertTriangle, Globe,
  ChevronsLeft, ChevronDown, LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';

type Link = { to: string; icon: LucideIcon; label: string };

/* Desktop sidebar, grouped. Collapsed it shows icons only (group titles become dividers). */
const groups: { title: string; links: Link[] }[] = [
  { title: 'Operations', links: [
    { to: '/',              icon: LayoutDashboard, label: 'Dashboard'   },
    { to: '/vehicles',      icon: Car,             label: 'Vehicles'    },
    { to: '/bookings',      icon: CalendarDays,    label: 'Bookings'    },
    { to: '/inquiries',     icon: MessageSquare,   label: 'Inquiries'   },
    { to: '/handovers',     icon: Truck,           label: 'Handovers'   },
    { to: '/notifications', icon: Bell,            label: 'Alerts'      },
    { to: '/incomplete',    icon: AlertTriangle,   label: 'Incomplete'  },
  ] },
  { title: 'Finance', links: [
    { to: '/commissions',   icon: Percent,         label: 'Commissions' },
    { to: '/referrals',     icon: HandCoins,       label: 'Referrals'   },
    { to: '/expenses',      icon: Receipt,         label: 'Expenses'    },
    { to: '/credit',        icon: CreditCard,      label: 'Credit'      },
  ] },
  { title: 'People', links: [
    { to: '/owners',        icon: Users,           label: 'Owners'      },
    { to: '/drivers',       icon: UserCheck,       label: 'Drivers'     },
    { to: '/customers',     icon: Contact,         label: 'Customers'   },
  ] },
  { title: 'Admin', links: [
    { to: '/website',       icon: Globe,           label: 'Website'     },
    { to: '/permissions',   icon: ShieldCheck,     label: 'Permissions' },
  ] },
];

const ADMIN_ONLY = ['/owners', '/credit', '/website', '/permissions'];

/* 5 primary links shown in the mobile pill */
const mobileNav = [
  { to: '/',              icon: LayoutDashboard },
  { to: '/bookings',      icon: CalendarDays    },
  { to: '/vehicles',      icon: Car             },
  { to: '/notifications', icon: Bell            },
  { to: '/commissions',   icon: Percent         },
];

const WIDTH_COLLAPSED = 72;
const WIDTH_EXPANDED  = 256;
const STORAGE_KEY     = 'crac-sidebar-expanded';
const GROUPS_KEY      = 'crac-sidebar-groups';

function readOpenGroups(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? 'null');
    if (Array.isArray(v)) return v;
  } catch { /* storage unavailable or corrupt */ }
  return ['Operations']; // first visit: day-to-day pages open, the rest folded
}

function isActive(to: string, pathname: string) {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

function readExpanded() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v !== null) return v === '1';
  } catch { /* storage unavailable — fall through */ }
  return window.innerWidth >= 1280; // first visit: open on roomy screens
}

export default function Sidebar() {
  const location    = useLocation();
  const isAdmin     = useAuthStore((s) => s.isAdmin);
  const can         = useAuthStore((s) => s.can);
  const currentUser = useAuthStore((s) => s.currentUser);
  const unread      = useStore((s) =>
    s.notifications.filter((n) =>
      !n.read && (isAdmin() || !n.ownerId || n.ownerId === currentUser?.ownerId),
    ).length,
  );
  const draftCount  = useStore((s) => s.drafts.length);

  const [expanded, setExpanded] = useState(readExpanded);
  const [openGroups, setOpenGroups] = useState<string[]>(readOpenGroups);

  const toggleGroup = (title: string) =>
    setOpenGroups((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));

  useEffect(() => {
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(openGroups)); } catch { /* ignore */ }
  }, [openGroups]);

  // The section holding the current page always opens, so the active link is never hidden
  useEffect(() => {
    const g = groups.find((grp) => grp.links.some((l) => isActive(l.to, location.pathname)));
    if (g) setOpenGroups((prev) => (prev.includes(g.title) ? prev : [...prev, g.title]));
  }, [location.pathname]);
  // Tooltip for the collapsed rail (fixed-positioned so the scrolling nav can't clip it)
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);

  // Publish the width so <main> can make room for it
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', `${expanded ? WIDTH_EXPANDED : WIDTH_COLLAPSED}px`);
    try { localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0'); } catch { /* ignore */ }
    if (expanded) setTip(null);
  }, [expanded]);

  // Ctrl/Cmd + B toggles the sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setExpanded((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const canSee = (to: string) => {
    if (isAdmin()) return true;
    if (ADMIN_ONLY.includes(to)) return false;
    // Always visible to owners
    if (['/', '/vehicles', '/bookings', '/commissions', '/notifications'].includes(to)) return true;
    // Permission-gated pages
    if (to === '/expenses')    return can('canViewExpenses');
    if (to === '/handovers')   return can('canViewHandovers');
    if (to === '/drivers')     return can('canViewDrivers');
    if (to === '/customers')   return can('canViewCustomers');
    if (to === '/referrals')   return can('canViewReferrals');
    if (to === '/inquiries')   return can('canViewInquiries');
    if (to === '/incomplete')  return can('canViewIncomplete');
    return false;
  };

  const visibleGroups = groups
    .map((g) => ({ ...g, links: g.links.filter((l) => canSee(l.to)) }))
    .filter((g) => g.links.length > 0);

  const showTip = (label: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    if (expanded) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);

  const renderItem = ({ to, icon: Icon, label }: Link) => {
    const active = isActive(to, location.pathname);
    const count  = to === '/notifications' ? unread : to === '/incomplete' ? draftCount : 0;
    const countColor = to === '/incomplete' ? 'bg-amber-500' : 'bg-brand-500';
    return (
      <NavLink
        key={to}
        to={to}
        aria-label={label}
        className={clsx('side-item', active && 'active')}
        onMouseEnter={showTip(label)}
        onMouseLeave={hideTip}
        onFocus={showTip(label)}
        onBlur={hideTip}
      >
        <span className="side-item__icon">
          <Icon size={20} />
          {count > 0 && !expanded && (
            <span className={clsx('absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white', countColor)}>
              {count > 9 ? '9+' : count}
            </span>
          )}
        </span>
        <span className="side-item__label">{label}</span>
        {count > 0 && expanded && (
          <span className={clsx('ml-auto mr-2 min-w-[20px] h-5 px-1.5 rounded-full text-white text-[10px] font-bold flex items-center justify-center', countColor)}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <>
      {/* ── Desktop left sidebar ── */}
      <aside
        className={clsx('sidebar hidden md:flex', expanded && 'is-expanded')}
        style={{ width: expanded ? WIDTH_EXPANDED : WIDTH_COLLAPSED }}
      >
        {/* Brand */}
        <NavLink to="/" className="sidebar__brand" aria-label="Ceylon Rent A Cars — Dashboard">
          <img src="/brand/emblem-light.png" alt="" className="w-[46px] h-auto flex-shrink-0 select-none" draggable={false} />
          <span className="side-fade min-w-0 leading-none">
            <span className="block text-[17px] font-extrabold tracking-tight text-navy-800">Ceylon</span>
            <span className="block text-[9.5px] font-bold uppercase tracking-[0.2em] text-brand-500 mt-1">Rent A Cars · Admin</span>
          </span>
        </NavLink>

        {/* Collapse / expand handle on the sidebar edge */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="sidebar__toggle"
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={expanded}
          title={`${expanded ? 'Collapse' : 'Expand'} sidebar (Ctrl+B)`}
        >
          <ChevronsLeft size={14} className={clsx('transition-transform duration-300', !expanded && 'rotate-180')} />
        </button>

        <nav className="sidebar__nav no-scrollbar" onScroll={hideTip}>
          {visibleGroups.map((g, i) => {
            // The icon rail always shows every link; sections only fold when expanded
            const open = !expanded || openGroups.includes(g.title);
            const id = `side-group-${g.title.toLowerCase()}`;
            // A folded section still signals what's inside: unread counts or the current page
            const hasAlert = g.links.some((l) => (l.to === '/notifications' && unread > 0) || (l.to === '/incomplete' && draftCount > 0));
            const hasActive = g.links.some((l) => isActive(l.to, location.pathname));
            return (
              <div key={g.title} className="flex flex-col">
                <button
                  type="button"
                  className="sidebar__group"
                  onClick={() => toggleGroup(g.title)}
                  disabled={!expanded}
                  tabIndex={expanded ? 0 : -1}
                  aria-expanded={open}
                  aria-controls={id}
                  aria-hidden={!expanded}
                >
                  <span className="side-fade flex items-center gap-2 w-full">
                    {g.title}
                    {!open && (hasAlert || hasActive) && (
                      <span className={clsx('w-1.5 h-1.5 rounded-full', hasAlert ? 'bg-brand-500' : 'bg-navy-700')} />
                    )}
                    <ChevronDown size={14} className={clsx('ml-auto transition-transform duration-300', !open && '-rotate-90')} />
                  </span>
                  {i > 0 && <span className="sidebar__divider" />}
                </button>
                <div id={id} className={clsx('acc-grid sidebar__acc', open && 'open')}>
                  <div>
                    <div className="flex flex-col gap-1 pt-1">{g.links.map(renderItem)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="sidebar__foot">
          {renderItem({ to: '/settings', icon: Settings, label: 'Settings' })}
          {currentUser && (
            <div className="sidebar__user">
              <span className="w-8 h-8 rounded-lg bg-navy-700 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                {currentUser.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="side-fade min-w-0">
                <span className="block text-xs font-semibold text-navy-800 truncate">{currentUser.name}</span>
                <span className="block text-[10px] text-navy-400">{currentUser.role === 'admin' ? 'Administrator' : 'Owner'}</span>
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* Collapsed-rail tooltip */}
      {tip && !expanded && (
        <div
          className="hidden md:block fixed z-50 pointer-events-none -translate-y-1/2 anim-fade-in"
          style={{ left: WIDTH_COLLAPSED + 6, top: tip.top }}
        >
          <span className="block bg-navy-700 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
            {tip.label}
          </span>
        </div>
      )}

      {/* ── Mobile floating pill nav ── */}
      <nav className="flex md:hidden fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
        <div
          className="flex items-center gap-0.5 rounded-full px-2 py-2"
          style={{
            background: '#0B0B0D',
            boxShadow: '0 8px 32px rgba(0,0,0,0.40), 0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          {mobileNav.map(({ to, icon: Icon }) => {
            const active  = isActive(to, location.pathname);
            const isNotif = to === '/notifications';
            return (
              <NavLink key={to} to={to}>
                <div className={clsx(
                  'w-11 h-11 flex items-center justify-center rounded-full transition-all relative',
                  active ? 'bg-brand-500 shadow-brand' : 'hover:bg-white/[0.08]'
                )}>
                  <Icon size={20} className={active ? 'text-white' : 'text-white/45'} />
                  {isNotif && unread > 0 && (
                    <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full" />
                  )}
                </div>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </>
  );
}
