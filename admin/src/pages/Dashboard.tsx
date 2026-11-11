import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarDays, Car, CheckCircle2, ChevronRight, Clock, Info, KeyRound, Megaphone, Undo2, Wrench,
} from 'lucide-react';
import Header from '../components/layout/Header';
import PayoutReminder from '../components/ui/PayoutReminder';
import FigureExplain, { type FigureKey } from '../components/ui/FigureExplain';
import DashboardClassic from './DashboardClassic';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { bookingNo, depositHeld, missingInfo } from '../lib/bookingRecord';
import { channelOf } from '../lib/channels';
import { useSettlements } from '../lib/settlements';
import { useCompanyFinance } from '../lib/companyFinance';
import {
  balances, buildLedger, checks, heldForOthers, monthlyTrend, periodFigures, profitRows, receivables, staleShares, utilisation, type Books,
} from '../lib/ledger';
import { payoutDate, dueMonth } from '../lib/settlements';
import type { Booking } from '../types';

/*
 * Dashboard — built around the company's work today and what it really earns:
 *   Today            pickups, returns, overdue, cars on rent / free / in repair
 *   Needs attention  every job waiting, each leading to where it's done
 *   Company (month)  commission earned, cash in, whose money we hold (click a figure: how it's worked out)
 *   Cars this month  days on rent and what each car earned the company
 *   Next 7 days      pickups and returns coming up
 *   Channels         how this month's customers found us
 * Each job sees its part: Operations (bookings, handovers), Finance (money), Fleet (cars); admins see all.
 * Owner logins keep their own dashboard (DashboardClassic).
 */

