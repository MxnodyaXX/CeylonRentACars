import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Gauge, TrendingUp, TrendingDown, Repeat, AlertTriangle,
  CalendarClock, ShieldAlert, Users, Receipt, CreditCard,
  Banknote, Target, ArrowDownRight, ArrowUpRight, Car,
  DollarSign, Scissors,
} from 'lucide-react';
import { Vehicle, Booking, Expense, Inquiry } from '../../types';
import {
  fleetUtilization, vehicleProfit, inquiryFunnel, leadSources,
  expensesByCategory, overdueReturns, upcoming, insuranceExpiring,
  customerStats, rentalAverages, momGrowth, paymentMethods, depositAndDebt,
} from '../../lib/analytics';
import { grossRevenue, netRevenue, totalDiscount } from '../../lib/revenue';

const PIE = ['#E11D2A', '#10B981', '#F59E0B', '#111114', '#8B5CF6', '#06B6D4', '#EC4899', '#71717A'];

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/* Brief settle so each block reveals with a loading shimmer rather than snapping
   in. All blocks mount together, so they reveal in sync. */
function useReveal(delay = 650) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return ready;
}

const vLabelOf = (vehicles: Vehicle[]) => (vehicleId: string) => {
  const v = vehicles.find((x) => x.id === vehicleId);
  return v ? `${v.brand} ${v.model} · ${v.vehicleNumber}` : '—';
};

/* ════════════════════════════════════════════════════════════════════════
   1. OPERATIONAL ALERTS — overdue returns · next 7 days · insurance watch
   Placed high on the dashboard because these are time-sensitive.
   ════════════════════════════════════════════════════════════════════════ */
