import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Wand2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import { bookingNo } from '../../lib/bookingRecord';
import { mainCommission } from '../../lib/exchange';
import { companyShareOf, shareBaseOf, shareWorking, useCompanyShare } from '../../lib/companyShare';
import { completedOn, useSettlements } from '../../lib/settlements';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

/*
 * Owner payouts → give the company's commission to bookings made before commissions existed:
 * confirmed and ongoing bookings, and those completed since owner payouts started that aren't paid.
 * Each one goes through the normal booking correction, so the payout line and the owners' totals
 * follow and the booking's history says what changed. Old referral fees can be removed at the same time.
 */
export default function ApplyCommission() {
  const { bookings, vehicles, commissions, editBooking, reopenPayout } = useStore();
  const admin = useAuthStore((s) => s.isAdmin());
  const by = useAuthStore((s) => s.currentUser?.name ?? 'Admin');
  const method = useCompanyShare((s) => s.method);
  const from = useSettlements((s) => s.from);
  const [open, setOpen] = useState(false);
  const [dropFees, setDropFees] = useState(true);
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const share = { companyShareType: method.type, companyShareValue: method.value, companyShareMin: method.type === 'percent_min' ? method.min : undefined };
  const rows = useMemo(() => bookings.filter((b) => {
    if (b.companyShareType || b.status === 'Cancelled' || b.exchanges?.length) return false;
    const c = mainCommission(commissions, b);
    if (!c || c.status === 'Paid' || c.settlementId) return false;            // already paid to the owner: leave it
    if (b.status === 'Completed') return completedOn(b) >= from;               // before owner payouts started: settled the old way
    return true;                                                               // confirmed / ongoing
  }).map((b) => {
    const c = mainCommission(commissions, b)!;
    const fee = dropFees ? 0 : b.referralFee ?? 0;
    const base = shareBaseOf(b);   // the final bill: rent + charges − discount
    const company = companyShareOf({ ...b, ...share }, base);
    const adj = (b.payoutAdjustments ?? []).filter((x) => !x.reversedAt).reduce((t, x) => t + x.amount, 0);
    return { b, before: c.ownerPayout, company, after: Math.max(0, base - fee - company - adj), feeRemoved: dropFees ? b.referralFee ?? 0 : 0 };
  }).sort((x, y) => x.b.startDate.localeCompare(y.b.startDate)), [bookings, commissions, from, dropFees, method]); // eslint-disable-line react-hooks/exhaustive-deps

  // bookings that would qualify but can't be changed here — shown with the reason, never hidden
  const skipped = useMemo(() => bookings.filter((b) => !b.companyShareType && b.status !== 'Cancelled'
      && (b.status !== 'Completed' || completedOn(b) >= from)).map((b) => {
    const c = mainCommission(commissions, b);
    const reason: 'exchanged' | 'no-line' | 'settled' | 'paid-by-hand' | null =
      b.exchanges?.length ? 'exchanged' : !c ? 'no-line' : c.settlementId ? 'settled' : c.status === 'Paid' ? 'paid-by-hand' : null;
    return reason ? { b, c, reason } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x), [bookings, commissions, from]);

  if (!admin || (rows.length === 0 && skipped.length === 0)) return null;
  const chosen = rows.filter((r) => !skip[r.b.id]);
  const total = chosen.reduce((s, r) => s + r.company, 0);

  const apply = () => {
    if (!confirm(`Add the company commission to ${chosen.length} booking${chosen.length === 1 ? '' : 's'} (${rs(total)} in total)? Each owner's payout goes down by their booking's commission.`)) return;
    setBusy(true);
    chosen.forEach((r) => {
      editBooking(r.b.id, { ...share, ...(r.feeRemoved ? { referralFee: 0 } : {}) }, {
        by, quiet: true, reason: 'Company commission added to an existing booking',
        changes: [`Company commission ${rs(r.company)} (${shareWorking({ ...r.b, ...share }, shareBaseOf(r.b))})`,
                  ...(r.feeRemoved ? [`Referral fee ${rs(r.feeRemoved)} removed — no referral fees`] : []),
                  `Owner payout ${rs(r.before)} → ${rs(r.after)}`],
      });
    });
    setBusy(false);
    setSkip({});
    toast.success('Commission added', `${chosen.length} booking${chosen.length === 1 ? '' : 's'} · company ${rs(total)}`);
  };

  return (
    <div className="card mb-5 border border-amber-200">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-3 text-left">
        <Wand2 size={18} className="text-amber-600 flex-shrink-0" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-navy-800">{rows.length + skipped.length} existing booking{rows.length + skipped.length === 1 ? ' has' : 's have'} no company commission{skipped.length ? ` · ${skipped.length} need a check first` : ''}</span>
          <span className="block text-xs text-navy-400">Confirmed, ongoing, and completed since owner payouts started — not paid to the owner yet. Add the company commission to them.</span>
        </span>
        <ChevronDown size={18} className={`text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-navy-500">Uses the company commission above: <b>{method.type === 'percent' ? `${method.value}% of the rental` : method.type === 'percent_min' ? `${method.value}% of the rental, at least ${rs(method.min ?? 0)} a day` : method.type === 'per_day' ? `${rs(method.value)} a day` : `${rs(method.value)} per trip`}</b>. Untick any booking that should stay without it.</p>
          <label className="text-xs text-navy-700 flex items-center gap-1.5">
            <input type="checkbox" checked={dropFees} onChange={(e) => setDropFees(e.target.checked)} /> Also remove old referral fees on these bookings (no referral fees are paid any more)
          </label>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-xs">
              <thead><tr className="text-navy-400 text-left">
                <th className="py-1.5 w-6" /><th>Booking</th><th>Car</th><th>Status</th>
                <th className="text-right">Rental</th><th className="text-right">Company</th><th className="text-right">Owner now → after</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const v = vehicles.find((x) => x.id === r.b.vehicleId);
                  return (
                    <tr key={r.b.id} className={`border-t border-navy-50 ${skip[r.b.id] ? 'opacity-40' : ''}`}>
                      <td className="py-1.5"><input type="checkbox" checked={!skip[r.b.id]} onChange={(e) => setSkip((s) => ({ ...s, [r.b.id]: !e.target.checked }))} /></td>
                      <td><Link to={`/bookings/${r.b.id}`} className="font-medium text-navy-800 hover:underline">{bookingNo(r.b)}</Link> <span className="text-navy-400">· {r.b.customerName}</span></td>
                      <td className="text-navy-600">{v ? `${v.brand} ${v.model} ${v.vehicleNumber}` : '—'}</td>
                      <td className="text-navy-600">{r.b.status}</td>
                      <td className="text-right">{rs(r.b.totalAmount)}</td>
                      <td className="text-right font-semibold text-navy-800">{rs(r.company)}{r.feeRemoved ? <span className="block font-normal text-navy-400">fee −{rs(r.feeRemoved)}</span> : null}</td>
                      <td className="text-right">{rs(r.before)} → <b>{rs(r.after)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {skipped.length > 0 && (
            <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3">
              <p className="text-xs font-semibold text-amber-900 mb-1.5">Not in the list above — {skipped.length} booking{skipped.length === 1 ? '' : 's'} to check</p>
              <div className="divide-y divide-amber-100">
                {skipped.map(({ b, c, reason }) => {
                  const v = vehicles.find((x) => x.id === b.vehicleId);
                  return (
                    <div key={b.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                      <span className="flex-1 min-w-[16rem]">
                        <Link to={`/bookings/${b.id}`} className="font-medium text-navy-800 hover:underline">{bookingNo(b)}</Link>
                        <span className="text-navy-500"> · {b.customerName} · {v ? `${v.brand} ${v.model} ${v.vehicleNumber}` : '—'} · {b.status}</span>
                        <span className="block text-amber-800">
                          {reason === 'paid-by-hand' && `Its owner payout (${rs(c!.ownerPayout)}) is marked as already paid — so it is left alone. If the owner hasn't actually been paid, include it.`}
                          {reason === 'settled' && 'Already paid to the owner in a monthly payout — left as it is.'}
                          {reason === 'no-line' && "It has no owner payout line (it wasn't saved) — create it first, then add the commission."}
                          {reason === 'exchanged' && 'The car was exchanged mid-trip — each car has its own part, so add the commission by hand on the payout lines.'}
                        </span>
                      </span>
                      {reason === 'no-line' && (
                        <button type="button" className="btn-secondary !py-1 text-xs"
                                onClick={() => { const e = useStore.getState().createPayoutLine(b.id); if (e) toast.error('Not created', e); else toast.success('Payout line created', 'It now shows in the list above.'); }}>
                          Create the payout line
                        </button>
                      )}
                      {reason === 'paid-by-hand' && (
                        <button type="button" className="btn-secondary !py-1 text-xs"
                                onClick={() => { if (confirm(`Has the owner NOT been paid ${rs(c!.ownerPayout)} for ${b.customerName}'s booking yet? It moves into the list above.`)) reopenPayout(c!.id); }}>
                          Not paid yet — include
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-navy-600">{chosen.length} booking{chosen.length === 1 ? '' : 's'} · company <b>{rs(total)}</b></span>
            <button type="button" disabled={!chosen.length || busy} onClick={apply} className="btn-primary disabled:opacity-40">Add commission</button>
          </div>
        </div>
      )}
    </div>
  );
}
