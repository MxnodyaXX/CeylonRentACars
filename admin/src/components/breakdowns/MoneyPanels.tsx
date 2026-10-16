import { useMemo, useState } from 'react';
import { Ban, Banknote, Plus, Receipt, Scale, Undo2, Upload } from 'lucide-react';
import { useBreakdownStore, newKey } from '../../store/useBreakdownStore';
import { BdExpense, EXPENSE_LABEL, ExpenseCategory, PARTY_LABEL, PAYMENT_LABEL, Party, PaymentKind } from '../../lib/breakdowns';
import { expensePaid, expenseStatus, ledgerFor, sharesProblem, resolveShares } from '../../lib/breakdownLedger';
import { uploadBookingFile, fileUrl } from '../../lib/bookingRecord';
import { toast } from '../../store/useToast';
import { Chips, ErrorLine, Field, Grid, KV, Pill, Section, rs, when } from './bdui';

const METHODS = ['Cash', 'Bank transfer', 'Card', 'Online', 'Cheque'];
const PARTIES: [Party, string][] = [['company', 'Company'], ['owner', 'Owner'], ['customer', 'Customer'], ['insurance', 'Insurance']];

async function uploadReceipt(bookingId: string, incidentId: string, file?: File | null) {
  if (!file) return undefined;
  // stored under the booking's private folder (only admins and the vehicle's owner can open it)
  void incidentId;
  try { return await uploadBookingFile(bookingId, file); }
  catch (e) { toast.error('Receipt not uploaded', (e as Error).message); return undefined; }
}
const openFile = async (path: string) => { try { window.open(await fileUrl(path), '_blank'); } catch (e) { toast.error('Could not open file', (e as Error).message); } };

/* ── Ledger summary ───────────────────────────────────────────────────────── */