export function OperationalAlerts({ vehicles, bookings }: { vehicles: Vehicle[]; bookings: Booking[] }) {
  const navigate = useNavigate();
  const ready = useReveal();
  const { overdue, soon, insurance } = useMemo(() => ({
    overdue: overdueReturns(bookings),
    soon: upcoming(bookings, 7),
    insurance: insuranceExpiring(vehicles, 30),
  }), [vehicles, bookings]);
  const vLabel = vLabelOf(vehicles);

  if (!ready) return <SkelGrid count={3} h={200} cols="grid-cols-1 lg:grid-cols-3" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Panel delay={0} title="Overdue Returns" icon={<AlertTriangle size={15} className="text-red-500" />}
        badge={overdue.length} badgeTone={overdue.length ? 'red' : 'muted'}
        onClick={() => navigate('/bookings?status=Ongoing')}>
        {overdue.length === 0 ? <Empty text="No overdue rentals. Every vehicle is back on time." /> : (
          <div className="space-y-2">
            {overdue.slice(0, 5).map(({ booking: b, daysLate }) => (
              <div key={b.id} className="flex items-center justify-between gap-3 bg-red-50/60 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-navy-800 truncate">{b.customerName}</p>
                  <p className="text-[11px] text-navy-400 truncate">{vLabel(b.vehicleId)}</p>
                </div>
                <span className="text-[11px] font-bold text-red-600 flex-shrink-0">{daysLate}d late</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel delay={80} title="Next 7 Days" icon={<CalendarClock size={15} className="text-blue-500" />}
        badge={soon.pickups.length + soon.returns.length} badgeTone="blue"
        onClick={() => navigate('/bookings')}>
        {soon.pickups.length === 0 && soon.returns.length === 0 ? (
          <Empty text="Nothing scheduled in the coming week." />
        ) : (
          <div className="space-y-2">
            {soon.pickups.slice(0, 3).map((b) => (
              <UpcomingRow key={`p${b.id}`} tone="emerald" tag="Pickup" name={b.customerName} sub={vLabel(b.vehicleId)} date={b.startDate} />
            ))}
            {soon.returns.slice(0, 3).map((b) => (
              <UpcomingRow key={`r${b.id}`} tone="blue" tag="Return" name={b.customerName} sub={vLabel(b.vehicleId)} date={b.endDate} />
            ))}
          </div>
        )}
      </Panel>

      <Panel delay={160} title="Insurance Watch" icon={<ShieldAlert size={15} className="text-amber-500" />}
        badge={insurance.length} badgeTone={insurance.length ? 'amber' : 'muted'}
        onClick={() => navigate('/vehicles')}>
        {insurance.length === 0 ? <Empty text="All policies are valid for the next 30 days." /> : (
          <div className="space-y-2">
            {insurance.slice(0, 5).map((al) => (
              <div key={al.vehicle.id} className="flex items-center justify-between gap-3 bg-amber-50/60 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-navy-800 truncate">{al.vehicle.brand} {al.vehicle.model}</p>
                  <p className="text-[11px] text-navy-400 truncate">{al.vehicle.vehicleNumber}</p>
                </div>
                <span className={`text-[11px] font-bold flex-shrink-0 ${al.missing || (al.daysLeft ?? 0) < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                  {al.missing ? 'No policy' : (al.daysLeft ?? 0) < 0 ? 'Expired' : `${al.daysLeft}d left`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   2. MONEY INSIGHTS — revenue growth · deposits held · bad debt
   Sits with the other financial KPIs (Outstanding / Profit / Credit).
   ════════════════════════════════════════════════════════════════════════ */
export function MoneyInsights({ bookings }: { bookings: Booking[] }) {
  const navigate = useNavigate();
  const ready = useReveal();
  const { mom, dd, gross, net, discounts } = useMemo(() => ({
    mom: momGrowth(bookings),
    dd: depositAndDebt(bookings),
    gross: grossRevenue(bookings),
    net: netRevenue(bookings),
    discounts: totalDiscount(bookings),
  }), [bookings]);

  if (!ready) return <SkelGrid count={5} h={86} cols="grid-cols-2 lg:grid-cols-3" />;

  const down = mom.growth !== null && mom.growth < 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {/* Gross vs discounts — the "before discounts" figures live here so the
          Net Revenue shown everywhere else stays discount-adjusted. */}
      <StatTile delay={0} icon={<DollarSign size={18} />} color="bg-navy-700"
        label="Gross Revenue" value={rs(gross)} sub="before discounts"
        onClick={() => navigate('/commissions')} />
      <StatTile delay={80} icon={<Scissors size={18} />} color="bg-amber-500"
        label="Discounts Given" value={rs(discounts)} sub={`net Rs ${Math.round(net).toLocaleString()} earned`}
        tone={discounts > 0 ? 'red' : undefined} onClick={() => navigate('/bookings')} />
      <StatTile delay={160}
        icon={down ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
        color={down ? 'bg-red-500' : 'bg-emerald-500'}
        label="Revenue Growth"
        value={mom.growth === null ? '—' : `${mom.growth >= 0 ? '+' : ''}${pct(mom.growth)}`}
        sub="this month vs last" tone={down ? 'red' : 'emerald'}
        onClick={() => navigate('/commissions')} />
      <StatTile delay={240} icon={<Banknote size={18} />} color="bg-navy-700"
        label="Deposits Held" value={rs(dd.depositsHeld)} sub="refundable on return"
        onClick={() => navigate('/bookings')} />
      <StatTile delay={320} icon={<ArrowDownRight size={18} />} color="bg-red-500"
        label="Bad Debt" value={rs(dd.badDebt)} sub="written off" tone={dd.badDebt > 0 ? 'red' : undefined}
        onClick={() => navigate('/credit')} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   3. VEHICLE PERFORMANCE — busiest (utilization) · profit per vehicle
   Placed right after the revenue Leaderboard; same "rank the fleet" theme.
   ════════════════════════════════════════════════════════════════════════ */
export function VehiclePerformance({ vehicles, bookings, expenses }: {
  vehicles: Vehicle[]; bookings: Booking[]; expenses: Expense[];
}) {
  const navigate = useNavigate();
  const ready = useReveal();
  const { util, profit, maxAbsProfit } = useMemo(() => {
    const u = fleetUtilization(vehicles, bookings, 30);
    const p = vehicleProfit(vehicles, expenses, bookings);
    return { util: u, profit: p, maxAbsProfit: Math.max(1, ...p.map((x) => Math.abs(x.profit))) };
  }, [vehicles, bookings, expenses]);

  if (!ready) return <SkelGrid count={2} h={210} cols="grid-cols-1 lg:grid-cols-2" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel delay={0} title="Busiest Vehicles" icon={<Gauge size={15} className="text-blue-500" />}
        onClick={() => navigate('/vehicles')}>
        <p className="text-[11px] text-navy-400 -mt-2 mb-3">Fleet average {pct(util.fleetRate)} busy · last 30 days</p>
        {util.perVehicle.length === 0 ? <Empty text="No vehicles to rank yet." /> : (
          <div className="space-y-3">
            {util.perVehicle.slice(0, 5).map((u) => (
              <Bar key={u.vehicle.id} label={`${u.vehicle.brand} ${u.vehicle.model}`} sub={u.vehicle.vehicleNumber}
                ratio={u.rate} display={pct(u.rate)} tone="blue" />
            ))}
          </div>
        )}
      </Panel>

      <Panel delay={80} title="Profit per Vehicle" icon={<TrendingUp size={15} className="text-emerald-500" />}
        onClick={() => navigate('/vehicles')}>
        <p className="text-[11px] text-navy-400 -mt-2 mb-3">Revenue minus all logged expenses</p>
        {profit.length === 0 ? <Empty text="No vehicles to rank yet." /> : (
          <div className="space-y-3">
            {profit.slice(0, 5).map((p) => (
              <Bar key={p.vehicle.id} label={`${p.vehicle.brand} ${p.vehicle.model}`}
                sub={`rev ${rs(p.revenue)} · exp ${rs(p.expenses)}`}
                ratio={Math.abs(p.profit) / maxAbsProfit} display={rs(p.profit)} tone={p.profit < 0 ? 'red' : 'emerald'} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   4. DISTRIBUTION CHARTS — lead sources · expenses · payment methods
   Placed under the revenue/expense charts; same "where does it break down" lens.
   ════════════════════════════════════════════════════════════════════════ */
export function DistributionCharts({ bookings, expenses }: { bookings: Booking[]; expenses: Expense[] }) {
  const navigate = useNavigate();
  const ready = useReveal();
  const { leads, expCats, pay } = useMemo(() => ({
    leads: leadSources(bookings),
    expCats: expensesByCategory(expenses),
    pay: paymentMethods(bookings),
  }), [bookings, expenses]);

  if (!ready) return <SkelGrid count={3} h={190} cols="grid-cols-1 lg:grid-cols-3" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <DonutCard delay={0} title="Lead Sources" icon={<Target size={15} className="text-blue-500" />}
        slices={leads.map((l) => ({ name: l.source, value: l.revenue }))} format={rs} empty="No bookings to attribute yet."
        onClick={() => navigate('/referrals')} />
      <DonutCard delay={80} title="Expense Breakdown" icon={<Receipt size={15} className="text-red-500" />}
        slices={expCats.map((e) => ({ name: e.category, value: e.amount }))} format={rs} empty="No expenses logged yet."
        onClick={() => navigate('/expenses')} />
      <DonutCard delay={160} title="Payment Methods" icon={<CreditCard size={15} className="text-violet-500" />}
        slices={pay.map((p) => ({ name: p.method, value: p.amount }))} format={rs} empty="No payments recorded yet."
        onClick={() => navigate('/bookings')} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   5. CUSTOMER INSIGHTS — averages · inquiry conversion · top customers
   Sits with the fleet stats bar (Total Customers / Total Inquiries).
   ════════════════════════════════════════════════════════════════════════ */
export function CustomerInsights({ bookings, inquiries, showInquiries }: {
  bookings: Booking[]; inquiries: Inquiry[]; showInquiries: boolean;
}) {
  const navigate = useNavigate();
  const ready = useReveal();
  const { customers, avgs, funnel } = useMemo(() => ({
    customers: customerStats(bookings),
    avgs: rentalAverages(bookings),
    funnel: inquiryFunnel(inquiries),
  }), [bookings, inquiries]);

  if (!ready) {
    return (
      <div className="space-y-4">
        <SkelGrid count={3} h={86} cols="grid-cols-2 lg:grid-cols-3" />
        <SkelGrid count={showInquiries ? 2 : 1} h={190} cols={showInquiries ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatTile delay={0} icon={<Banknote size={18} />} color="bg-navy-700"
          label="Avg Rental Value" value={rs(avgs.avgValue)} sub={`${avgs.avgDuration.toFixed(1)} days avg`}
          onClick={() => navigate('/bookings')} />
        <StatTile delay={80} icon={<Repeat size={18} />} color="bg-violet-500"
          label="Repeat Customers" value={pct(customers.repeatRate)} sub={`${customers.repeat} of ${customers.total}`}
          onClick={() => navigate('/customers')} />
        <StatTile delay={160} icon={<Car size={18} />} color="bg-navy-700"
          label="Total Rentals" value={avgs.count} sub="non-cancelled bookings"
          onClick={() => navigate('/bookings')} />
      </div>

      <div className={`grid grid-cols-1 ${showInquiries ? 'lg:grid-cols-2' : ''} gap-4`}>
        {showInquiries && (
          <Panel delay={0} title="Inquiry Conversion" icon={<Target size={15} className="text-emerald-500" />}
            onClick={() => navigate('/inquiries?status=Lost')}>
            {funnel.total === 0 ? <Empty text="No inquiries captured yet." /> : (
              <>
                <div className="flex items-end gap-2 mb-4">
                  <p className="text-3xl font-black text-emerald-600 leading-none">{pct(funnel.conversionRate)}</p>
                  <p className="text-xs text-navy-400 mb-1">conversion rate</p>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <FunnelStat label="Pending" value={funnel.pending} tone="amber" />
                  <FunnelStat label="Converted" value={funnel.converted} tone="emerald" />
                  <FunnelStat label="Lost" value={funnel.lost} tone="red" />
                </div>
                {funnel.lostReasons.length > 0 && (
                  <>
                    <p className="text-[11px] font-semibold text-navy-500 mb-2">Top lost reasons</p>
                    <div className="space-y-1.5">
                      {funnel.lostReasons.slice(0, 4).map((r) => (
                        <div key={r.reason} className="flex items-center justify-between text-xs">
                          <span className="text-navy-600 truncate">{r.reason}</span>
                          <span className="font-semibold text-navy-800 flex-shrink-0 ml-2">{r.count}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </Panel>
        )}

        <Panel delay={showInquiries ? 80 : 0} title="Top Customers" icon={<Users size={15} className="text-navy-500" />}
          onClick={() => navigate('/customers')}>
          {customers.top.length === 0 ? <Empty text="No customers yet." /> : (
            <div className="space-y-2">
              {customers.top.map((c, i) => (
                <div key={c.phone} className="flex items-center gap-3 bg-navy-50/60 rounded-xl px-3 py-2">
                  <span className="w-6 h-6 rounded-lg bg-navy-700 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-navy-800 truncate">{c.name}</p>
                    <p className="text-[11px] text-navy-400">{c.bookings} booking{c.bookings !== 1 ? 's' : ''}</p>
                  </div>
                  <span className="text-sm font-bold text-emerald-600 flex-shrink-0">{rs(c.spend)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ── Shared sub-components ─────────────────────────────────────────────────── */

function StatTile({ icon, label, value, sub, color, delay, tone, onClick }: {
  icon: React.ReactNode; label: string; value: string | number; sub: string;
  color: string; delay: number; tone?: 'red' | 'emerald'; onClick?: () => void;
}) {
  const valColor = tone === 'red' ? 'text-red-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-navy-800';
  const clickable = onClick ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200' : '';
  return (
    <div onClick={onClick} className={`card flex items-start gap-3 anim-fade-up ${clickable}`} style={{ animationDelay: `${delay}ms` }}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${color}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="text-xs text-navy-400 font-medium">{label}</p>
          {onClick && <ArrowUpRight size={14} className="text-navy-300 flex-shrink-0" />}
        </div>
        <p className={`text-xl font-black leading-tight ${valColor}`}>{value}</p>
        <p className="text-xs text-navy-400 mt-0.5 truncate">{sub}</p>
      </div>
    </div>
  );
}

function Panel({ title, icon, badge, badgeTone, delay, children, onClick }: {
  title: string; icon: React.ReactNode; badge?: number;
  badgeTone?: 'red' | 'blue' | 'amber' | 'muted'; delay: number; children: React.ReactNode; onClick?: () => void;
}) {
  const toneCls = {
    red: 'bg-red-100 text-red-600', blue: 'bg-blue-100 text-blue-600',
    amber: 'bg-amber-100 text-amber-700', muted: 'bg-navy-100 text-navy-500',
  }[badgeTone ?? 'muted'];
  const clickable = onClick ? 'cursor-pointer hover:shadow-card-hover transition-shadow' : '';
  return (
    <div onClick={onClick} className={`card anim-fade-up ${clickable}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">{icon}<p className="section-title">{title}</p></div>
        <div className="flex items-center gap-1.5">
          {badge !== undefined && <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${toneCls}`}>{badge}</span>}
          {onClick && <ArrowUpRight size={14} className="text-navy-300" />}
        </div>
      </div>
      {children}
    </div>
  );
}

function Bar({ label, sub, ratio, display, tone }: {
  label: string; sub?: string; ratio: number; display: string; tone: 'blue' | 'emerald' | 'red';
}) {
  const bg = { blue: '#111114', emerald: '#10B981', red: '#EF4444' }[tone];
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1 gap-2">
        <span className="text-navy-700 font-medium truncate">
          {label}{sub && <span className="text-navy-400 font-normal"> · {sub}</span>}
        </span>
        <span className="font-semibold text-navy-800 flex-shrink-0">{display}</span>
      </div>
      <div className="h-2 rounded-full bg-navy-50 overflow-hidden">
        <div className="h-full rounded-full anim-bar-grow"
          style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%`, background: bg }} />
      </div>
    </div>
  );
}

function DonutCard({ title, icon, slices, format, empty, delay, onClick }: {
  title: string; icon: React.ReactNode; delay: number; onClick?: () => void;
  slices: { name: string; value: number }[]; format: (n: number) => string; empty: string;
}) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((s, x) => s + x.value, 0);
  return (
    <Panel title={title} icon={icon} delay={delay} onClick={onClick}>
      {total === 0 ? <Empty text={empty} /> : (
        <div className="flex items-center gap-4">
          <div style={{ width: 124, height: 124, flexShrink: 0, position: 'relative' }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={60} paddingAngle={2} stroke="none">
                  {data.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number, n) => [format(v), n as string]}
                  contentStyle={{ borderRadius: 10, border: 'none', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span className="text-[9px] text-navy-400 uppercase tracking-wide">Total</span>
              <span className="text-xs font-black text-navy-800">{format(total)}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            {data.slice(0, 6).map((s, i) => (
              <div key={s.name} className="flex items-center gap-2 text-xs">
                <span style={{ width: 9, height: 9, borderRadius: 3, background: PIE[i % PIE.length], flexShrink: 0 }} />
                <span className="text-navy-600 truncate flex-1">{s.name}</span>
                <span className="font-semibold text-navy-800 flex-shrink-0">{format(s.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function UpcomingRow({ tone, tag, name, sub, date }: {
  tone: 'emerald' | 'blue'; tag: string; name: string; sub: string; date: string;
}) {
  const cls = tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700';
  return (
    <div className="flex items-center justify-between gap-3 bg-navy-50/60 rounded-xl px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-navy-800 truncate">{name}</p>
        <p className="text-[11px] text-navy-400 truncate">{sub}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{tag}</span>
        <p className="text-[11px] text-navy-500 mt-0.5">{safeDate(date)}</p>
      </div>
    </div>
  );
}

function FunnelStat({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'emerald' | 'red' }) {
  const cls = { amber: 'bg-amber-50 text-amber-700', emerald: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-600' }[tone];
  return (
    <div className={`rounded-xl py-2.5 text-center ${cls}`}>
      <p className="text-lg font-black leading-none">{value}</p>
      <p className="text-[10px] mt-1 opacity-80">{label}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-navy-400 text-xs text-center py-8">{text}</p>;
}

function safeDate(d: string) {
  const t = new Date(d);
  return isNaN(t.getTime()) ? d : format(t, 'EEE, MMM d');
}

/* ── Loading skeleton ─────────────────────────────────────────────────────── */

function SkelGrid({ count, h, cols }: { count: number; h: number; cols: string }) {
  return (
    <div className={`grid ${cols} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="anim-shimmer rounded-2xl" style={{ height: h }} />
      ))}
    </div>
  );
}
