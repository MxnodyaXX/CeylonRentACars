import { useMemo, useState } from 'react';
import { ArrowLeftRight, Car, ChevronDown, Receipt, RotateCcw, Search, ShieldCheck, Undo2, UserRound, Wallet } from 'lucide-react';
import { bookingNo } from '../../lib/bookingRecord';
import { bookingBill, bookingDue } from '../../lib/credit';
import type { Books, LedgerEntry } from '../../lib/ledger';
import type { Booking } from '../../types';

/*
 * "Money in our accounts", booking by booking: everything that came in (or went back) for one booking together —
 * advance, deposit, part payments, the final payment, the deposit used for the bill, refunds — in date order.
 * Money not tied to a booking (owner payouts, expenses, transfers) is listed on its own.
 */

const rs = (n: number) => `Rs ${Math.abs(Math.round(n)).toLocaleString('en-LK')}`;
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

type Kind = 'advance' | 'deposit' | 'part' | 'final' | 'full' | 'depositBill' | 'depositKept' | 'refund' | 'depositBack';
const KIND: Record<Kind, { label: string; tone: string; icon: typeof Wallet }> = {
  advance:     { label: 'Advance',                 tone: 'bg-violet-50 text-violet-700',   icon: Wallet },
  deposit:     { label: 'Deposit',                 tone: 'bg-sky-50 text-sky-700',         icon: ShieldCheck },
  part:        { label: 'Part payment',            tone: 'bg-emerald-50 text-emerald-700', icon: Wallet },
  final:       { label: 'Final payment',           tone: 'bg-emerald-100 text-emerald-800', icon: Wallet },
  full:        { label: 'Full payment',            tone: 'bg-emerald-100 text-emerald-800', icon: Wallet },
  depositBill: { label: 'Deposit used for the bill', tone: 'bg-sky-50 text-sky-700',       icon: ShieldCheck },
  depositKept: { label: 'Deposit kept',            tone: 'bg-amber-50 text-amber-700',     icon: ShieldCheck },
  refund:      { label: 'Refund',                  tone: 'bg-rose-50 text-rose-700',       icon: Undo2 },
  depositBack: { label: 'Deposit returned',        tone: 'bg-rose-50 text-rose-700',       icon: RotateCcw },
};
const OTHER: Record<string, { label: string; icon: typeof Wallet }> = {
  owner_payout: { label: 'Owner payout', icon: UserRound },
  company_expense: { label: 'Company expense', icon: Receipt },
  vehicle_expense: { label: 'Vehicle expense', icon: Car },
  transfer: { label: 'Transfer', icon: ArrowLeftRight },
};

/** what one entry is, for its booking */
function kindOf(e: LedgerEntry): Kind {
  if (e.kind === 'deposit_in') return 'deposit';
  if (e.kind === 'deposit_out') return 'depositBack';
  if (e.kind === 'refund') return 'refund';
  if (/^Deposit used for the bill/.test(e.label)) return 'depositBill';
  if (/^Deposit kept/.test(e.label)) return 'depositKept';
  if (/^Advance/.test(e.label)) return 'advance';
  return 'part';
}