export function LedgerSummary({ incidentId }: { incidentId: string }) {
  const d = useBreakdownStore();
  const l = ledgerFor(incidentId, d);
  const row = (p: Party) => (
    <tr key={p} className="border-t border-navy-50">
      <td className="py-1.5">{PARTY_LABEL[p]}</td>
      <td className="py-1.5 text-right">{rs(l.allocated[p])}</td>
      <td className="py-1.5 text-right">{rs(p === 'company' ? l.companyNet : l.contributed[p])}</td>
      <td className={`py-1.5 text-right font-semibold ${p !== 'company' && l.outstanding[p] > 0.5 ? 'text-amber-700' : p !== 'company' && l.outstanding[p] < -0.5 ? 'text-sky-700' : 'text-navy-500'}`}>
        {p === 'company' ? '—' : l.outstanding[p] > 0.5 ? `owes ${rs(l.outstanding[p])}` : l.outstanding[p] < -0.5 ? `owed ${rs(-l.outstanding[p])}` : 'settled'}
      </td>
    </tr>
  );
  return (
    <Section title="Money summary" icon={Scale} action={<Pill k={l.settled ? 'settled' : 'outstanding'}>{l.settled ? 'Settled' : 'Outstanding'}</Pill>}>
      <Grid cols={4}>
        <div className="rounded-xl bg-navy-50/60 p-3"><p className="text-[11px] text-navy-400 uppercase tracking-wide font-semibold">Total cost</p><p className="text-lg font-bold text-navy-900">{rs(l.cost)}</p></div>
        <div className="rounded-xl bg-navy-50/60 p-3"><p className="text-[11px] text-navy-400 uppercase tracking-wide font-semibold">Unpaid to providers</p><p className={`text-lg font-bold ${l.vendorUnpaid > 0.5 ? 'text-amber-700' : 'text-navy-900'}`}>{rs(l.vendorUnpaid)}</p></div>
        <div className="rounded-xl bg-navy-50/60 p-3"><p className="text-[11px] text-navy-400 uppercase tracking-wide font-semibold">Company spent (net)</p><p className="text-lg font-bold text-navy-900">{rs(l.companyNet)}</p></div>
        <div className="rounded-xl bg-navy-50/60 p-3"><p className="text-[11px] text-navy-400 uppercase tracking-wide font-semibold">Refunds paid</p><p className="text-lg font-bold text-navy-900">{rs(l.refundsPaid)}{l.refundPending > 0 && <span className="block text-xs text-amber-700 font-semibold">{rs(l.refundPending)} pending</span>}</p></div>
      </Grid>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead><tr className="text-[11px] uppercase tracking-wide text-navy-400"><th className="text-left py-1 font-semibold">Party</th><th className="text-right font-semibold">Responsible for</th><th className="text-right font-semibold">Put in</th><th className="text-right font-semibold">Balance</th></tr></thead>
          <tbody>{(['owner', 'customer', 'insurance', 'company'] as Party[]).map(row)}</tbody>
        </table>
      </div>
      {l.unallocated > 0.5 && <p className="text-xs text-amber-700">Responsibility for {rs(l.unallocated)} not decided yet — pending investigation (the company carries it until then).</p>}
      {!l.settled && <ul className="text-xs text-navy-500 list-disc pl-4 space-y-0.5">{l.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
    </Section>
  );
}

/* ── Expenses ─────────────────────────────────────────────────────────────── */

export function ExpenseEditor({ incidentId, bookingId, solutionId, by, defaultCategory = 'labour', categories, compact }: {
  incidentId: string; bookingId: string; solutionId?: string; by: string; defaultCategory?: ExpenseCategory; categories?: ExpenseCategory[]; compact?: boolean;
}) {
  const d = useBreakdownStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: defaultCategory, description: '', quantity: '1', unitCost: '', vendor: '', paid: false, payer: 'company' as Party, method: 'Cash', reference: '' });
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(newKey);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const list = d.expenses.filter((e) => e.incidentId === incidentId && (solutionId ? e.solutionId === solutionId : true));
  const cats = (categories ?? (Object.keys(EXPENSE_LABEL) as ExpenseCategory[])).map((c) => [c, EXPENSE_LABEL[c]] as [ExpenseCategory, string]);
  const total = (Number(f.quantity) || 0) * (Number(f.unitCost) || 0);

  const add = async () => {
    setErr(''); setBusy(true);
    const receiptPath = f.paid ? await uploadReceipt(bookingId, incidentId, file) : undefined;
    const e = d.addExpense({
      incidentId, solutionId, category: f.category, description: f.description, quantity: Number(f.quantity), unitCost: Number(f.unitCost),
      vendor: f.vendor, by, ...(f.paid ? { paidNow: { payer: f.payer, method: f.method, reference: f.reference, receiptPath, key } } : {}),
    });
    setBusy(false);
    if (e) { setErr(e); return; }
    setF((x) => ({ ...x, description: '', quantity: '1', unitCost: '', reference: '' })); setFile(null); setKey(newKey()); setOpen(false);
  };

  return (
    <div className="space-y-2">
      <ExpenseList expenses={list} incidentId={incidentId} bookingId={bookingId} by={by} compact={compact} />
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy-600 hover:text-navy-900"><Plus size={13} /> Add expense line</button>
      ) : (
        <div className="rounded-xl border border-navy-100 bg-navy-50/40 p-3 space-y-3">
          <Field label="Type"><Chips size="xs" value={f.category} options={cats} onChange={(c) => setF((x) => ({ ...x, category: c }))} /></Field>
          <Grid cols={4}>
            <Field label="Description *" className="sm:col-span-2"><input className="input" value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} placeholder="e.g. Alternator replaced" /></Field>
            <Field label="Quantity"><input className="input" type="number" min="0" step="0.5" value={f.quantity} onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value }))} /></Field>
            <Field label="Unit cost (Rs) *"><input className="input" type="number" min="0" value={f.unitCost} onChange={(e) => setF((x) => ({ ...x, unitCost: e.target.value }))} /></Field>
          </Grid>
          <Grid>
            <Field label="Vendor / paid to"><input className="input" value={f.vendor} onChange={(e) => setF((x) => ({ ...x, vendor: e.target.value }))} placeholder="Garage, technician, tow company…" /></Field>
            <div className="flex items-end text-sm text-navy-600 pb-2">Total: <b className="ml-1 text-navy-900">{rs(f.category === 'discount' ? -total : total)}</b></div>
          </Grid>
          <label className="flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" checked={f.paid} onChange={(e) => setF((x) => ({ ...x, paid: e.target.checked }))} /> Already paid</label>
          {f.paid && f.category !== 'discount' && (
            <Grid cols={4}>
              <Field label="Paid by"><select className="input" value={f.payer} onChange={(e) => setF((x) => ({ ...x, payer: e.target.value as Party }))}>{PARTIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Method"><select className="input" value={f.method} onChange={(e) => setF((x) => ({ ...x, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Reference"><input className="input" value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} placeholder="Receipt / transfer no." /></Field>
              <Field label="Receipt"><input className="input !py-1.5 text-xs" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
            </Grid>
          )}
          <ErrorLine msg={err} />
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary !py-1.5 text-sm" disabled={busy} onClick={add}>Add expense</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ExpenseList({ expenses, incidentId, bookingId, by, compact }: { expenses: BdExpense[]; incidentId: string; bookingId: string; by: string; compact?: boolean }) {
  const d = useBreakdownStore();
  const [payFor, setPayFor] = useState<string | null>(null);
  if (!expenses.length) return <p className="text-xs text-navy-400">No expenses yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[560px]">
        <thead><tr className="text-[11px] uppercase tracking-wide text-navy-400"><th className="text-left py-1 font-semibold">Expense</th><th className="text-right font-semibold">Qty × unit</th><th className="text-right font-semibold">Amount</th><th className="text-right font-semibold">Paid</th><th /></tr></thead>
        <tbody>
          {expenses.map((e) => {
            const st = expenseStatus(e, d.payments), paid = expensePaid(e, d.payments);
            return [
              <tr key={e.id} className={`border-t border-navy-50 ${e.voidedAt ? 'opacity-50 line-through' : ''}`}>
                <td className="py-1.5"><p className="font-medium text-navy-800">{e.description}</p><p className="text-[11px] text-navy-400">{EXPENSE_LABEL[e.category]}{e.vendor ? ` · ${e.vendor}` : ''}{!compact ? ` · ${when(e.createdAt)}` : ''}</p></td>
                <td className="text-right text-navy-500">{e.quantity} × {rs(e.unitCost)}</td>
                <td className="text-right font-semibold">{rs(e.amount)}</td>
                <td className="text-right">{e.voidedAt ? <span className="text-[11px]">removed</span> : e.amount <= 0 ? '—' : <Pill k={st === 'paid' ? 'completed' : st === 'partly_paid' ? 'in_progress' : 'planned'}>{st === 'paid' ? 'Paid' : st === 'partly_paid' ? `${rs(paid)} paid` : 'Unpaid'}</Pill>}</td>
                <td className="text-right whitespace-nowrap">
                  {!e.voidedAt && e.amount > 0 && st !== 'paid' && <button type="button" title="Record payment" onClick={() => setPayFor(payFor === e.id ? null : e.id)} className="p-1 text-navy-400 hover:text-emerald-700"><Banknote size={15} /></button>}
                  {!e.voidedAt && <button type="button" title="Remove (kept in history)" onClick={() => { const r = prompt('Why is this expense removed?'); if (r) { const x = d.voidExpense(e.id, r, by); if (x) toast.error('Not removed', x); } }} className="p-1 text-navy-400 hover:text-red-600"><Ban size={14} /></button>}
                </td>
              </tr>,
              payFor === e.id && (
                <tr key={e.id + '-pay'}><td colSpan={5} className="pb-2">
                  <PaymentForm incidentId={incidentId} bookingId={bookingId} by={by} expense={e} defaultAmount={e.amount - paid} onDone={() => setPayFor(null)} />
                </td></tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Payments ─────────────────────────────────────────────────────────────── */

const KINDS: [PaymentKind, string][] = [['vendor_payment', 'Paid to a provider'], ['reimbursement', 'Reimbursement'], ['owner_offset', 'Deduct from owner payout'], ['customer_charge', 'Add to customer bill']];

export function PaymentForm({ incidentId, bookingId, by, expense, defaultAmount, onDone }: {
  incidentId: string; bookingId: string; by: string; expense?: BdExpense; defaultAmount?: number; onDone?: () => void;
}) {
  const d = useBreakdownStore();
  const [kind, setKind] = useState<PaymentKind>(expense ? 'vendor_payment' : 'reimbursement');
  const [payer, setPayer] = useState<Party>(expense ? 'company' : 'owner');
  const [payee, setPayee] = useState(expense?.vendor ?? 'company');
  const [amount, setAmount] = useState(defaultAmount ? String(Math.round(defaultAmount * 100) / 100) : '');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [key] = useState(newKey);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const l = ledgerFor(incidentId, d);

  const submit = async () => {
    setErr('');
    const amt = Number(amount);
    if (kind === 'customer_charge') {
      if (!confirm(`Add ${rs(l.outstanding.customer)} (the customer's share) to the booking bill? Only do this once the customer has been told and agreed.`)) return;
      const e = d.chargeCustomerShare(incidentId, by, key); if (e) setErr(e); else onDone?.(); return;
    }
    if (kind === 'owner_offset') {
      if (!confirm(`Deduct ${rs(amt)} from the owner's payout for this booking?`)) return;
      const e = d.offsetOwnerShare(incidentId, amt, by, key); if (e) setErr(e); else onDone?.(); return;
    }
    setBusy(true);
    const receiptPath = await uploadReceipt(bookingId, incidentId, file);
    setBusy(false);
    const e = d.postPayment({ incidentId, expenseId: expense?.id, kind, payer, payee: payee.trim() || 'company', amount: amt, method, reference, receiptPath, paidAt: paidAt ? new Date(paidAt).toISOString() : undefined, key, by });
    if (e) setErr(e); else onDone?.();
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-3">
      {!expense && <Field label="What happened"><Chips size="xs" value={kind} options={KINDS} onChange={(k) => { setKind(k); if (k === 'reimbursement') setPayee('company'); }} /></Field>}
      {kind === 'customer_charge' ? (
        <p className="text-sm text-navy-700">Adds the customer's outstanding share (<b>{rs(l.outstanding.customer)}</b>) to their booking bill as a Damage charge. They pay it with the booking balance.</p>
      ) : kind === 'owner_offset' ? (
        <Grid><Field label="Amount to deduct (Rs)" hint={`The owner owes ${rs(Math.max(0, l.outstanding.owner))}`}><input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></Grid>
      ) : (
        <>
          <Grid cols={4}>
            <Field label="Paid by"><select className="input" value={payer} onChange={(e) => setPayer(e.target.value as Party)}>{PARTIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
            <Field label="Paid to" hint={kind === 'reimbursement' ? "'company', or the party the company paid back" : undefined}>
              {kind === 'reimbursement'
                ? <select className="input" value={payee} onChange={(e) => setPayee(e.target.value)}><option value="company">Company</option><option value="owner">Owner</option><option value="customer">Customer</option><option value="insurance">Insurance</option></select>
                : <input className="input" value={payee} onChange={(e) => setPayee(e.target.value)} />}
            </Field>
            <Field label="Amount (Rs) *"><input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
          </Grid>
          <Grid cols={3}>
            <Field label="Reference"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt / transfer no." /></Field>
            <Field label="Paid on"><input className="input" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
            <Field label="Receipt"><input className="input !py-1.5 text-xs" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          </Grid>
        </>
      )}
      <ErrorLine msg={err} />
      <div className="flex gap-2 justify-end">
        {onDone && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={onDone}>Cancel</button>}
        <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5" disabled={busy} onClick={submit}><Upload size={13} /> Record</button>
      </div>
    </div>
  );
}

export function PaymentList({ incidentId, by }: { incidentId: string; by: string }) {
  const d = useBreakdownStore();
  const list = d.payments.filter((p) => p.incidentId === incidentId).sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  if (!list.length) return <p className="text-xs text-navy-400">No payments recorded yet.</p>;
  return (
    <ul className="divide-y divide-navy-50">
      {list.map((p) => (
        <li key={p.id} className={`py-2 flex flex-wrap items-center gap-2 text-sm ${p.status === 'reversed' ? 'opacity-50' : ''}`}>
          <div className="flex-1 min-w-[200px]">
            <p className={`font-medium text-navy-800 ${p.status === 'reversed' ? 'line-through' : ''}`}>{PAYMENT_LABEL[p.kind]} · {rs(p.amount)}</p>
            <p className="text-[11px] text-navy-400">{PARTY_LABEL[p.payer]} → {p.payee}{p.method ? ` · ${p.method}` : ''}{p.reference ? ` · ref ${p.reference}` : ''} · {when(p.paidAt)} · by {p.createdBy}
              {p.status === 'reversed' && ` · reversed by ${p.reversedBy}: ${p.reverseReason}`}</p>
          </div>
          {p.receiptPath && <button type="button" onClick={() => openFile(p.receiptPath!)} className="text-xs font-semibold text-navy-600 inline-flex items-center gap-1"><Receipt size={12} /> Receipt</button>}
          {p.status === 'posted' && p.kind !== 'refund' && (
            <button type="button" onClick={() => { const r = prompt('Why is this payment reversed? (It stays in the history.)'); if (r) { const e = d.reversePayment(p.id, r, by); if (e) toast.error('Not reversed', e); } }}
                    className="text-xs font-semibold text-red-600 inline-flex items-center gap-1"><Undo2 size={12} /> Reverse</button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Responsibility ───────────────────────────────────────────────────────── */

export function ResponsibilityEditor({ incidentId, by }: { incidentId: string; by: string }) {
  const d = useBreakdownStore();
  const l = ledgerFor(incidentId, d);
  const current = d.allocations.filter((a) => a.incidentId === incidentId && !a.supersededAt);
  const history = d.allocations.filter((a) => a.incidentId === incidentId && a.supersededAt);
  const [rows, setRows] = useState<{ party: Party; mode: 'percent' | 'amount'; value: string }[]>(() =>
    current.length ? current.map((a) => ({ party: a.party, mode: a.mode, value: String(a.value) })) : [{ party: 'company', mode: 'percent', value: '100' }]);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(!current.length);
  const [err, setErr] = useState('');
  const parsed = rows.map((r) => ({ party: r.party, mode: r.mode, value: Number(r.value) || 0 }));
  const preview = useMemo(() => resolveShares(l.cost, parsed), [l.cost, JSON.stringify(parsed)]); // eslint-disable-line react-hooks/exhaustive-deps
  const problem = sharesProblem(l.cost, parsed);
  const left = l.cost - preview.reduce((s, r) => s + r.amount, 0);

  const save = () => {
    setErr('');
    const e = d.decideResponsibility(incidentId, parsed, reason, by);
    if (e) { setErr(e); return; }
    setEditing(false); setReason('');
  };

  return (
    <Section title="Responsibility for the cost" icon={Scale} action={!editing && <button type="button" className="text-xs font-semibold text-navy-600" onClick={() => setEditing(true)}>Change decision</button>}>
      <p className="text-[11px] text-navy-400">Decided by an admin after reviewing the evidence, rental agreement, owner contract and insurance — never assumed from the breakdown type.</p>
      {!editing ? (
        current.length ? (
          <div className="space-y-1">
            {current.map((a) => <KV key={a.id} k={`${PARTY_LABEL[a.party]}${a.mode === 'percent' ? ` (${a.value}%)` : ''}`} v={rs(a.amount)} />)}
            {l.unallocated > 0.5 && <KV k="Pending investigation" v={rs(l.unallocated)} warn />}
            <p className="text-xs text-navy-500">Reason: {current[0].reason} — {current[0].decidedBy}, {when(current[0].decidedAt)}</p>
          </div>
        ) : <p className="text-sm text-amber-700">Not decided yet — pending investigation.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <select className="input !w-40" value={r.party} onChange={(e) => setRows((x) => x.map((y, i) => (i === idx ? { ...y, party: e.target.value as Party } : y)))}>{PARTIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              <select className="input !w-24" value={r.mode} onChange={(e) => setRows((x) => x.map((y, i) => (i === idx ? { ...y, mode: e.target.value as 'percent' | 'amount' } : y)))}><option value="percent">%</option><option value="amount">Rs</option></select>
              <input className="input !w-28" type="number" min="0" value={r.value} onChange={(e) => setRows((x) => x.map((y, i) => (i === idx ? { ...y, value: e.target.value } : y)))} />
              <span className="text-sm text-navy-500">= {rs(preview[idx]?.amount)}</span>
              {rows.length > 1 && <button type="button" className="text-xs text-red-600" onClick={() => setRows((x) => x.filter((_, i) => i !== idx))}>Remove</button>}
            </div>
          ))}
          {rows.length < 4 && <button type="button" className="text-xs font-semibold text-navy-600 inline-flex items-center gap-1" onClick={() => setRows((x) => [...x, { party: (['owner', 'customer', 'insurance', 'company'] as Party[]).find((p) => !x.some((y) => y.party === p)) ?? 'company', mode: 'amount', value: '0' }])}><Plus size={12} /> Add party</button>}
          <p className={`text-xs ${problem ? 'text-red-600' : left > 0.5 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {problem ?? (left > 0.5 ? `${rs(left)} of ${rs(l.cost)} left as pending investigation` : `All ${rs(l.cost)} allocated`)}
          </p>
          <Field label="Reason for this decision *"><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner contract clause 4 — mechanical wear is the owner's; photos show no customer damage" /></Field>
          <ErrorLine msg={err} />
          <div className="flex gap-2 justify-end">
            {current.length > 0 && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setEditing(false)}>Cancel</button>}
            <button type="button" className="btn-primary !py-1.5 text-sm" onClick={save}>Save decision</button>
          </div>
        </div>
      )}
      {history.length > 0 && <details className="text-xs text-navy-500"><summary className="cursor-pointer">Earlier decisions ({history.length})</summary>{history.map((a) => <p key={a.id}>{when(a.decidedAt)} · {PARTY_LABEL[a.party]} {rs(a.amount)} — {a.reason} ({a.decidedBy}; replaced {when(a.supersededAt)})</p>)}</details>}
    </Section>
  );
}

/** Customer / owner quick settlement actions (on the money tab) */
export function SettlementActions({ incidentId, by }: { incidentId: string; by: string }) {
  const d = useBreakdownStore();
  const l = ledgerFor(incidentId, d);
  const [key] = useState(newKey);
  const [ownerAmt, setOwnerAmt] = useState('');
  if (!(l.outstanding.customer > 0.5) && !(l.outstanding.owner > 0.5)) return null;
  return (
    <Section title="Settle shares" icon={Banknote}>
      {l.outstanding.customer > 0.5 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Customer owes <b>{rs(l.outstanding.customer)}</b></span>
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => {
            if (!confirm(`Add ${rs(l.outstanding.customer)} to the customer's booking bill? Only after the customer has been told and agreed.`)) return;
            const e = d.chargeCustomerShare(incidentId, by, key); if (e) toast.error('Not added', e);
          }}>Approve & add to booking bill</button>
        </div>
      )}
      {l.outstanding.owner > 0.5 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Owner owes <b>{rs(l.outstanding.owner)}</b></span>
          <span className="flex items-center gap-2">
            <input className="input !w-28 !py-1.5" type="number" min="0" placeholder={String(Math.round(l.outstanding.owner))} value={ownerAmt} onChange={(e) => setOwnerAmt(e.target.value)} />
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => {
              const amt = Number(ownerAmt || l.outstanding.owner);
              if (!confirm(`Deduct ${rs(amt)} from the owner's payout for this booking?`)) return;
              const e = d.offsetOwnerShare(incidentId, amt, by, newKey()); if (e) toast.error('Not deducted', e); else setOwnerAmt('');
            }}>Deduct from payout</button>
          </span>
        </div>
      )}
      <p className="text-[11px] text-navy-400">Or record a cash / bank reimbursement under Payments. Nothing counts as paid until it is recorded here.</p>
    </Section>
  );
}

export { openFile };
