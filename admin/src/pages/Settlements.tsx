import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileText, Loader2, Send, Undo2, Wallet } from 'lucide-react';
import ApplyCommission from '../components/ui/ApplyCommission';
import BookingDetailsModal from '../components/ui/BookingDetailsModal';
import CompanyShareSettings from '../components/ui/CompanyShareSettings';
import Header from '../components/layout/Header';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from '../store/useToast';
import { rs } from '../lib/bookingRecord';
import { sendSms } from '../lib/sms';
import { printSettlement } from '../lib/printSettlement';
import { useCompanyFinance } from '../lib/companyFinance';
import {
  STATUS_INFO, dueMonth, leftOutOf, linesFor, payoutDate, periodLabel, shiftPeriod, totalsOf, useSettlements,
} from '../lib/settlements';
import type { Owner, OwnerSettlement, SettlementLine } from '../types';

/*
 * Finance → Owner Settlements. Once a month the company pays each owner for the rentals completed
 * that month. Finance prepares → Brian approves → Finance records the transfer → the owner confirms.
 * Every line behind each figure is shown, and the approved lines are exactly the ones paid.
 */

const KIND = {
  rental:    { label: 'Rentals',                         cls: 'text-navy-800' },
  referral:  { label: 'Referral fees earned',            cls: 'text-navy-800' },
  deduction: { label: 'Owed back',                       cls: 'text-red-600' },
  expense:   { label: 'Expenses the company paid',       cls: 'text-red-600' },
} as const;
const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const money = (n: number) => (n < 0 ? `− ${rs(-n)}` : rs(n));

