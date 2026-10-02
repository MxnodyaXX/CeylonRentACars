import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import VehicleImage from '../components/ui/VehicleImage';
import {
  OperationalAlerts, MoneyInsights, VehiclePerformance,
  DistributionCharts, CustomerInsights,
} from '../components/dashboard/AnalyticsSection';
import { vehicleBodyColor } from '../components/ui/CarSVG';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Car, CalendarDays, DollarSign, AlertCircle,
  Users, CheckSquare, UserCircle, MessageSquare,
  ArrowUpRight, Crown, TrendingUp, Wallet, CreditCard,
} from 'lucide-react';
import { Vehicle, Booking } from '../types';
import { creditTotals } from '../lib/credit';
import { vehicleNetRevenue, totalDiscount } from '../lib/revenue';

function useIsMobile() {
  const [v, setV] = useState(typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const fn = () => setV(window.innerWidth < 640);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return v;
}



/* Podium display order: 2nd · 1st · 3rd */
const PODIUM = [
  {
    rank: 2, h: 88,  medal: '🥈', size: 76,
    grad: 'linear-gradient(160deg,#A1A1AA 0%,#71717A 100%)',
    side: '#71717A',
    shadow: '0 0 0 3px #D4D4D8,0 0 0 6px rgba(255,255,255,0.85),0 14px 32px rgba(0,0,0,0.22)',
  },
  {
    rank: 1, h: 130, medal: '🥇', size: 96,
    grad: 'linear-gradient(160deg,#E11D2A 0%,#111114 100%)',
    side: '#0B0B0D',
    shadow: null,
  },
  {
    rank: 3, h: 68,  medal: '🥉', size: 76,
    grad: 'linear-gradient(160deg,#A1A1AA 0%,#52525B 100%)',
    side: '#3F3F46',
    shadow: '0 0 0 3px #FB923C,0 0 0 6px rgba(255,255,255,0.85),0 14px 32px rgba(0,0,0,0.22)',
  },
];

/* Simple CSS cloud shape */
function CloudShape({ x, y, scale = 1, delay = '0s', duration = '28s' }: {
  x: number; y: number; scale?: number; delay?: string; duration?: string;
}) {
  return (
    <div style={{
      position: 'absolute', left: `${x}%`, top: `${y}%`,
      transformOrigin: 'left top', pointerEvents: 'none', zIndex: 1,
    }}>
      <div
        className="anim-cloud-drift"
        style={{ '--cd': duration } as React.CSSProperties & Record<string, string>}
      >
        <div style={{ position: 'relative', width: 140, height: 55, transform: `scale(${scale})`, transformOrigin: 'left top' }}>
          <div style={{ position: 'absolute', width: 75, height: 75, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', left: 22, top: -30 }} />
          <div style={{ position: 'absolute', width: 55, height: 55, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', left: 73, top: -14 }} />
          <div style={{ position: 'absolute', width: 55, height: 55, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', left: 5,  top: -14 }} />
          <div style={{ position: 'absolute', width: 140, height: 40, borderRadius: 22, background: 'rgba(255,255,255,0.05)', left: 0,  top: 12  }} />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const isMobile = useIsMobile();
  const { vehicles, bookings, inquiries, expenses, owners, notifications } = useStore();
  const { currentUser, isAdmin } = useAuthStore();
  const navigate  = useNavigate();
  const [tab,      setTab]      = useState<'weekly' | 'alltime'>('alltime');
  const [chartTab, setChartTab] = useState<'revenue' | 'bookings' | 'expenses'>('revenue');
  const [infoModal, setInfoModal] = useState<'outstanding' | 'profit' | null>(null);

  /* scope data to owner when not admin */
  const isOwnerRole = !isAdmin() && currentUser?.role === 'owner';
  const myVehicleIdSet = isOwnerRole
    ? new Set(vehicles.filter((v) => v.ownerId === currentUser?.ownerId).map((v) => v.id))
    : null;
  const scopedVehicles = myVehicleIdSet ? vehicles.filter((v) => myVehicleIdSet.has(v.id)) : vehicles;
  const scopedBookings = myVehicleIdSet ? bookings.filter((b) => myVehicleIdSet.has(b.vehicleId)) : bookings;
  const scopedExpenses = myVehicleIdSet ? expenses.filter((e) => myVehicleIdSet.has(e.vehicleId)) : expenses;

  /* derived from scoped data — revenue is NET of discounts everywhere; the
     gross (before-discount) figure is surfaced separately in the KPI sub-line. */
  const netRev         = (v: Vehicle) => vehicleNetRevenue(v, scopedBookings);
  const byRevenue      = [...scopedVehicles].sort((a, b) => netRev(b) - netRev(a));
  const grossRevenue   = scopedVehicles.reduce((s, v) => s + v.revenue, 0);
  const totalDiscounts = totalDiscount(scopedBookings);
  const totalRevenue   = grossRevenue - totalDiscounts;
  const totalExpenses  = scopedExpenses.reduce((s, e) => s + e.amount, 0);
  const activeBookings = scopedBookings.filter((b) => b.status === 'Confirmed' || b.status === 'Ongoing');
  const unread         = notifications.filter((n) => !n.read).length;
  /* vehicle availability is always company-wide (owners can see fleet status) */
  const available      = vehicles.filter((v) => v.status === 'Available');
  const onRent         = vehicles.filter((v) => v.status === 'Ongoing' || v.status === 'Reserved');
  const underRepair    = vehicles.filter((v) => v.status === 'Maintenance');
  /* scoped vehicle lists for the fleet columns */
  const scopedAvailable   = scopedVehicles.filter((v) => v.status === 'Available');
  const scopedOnRent      = scopedVehicles.filter((v) => v.status === 'Ongoing' || v.status === 'Reserved');
  const scopedUnderRepair = scopedVehicles.filter((v) => v.status === 'Maintenance');
  const completedRentals = scopedBookings.filter((b) => b.status === 'Completed').length;
  const uniqueCustomers  = new Set(scopedBookings.map((b) => b.customerPhone)).size;

  /* business KPIs
     Outstanding = money actually owed: vehicle is out (Ongoing) or rental finished (Completed)
     and still unpaid. Confirmed bookings haven't started, so their balance is expected future
     income, not outstanding. */
  const receivableBookings = scopedBookings.filter((b) => b.status === 'Ongoing' || b.status === 'Completed');
  /* Exclude bookings already tracked as formal credit — those appear in the Total Credit card.
     The two cards are additive: Outstanding + Credit.total = all money owed, no double-counting. */
  const informallyUnpaid = receivableBookings.filter((b) => !((b.creditAmount ?? 0) > 0 && !b.creditSettled));
  const outstandingBalance = informallyUnpaid.reduce((s, b) => s + Math.max(0, b.totalAmount - (b.discount ?? 0) - b.paidAmount), 0);
  /* Credit to be received — balances recorded as customer credit dues. */
  const credit = creditTotals(scopedBookings);
  const today = new Date();
  const thisMonthRevenue = scopedBookings
    .filter((b) => { if (b.status === 'Cancelled') return false; const d = new Date(b.startDate); return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(); })
    .reduce((s, b) => s + b.totalAmount, 0);
  const thisMonthExpenses = scopedExpenses
    .filter((e) => { const d = new Date(e.date); return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(); })
    .reduce((s, e) => s + e.amount, 0);
  const monthlyProfit = thisMonthRevenue - thisMonthExpenses;

  /* breakdown rows for the info popups */
  const outstandingRows = informallyUnpaid
    .filter((b) => b.totalAmount - (b.discount ?? 0) > b.paidAmount)
    .map((b) => ({ ...b, balance: b.totalAmount - (b.discount ?? 0) - b.paidAmount }))
    .sort((a, b) => b.balance - a.balance);
  const monthRevenueRows = scopedBookings
    .filter((b) => { if (b.status === 'Cancelled') return false; const d = new Date(b.startDate); return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(); })
    .sort((a, b) => b.totalAmount - a.totalAmount);
  const monthExpenseRows = scopedExpenses
    .filter((e) => { const d = new Date(e.date); return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(); })
    .sort((a, b) => b.amount - a.amount);
  const vehicleLabel = (vehicleId: string) => {
    const v = vehicles.find((x) => x.id === vehicleId);
    return v ? `${v.brand} ${v.model} · ${v.vehicleNumber}` : '—';
  };

  /* last-5-months chart data — scoped to owner when applicable */
  const chartData = useMemo(() => {
    const months = Array.from({ length: 5 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (4 - i));
      return { year: d.getFullYear(), month: d.getMonth(), label: format(d, 'MMM') };
    });
    return months.map(({ year, month, label }) => {
      const rev = scopedBookings
        .filter((b) => { if (b.status === 'Cancelled') return false; const d = new Date(b.startDate); return d.getFullYear() === year && d.getMonth() === month; })
        .reduce((s, b) => s + b.totalAmount, 0);
      const cnt = scopedBookings.filter((b) => { if (b.status === 'Cancelled') return false; const d = new Date(b.startDate); return d.getFullYear() === year && d.getMonth() === month; }).length;
      const exp = scopedExpenses
        .filter((e) => { const d = new Date(e.date); return d.getFullYear() === year && d.getMonth() === month; })
        .reduce((s, e) => s + e.amount, 0);
      return { month: label, revenue: rev, bookings: cnt, expenses: exp };
    });
  }, [scopedBookings, scopedExpenses]);

  const chartRange = (() => {
    const first = new Date(); first.setDate(1); first.setMonth(first.getMonth() - 4);
    return `${format(first, 'MMM')} – ${format(today, 'MMM yyyy')}`;
  })();

  /* podium: 2nd · 1st · 3rd */
  const podiumVehicles = [byRevenue[1], byRevenue[0], byRevenue[2]].filter(Boolean);


  const kpiCards = [
    { label: 'Total Fleet',     value: scopedVehicles.length,                     sub: `${scopedAvailable.length} available`, icon: <Car size={18}/>,          color: 'bg-navy-700',    path: '/vehicles'      },
    { label: 'Active Bookings', value: activeBookings.length,                     sub: 'confirmed + ongoing',                icon: <CalendarDays size={18}/>, color: 'bg-navy-700',    path: '/bookings'      },
    { label: 'Net Revenue',     value: `Rs ${totalRevenue.toLocaleString()}`,   sub: totalDiscounts > 0 ? `Gross Rs ${grossRevenue.toLocaleString()} · −Rs ${totalDiscounts.toLocaleString()} disc.` : `Gross Rs ${grossRevenue.toLocaleString()}`, icon: <DollarSign size={18}/>, color: 'bg-emerald-500', path: '/commissions' },
    { label: 'Alerts',          value: unread,                                    sub: 'unread notifications',               icon: <AlertCircle size={18}/>,  color: 'bg-amber-500',   path: '/notifications' },
  ];

  const fleetPills = [
    { label: 'Available',    count: available.length,   color: '#10B981', bg: 'rgba(16,185,129,0.09)',  border: 'rgba(16,185,129,0.18)' },
    { label: 'On Rent',      count: onRent.length,      color: '#3B82F6', bg: 'rgba(59,130,246,0.09)',  border: 'rgba(59,130,246,0.18)' },
    { label: 'Under Repair', count: underRepair.length, color: '#EF4444', bg: 'rgba(239,68,68,0.09)',   border: 'rgba(239,68,68,0.18)'  },
  ];

  return (
    <div className="space-y-5">
      <Header title="Dashboard" subtitle="Fleet performance at a glance" />

      {/* ── KPI Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map(({ label, value, sub, icon, color, path }, idx) => (
          <div key={label} className="anim-fade-up" style={{ animationDelay: `${idx * 80}ms` }}>
            <KpiCard label={label} value={value} sub={sub} icon={icon} color={color}
              onClick={() => navigate(path)} />
          </div>
        ))}
      </div>

      {/* ── Operational Alerts (overdue · upcoming · insurance) ───── */}
      <OperationalAlerts vehicles={scopedVehicles} bookings={scopedBookings} />

      {/* ── Business KPI Row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setInfoModal('outstanding')}
          className="card flex items-start gap-4 anim-fade-up text-left w-full hover:shadow-card-hover transition-shadow cursor-pointer"
          style={{ animationDelay: '80ms' }}
        >
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white flex-shrink-0 bg-red-500">
            <Wallet size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-navy-400 font-medium">Outstanding Balances</p>
              <ArrowUpRight size={14} className="text-navy-300" />
            </div>
            <p className={`text-2xl font-black leading-tight ${outstandingBalance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              Rs {outstandingBalance.toLocaleString()}
            </p>
            <p className="text-xs text-navy-400 mt-0.5">{outstandingRows.length} unpaid booking{outstandingRows.length !== 1 ? 's' : ''} · excludes tracked credits</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setInfoModal('profit')}
          className="card flex items-start gap-4 anim-fade-up text-left w-full hover:shadow-card-hover transition-shadow cursor-pointer"
          style={{ animationDelay: '160ms' }}
        >
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${monthlyProfit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}>
            <TrendingUp size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-navy-400 font-medium">This Month's Profit</p>
              <ArrowUpRight size={14} className="text-navy-300" />
            </div>
            <p className={`text-2xl font-black leading-tight ${monthlyProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              Rs {monthlyProfit.toLocaleString()}
            </p>
            <p className="text-xs text-navy-400 mt-0.5">Revenue Rs {thisMonthRevenue.toLocaleString()} − Expenses Rs {thisMonthExpenses.toLocaleString()}</p>
          </div>
        </button>
      </div>

      {/* ── Total Credit To Be Received ──────────────────────────── */}
      <div
        className="card anim-fade-up cursor-pointer hover:shadow-card-hover transition-shadow"
        style={{ animationDelay: '170ms' }}
        onClick={() => navigate('/credit')}
        title="View and manage outstanding customer credits"
      >
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white flex-shrink-0 bg-amber-500">
            <CreditCard size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-navy-400 font-medium">Total Credit To Be Received</p>
              <ArrowUpRight size={14} className="text-navy-300" />
            </div>
            <p className={`text-2xl font-black leading-tight ${credit.total > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              Rs {credit.total.toLocaleString()}
            </p>
            <div className="flex gap-4 mt-1.5">
              <span className="text-xs text-navy-500"><span className="font-semibold text-navy-700">{credit.customers}</span> customer{credit.customers !== 1 ? 's' : ''} with credit</span>
              <span className="text-xs text-navy-500"><span className="font-semibold text-navy-700">{credit.bookings}</span> pending booking{credit.bookings !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Money Insights (growth · deposits · bad debt) ────────── */}
      <MoneyInsights bookings={scopedBookings} />

      {/* ── Leaderboard ─────────────────────────────────────────── */}
      <div className="card anim-fade-up" style={{ animationDelay: '180ms' }}>

        {/* Header + tabs */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-navy-700 flex items-center justify-center">
              <Crown size={15} className="text-amber-400" />
            </div>
            <p className="section-title">Leaderboard</p>
          </div>
          <div className="flex bg-navy-50 rounded-xl p-0.5 gap-0.5">
            {(['weekly', 'alltime'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-[10px] text-xs font-semibold transition-all ${
                  tab === t ? 'bg-white text-navy-800 shadow-sm' : 'text-navy-400 hover:text-navy-600'
                }`}
              >
                {t === 'weekly' ? 'Weekly' : 'All Time'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Sky arena ── */}
        <div
          className="relative overflow-hidden flex items-end justify-center gap-6 sm:gap-10 pt-10 pb-0"
          style={{
            background: 'linear-gradient(165deg,#0B0B0D 0%,#111114 55%,#111114 100%)',
            borderRadius: 20,
            minHeight: 420,
          }}
        >
          {/* Faint moonlit clouds */}
          <CloudShape x={4}  y={2}  scale={1.05} duration="32s" />
          <CloudShape x={64} y={1}  scale={1.2}  duration="26s" />
          <CloudShape x={30} y={0}  scale={0.8}  duration="38s" />
          <CloudShape x={14} y={26} scale={0.7}  duration="24s" />
          <CloudShape x={58} y={24} scale={0.75} duration="30s" />

          {/* Centre blue glow */}
          <div style={{
            position:'absolute', top:'8%', left:'50%', transform:'translateX(-50%)',
            width:320, height:320, borderRadius:'50%',
            background:'radial-gradient(circle,rgba(75,123,229,0.18) 0%,transparent 68%)',
            pointerEvents:'none',
          }} />

          {/* Star dots */}
          {[[8,14],[18,32],[82,16],[76,38],[50,7],[38,48],[66,24],[14,52],[90,42],[55,35]].map(([x,y],i) => (
            <div key={`s${i}`} style={{
              position:'absolute', left:`${x}%`, top:`${y}%`,
              width: i%3===0?3:2, height: i%3===0?3:2, borderRadius:'50%',
              background:`rgba(255,255,255,${0.18+(i%3)*0.14})`,
              pointerEvents:'none',
            }} />
          ))}


          {byRevenue.length === 0 && (
            <p className="text-navy-500 text-sm py-16">No vehicles yet.</p>
          )}

          {/* Podium figures */}
          {podiumVehicles.map((v, i) => {
            const cfg       = PODIUM[i];
            const ps        = isMobile ? 0.72 : 1;
            const rankLabel = cfg.rank === 1 ? '1st' : cfg.rank === 2 ? '2nd' : '3rd';
            return (
              <div key={v.id} className="flex flex-col items-center anim-scale-pop"
                style={{ animationDelay: `${i * 110 + 160}ms` }}
              >
                {/* Medal */}
                <span className={`anim-medal-float ${isMobile ? 'text-xl' : 'text-3xl'}`}
                  style={{ animationDelay: `${i * 0.38}s`, filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.22))', marginBottom: 10, display: 'block' }}
                >
                  {cfg.medal}
                </span>

                {/* Car photo */}
                <div
                  className={cfg.rank === 1 ? 'anim-pulse-gold' : ''}
                  style={{
                    width: Math.round(cfg.size * ps), height: Math.round(cfg.size * ps),
                    borderRadius: '50%', overflow: 'hidden',
                    marginBottom: 10, background: '#fff', flexShrink: 0,
                    ...(cfg.shadow ? { boxShadow: cfg.shadow } : {}),
                  }}
                >
                  <VehicleImage brand={v.brand} model={v.model} color={v.color} imageUrl={v.imageUrl}
                    circle className="w-full h-full" />
                </div>

                {/* Name + revenue (on sky — dark text) */}
                <div className="text-center mb-2" style={{ maxWidth: Math.round(104 * ps) }}>
                  <p style={{ color: 'white', fontWeight: 800, fontSize: isMobile ? 10 : 13, lineHeight: 1.2, textShadow: '0 2px 8px rgba(0,0,0,0.5)' }} className="truncate">
                    {v.brand} {v.model}
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 600, marginTop: 1 }}>
                    Rs {netRev(v).toLocaleString()}
                  </p>
                </div>

                {/* 3D Platform */}
                <div>
                  <div style={{
                    width: Math.round(96 * ps), height: Math.round(cfg.h * ps),
                    background: cfg.grad,
                    borderRadius: '12px 12px 0 0',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 2,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22),inset -1px 0 0 rgba(0,0,0,0.09)',
                  }}>
                    <span style={{ color:'rgba(255,255,255,0.42)', fontSize:9, fontWeight:700, letterSpacing:3, textTransform:'uppercase' }}>
                      {rankLabel}
                    </span>
                    <span style={{ color:'white', fontWeight:900, fontSize: Math.round(40 * ps), lineHeight:1, textShadow:'0 2px 10px rgba(0,0,0,0.4)' }}>
                      {cfg.rank}
                    </span>
                  </div>
                  <div style={{ width:Math.round(96 * ps), height:10, background:cfg.side, borderRadius:'0 0 8px 8px', boxShadow:'0 10px 28px rgba(0,0,0,0.25)' }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Fleet summary pills */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          {fleetPills.map(({ label, count, color, bg, border }, idx) => (
            <div key={label} className="anim-fade-up" style={{ animationDelay: `${idx * 80 + 420}ms` }}>
              <div style={{
                background: bg, border: `1px solid ${border}`,
                borderRadius: 16, padding: '18px 12px', textAlign: 'center',
                boxShadow: '0 2px 10px rgba(0,0,0,0.05),inset 0 1px 0 rgba(255,255,255,0.85)',
              }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginBottom:8 }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:color }} />
                  <span style={{ fontSize:11, fontWeight:600, color:'#71717A' }}>{label}</span>
                </div>
                <p style={{ fontSize:32, fontWeight:900, color:'#111114', lineHeight:1 }}>{count}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Vehicle Performance (utilization · profit per vehicle) ── */}
      <VehiclePerformance vehicles={scopedVehicles} bookings={scopedBookings} expenses={scopedExpenses} />

      {/* ── Charts Card ─────────────────────────────────────────── */}
      <div className="card anim-fade-up" style={{ animationDelay: '320ms' }}>
        <div className="flex items-center justify-between mb-5 gap-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {(['revenue', 'bookings', 'expenses'] as const).map((t) => (
              <button key={t} onClick={() => setChartTab(t)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex-shrink-0 ${
                  chartTab === t ? 'bg-navy-700 text-white' : 'bg-navy-50 text-navy-500 hover:bg-navy-100'
                }`}
              >
                {t === 'revenue' ? 'Revenue' : t === 'bookings' ? 'Booking Overview' : 'Expenses'}
              </button>
            ))}
          </div>
          <span className="text-xs text-navy-400 flex-shrink-0 hidden sm:block">{chartRange}</span>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          {chartTab === 'revenue' ? (
            <AreaChart data={chartData} margin={{ top:0,right:0,left:-20,bottom:0 }}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#E11D2A" stopOpacity={0.22}/>
                  <stop offset="95%" stopColor="#E11D2A" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F5" vertical={false}/>
              <XAxis dataKey="month" tick={{ fontSize:11,fill:'#71717A' }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize:11,fill:'#71717A' }} axisLine={false} tickLine={false} tickFormatter={(v)=>`${v/1000}k`}/>
              <Tooltip formatter={(v:number) => [`Rs ${v.toLocaleString()}`,'Revenue']} contentStyle={{ borderRadius:10,border:'none',fontSize:12 }}/>
              <Area type="monotone" dataKey="revenue" stroke="#E11D2A" strokeWidth={2.5} fill="url(#gRev)" dot={false}/>
            </AreaChart>
          ) : chartTab === 'bookings' ? (
            <BarChart data={chartData} margin={{ top:0,right:0,left:-20,bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F5" vertical={false}/>
              <XAxis dataKey="month" tick={{ fontSize:11,fill:'#71717A' }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize:11,fill:'#71717A' }} axisLine={false} tickLine={false}/>
              <Tooltip formatter={(v:number) => [v,'Bookings']} contentStyle={{ borderRadius:10,border:'none',fontSize:12 }}/>
              <Bar dataKey="bookings" fill="#E11D2A" radius={[6,6,0,0]}/>
            </BarChart>
          ) : (
            <AreaChart data={chartData} margin={{ top:0,right:0,left:-20,bottom:0 }}>
              <defs>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F5" vertical={false}/>
              <XAxis dataKey="month" tick={{ fontSize:11,fill:'#71717A' }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize:11,fill:'#71717A' }} axisLine={false} tickLine={false} tickFormatter={(v)=>`${v/1000}k`}/>
              <Tooltip formatter={(v:number) => [`Rs ${v.toLocaleString()}`,'Expenses']} contentStyle={{ borderRadius:10,border:'none',fontSize:12 }}/>
              <Area type="monotone" dataKey="expenses" stroke="#EF4444" strokeWidth={2.5} fill="url(#gExp)" dot={false}/>
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* ── Distribution (lead sources · expenses · payment mix) ──── */}
      <DistributionCharts bookings={scopedBookings} expenses={scopedExpenses} />

      {/* ── Fleet Section ────────────────────────────────────────── */}
      <div className="card overflow-hidden p-0 anim-fade-up" style={{ animationDelay: '420ms' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-navy-50">
          <FleetColumn title="Available Vehicles"           vehicles={scopedAvailable}   bookings={[]}            expenseMap={{}}                           accent="emerald" onViewAll={() => navigate('/vehicles')} />
          <FleetColumn title="Vehicles On Rent"             vehicles={scopedOnRent}      bookings={activeBookings} expenseMap={{}}                           accent="blue"    onViewAll={() => navigate('/bookings')} />
          <FleetColumn title="Under Repair / Not In Action" vehicles={scopedUnderRepair} bookings={[]}            expenseMap={buildExpenseMap(scopedExpenses)} accent="red"  onViewAll={() => navigate('/expenses')} />
        </div>

        {/* Stats bar */}
        <div className={`border-t border-navy-50 grid grid-cols-2 ${isOwnerRole ? 'sm:grid-cols-4' : 'sm:grid-cols-5'} divide-x divide-navy-50 bg-navy-50/40`}>
          {([
            !isOwnerRole ? { icon:<UserCircle size={18}/>,   label:'Total Owners',      value:owners.length,          sub:'+1 this month'               } : null,
            { icon:<Car size={18}/>,           label:'Total Vehicles',    value:scopedVehicles.length,  sub:`${scopedAvailable.length} available`  },
            { icon:<CheckSquare size={18}/>,   label:'Completed Rentals', value:completedRentals,       sub:'+3 this month'               },
            { icon:<Users size={18}/>,         label:'Total Customers',   value:uniqueCustomers,        sub:`+${uniqueCustomers} tracked` },
            { icon:<MessageSquare size={18}/>, label:'Total Inquiries',   value:inquiries.length,       sub:'+2 this month'               },
          ].filter(Boolean) as { icon:React.ReactNode; label:string; value:number; sub:string }[]).map(({ icon, label, value, sub }) => (
            <div key={label} className="flex items-center gap-3 px-4 py-4">
              <div className="text-navy-300 flex-shrink-0">{icon}</div>
              <div>
                <p className="text-navy-800 font-black text-xl leading-tight">{value}</p>
                <p className="text-navy-500 text-xs mt-0.5">{label}</p>
                <p className="text-emerald-600 text-xs font-medium">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Customer Insights (averages · conversion · top customers) ── */}
      <CustomerInsights bookings={scopedBookings} inquiries={inquiries} showInquiries={!isOwnerRole} />

      {/* ── Outstanding Balances breakdown ── */}
      <Modal open={infoModal === 'outstanding'} onClose={() => setInfoModal(null)} title="Outstanding Balances" width="max-w-lg">
        <p className="text-xs text-navy-500 mb-4">
          Money actually owed: <span className="font-semibold text-navy-700">Total − Paid</span> for bookings that are
          <span className="font-semibold text-navy-700"> ongoing</span> (vehicle is out) or <span className="font-semibold text-navy-700">completed</span> (rental finished).
          Confirmed bookings haven't started yet, so their balance is upcoming income — not outstanding.
        </p>
        {outstandingRows.length === 0 ? (
          <div className="text-center py-8 text-navy-400 text-sm">No outstanding balances. Every ongoing and completed rental is fully paid.</div>
        ) : (
          <div className="space-y-2">
            {outstandingRows.map((b) => (
              <div key={b.id} className="flex items-center gap-3 bg-navy-50/60 rounded-xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-navy-800 truncate">{b.customerName}</p>
                  <p className="text-[11px] text-navy-400 truncate">{vehicleLabel(b.vehicleId)}</p>
                  <p className="text-[11px] text-navy-400">Total Rs {b.totalAmount.toLocaleString()} · Paid Rs {b.paidAmount.toLocaleString()}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-red-600">Rs {b.balance.toLocaleString()}</p>
                  <StatusBadge status={b.status} />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-navy-100 pt-3 mt-3">
              <span className="text-sm font-semibold text-navy-700">Total Outstanding</span>
              <span className="text-base font-black text-red-600">Rs {outstandingBalance.toLocaleString()}</span>
            </div>
          </div>
        )}
      </Modal>

      {/* ── This Month's Profit breakdown ── */}
      <Modal open={infoModal === 'profit'} onClose={() => setInfoModal(null)} title={`This Month's Profit · ${format(today, 'MMMM yyyy')}`} width="max-w-lg">
        <p className="text-xs text-navy-500 mb-4">
          <span className="font-semibold text-navy-700">Revenue − Expenses</span> for bookings created and expenses dated in {format(today, 'MMMM yyyy')}. Cancelled bookings are excluded.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-emerald-50 rounded-xl p-3 text-center">
            <p className="text-[11px] text-emerald-500 font-medium">Revenue</p>
            <p className="text-lg font-black text-emerald-700">Rs {thisMonthRevenue.toLocaleString()}</p>
            <p className="text-[10px] text-emerald-500">{monthRevenueRows.length} bookings</p>
          </div>
          <div className="bg-red-50 rounded-xl p-3 text-center">
            <p className="text-[11px] text-red-400 font-medium">Expenses</p>
            <p className="text-lg font-black text-red-600">Rs {thisMonthExpenses.toLocaleString()}</p>
            <p className="text-[10px] text-red-400">{monthExpenseRows.length} entries</p>
          </div>
        </div>

        <div className="flex items-center justify-between bg-navy-50/60 rounded-xl px-4 py-3 mb-4">
          <span className="text-sm font-semibold text-navy-700">Net Profit</span>
          <span className={`text-base font-black ${monthlyProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Rs {monthlyProfit.toLocaleString()}</span>
        </div>

        {monthRevenueRows.length > 0 && (
          <>
            <p className="text-xs font-semibold text-navy-600 mb-2">Revenue — bookings</p>
            <div className="space-y-1.5 mb-4">
              {monthRevenueRows.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 text-xs px-3 py-2 bg-navy-50/60 rounded-lg">
                  <span className="text-navy-700 truncate">{b.customerName} <span className="text-navy-400">· {vehicleLabel(b.vehicleId)}</span></span>
                  <span className="font-semibold text-emerald-700 flex-shrink-0">Rs {b.totalAmount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {monthExpenseRows.length > 0 && (
          <>
            <p className="text-xs font-semibold text-navy-600 mb-2">Expenses</p>
            <div className="space-y-1.5">
              {monthExpenseRows.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 text-xs px-3 py-2 bg-navy-50/60 rounded-lg">
                  <span className="text-navy-700 truncate">{e.category}<span className="text-navy-400"> · {vehicleLabel(e.vehicleId)}</span></span>
                  <span className="font-semibold text-red-600 flex-shrink-0">Rs {e.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

function buildExpenseMap(expenses: { vehicleId:string; category:string; date:string }[]) {
  const map: Record<string,string> = {};
  expenses.forEach((e) => { if (!map[e.vehicleId]) map[e.vehicleId] = `${e.category} · ${e.date}`; });
  return map;
}

function FleetColumn({ title, vehicles, bookings, expenseMap, accent, onViewAll }: {
  title:string; vehicles:Vehicle[]; bookings:Booking[];
  expenseMap:Record<string,string>; accent:'emerald'|'blue'|'red'; onViewAll:()=>void;
}) {
  const titleColor = { emerald:'text-emerald-600', blue:'text-blue-600', red:'text-red-600' }[accent];
  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <p className={`text-xs font-bold uppercase tracking-widest ${titleColor}`}>{title}</p>
        <button onClick={onViewAll} className="text-xs text-navy-400 hover:text-navy-700 flex items-center gap-1">
          View All <ArrowUpRight size={11}/>
        </button>
      </div>
      <div className="space-y-2.5">
        {vehicles.slice(0,4).map((v) => {
          const booking = bookings.find((b) => b.vehicleId === v.id);
          const expNote = expenseMap[v.id];
          return (
            <div key={v.id} className="flex items-center gap-3 bg-navy-50/60 hover:bg-navy-50 rounded-xl p-3 transition-colors">
              <div className="w-14 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-white border border-navy-50">
                <VehicleImage brand={v.brand} model={v.model} color={v.color} imageUrl={v.imageUrl} bodyColor={vehicleBodyColor(v.color)} className="w-full h-full" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-navy-800 truncate">{v.brand} {v.model}</p>
                <p className="text-xs text-navy-400 truncate">{v.vehicleNumber}</p>
                {booking  && <p className="text-xs text-navy-500 truncate">{booking.customerName} · {booking.startDate}…</p>}
                {!booking && expNote && <p className="text-xs text-navy-400 truncate">{expNote}</p>}
              </div>
              <StatusBadge status={v.status} />
            </div>
          );
        })}
        {vehicles.length === 0 && <p className="text-navy-400 text-xs text-center py-6">None at the moment.</p>}
        {vehicles.length > 4 && (
          <button onClick={onViewAll} className="w-full text-xs text-navy-400 hover:text-navy-600 py-1.5 text-center">
            +{vehicles.length - 4} more
          </button>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, icon, color, onClick }: {
  label:string; value:string|number; sub:string;
  icon:React.ReactNode; color:string; onClick?:()=>void;
}) {
  return (
    <div onClick={onClick}
      className="card flex items-start gap-3 cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-navy-400 font-medium">{label}</p>
        <p className="text-xl font-bold text-navy-800 leading-tight">{value}</p>
        <p className="text-xs text-navy-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}
