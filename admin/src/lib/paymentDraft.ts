import type { Booking, PaymentEntry, PaymentKind } from '../types';
import { ledgerOf, legacyAdvance, newId } from './bookingRecord';
import { SHOP_PAID_METHOD } from './credit';

/*
 * The payment log, edited line by line in "Correct booking".
 * Each line can change type, date, amount, method and receipt; lines can be added or removed.
 * On save the log is rewritten and the booking's totals (Paid, Advance, Deposit, Deposit given back) are worked
 * out again from it, so the two can't disagree.
 *   - an undated line ("recorded before the payment log") stays undated until a date is entered — its amount
 *     still counts in the totals; with a date it becomes a normal entry
 *   - a payment taken from the deposit or paid at a repair shop is fixed here (it is tied to the deposit / a breakdown)
 */

export const PAY_KINDS: PaymentKind[] = ['Advance', 'Payment', 'Deposit received', 'Refund', 'Deposit returned'];
export const PAY_METHODS = ['Cash', 'Bank transfer', 'Card', 'Online'];

export interface DraftRow {
  key: string;
  kind: PaymentKind;
  /** yyyy-mm-dd, or '' for an undated (legacy) line */
  date: string;
  amount: number;
  method: string;
  receiptNo: string;
  /** the saved entry this line came from (none for an undated or a new line) */
  orig?: PaymentEntry;
  legacy: boolean;
  locked: boolean;
  removed?: boolean;
}

const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
const isLocked = (p: PaymentEntry) => p.method === 'Security deposit' || p.method === SHOP_PAID_METHOD;
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-US')}`;

/** The log as editable lines — undated money split into its advance and payment parts */
export function draftOf(b: Booking): DraftRow[] {
  return ledgerOf(b).flatMap((p): DraftRow[] => {
    const legacy = p.id.startsWith('legacy');
    const base = { kind: p.kind, date: legacy ? '' : localDay(p.at), amount: p.amount, method: p.method && p.method !== '—' ? p.method : 'Cash', receiptNo: p.receiptNo ?? '', legacy, locked: !legacy && isLocked(p), orig: legacy ? undefined : p };
    if (p.id === 'legacy') {
      const adv = legacyAdvance(b);
      if (adv > 0 && adv < p.amount) return [{ ...base, key: 'legacy-adv', kind: 'Advance', amount: adv }, { ...base, key: 'legacy', kind: 'Payment', amount: p.amount - adv }];
    }
    return [{ ...base, key: p.id }];
  });
}

export const blankRow = (today = new Date().toLocaleDateString('en-CA')): DraftRow =>
  ({ key: 'new-' + newId(), kind: 'Payment', date: today, amount: 0, method: 'Cash', receiptNo: '', legacy: false, locked: false });

/** Totals the booking keeps, from the lines (undated ones included) */
export function totalsOf(rows: DraftRow[]) {
  const live = rows.filter((r) => !r.removed);
  const sum = (k: PaymentKind) => live.filter((r) => r.kind === k).reduce((s, r) => s + r.amount, 0);
  return {
    paidAmount: sum('Payment') - sum('Refund'),
    advanceAmount: sum('Advance'),
    depositAmount: sum('Deposit received'),
    depositReturned: sum('Deposit returned'),
    /** bill payments only (what "paid" means on the bill) */
    paid: sum('Payment') - sum('Refund') + sum('Advance'),
  };
}

const sameRow = (a: DraftRow, b: DraftRow) =>
  a.kind === b.kind && a.date === b.date && a.amount === b.amount && a.method === b.method && a.receiptNo === b.receiptNo && !!a.removed === !!b.removed;

const desc = (r: Pick<DraftRow, 'kind' | 'amount' | 'date'>) => `${r.kind} ${rs(r.amount)}${r.date ? ` on ${r.date}` : ''}`;

/**
 * What saving the lines does to the booking: the new log, the totals, and a line per change for History.
 * Returns nothing to save when the lines are as they were.
 */
export function applyDraft(b: Booking, rows: DraftRow[], by: string): { updates?: Partial<Booking>; changes: string[]; error?: string } | null {
  const before = draftOf(b);
  const changes: string[] = [];
  for (const r of rows) {
    const was = before.find((x) => x.key === r.key);
    if (!was) { if (!r.removed) changes.push(`Payment log: added ${desc(r)} (${r.method})`); continue; }
    if (sameRow(was, r)) continue;
    if (r.removed) { changes.push(`Payment log: removed ${desc(was)}`); continue; }
    const what = [
      was.kind !== r.kind ? `${was.kind} → ${r.kind}` : '',
      was.amount !== r.amount ? `${rs(was.amount)} → ${rs(r.amount)}` : '',
      was.date !== r.date ? `date ${was.date || 'not recorded'} → ${r.date || 'not recorded'}` : '',
      was.method !== r.method ? `${was.method} → ${r.method}` : '',
      was.receiptNo !== r.receiptNo ? `receipt ${was.receiptNo || '—'} → ${r.receiptNo || '—'}` : '',
    ].filter(Boolean).join(', ');
    changes.push(`Payment log: ${was.kind} ${rs(was.amount)} — ${what}`);
  }
  if (!changes.length) return null;

  const live = rows.filter((r) => !r.removed);
  if (live.some((r) => !(r.amount > 0))) return { changes, error: 'Enter an amount on every payment line (or remove it).' };
  if (live.some((r) => !r.legacy && !r.date)) return { changes, error: 'Enter the date of every payment.' };
  const t = totalsOf(rows);
  if (t.paidAmount < 0) return { changes, error: 'The refunds are more than what was paid.' };
  if (t.depositAmount > 0 && b.depositType && b.depositType !== 'cash') return { changes, error: 'This booking holds a vehicle or an item as the deposit, not cash.' };
  if (t.depositAmount < t.depositReturned + (b.depositDeduction ?? 0))
    return { changes, error: 'More of the deposit is given back or used than was received.' };

  const at = (date: string) => new Date(`${date}T12:00:00`).toISOString();
  const payments: PaymentEntry[] = live.filter((r) => !(r.legacy && !r.date)).map((r) => {
    const was = before.find((x) => x.key === r.key);
    if (r.orig && was && sameRow(was, r)) return r.orig;
    const note = r.orig ? [r.orig.note, 'corrected in Correct booking'].filter(Boolean).join(' · ') : r.legacy ? 'Date added in Correct booking' : 'Added in Correct booking';
    return {
      ...(r.orig ?? {}),
      id: r.orig?.id ?? newId(), by: r.orig?.by ?? by,
      at: r.orig && was?.date === r.date ? r.orig.at : at(r.date),
      kind: r.kind, amount: Math.round(r.amount), method: r.method,
      ...(r.receiptNo.trim() ? { receiptNo: r.receiptNo.trim() } : { receiptNo: undefined }),
      note,
    };
  });
  return {
    changes,
    updates: {
      payments,
      paidAmount: t.paidAmount, advanceAmount: t.advanceAmount,
      depositAmount: t.depositAmount, depositReturned: t.depositReturned,
      ...(t.depositAmount > 0 && !b.depositType ? { depositType: 'cash' as const } : {}),
    },
  };
}