const rs = (n: number) => `${n < 0 ? '− ' : ''}Rs ${Math.abs(Math.round(n)).toLocaleString('en-LK')}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = () => { const n = new Date(); return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; };

export default function Dashboard() {
  const { currentUser, isAdmin, can } = useAuthStore();
  const owner = !isAdmin() && currentUser?.role === 'owner';
  if (owner) return <DashboardClassic />;
  return <CompanyDashboard admin={isAdmin()} staff={currentUser?.role === 'staff'} can={can} name={currentUser?.name} />;
}

function CompanyDashboard({ admin, staff, can, name }: { admin: boolean; staff: boolean; can: (k: never) => boolean; name?: string }) {
  const may = (k: string) => admin || !staff || (can as (k: string) => boolean)(k);
  const money = admin || (staff && may('canViewFinance'));
  const ops = may('canBook') || may('canViewHandovers');
  const fleet = may('canChangeStatus') || may('canManageBreakdowns') || may('canEditVehicle');
  const st = useStore();
  const fin = useCompanyFinance();
  const settle = useSettlements();
  const navigate = useNavigate();
  useEffect(() => { if (money) { fin.refresh(); settle.refresh(); } }, [money]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = iso(new Date());
  const now = hm();
  const n = new Date();
  const start = iso(new Date(n.getFullYear(), n.getMonth(), 1));
  const end = iso(new Date(n.getFullYear(), n.getMonth() + 1, 0));
  const monthName = n.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const periodText = `1 – ${new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()} ${n.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;

  const books: Books = useMemo(() => ({
    bookings: st.bookings, commissions: st.commissions, expenses: st.expenses, vehicles: st.vehicles, owners: st.owners,
    settlements: settle.list, accounts: fin.accounts, companyExpenses: fin.expenses, transfers: fin.transfers, settings: fin.settings, from: settle.from,
  }), [st.bookings, st.commissions, st.expenses, st.vehicles, st.owners, settle.list, settle.from, fin.accounts, fin.expenses, fin.transfers, fin.settings]);
  const ledger = useMemo(() => buildLedger(books), [books]);
  const f = useMemo(() => periodFigures(books, ledger, start, end, admin), [books, ledger, start, end, admin]);
  const bal = useMemo(() => balances(books, ledger), [books, ledger]);
  const held = useMemo(() => heldForOthers(books), [books]);
  const rec = useMemo(() => receivables(books), [books]);
  const trend = useMemo(() => monthlyTrend(books, ledger, 6, admin), [books, ledger, admin]);
  const own = bal.total - held.owed - held.deposits - held.unpaidExpenses;
  const [ex, setEx] = useState<FigureKey | null>(null);

  // ── today ──
  const live = st.bookings.filter((b) => b.status !== 'Cancelled');
  const car = (id: string) => { const v = st.vehicles.find((x) => x.id === id); return v ? `${v.model} ${v.vehicleNumber}` : 'Vehicle removed'; };
  const pickups = live.filter((b) => b.status === 'Confirmed' && b.startDate === today);
  const returns = live.filter((b) => b.status === 'Ongoing' && b.endDate === today && (b.endTime ?? '23:59') >= now);
  const overdue = live.filter((b) => b.status === 'Ongoing' && (b.endDate < today || (b.endDate === today && (b.endTime ?? '23:59') < now)));
  const lateStart = live.filter((b) => b.status === 'Confirmed' && b.startDate < today);
  const onRent = st.vehicles.filter((v) => v.status === 'Ongoing');
  const free = st.vehicles.filter((v) => v.status === 'Available');
  const repair = st.vehicles.filter((v) => v.status === 'Maintenance');
  const daysLate = (b: Booking) => Math.max(0, Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${b.endDate}T00:00:00`).getTime()) / 864e5));

  // ── commission on trips still running (what the company will earn when they finish) ──
  const onRentCommission = live.filter((b) => b.status === 'Ongoing')
    .reduce((s, b) => s + st.commissions.filter((c) => c.bookingId === b.id).reduce((t, c) => t + (c.commissionAmount ?? 0), 0), 0);

  // ── needs attention ──
  const attention: { level: 'red' | 'amber' | 'grey'; text: ReactNode; to: string; count?: number }[] = [];
  if (ops) {
    overdue.forEach((b) => attention.push({ level: 'red', to: `/bookings/${b.id}`, text: <><b>{car(b.vehicleId)}</b> is {daysLate(b) ? `${daysLate(b)} day${daysLate(b) === 1 ? '' : 's'}` : 'hours'} overdue — {b.customerName} ({bookingNo(b)})</> }));
    lateStart.forEach((b) => attention.push({ level: 'amber', to: `/bookings/${b.id}`, text: <><b>{b.customerName}</b> was due to pick up {car(b.vehicleId)} on {new Date(`${b.startDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — start the rental or cancel</> }));
    const soon = live.filter((b) => b.status === 'Confirmed' && b.startDate <= iso(new Date(Date.now() + 2 * 864e5)) && missingInfo(b).some((m) => m.critical));
    if (soon.length) attention.push({ level: 'amber', to: '/incomplete', count: soon.length, text: <>Pickups in the next 2 days missing details needed before handover (NIC, licence…)</> });
  }
  if (money) {
    const unpaid = rec.done.filter((x) => x.days > 7);
    if (unpaid.length) attention.push({ level: 'red', to: '/accounts', count: unpaid.length, text: <>Finished trips still unpaid after 7 days — {rs(unpaid.reduce((s, x) => s + x.due, 0))}</> });
    const deps = live.filter((b) => b.status === 'Completed' && depositHeld(b) > 0);
    if (deps.length) attention.push({ level: 'amber', to: '/accounts', count: deps.length, text: <>Deposits still held on finished trips — {rs(deps.reduce((s, b) => s + depositHeld(b), 0))} to return or settle</> });
    const stale = staleShares(books).filter((x) => x.check.fixable);
    if (stale.length) attention.push({ level: 'amber', to: '/accounts', count: stale.length, text: <>Commission / owner share out of date — fix in Company accounts → Other rental income</> });
    checks(books, ledger, payoutDate(dueMonth(), settle.payoutDay))
      .filter((c) => !/unpaid after 7 days|Deposits still held|out of date/i.test(c.text))
      .forEach((c) => attention.push({ level: c.level === 'warn' ? 'amber' : 'grey', to: /expenses with no/i.test(c.text) ? '/expenses' : /payouts/i.test(c.text) ? '/settlements' : /no company commission/i.test(c.text) ? '/settlements' : '/accounts', count: c.count, text: c.text }));
  }
  if (fleet && repair.length) attention.push({ level: 'grey', to: '/vehicles', count: repair.length, text: <>Cars in repair / not in action: {repair.map((v) => v.vehicleNumber).join(', ')}</> });
  const order = { red: 0, amber: 1, grey: 2 };
  attention.sort((a, b) => order[a.level] - order[b.level]);

  // ── cars this month ──
  const util = useMemo(() => utilisation(books, start, end), [books, start, end]);
  const earned = useMemo(() => {
    const m = new Map<string, { company: number; owner: number }>();
    profitRows(books, start, end).forEach((r) => { const e = m.get(r.b.vehicleId) ?? { company: 0, owner: 0 }; e.company += r.commission + r.other; e.owner += r.owners; m.set(r.b.vehicleId, e); });
    return m;
  }, [books, start, end]);
  const cars = st.vehicles.map((v) => {
    const u = util.find((x) => x.name === `${v.brand} ${v.model} ${v.vehicleNumber}`);
    return { v, pct: u?.pct ?? 0, days: u?.days ?? 0, ...(earned.get(v.id) ?? { company: 0, owner: 0 }) };
  }).sort((a, b) => (money ? b.company - a.company : 0) || b.pct - a.pct);
  const monthDay = n.getDate();

  // ── next 7 days ──
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + i * 864e5), k = iso(d);
    return {
      k, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      out: live.filter((b) => b.status === 'Confirmed' && b.startDate === k),
      back: live.filter((b) => (b.status === 'Ongoing' || b.status === 'Confirmed') && b.endDate === k),
    };
  });

  // ── how this month's customers found us ──
  const channels = useMemo(() => {
    const m = new Map<string, number>();
    live.filter((b) => (b.createdAt ?? '').slice(0, 10) >= start).forEach((b) => { const c = channelOf(b) ?? 'Not recorded'; m.set(c, (m.get(c) ?? 0) + 1); });
    const total = [...m.values()].reduce((s, x) => s + x, 0);
    return { total, rows: [...m.entries()].map(([k, c]) => ({ k, c, pct: total ? Math.round((c / total) * 100) : 0 })).sort((a, b) => b.c - a.c) };
  }, [live, start]);

  const hello = n.getHours() < 12 ? 'Good morning' : n.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <Header title="Dashboard" subtitle={`${hello}${name ? `, ${name.split(' ')[0]}` : ''} — ${n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`} />
      {money && <FigureExplain k={ex} onClose={() => setEx(null)} books={books} ledger={ledger} f={f} start={start} end={end} periodText={periodText} admin={admin} />}
      <PayoutReminder />

      {/* ── 1 · today ── */}
      <section className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <TodayTile icon={<KeyRound size={16} />} label="Pickups today" value={pickups.length} sub={pickups.map((b) => car(b.vehicleId)).join(', ') || 'none'} onClick={() => navigate('/handovers')} />
        <TodayTile icon={<Undo2 size={16} />} label="Returns today" value={returns.length} sub={returns.map((b) => car(b.vehicleId)).join(', ') || 'none'} onClick={() => navigate('/handovers')} />
        <TodayTile icon={<Clock size={16} />} label="Overdue" value={overdue.length} tone={overdue.length ? 'red' : undefined}
          sub={overdue.length ? overdue.map((b) => car(b.vehicleId)).join(', ') : 'all on time'} onClick={() => overdue.length === 1 ? navigate(`/bookings/${overdue[0].id}`) : navigate('/bookings')} />
        <TodayTile icon={<Car size={16} />} label="On rent" value={onRent.length} sub={`of ${st.vehicles.length} cars`} tone="blue" onClick={() => navigate('/bookings')} />
        <TodayTile icon={<CheckCircle2 size={16} />} label="Available" value={free.length} sub="ready to rent" tone="green" onClick={() => navigate('/vehicles')} />
        <TodayTile icon={<Wrench size={16} />} label="In repair" value={repair.length} sub={repair.map((v) => v.vehicleNumber).join(', ') || 'none'} tone={repair.length ? 'amber' : undefined} onClick={() => navigate('/vehicles')} />
      </section>

      <div className="grid gap-5 lg:grid-cols-5 items-start mb-5">
        {/* ── 2 · company this month ── */}
        {money && (
          <section className="card lg:col-span-3">
            <div className="flex items-center justify-between mb-1">
              <p className="section-title">Company · {monthName}</p>
              <Link to="/accounts" className="text-xs text-navy-500 hover:text-navy-800 inline-flex items-center gap-0.5">Company accounts <ChevronRight size={13} /></Link>
            </div>
            <p className="text-xs text-navy-400 mb-3">Click any figure to see how it's worked out</p>
            <div className="grid sm:grid-cols-2 gap-x-6">
              <div>
                <Fig label="Commission earned" sub={`${f.bookings} rental${f.bookings === 1 ? '' : 's'} completed this month`} v={f.commission} big onClick={() => setEx('commission')} />
                <Fig label="+ on trips still running" sub="earned when they finish" v={onRentCommission} muted onClick={() => navigate('/bookings')} />
                <Fig label={f.profit >= 0 ? 'Company profit' : 'Company loss'} sub="after the company's own costs" v={f.profit} onClick={() => setEx('profit')} />
                <Fig label="Collected from customers" sub="cash in this month" v={f.collected} onClick={() => setEx('collected')} />
                <Fig label="To come in" sub={`${rec.done.length} finished trip${rec.done.length === 1 ? '' : 's'} unpaid + on rent now`} v={rec.total + rec.onRentTotal} icon={<ArrowDownLeft size={13} className="text-emerald-600" />} onClick={() => navigate('/accounts')} />
              </div>
              <div className="sm:border-l sm:border-navy-100 sm:pl-6">
                <Fig label="Money in our accounts" sub={books.accounts.length ? `${books.accounts.length} accounts` : 'no accounts set up yet'} v={bal.total} onClick={() => setEx('cash')} />
                <Fig label="Owed to owners" sub="their share, not paid yet" v={-held.owed} tone="amber" icon={<ArrowUpRight size={13} className="text-amber-600" />} onClick={() => setEx('owed')} />
                <Fig label="Customer deposits held" sub="to be returned" v={-held.deposits} tone="amber" onClick={() => setEx('deposits')} />
                {held.unpaidExpenses > 0 && <Fig label="Approved bills to pay" v={-held.unpaidExpenses} tone="amber" onClick={() => setEx('unpaid')} />}
                <Fig label="Company's own money" sub="what is really the company's" v={own} big tone={own >= 0 ? 'green' : 'red'} onClick={() => setEx('own')} />
              </div>
            </div>
            {trend.some((t) => t.income || t.costs) && (
              <div className="mt-4 pt-3 border-t border-navy-100">
                <p className="text-xs text-navy-400 mb-1">Rental profit by month</p>
                <ResponsiveContainer width="100%" height={90}>
                  <BarChart data={trend} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#71717A' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v: number) => rs(v)} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Bar dataKey="income" name="Rental profit" fill="#111114" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        )}

        {/* ── 3 · needs attention ── */}
        <section className={`card ${money ? 'lg:col-span-2' : 'lg:col-span-5'}`}>
          <p className="section-title flex items-center gap-1.5 mb-3"><AlertTriangle size={15} className="text-amber-600" /> Needs attention</p>
          {attention.length === 0 && <p className="text-sm text-emerald-700 flex items-center gap-1.5 py-2"><CheckCircle2 size={15} /> Nothing waiting — all clear.</p>}
          <div className="space-y-1.5 max-h-[26rem] overflow-y-auto">
            {attention.map((a, i) => (
              <Link key={i} to={a.to} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${a.level === 'red' ? 'bg-red-50 text-red-900 hover:bg-red-100' : a.level === 'amber' ? 'bg-amber-50 text-amber-900 hover:bg-amber-100' : 'bg-navy-50/70 text-navy-700 hover:bg-navy-100/70'}`}>
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.level === 'red' ? 'bg-red-600' : a.level === 'amber' ? 'bg-amber-500' : 'bg-navy-400'}`} />
                <span className="flex-1 min-w-0">{a.text}</span>
                {a.count !== undefined && <b className="tabular-nums">{a.count}</b>}
                <ChevronRight size={14} className="mt-0.5 flex-shrink-0 opacity-50" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-5 items-start mb-5">
        {/* ── 4 · next 7 days ── */}
        {ops && (
          <section className="card lg:col-span-2">
            <p className="section-title flex items-center gap-1.5 mb-3"><CalendarDays size={15} /> Next 7 days</p>
            <div className="space-y-2">
              {week.map((d) => (
                <div key={d.k} className="flex gap-3">
                  <p className={`w-20 flex-shrink-0 text-xs pt-1 ${d.k === today ? 'font-bold text-navy-900' : 'text-navy-500'}`}>{d.label}</p>
                  <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                    {!d.out.length && !d.back.length && <span className="text-xs text-navy-300 pt-1">—</span>}
                    {d.out.map((b) => <Chip key={`o${b.id}`} to={`/bookings/${b.id}`} kind="out" text={`${car(b.vehicleId)} · ${b.customerName.split(' ')[0]}${b.startTime ? ` ${b.startTime}` : ''}`} />)}
                    {d.back.map((b) => <Chip key={`b${b.id}`} to={`/bookings/${b.id}`} kind="back" text={`${car(b.vehicleId)} · ${b.customerName.split(' ')[0]}${b.endTime ? ` ${b.endTime}` : ''}`} />)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-navy-400 mt-3"><span className="text-emerald-700 font-semibold">↑ pickup</span> · <span className="text-sky-700 font-semibold">↓ return</span></p>
          </section>
        )}

        {/* ── 5 · cars this month ── */}
        <section className={`card ${ops ? 'lg:col-span-3' : 'lg:col-span-5'}`}>
          <div className="flex items-center justify-between mb-3">
            <p className="section-title flex items-center gap-1.5"><Car size={15} /> Cars this month</p>
            <span className="text-[11px] text-navy-400">days on rent so far ({monthDay} day{monthDay === 1 ? '' : 's'}){money ? ' · company earned on completed trips' : ''}</span>
          </div>
          <div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
            {cars.map(({ v, pct, days, company }) => {
              const idle = v.status === 'Available' && pct < 25;
              return (
                <Link key={v.id} to="/vehicles" className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[13rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-1 py-1 hover:bg-navy-50/70">
                  <span className="text-sm text-navy-800 truncate">{v.model} <span className="text-navy-400">{v.vehicleNumber}</span>
                    {v.status === 'Maintenance' && <span className="ml-1 text-[10px] font-semibold text-red-600">repair</span>}
                    {idle && <span className="ml-1 text-[10px] font-semibold text-amber-600">idle</span>}</span>
                  <span className="order-3 sm:order-none col-span-2 sm:col-span-1 flex items-center gap-2">
                    <span className="flex-1 h-2 rounded-full bg-navy-100 overflow-hidden"><span className={`block h-full rounded-full ${pct >= 60 ? 'bg-emerald-500' : pct >= 25 ? 'bg-sky-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} /></span>
                    <span className="text-[11px] text-navy-500 tabular-nums w-16 text-right">{pct}% · {days}d</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-right text-navy-900">{money ? rs(company) : ''}</span>
                </Link>
              );
            })}
          </div>
          {cars.some((c) => c.v.status === 'Available' && c.pct < 25) && (
            <p className="text-[11px] text-navy-400 mt-3 flex gap-1"><Info size={12} className="mt-0.5 flex-shrink-0" /> "Idle" cars have been on rent less than a quarter of the month — worth a price check or a word with the owner.</p>
          )}
        </section>
      </div>

      {/* ── 6 · how customers found us ── */}
      {(money || ops) && channels.total > 0 && (
        <section className="card mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="section-title flex items-center gap-1.5"><Megaphone size={15} /> How this month's customers found us</p>
            <span className="text-[11px] text-navy-400">{channels.total} booking{channels.total === 1 ? '' : 's'} made in {n.toLocaleDateString('en-GB', { month: 'long' })}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {channels.rows.map((c) => (
              <div key={c.k} className="flex items-center gap-2 text-sm">
                <span className="w-28 truncate text-navy-700">{c.k}</span>
                <span className="flex-1 h-2 rounded-full bg-navy-100 overflow-hidden"><span className="block h-full rounded-full bg-navy-800" style={{ width: `${c.pct}%` }} /></span>
                <span className="w-16 text-right text-xs text-navy-500 tabular-nums">{c.c} · {c.pct}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!money && staff && (
        <p className="text-xs text-navy-400">Payments and company figures are shown to Finance and admins.</p>
      )}
    </div>
  );
}

function TodayTile({ icon, label, value, sub, tone, onClick }: { icon: ReactNode; label: string; value: number; sub: string; tone?: 'red' | 'blue' | 'green' | 'amber'; onClick: () => void }) {
  const cls = tone === 'red' ? 'bg-red-600 text-white' : tone === 'blue' ? 'bg-navy-800 text-white' : tone === 'green' ? 'bg-emerald-50 text-emerald-900' : tone === 'amber' ? 'bg-amber-50 text-amber-900' : 'bg-white text-navy-900';
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl px-3.5 py-3 text-left shadow-card transition hover:shadow-card-hover ${cls}`}>
      <p className="text-[11px] opacity-75 flex items-center gap-1.5">{icon}{label}</p>
      <p className="text-2xl font-black leading-tight mt-0.5 tabular-nums">{value}</p>
      <p className="text-[11px] opacity-70 truncate" title={sub}>{sub}</p>
    </button>
  );
}

function Fig({ label, sub, v, big, muted, tone, icon, onClick }: { label: string; sub?: string; v: number; big?: boolean; muted?: boolean; tone?: 'amber' | 'green' | 'red'; icon?: ReactNode; onClick: () => void }) {
  const color = tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-600' : muted ? 'text-navy-500' : 'text-navy-900';
  return (
    <button type="button" onClick={onClick} title="How it's worked out" className="group w-full text-left flex items-start justify-between gap-3 py-1.5 px-1.5 -mx-1.5 rounded-lg hover:bg-navy-50/80">
      <span className="min-w-0">
        <span className={`flex items-center gap-1 ${big ? 'text-sm font-semibold text-navy-900' : 'text-sm text-navy-700'}`}>{icon}{label}<Info size={11} className="text-navy-300 group-hover:text-navy-600" /></span>
        {sub && <span className="block text-[11px] text-navy-400">{sub}</span>}
      </span>
      <span className={`whitespace-nowrap tabular-nums font-bold ${big ? 'text-lg' : 'text-sm'} ${color}`}>{rs(v)}</span>
    </button>
  );
}

function Chip({ to, kind, text }: { to: string; kind: 'out' | 'back'; text: string }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${kind === 'out' ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'bg-sky-50 text-sky-800 hover:bg-sky-100'}`}>
      <span className="font-bold">{kind === 'out' ? '↑' : '↓'}</span>{text}
    </Link>
  );
}