function Lines({ lines, onClear, onOpen }: { lines: SettlementLine[]; onClear?: (l: SettlementLine) => void; onOpen?: (bookingId: string) => void }) {
  if (!lines.length) return <p className="text-sm text-navy-400">Nothing for this month.</p>;
  return (
    <div className="space-y-3">
      {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => {
        const ls = lines.filter((l) => l.kind === k);
        if (!ls.length) return null;
        return (
          <div key={k}>
            <p className="text-[11px] font-semibold text-navy-400 uppercase tracking-wide mb-1">{KIND[k].label} · {money(ls.reduce((s, l) => s + l.amount, 0))}</p>
            <div className="rounded-xl border border-navy-100 divide-y divide-navy-50">
              {ls.map((l) => (
                <div key={l.kind + l.id} role={l.bookingId && onOpen ? 'button' : undefined} tabIndex={l.bookingId && onOpen ? 0 : undefined}
                     title={l.bookingId && onOpen ? 'Open the booking — payments first' : undefined}
                     onClick={() => { if (l.bookingId && onOpen) onOpen(l.bookingId); }}
                     onKeyDown={(e) => { if (l.bookingId && onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(l.bookingId); } }}
                     className={`flex items-start gap-3 px-3 py-2 text-sm ${l.bookingId && onOpen ? 'cursor-pointer hover:bg-navy-50/70' : ''}`}>
                  <span className="w-20 flex-shrink-0 text-xs text-navy-400 pt-0.5">{fmtDay(l.date)}{l.carriedOver && <span className="block text-amber-600">earlier month</span>}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-navy-800 truncate">{l.label}{l.bookingId && onOpen && <span className="ml-1.5 text-[11px] text-navy-400 underline">view payments</span>}</span>
                    {l.detail && <span className="block text-xs text-navy-400">{l.detail}</span>}
                  </span>
                  <span className="text-right"><span className={`block font-semibold whitespace-nowrap ${l.amount < 0 ? 'text-red-600' : KIND[k].cls}`}>{money(l.amount)}</span>
                    {onClear && l.kind === 'deduction' && <button type="button" onClick={(e) => { e.stopPropagation(); onClear(l); }} title="The owner already bore this — don't take it from their payout" className="mt-1 text-[11px] font-semibold text-navy-500 hover:text-red-700 underline">Not owed</button>}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Totals({ t }: { t: ReturnType<typeof totalsOf> }) {
  return (
    <div className="rounded-xl bg-navy-50/70 px-4 py-3 text-sm space-y-1 sm:w-80 sm:ml-auto">
      <p className="flex justify-between"><span className="text-navy-500">Their share of rentals</span><span>{rs(t.rentals)}</span></p>
      {t.referralFees !== 0 && <p className="flex justify-between"><span className="text-navy-500">Referral fees</span><span>{rs(t.referralFees)}</span></p>}
      {t.deductions !== 0 && <p className="flex justify-between"><span className="text-navy-500">Owed back</span><span className="text-red-600">{money(t.deductions)}</span></p>}
      {t.expenses !== 0 && <p className="flex justify-between"><span className="text-navy-500">Expenses on their cars</span><span className="text-red-600">− {rs(t.expenses)}</span></p>}
      <p className="flex justify-between font-bold text-navy-900 border-t border-navy-200 pt-1.5 mt-1"><span>{t.net >= 0 ? 'Net to pay' : 'Owner owes the company'}</span><span>{rs(Math.abs(t.net))}</span></p>
    </div>
  );
}

function PayForm({ s, owner, onDone }: { s: OwnerSettlement; owner?: Owner; onDone: () => void }) {
  const pay = useSettlements((x) => x.pay);
  const [method, setMethod] = useState('Bank transfer');
  const [ref, setRef] = useState('');
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const fin = useCompanyFinance();
  useEffect(() => { if (!fin.loaded) fin.refresh(); }, [fin.loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const [acc, setAcc] = useState('');
  const account = acc || fin.settings.methodAccounts[method] || '';
  const save = async () => {
    if (s.net > 0 && !ref.trim()) { toast.error('Reference needed', 'Enter the bank transfer or receipt reference.'); return; }
    setBusy(true);
    try {
      await pay(s.id, { method, ref: ref.trim(), paidAt: new Date(`${on}T12:00:00`).toISOString() });
      if (account) await fin.setPayoutAccount(s.id, account).catch(() => undefined);
      toast.success('Payout recorded', `${owner?.name ?? 'Owner'} — ${rs(s.net)}`);
      if (owner?.phone && s.net > 0) {
        sendSms(owner.phone, `Ceylon Rent A Cars: your ${periodLabel(s.period)} payout of ${rs(s.net)} was sent (${method}${ref.trim() ? `, ref ${ref.trim()}` : ''}). The statement is in your login — please tap "Confirm received".`,
          { category: 'ownerPayout', role: 'owner', relatedId: owner.id, optIn: owner.smsOptIn, transactional: true });
      }
      onDone();
    } catch (e) { toast.error('Not recorded', (e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 grid gap-2 sm:grid-cols-[10rem_1fr_9rem_auto] items-end">
      <label className="text-xs text-navy-500">Paid by
        <select className="input !py-1.5 mt-1" value={method} onChange={(e) => setMethod(e.target.value)}>
          {['Bank transfer', 'Cash', 'Cheque', 'Online'].map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label className="text-xs text-navy-500">Transfer / receipt reference{s.net > 0 ? ' *' : ''}
        <input className="input !py-1.5 mt-1" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. BOC 00123456" />
      </label>
      <label className="text-xs text-navy-500">Date paid
        <input className="input !py-1.5 mt-1" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      </label>
      {fin.accounts.length > 0 && (
        <label className="text-xs text-navy-500 sm:col-span-3">From account
          <select className="input !py-1.5 mt-1" value={account} onChange={(e) => setAcc(e.target.value)}>
            <option value="">Not set</option>{fin.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <button type="button" onClick={save} disabled={busy} className="btn-primary !py-2 inline-flex items-center gap-1.5 disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />} Record payment
      </button>
    </div>
  );
}

export default function Settlements() {
  const { bookings, commissions, expenses, vehicles, owners, reopenPayout, updateSwapPayout } = useStore();
  const { isAdmin, currentUser, can } = useAuthStore();
  const { list, loaded, payoutDay, from, refresh, prepare, withdraw, review, setPayoutDay } = useSettlements();
  const admin = isAdmin();
  const mayPrepare = admin || (currentUser?.role === 'staff' && can('canViewFinance'));
  const [period, setPeriod] = useState(dueMonth());
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { refresh(); }, [refresh]);

  const rows = useMemo(() => {
    const data = { bookings, commissions, expenses, vehicles, owners };
    return owners.map((o) => {
      const s = list.find((x) => x.ownerId === o.id && x.period === period);
      const live = linesFor(o.id, period, data, from);
      // what is shown: the prepared lines once sent (exactly what is approved and paid), else today's
      const lines = s && s.status !== 'returned' ? s.lines : live;
      const newSince = s && ['pending_approval', 'approved'].includes(s.status)
        ? live.filter((l) => !s.lines.some((x) => x.kind === l.kind && x.id === l.id)).length : 0;
      return { owner: o, s, lines, live, t: totalsOf(lines), newSince };
    }).filter((r) => r.s || r.live.length).sort((a, b) => b.t.net - a.t.net);
  }, [owners, list, period, bookings, commissions, expenses, vehicles, from]);
  const leftOut = useMemo(() => leftOutOf(period, { bookings, commissions, expenses, vehicles, owners }, from),
    [period, bookings, commissions, expenses, vehicles, owners, from]);
  const before = `${period}-31` < from;
  const fromLabel = new Date(`${from}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const due = payoutDate(period, payoutDay);
  const unpaid = rows.filter((r) => !r.s || !['paid', 'confirmed'].includes(r.s.status));
  const overdue = new Date() >= due && unpaid.length > 0;
  const sum = (f: (r: typeof rows[0]) => boolean) => rows.filter(f).reduce((s, r) => s + r.t.net, 0);

  const run = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key);
    try { await fn(); toast.success(done); } catch (e) { toast.error('Not saved', (e as Error).message); }
    setBusy(null);
  };
  const pending = rows.filter((r) => r.s?.status === 'pending_approval');
  // a payout line opens its booking — on the Payments tab (the full record and history are in the other tabs)
  const [viewing, setViewing] = useState<string | null>(null);
  const navigate = useNavigate();
  // an owed-back line the owner already bore (paid it themselves / it was already taken off) — set to 0, kept for the record
  const clearOwed = (l: SettlementLine, ownerName: string) => {
    if (!confirm(`Remove this from ${ownerName}'s payout?

${l.label}
${money(l.amount)}

Use this when the owner already bore it. The line stays on record at Rs 0.`)) return;
    const by = currentUser?.name ?? 'Admin';
    const e = updateSwapPayout(l.id, 0, `${l.label} — not owed: the owner already bore it (removed by ${by}, was ${money(l.amount)})`);
    if (e) toast.error('Not removed', e); else toast.success('Removed from the payout', `${money(l.amount)} is no longer taken from ${ownerName}.`);
  };

  return (
    <div>
      {viewing && <BookingDetailsModal bookingId={viewing} startTab="payments" onClose={() => setViewing(null)}
        onEdit={(b) => navigate(`/bookings/${b.id}`)} onCancel={(b) => navigate(`/bookings/${b.id}`)} />}
      <Header title="Owner Settlements" subtitle="Each month's payouts to vehicle owners — prepared by Finance, approved by Brian, confirmed by the owner" />

      <CompanyShareSettings />
      <ApplyCommission />

      {/* month + payout day */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-white rounded-xl shadow-card p-1">
          <button type="button" onClick={() => setPeriod((p) => shiftPeriod(p, -1))} className="w-8 h-8 rounded-lg hover:bg-navy-50 flex items-center justify-center" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <span className="px-2 text-sm font-semibold text-navy-800 min-w-[8.5rem] text-center">{periodLabel(period)}</span>
          <button type="button" onClick={() => setPeriod((p) => shiftPeriod(p, 1))} className="w-8 h-8 rounded-lg hover:bg-navy-50 flex items-center justify-center" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
        <span className="text-sm text-navy-500 flex items-center gap-1.5"><CalendarClock size={15} /> Payout day: {due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        {admin && (
          <label className="text-xs text-navy-500 flex items-center gap-1.5 ml-auto">Pay owners on day
            <input className="input !py-1 !w-16 text-center" type="number" min={1} max={28} value={payoutDay}
                   onChange={(e) => setPayoutDay(Number(e.target.value) || 5).catch((x) => toast.error('Not saved', (x as Error).message))} />
            of each month
          </label>
        )}
      </div>

      <p className="text-xs text-navy-400 -mt-2 mb-4">Owner payouts include rentals completed from <b>{fromLabel}</b>. Earlier trips were settled before this system.</p>
      {/* the next payout is building up: this month's completed trips are paid on the payout day of next month */}
      {(() => {
        const next = shiftPeriod(dueMonth(), 1);
        if (period !== dueMonth()) return null;
        const data = { bookings, commissions, expenses, vehicles, owners };
        const lines = owners.flatMap((o) => linesFor(o.id, next, data, from).filter((l) => l.date >= `${next}-01` && l.kind !== 'expense'));
        if (!lines.length) return null;
        const due = payoutDate(next, payoutDay);
        return (
          <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[16rem]"><b>{lines.length} trip{lines.length === 1 ? '' : 's'} completed in {periodLabel(next)}</b> — owners' share {rs(lines.reduce((t, l) => t + l.amount, 0))} — will be paid on {due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.</span>
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setPeriod(next)}>See {periodLabel(next)} →</button>
          </div>
        );
      })()}
      {before && <div className="card text-center py-10 text-sm text-navy-400 mb-4">{periodLabel(period)} is before owner payouts started ({fromLabel}).</div>}

      {overdue && !before && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4 text-sm text-red-800 flex gap-2">
          <AlertTriangle size={17} className="flex-shrink-0 mt-0.5" />
          <span><b>{periodLabel(period)} payouts were due on {due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.</b> {unpaid.length} owner{unpaid.length === 1 ? ' is' : 's are'} not paid yet ({rs(unpaid.reduce((s, r) => s + Math.max(0, r.t.net), 0))}).</span>
        </div>
      )}

      {/* the month at a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          ['To pay this month', rs(sum((r) => r.t.net > 0))],
          ['Not prepared yet', ((n) => `${n} owner${n === 1 ? '' : 's'}`)(rows.filter((r) => !r.s || r.s.status === 'returned').length)],
          ['Waiting for approval', `${pending.length} · ${rs(sum((r) => r.s?.status === 'pending_approval'))}`],
          ['Paid', `${rows.filter((r) => r.s && ['paid', 'confirmed'].includes(r.s.status)).length} of ${rows.length} · ${rs(sum((r) => !!r.s && ['paid', 'confirmed'].includes(r.s.status)))}`],
        ].map(([k, v]) => (
          <div key={k} className="card !p-4"><p className="text-xs text-navy-400">{k}</p><p className="text-lg font-bold text-navy-900 mt-0.5">{v}</p></div>
        ))}
      </div>

      {admin && pending.length > 1 && (
        <div className="flex justify-end mb-3">
          <button type="button" disabled={!!busy}
                  onClick={() => { if (confirm(`Approve all ${pending.length} owner payouts waiting (${rs(pending.reduce((s, r) => s + r.t.net, 0))})?`)) run('all', async () => { for (const r of pending) await review(r.s!.id, true); }, 'All approved'); }}
                  className="btn-primary inline-flex items-center gap-1.5"><CheckCircle2 size={15} /> Approve all {pending.length}</button>
        </div>
      )}

      {!loaded && <p className="text-sm text-navy-400 py-8 text-center"><Loader2 size={16} className="inline animate-spin mr-2" />Loading…</p>}
      {loaded && rows.length === 0 && !before && <div className="card text-center py-14 text-sm text-navy-400">No completed rentals to pay for {periodLabel(period)}.</div>}

      <div className="space-y-3">
        {rows.map(({ owner, s, lines, live, t, newSince }) => {
          const st = STATUS_INFO[s?.status ?? 'not_prepared'];
          const isOpen = open === owner.id;
          const key = owner.id;
          return (
            <div key={owner.id} className="card !p-0 overflow-hidden">
              <button type="button" onClick={() => setOpen(isOpen ? null : owner.id)} aria-expanded={isOpen}
                      className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-navy-50/50">
                <div className="w-10 h-10 rounded-xl bg-navy-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{owner.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-navy-800 text-sm truncate">{owner.name}</p>
                  <p className="text-xs text-navy-400 truncate">
                    {lines.filter((l) => l.kind === 'rental').length} rental{lines.filter((l) => l.kind === 'rental').length === 1 ? '' : 's'}
                    {lines.some((l) => l.kind === 'expense') && ` · ${lines.filter((l) => l.kind === 'expense').length} expense${lines.filter((l) => l.kind === 'expense').length === 1 ? '' : 's'}`}
                    {lines.some((l) => l.carriedOver) && ' · includes earlier months'}
                  </p>
                </div>
                <span className={`hidden sm:inline rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                <span className={`text-sm font-bold w-28 text-right ${t.net < 0 ? 'text-red-600' : 'text-navy-900'}`}>{money(t.net)}</span>
                <ChevronDown size={18} className={`text-navy-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {isOpen && (
                <div className="px-5 pb-5 pt-4 border-t border-navy-100 space-y-4">
                  <span className={`sm:hidden inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                  {s?.status === 'returned' && s.reviewNote && (
                    <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800"><b>Sent back:</b> {s.reviewNote}</p>
                  )}
                  {newSince > 0 && (
                    <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                      {newSince} more line{newSince === 1 ? '' : 's'} came in after this was prepared. {s?.status === 'pending_approval' ? 'Brian can send it back so Finance prepares it again, or they' : 'They'} go into next month.
                    </p>
                  )}
                  <Lines lines={lines} onOpen={setViewing} onClear={mayPrepare && (!s || s.status === 'returned') ? (l) => clearOwed(l, owner.name) : undefined} />
                  {mayPrepare && s?.status === 'pending_approval' && lines.some((l) => l.kind === 'deduction') && <p className="text-xs text-navy-400">To remove an owed-back line, take this payout back first.</p>}
                  <Totals t={t} />

                  {/* history */}
                  {s && (
                    <div className="text-xs text-navy-500 space-y-0.5">
                      {s.preparedBy && <p>Prepared by {s.preparedBy} · {fmtDay(s.preparedAt)}</p>}
                      {s.approvedBy && <p>Approved by {s.approvedBy} · {fmtDay(s.approvedAt)}</p>}
                      {s.paidAt && <p>Paid {fmtDay(s.paidAt)} · {s.payMethod}{s.payRef ? ` · ref ${s.payRef}` : ''} · recorded by {s.paidBy}</p>}
                      {s.ownerConfirmedAt ? <p className="text-emerald-700 font-semibold">Owner confirmed receipt · {fmtDay(s.ownerConfirmedAt)}{s.ownerNote ? ` — “${s.ownerNote}”` : ''}</p>
                        : s.status === 'paid' && <p className="text-amber-700">Waiting for the owner to confirm in their login</p>}
                    </div>
                  )}

                  {/* actions for this step */}
                  <div className="flex flex-wrap gap-2 justify-end">
                    {s && ['paid', 'confirmed', 'approved', 'pending_approval'].includes(s.status) && (
                      <button type="button" onClick={() => { if (!printSettlement(s, owner)) toast.error('Statement not opened', 'Allow pop-ups for this site.'); }}
                              className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1.5"><FileText size={14} /> Statement</button>
                    )}
                    {mayPrepare && (!s || s.status === 'returned') && live.length > 0 && (
                      <button type="button" disabled={busy === key} onClick={() => run(key, () => prepare(owner.id, period, live), 'Sent to Brian for approval')}
                              className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5"><Send size={14} /> {s ? 'Prepare again' : 'Send for approval'}</button>
                    )}
                    {s?.status === 'pending_approval' && mayPrepare && !admin && (
                      <button type="button" disabled={busy === key} onClick={() => { if (confirm('Take this back to change it?')) run(key, () => withdraw(s.id), 'Taken back'); }}
                              className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1.5"><Undo2 size={14} /> Take back</button>
                    )}
                    {s?.status === 'pending_approval' && admin && (
                      <>
                        <button type="button" disabled={busy === key}
                                onClick={() => { const why = prompt('Why is it sent back? Finance sees this note.'); if (why?.trim()) run(key, () => review(s.id, false, why.trim()), 'Sent back to Finance'); }}
                                className="btn-secondary !py-1.5 text-sm">Send back</button>
                        <button type="button" disabled={busy === key} onClick={() => run(key, () => review(s.id, true), `${owner.name}'s payout approved`)}
                                className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5"><CheckCircle2 size={14} /> Approve {rs(s.net)}</button>
                      </>
                    )}
                    {s?.status === 'approved' && mayPrepare && paying !== s.id && (
                      <button type="button" onClick={() => setPaying(s.id)} className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5"><Wallet size={14} /> Record payment</button>
                    )}
                  </div>
                  {s?.status === 'approved' && paying === s.id && <PayForm s={s} owner={owner} onDone={() => setPaying(null)} />}
                  {s?.status === 'pending_approval' && !admin && <p className="text-xs text-navy-400 text-right">Waiting for Brian to approve.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {leftOut.length > 0 && (
        <div className="card mt-6">
          <p className="section-title">Not in these payouts · {leftOut.length}</p>
          <p className="text-xs text-navy-400 mb-3">Rentals of {periodLabel(period)} that aren't included above, and why. Fix them here so no owner is missed.</p>
          <div className="divide-y divide-navy-50">
            {leftOut.map((x) => {
              const v = vehicles.find((y) => y.id === x.booking.vehicleId);
              const o = owners.find((y) => y.id === x.ownerId);
              return (
                <div key={x.booking.id + x.reason} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="w-24 text-xs text-navy-400">{fmtDay(x.booking.endDate)}</span>
                  <span className="flex-1 min-w-[14rem]">
                    <Link to={`/bookings/${x.booking.id}`} className="font-medium text-navy-800 hover:underline">{x.booking.customerName}</Link>
                    <span className="text-navy-400"> · {v ? `${v.brand} ${v.model} ${v.vehicleNumber}` : 'Vehicle removed'} · {o?.name ?? 'no owner'}</span>
                    <span className={`block text-xs ${x.reason === 'paid-by-hand' ? 'text-amber-700' : 'text-red-600'}`}>
                      {x.reason === 'paid-by-hand' && `Owner payout ${rs(x.amount)} was marked as paid by hand, so it isn't paid again here.`}
                      {x.reason === 'not-completed' && `Still ${x.booking.status} in the system — complete the rental and it comes into the payouts.`}
                      {x.reason === 'no-payout-line' && "This booking has no owner payout line (it wasn't saved) — create it from the booking."}
                    </span>
                  </span>
                  {x.reason === 'no-payout-line' && mayPrepare && (
                    <button type="button" className="btn-secondary !py-1.5 text-xs"
                            onClick={() => { const e = useStore.getState().createPayoutLine(x.booking.id); if (e) toast.error('Not created', e); else toast.success('Payout line created', 'It now shows under the owner above.'); }}>
                      Create the payout line
                    </button>
                  )}
                  {x.reason === 'paid-by-hand' && mayPrepare && (
                    <button type="button" className="btn-secondary !py-1.5 text-xs"
                            onClick={() => { if (confirm(`Was ${o?.name ?? 'the owner'} NOT actually paid ${rs(x.amount)} for this? It will be included in the payout.`)) { x.payoutIds.forEach(reopenPayout); toast.success('Included', 'It now shows under the owner above.'); } }}>
                      Not paid yet — include
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