export default function MoneyByBooking({ entries, books, onOpen }: { entries: LedgerEntry[]; books: Books; onOpen: (bookingId: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, LedgerEntry[]>();
    entries.filter((e) => e.bookingId).forEach((e) => m.set(e.bookingId!, [...(m.get(e.bookingId!) ?? []), e]));
    return [...m.entries()].map(([id, list]) => {
      const b = books.bookings.find((x) => x.id === id);
      const sorted = [...list].sort((a, c) => a.date.localeCompare(c.date) || a.id.localeCompare(c.id));
      const kinds = sorted.map((e) => ({ e, k: kindOf(e) }));
      // the last ordinary payment on a fully-paid trip is its final payment (or the full payment, when it's the only money)
      const plain = kinds.filter((x) => x.k === 'part');
      if (b && b.status === 'Completed' && bookingDue(b) <= 0 && plain.length) {
        const last = plain[plain.length - 1];
        last.k = kinds.length === 1 ? 'full' : 'final';
      }
      const net = sorted.reduce((s, e) => s + e.amount, 0);
      const last = sorted[sorted.length - 1]?.date ?? '';
      return { id, b, rows: kinds, net, last };
    }).sort((a, c) => c.last.localeCompare(a.last));
  }, [entries, books.bookings]);
  const others = entries.filter((e) => !e.bookingId);

  const term = q.trim().toLowerCase();
  const shown = groups.filter((g) => !term || [g.b?.customerName, g.b ? bookingNo(g.b) : '', g.b?.customerPhone].filter(Boolean).join(' ').toLowerCase().includes(term));
  const visible = showAll || term ? shown : shown.slice(0, 25);

  // the totals by kind, across every booking
  const totals = useMemo(() => {
    const t = new Map<Kind, number>();
    groups.forEach((g) => g.rows.forEach(({ e, k }) => t.set(k, (t.get(k) ?? 0) + e.amount)));
    return t;
  }, [groups]);
  const sumOf = (...ks: Kind[]) => ks.reduce((s, k) => s + (totals.get(k) ?? 0), 0);
  const car = (b?: Booking) => { const v = books.vehicles.find((x) => x.id === b?.vehicleId); return v ? `${v.model} ${v.vehicleNumber}` : ''; };

  return (
    <div className="mt-4 space-y-3">
      {/* the money from bookings, in four plain figures */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ['Advances', sumOf('advance'), 'bg-violet-50 text-violet-800'],
          ['Rent payments', sumOf('part', 'final', 'full', 'depositBill', 'depositKept'), 'bg-emerald-50 text-emerald-800'],
          ['Deposits still with us', sumOf('deposit', 'depositBack'), 'bg-sky-50 text-sky-800'],
          ['Refunded', sumOf('refund'), 'bg-rose-50 text-rose-700'],
        ].map(([k, v, c]) => (
          <div key={k as string} className={`rounded-xl px-3 py-2 ${c}`}>
            <p className="text-[11px] opacity-75">{k}</p><p className="text-sm font-bold tabular-nums">{(v as number) < 0 ? '− ' : ''}{rs(v as number)}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">From bookings · {groups.length}</p>
        <label className="relative w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-300" />
          <input className="input !py-1 !pl-7 text-xs" placeholder="Customer or booking no." value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="space-y-1.5">
        {visible.map((g) => {
          const isOpen = open === g.id;
          const counts = new Map<Kind, number>();
          g.rows.forEach(({ k }) => counts.set(k, (counts.get(k) ?? 0) + 1));
          const due = g.b ? bookingDue(g.b) : 0;
          return (
            <div key={g.id} className={`rounded-xl border transition-colors ${isOpen ? 'border-navy-300 bg-white shadow-sm' : 'border-navy-100 bg-white hover:border-navy-200'}`}>
              <button type="button" onClick={() => setOpen(isOpen ? null : g.id)} aria-expanded={isOpen}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5">
                <span className="w-8 h-8 rounded-full bg-navy-900 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                  {(g.b?.customerName ?? '?').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-navy-900 truncate"><b>{g.b?.customerName ?? 'Booking removed'}</b> <span className="text-navy-400">· {g.b ? bookingNo(g.b) : ''}{car(g.b) ? ` · ${car(g.b)}` : ''}</span></span>
                  <span className="flex flex-wrap gap-1 mt-1">
                    {[...counts.entries()].map(([k, n]) => (
                      <span key={k} className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${KIND[k].tone}`}>{n > 1 ? `${n} × ` : ''}{KIND[k].label}</span>
                    ))}
                    {g.b && <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${due > 0 ? 'bg-red-50 text-red-600' : 'bg-navy-50 text-navy-500'}`}>{due > 0 ? `${rs(due)} still due` : 'paid in full'}</span>}
                  </span>
                </span>
                <span className="text-right flex-shrink-0">
                  <span className={`block text-sm font-bold tabular-nums ${g.net < 0 ? 'text-rose-600' : 'text-navy-900'}`}>{g.net < 0 ? '− ' : ''}{rs(g.net)}</span>
                  <span className="block text-[10px] text-navy-400">{g.rows.length} entr{g.rows.length === 1 ? 'y' : 'ies'} · last {fmtDay(g.last)}</span>
                </span>
                <ChevronDown size={15} className={`flex-shrink-0 text-navy-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="px-3 pb-3">
                  <div className="relative pl-5 border-l-2 border-navy-100 ml-4 space-y-2">
                    {g.rows.map(({ e, k }) => {
                      const K = KIND[k]; const I = K.icon;
                      return (
                        <div key={e.id} className="relative">
                          <span className={`absolute -left-[27px] top-1 w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-white ${K.tone}`}><I size={9} /></span>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm"><span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${K.tone}`}>{K.label}</span>
                                <span className="text-xs text-navy-500 ml-2">{fmtDay(e.date)}{e.method ? ` · ${e.method}` : ''}{e.ref ? ` · ${e.ref}` : ''}</span></p>
                              {k === 'depositBill' && <p className="text-[11px] text-navy-400 mt-0.5">The deposit taken on this day paid the bill — counted once, as rent.</p>}
                            </div>
                            <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${e.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{e.amount < 0 ? '− ' : '+ '}{rs(e.amount)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-navy-50/70 px-3 py-2 text-xs">
                    <span className="text-navy-600">{g.b ? <>Bill <b>{rs(bookingBill(g.b))}</b> · {g.b.status}</> : null}</span>
                    <span className="font-semibold text-navy-900">With the company from this booking: {g.net < 0 ? '− ' : ''}{rs(g.net)}</span>
                    <button type="button" onClick={() => onOpen(g.id)} className="text-navy-600 hover:text-navy-900 underline">Open the booking</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && <p className="text-sm text-navy-400 py-3 text-center">{term ? 'No booking matches.' : 'No money from bookings yet.'}</p>}
        {!showAll && !term && shown.length > 25 && (
          <button type="button" onClick={() => setShowAll(true)} className="w-full text-xs text-navy-500 underline py-1.5">Show all {shown.length} bookings</button>
        )}
      </div>

      {others.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-400 mb-1.5">Not tied to a booking · {others.length}</p>
          <div className="rounded-xl border border-navy-100 divide-y divide-navy-50 bg-white">
            {others.sort((a, c) => c.date.localeCompare(a.date)).map((e) => {
              const O = OTHER[e.kind] ?? { label: e.kind, icon: Wallet }; const I = O.icon;
              return (
                <div key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-7 h-7 rounded-lg bg-navy-50 text-navy-600 flex items-center justify-center flex-shrink-0"><I size={13} /></span>
                  <span className="flex-1 min-w-0"><span className="block text-navy-900 truncate">{e.label}</span>
                    <span className="block text-[11px] text-navy-400 truncate">{O.label} · {fmtDay(e.date)}{e.detail ? ` · ${e.detail}` : ''}</span></span>
                  <span className={`font-semibold tabular-nums whitespace-nowrap ${e.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{e.amount < 0 ? '− ' : '+ '}{rs(e.amount)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
