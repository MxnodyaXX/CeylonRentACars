import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import StatusBadge from '../components/ui/StatusBadge';
import {
  HandCoins, Users, Clock, CheckCircle2, ChevronDown, Search,
  Wallet, CalendarClock, Crown, BellRing, ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';
import {
  buildReferralRecords, totalsOf, periodWindow, inPeriod, PERIODS,
  type RefRecord, type Period, type RefTotals,
} from '../lib/referralInsights';
import { sendSms, smsTemplates } from '../lib/sms';

/* ── Small shared UI ──────────────────────────────────────────── */

function PeriodSwitch({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex bg-navy-50 rounded-xl p-0.5 gap-0.5">
      {PERIODS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1 rounded-[10px] text-xs font-semibold transition-all ${
            value === key ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, color, note }: {
  label: string; value: number; icon: typeof HandCoins; color: string; note: string;
}) {
  return (
    <div className="card flex items-start gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${color}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-navy-400 font-medium">{label}</p>
        <p className="text-xl font-bold text-navy-800">Rs {value.toLocaleString()}</p>
        <p className="text-[10px] text-navy-300 mt-0.5 truncate">{note}</p>
      </div>
    </div>
  );
}

/* Records table. `action` controls the right-hand cell:
   - 'settle'  → this party owes the fee (Mark paid / Paid toggle)
   - 'receive' → this party earns the fee (Received / Awaiting, read-only) */
function RecordsTable({ records, action, onToggle, vehicleLabel, leadColumn }: {
  records: RefRecord[];
  action: 'settle' | 'receive';
  onToggle?: (bookingId: string, paid: boolean) => void;
  vehicleLabel: (id: string) => string;
  leadColumn: 'referrer' | 'payer';
}) {
  if (records.length === 0) {
    return <div className="text-center py-6 text-navy-400 text-xs">No records in this period.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-xs">
        <thead>
          <tr className="text-navy-400">
            <th className="text-left font-medium pb-2">{leadColumn === 'referrer' ? 'Referrer (earns)' : 'Paying owner (owes)'}</th>
            <th className="text-left font-medium pb-2">Customer</th>
            <th className="text-left font-medium pb-2">Vehicle</th>
            <th className="text-left font-medium pb-2">Dates</th>
            <th className="text-center font-medium pb-2">Booking</th>
            <th className="text-right font-medium pb-2">Fee</th>
            <th className="text-center font-medium pb-2">{action === 'settle' ? 'Settlement' : 'Status'}</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.booking.id} className="border-t border-navy-100/60">
              <td className="py-2 text-navy-800 font-semibold">{leadColumn === 'referrer' ? r.referrer : r.payerOwnerName}</td>
              <td className="py-2 text-navy-600">{r.booking.customerName}</td>
              <td className="py-2 text-navy-600">{vehicleLabel(r.booking.vehicleId)}</td>
              <td className="py-2 text-navy-500">{r.booking.startDate} → {r.booking.endDate}</td>
              <td className="py-2 text-center"><StatusBadge status={r.booking.status} /></td>
              <td className="py-2 text-right font-semibold text-amber-700">Rs {r.fee.toLocaleString()}</td>
              <td className="py-2 text-center">
                {!r.payable ? (
                  <span className="text-[11px] text-blue-500">Not due yet</span>
                ) : action === 'receive' ? (
                  r.paid
                    ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><CheckCircle2 size={12} /> Received</span>
                    : <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600"><Clock size={12} /> Awaiting</span>
                ) : r.paid ? (
                  <button
                    onClick={() => onToggle?.(r.booking.id, false)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg transition-colors"
                    title="Click to mark as unpaid"
                  >
                    <CheckCircle2 size={12} /> Paid
                  </button>
                ) : (
                  <button
                    onClick={() => onToggle?.(r.booking.id, true)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-white bg-amber-500 hover:bg-amber-600 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    Mark paid
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Route entry — role-branched ──────────────────────────────── */

export default function Referrals() {
  const { isAdmin } = useAuthStore();
  return isAdmin() ? <AdminReferrals /> : <OwnerReferralProfile />;
}

/* ── Admin: company-wide referral insights ────────────────────── */

interface ReferrerGroup {
  referrer: string;
  referrerOwnerId?: string;
  records: RefRecord[];
  totals: RefTotals;
  pendingByOwner: { ownerId: string; name: string; amount: number; count: number }[];
}

function AdminReferrals() {
  const { bookings, vehicles, owners, notifications, markReferralPaid, addNotification } = useStore();
  const [search, setSearch] = useState('');
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [periodByKey, setPeriodByKey] = useState<Record<string, Period>>({});
  const [alerted, setAlerted] = useState<Record<string, boolean>>({});

  const records = useMemo(() => buildReferralRecords(bookings, vehicles, owners), [bookings, vehicles, owners]);

  const groups = useMemo<ReferrerGroup[]>(() => {
    const map: Record<string, RefRecord[]> = {};
    records.forEach((r) => { (map[r.referrer] ??= []).push(r); });
    return Object.entries(map).map(([referrer, recs]) => {
      const pend: Record<string, { name: string; amount: number; count: number }> = {};
      recs.filter((r) => r.payable && !r.paid).forEach((r) => {
        const p = (pend[r.payerOwnerId] ??= { name: r.payerOwnerName, amount: 0, count: 0 });
        p.amount += r.fee; p.count += 1;
      });
      return {
        referrer,
        referrerOwnerId: recs[0].referrerOwnerId,
        records: recs.sort((a, b) => (a.booking.startDate < b.booking.startDate ? 1 : -1)),
        totals: totalsOf(recs),
        pendingByOwner: Object.entries(pend).map(([ownerId, v]) => ({ ownerId, ...v })).sort((a, b) => b.amount - a.amount),
      };
    }).sort((a, b) => b.totals.pending - a.totals.pending || b.totals.earned - a.totals.earned);
  }, [records]);

  const grand = useMemo(() => totalsOf(records), [records]);
  const maxEarned = Math.max(1, ...groups.map((g) => g.totals.earned));
  const topReferrers = [...groups].sort((a, b) => b.totals.earned - a.totals.earned).slice(0, 5);

  // Auto-alert each paying owner once on open if they owe a referrer money.
  useEffect(() => {
    const owed: Record<string, number> = {};
    records.filter((r) => r.payable && !r.paid && r.payerOwnerId).forEach((r) => { owed[r.payerOwnerId] = (owed[r.payerOwnerId] ?? 0) + r.fee; });
    Object.entries(owed).forEach(([ownerId, amount]) => {
      const relatedId = `referral-owner:${ownerId}`;
      const already = notifications.some((n) => n.type === 'ReferralPayout' && n.relatedId === relatedId && !n.read);
      if (!already) {
        addNotification({
          type: 'ReferralPayout',
          title: 'Referral payout due',
          message: `You owe Rs ${amount.toLocaleString()} in referral fees for rentals on your vehicles. Please settle with the referrers.`,
          relatedId,
          ownerId,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vehicleLabel = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.brand} ${v.model} · ${v.vehicleNumber}` : '—';
  };
  const getPeriod = (k: string) => periodByKey[k] ?? 'all';

  const alertOwner = (ownerId: string, ownerName: string, referrer: string, amount: number, count: number) => {
    addNotification({
      type: 'ReferralPayout',
      title: 'Settle referral payout',
      message: `Please settle Rs ${amount.toLocaleString()} referral fee owed to ${referrer} across ${count} booking${count !== 1 ? 's' : ''} on your vehicles.`,
      relatedId: `referral-settle:${ownerId}:${referrer}`,
      ownerId,
    });
    // Also text the owner (no-op if SMS not configured).
    const phone = owners.find((o) => o.id === ownerId)?.phone;
    if (phone) sendSms(phone, smsTemplates.referralPayout(ownerName, amount));
    setAlerted((m) => ({ ...m, [`${ownerId}:${referrer}`]: true }));
  };

  const q = search.trim().toLowerCase();
  const visibleGroups = q
    ? groups.filter((g) => g.referrer.toLowerCase().includes(q) || g.records.some((r) => r.booking.customerName.toLowerCase().includes(q) || r.payerOwnerName.toLowerCase().includes(q)))
    : groups;

  return (
    <div>
      <Header title="Referrals" subtitle="Who brings business — and what they're owed" />

      {grand.pending > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center text-white flex-shrink-0"><Wallet size={18} /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Rs {grand.pending.toLocaleString()} in referral fees pending settlement</p>
            <p className="text-xs text-amber-700 mt-0.5">Owners owe these to referrers. Each owner with a balance has been alerted in their Notifications.</p>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi label="Total Referral Income" value={grand.earned}  icon={HandCoins}    color="bg-navy-700"    note="realized (ongoing + completed)" />
        <Kpi label="Paid Out"              value={grand.paid}     icon={CheckCircle2} color="bg-emerald-500" note="settled with referrers" />
        <Kpi label="Pending Settlement"    value={grand.pending}  icon={Clock}        color="bg-amber-500"   note={`${groups.filter((g) => g.totals.pending > 0).length} referrer(s) awaiting`} />
        <Kpi label="Upcoming"              value={grand.upcoming} icon={CalendarClock} color="bg-navy-700"   note="confirmed, not yet due" />
      </div>

      {/* Top referrers */}
      {topReferrers.length > 0 && (
        <div className="card mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl bg-navy-700 flex items-center justify-center"><Crown size={15} className="text-amber-400" /></div>
            <p className="section-title">Top Referrers</p>
          </div>
          <div className="space-y-3">
            {topReferrers.map((g, i) => (
              <div key={g.referrer} className="flex items-center gap-3">
                <span className="text-xs font-bold text-navy-400 w-5 text-center flex-shrink-0">{i + 1}</span>
                <div className="w-32 sm:w-44 flex-shrink-0">
                  <p className="text-sm font-semibold text-navy-800 truncate">{g.referrer}</p>
                  <p className="text-[10px] text-navy-400">{g.totals.count} booking{g.totals.count !== 1 ? 's' : ''}{g.referrerOwnerId ? ' · owner' : ''}</p>
                </div>
                <div className="flex-1 bg-navy-50 rounded-full h-2.5 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-navy-500 to-navy-700" style={{ width: `${(g.totals.earned / maxEarned) * 100}%` }} />
                </div>
                <span className="text-sm font-bold text-navy-800 w-24 text-right flex-shrink-0">Rs {g.totals.earned.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-referrer accordions */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <p className="section-title">Referrers</p>
            <p className="text-xs text-navy-400 mt-0.5">{groups.length} referrer{groups.length !== 1 ? 's' : ''} · {records.length} fee-bearing booking{records.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 pointer-events-none" />
            <input className="input pl-10 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search referrer, owner or customer…" />
          </div>
        </div>

        {visibleGroups.length === 0 ? (
          <div className="text-center py-16 text-navy-400 text-sm">
            <Users size={40} className="text-navy-200 mx-auto mb-3" />
            {groups.length === 0 ? 'No referral fees recorded yet.' : 'No referrers match your search.'}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleGroups.map((g, i) => {
              const isOpen = !!openRows[g.referrer];
              const period = getPeriod(g.referrer);
              const win = periodWindow(period);
              const periodRecs = g.records.filter((r) => inPeriod(r, win));
              const periodTot = totalsOf(periodRecs);
              return (
                <div key={g.referrer} className="border border-navy-100 rounded-xl overflow-hidden anim-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-xl bg-navy-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {g.referrer.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <button onClick={() => setOpenRows((m) => ({ ...m, [g.referrer]: !m[g.referrer] }))} className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-semibold text-navy-800 truncate">
                        {g.referrer}
                        {g.referrerOwnerId && <span className="ml-2 text-[10px] text-navy-400 bg-navy-50 border border-navy-100 rounded-full px-1.5 py-0.5">owner</span>}
                      </p>
                      <p className="text-xs text-navy-400">
                        {g.totals.count} booking{g.totals.count !== 1 ? 's' : ''} · Rs {g.totals.earned.toLocaleString()} earned
                        {g.totals.upcoming > 0 && <span className="text-blue-500"> · Rs {g.totals.upcoming.toLocaleString()} upcoming</span>}
                      </p>
                    </button>
                    <div className="text-right flex-shrink-0 w-24">
                      {g.totals.pending > 0
                        ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-lg"><Clock size={12} /> Rs {g.totals.pending.toLocaleString()}</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg"><CheckCircle2 size={12} /> Settled</span>}
                    </div>
                    <button onClick={() => setOpenRows((m) => ({ ...m, [g.referrer]: !m[g.referrer] }))} className="flex-shrink-0">
                      <ChevronDown size={16} className={`text-navy-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-navy-50 bg-navy-50/30 px-4 py-4 space-y-5">
                      {/* Section 1 — referral records with period switch */}
                      <div>
                        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                          <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide">Referral records</p>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-navy-400">{periodRecs.length} record{periodRecs.length !== 1 ? 's' : ''} · Rs {periodTot.earned.toLocaleString()}</span>
                            <PeriodSwitch value={period} onChange={(p) => setPeriodByKey((m) => ({ ...m, [g.referrer]: p }))} />
                          </div>
                        </div>
                        <RecordsTable records={periodRecs} action="settle" onToggle={markReferralPaid} vehicleLabel={vehicleLabel} leadColumn="payer" />
                      </div>

                      {/* Section 2 — unreceived income, grouped by paying owner */}
                      <div>
                        <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide mb-2">Unreceived income · by owner</p>
                        {g.pendingByOwner.length === 0 ? (
                          <p className="text-xs text-navy-400 py-2">All settled — nothing outstanding for {g.referrer}.</p>
                        ) : (
                          <div className="space-y-2">
                            {g.pendingByOwner.map((p) => {
                              const key = `${p.ownerId}:${g.referrer}`;
                              return (
                                <div key={p.ownerId} className="flex items-center gap-3 bg-white border border-navy-100 rounded-xl px-3 py-2.5">
                                  <div className="w-8 h-8 rounded-lg bg-navy-100 flex items-center justify-center text-navy-600 text-[10px] font-bold flex-shrink-0">
                                    {p.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-navy-800 truncate">{p.name}</p>
                                    <p className="text-[11px] text-navy-400">{p.count} booking{p.count !== 1 ? 's' : ''} unsettled</p>
                                  </div>
                                  <span className="text-sm font-bold text-amber-700 flex-shrink-0">Rs {p.amount.toLocaleString()}</span>
                                  <button
                                    onClick={() => alertOwner(p.ownerId, p.name, g.referrer, p.amount, p.count)}
                                    disabled={alerted[key]}
                                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-navy-700 hover:bg-navy-800 disabled:bg-emerald-500 disabled:cursor-default px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                                  >
                                    {alerted[key] ? <><CheckCircle2 size={13} /> Alerted</> : <><BellRing size={13} /> Alert to settle</>}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Owner: My Referral Profile ───────────────────────────────── */

function OwnerReferralProfile() {
  const { bookings, vehicles, owners, markReferralPaid } = useStore();
  const { currentUser } = useAuthStore();
  const myOwnerId = currentUser?.ownerId ?? '';
  const myName = owners.find((o) => o.id === myOwnerId)?.name ?? currentUser?.name ?? 'Me';

  const [refPeriod, setRefPeriod] = useState<Period>('all');
  const [owePeriod, setOwePeriod] = useState<Period>('all');

  const records = useMemo(() => buildReferralRecords(bookings, vehicles, owners), [bookings, vehicles, owners]);
  const referredByMe = useMemo(() => records.filter((r) => r.referrerOwnerId === myOwnerId || r.referrer.trim().toLowerCase() === myName.trim().toLowerCase()), [records, myOwnerId, myName]);
  const iOwe         = useMemo(() => records.filter((r) => r.payerOwnerId === myOwnerId), [records, myOwnerId]);

  const earnedTot = totalsOf(referredByMe);
  const oweTot    = totalsOf(iOwe);

  const vehicleLabel = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.brand} ${v.model} · ${v.vehicleNumber}` : '—';
  };

  const refWin = periodWindow(refPeriod);
  const oweWin = periodWindow(owePeriod);
  const refRecs = referredByMe.filter((r) => inPeriod(r, refWin)).sort((a, b) => (a.booking.startDate < b.booking.startDate ? 1 : -1));
  const oweRecs = iOwe.filter((r) => inPeriod(r, oweWin)).sort((a, b) => (a.booking.startDate < b.booking.startDate ? 1 : -1));

  const settleAllOwed = () => iOwe.filter((r) => r.payable && !r.paid).forEach((r) => markReferralPaid(r.booking.id, true));

  return (
    <div>
      <Header title="My Referral Profile" subtitle={`${myName} · referrals you brought and fees you owe`} />

      {oweTot.pending > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center text-white flex-shrink-0"><Wallet size={18} /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">You owe Rs {oweTot.pending.toLocaleString()} in referral fees</p>
            <p className="text-xs text-amber-700 mt-0.5">For rentals on your vehicles. Settle them with the referrers below.</p>
          </div>
          <button onClick={settleAllOwed} className="btn-primary text-xs !px-3 !py-1.5 flex-shrink-0 self-center">Settle all</button>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi label="I Referred — Earned" value={earnedTot.earned}  icon={ArrowUpRight}  color="bg-emerald-500" note="business you brought" />
        <Kpi label="Received"            value={earnedTot.paid}    icon={CheckCircle2}  color="bg-navy-700"    note="paid to you" />
        <Kpi label="Awaiting"            value={earnedTot.pending} icon={Clock}         color="bg-navy-700"    note="owed to you by owners" />
        <Kpi label="I Owe — Pending"     value={oweTot.pending}    icon={ArrowDownLeft} color="bg-amber-500"   note="to pay referrers" />
      </div>

      {/* Business I referred */}
      <div className="card mb-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <p className="section-title">Business I Referred</p>
            <p className="text-xs text-navy-400 mt-0.5">Customers you brought onto other owners' vehicles · {refRecs.length} record{refRecs.length !== 1 ? 's' : ''}</p>
          </div>
          <PeriodSwitch value={refPeriod} onChange={setRefPeriod} />
        </div>
        <RecordsTable records={refRecs} action="receive" vehicleLabel={vehicleLabel} leadColumn="payer" />
      </div>

      {/* Referral fees I owe */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <p className="section-title">Referral Fees I Owe</p>
            <p className="text-xs text-navy-400 mt-0.5">Referrers who brought customers to your vehicles · {oweRecs.length} record{oweRecs.length !== 1 ? 's' : ''}</p>
          </div>
          <PeriodSwitch value={owePeriod} onChange={setOwePeriod} />
        </div>
        <RecordsTable records={oweRecs} action="settle" onToggle={markReferralPaid} vehicleLabel={vehicleLabel} leadColumn="referrer" />
      </div>
    </div>
  );
}
