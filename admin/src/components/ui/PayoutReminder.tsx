import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { rs } from '../../lib/bookingRecord';
import { dueMonth, linesFor, payoutDate, periodLabel, totalsOf, useSettlements } from '../../lib/settlements';

/** Dashboard reminder for Brian and Finance: owner payouts due soon / overdue, and approvals waiting */
export default function PayoutReminder() {
  const { isAdmin, currentUser, can } = useAuthStore();
  const finance = isAdmin() || (currentUser?.role === 'staff' && can('canViewFinance'));
  const { bookings, commissions, expenses, vehicles, owners } = useStore();
  const { list, payoutDay, from, refresh } = useSettlements();
  useEffect(() => { if (finance) refresh(); }, [finance, refresh]);

  const period = dueMonth();
  const due = payoutDate(period, payoutDay);
  const info = useMemo(() => {
    const data = { bookings, commissions, expenses, vehicles, owners };
    const rows = owners.map((o) => ({ s: list.find((x) => x.ownerId === o.id && x.period === period), t: totalsOf(linesFor(o.id, period, data, from)) }))
      .filter((r) => r.s || r.t.net !== 0);
    const unpaid = rows.filter((r) => !r.s || !['paid', 'confirmed'].includes(r.s.status));
    return { unpaid: unpaid.length, amount: unpaid.reduce((s, r) => s + Math.max(0, r.s?.net ?? r.t.net), 0), waiting: list.filter((s) => s.status === 'pending_approval').length };
  }, [owners, list, period, bookings, commissions, expenses, vehicles, from]);

  if (!finance) return null;
  const days = Math.ceil((due.getTime() - Date.now()) / 864e5);
  const showDue = info.unpaid > 0 && days <= 5;
  const showApprove = isAdmin() && info.waiting > 0;
  if (!showDue && !showApprove) return null;
  const overdue = days < 0;
  return (
    <Link to="/settlements" className={`mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors ${overdue ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100' : 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}>
      <CalendarClock size={18} className="flex-shrink-0" />
      <span className="flex-1">
        {showDue && <><b>Owner payouts for {periodLabel(period)}</b> {overdue ? `were due on ${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : days === 0 ? 'are due today' : `are due in ${days} day${days === 1 ? '' : 's'} (${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })})`} — {info.unpaid} owner{info.unpaid === 1 ? '' : 's'}, {rs(info.amount)} not paid yet.</>}
        {showDue && showApprove && ' '}
        {showApprove && <b>{info.waiting} payout{info.waiting === 1 ? '' : 's'} waiting for your approval.</b>}
      </span>
      <ChevronRight size={16} />
    </Link>
  );
}
