import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Landmark, RefreshCw, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import Header from '../components/layout/Header';
import Modal from '../components/ui/Modal';
import Select from '../components/ui/Select';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from '../store/useToast';
import { eag, eagEnabled, eagError, lk, type Receipt } from '../lib/eagreement';

const rs = (n?: number | null) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-LK')}`;
type OpenRequest = Awaited<ReturnType<typeof eag.openRequests>>[number];

/**
 * Finance: check that money really reached the company account before a booking can be made.
 * A screenshot or a customer's word is not proof. The person who recorded a payment can't verify it.
 */
export default function PaymentChecks() {
  const canVerify = useAuthStore((s) => s.can('canVerifyPayments'));
  const canRecord = useAuthStore((s) => s.can('canTakePayments'));
  const me = useAuthStore((s) => s.currentUser?.name);
  const [rows, setRows] = useState<Receipt[]>([]);
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [check, setCheck] = useState<Receipt | null>(null);
  const [f, setF] = useState({ decision: 'VERIFIED', account: '', at: '', note: '', request: '' });
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<{ amount: string; account: string; reference: string; at: string; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, q, a] = await Promise.all([eag.receiptsToVerify(), eag.openRequests().catch(() => []), eag.accounts().catch(() => [])]);
      setRows(r); setRequests(q); setAccounts(a);
    } catch (e) { toast.error('Payment checks', eagError(e).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (eagEnabled) load(); }, [load]);

  const open = (r: Receipt) => {
    setCheck(r);
    setF({ decision: r.status === 'REFUND_DUE' ? 'REFUNDED' : 'VERIFIED', account: r.account_id ?? '', at: r.received_at ? new Date(new Date(r.received_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '', note: '', request: '' });
  };
  const decide = async () => {
    if (!check) return;
    setBusy(true);
    try {
      const r = await eag.verifyReceipt(check.id, f.decision, f.account || null, f.at ? new Date(f.at).toISOString() : null, f.note || null, f.request || null);
      toast.success('Saved', r.request_status === 'VERIFIED' ? 'Advance verified — reservations can now create the booking.' : r.request_status === 'PARTIAL' ? 'Part of the advance is verified.' : r.request_status === 'LATE' ? 'Verified, but the priority had ended — reservations must recheck the car or arrange a refund.' : `Marked ${f.decision.toLowerCase()}.`);
      setCheck(null); await load();
    } catch (e) { toast.error('Not saved', eagError(e).message); } finally { setBusy(false); }
  };
  const recordUnsolicited = async () => {
    if (!rec) return;
    setBusy(true);
    try { await eag.recordReceipt(null, Number(rec.amount), rec.account, rec.reference, new Date(rec.at).toISOString(), rec.note); toast.success('Recorded as unmatched', 'It confirms nothing until it is matched and verified by someone else.'); setRec(null); await load(); }
    catch (e) { toast.error('Not recorded', eagError(e).message); } finally { setBusy(false); }
  };

  if (!eagEnabled) return <div><Header title="Payment checks" /><p className="card text-sm text-navy-500">Needs the live database — not available in demo mode.</p></div>;

  return (
    <div>
      <Header title="Payment checks" subtitle="Verify advances against the bank or cash box before any booking is confirmed" />
      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700"><RefreshCw size={14} /> Refresh</button>
        {canRecord && <button type="button" onClick={() => setRec({ amount: '', account: '', reference: '', at: new Date().toISOString().slice(0, 16), note: '' })}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700"><Landmark size={14} /> Money without a request</button>}
      </div>
      <section className="card !p-0 overflow-hidden">
        {loading ? <p className="p-4 text-sm text-navy-400">Loading…</p> : rows.length === 0 ? <p className="p-6 text-sm text-navy-500 text-center">Nothing to check. 🎉</p> : (
          <ul className="divide-y divide-navy-50">
            {rows.map((r) => (
              <li key={r.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-800">{rs(r.amount)} <span className="font-normal text-navy-500">· {r.customer ?? 'no inquiry'}{r.bank_reference ? ` · ref ${r.bank_reference}` : ''}</span></p>
                  <p className="text-xs text-navy-500">
                    {r.reported_by_customer ? 'Reported by the customer' : `Recorded by ${r.created_by}`} {lk(r.created_at)} · {r.account ?? 'account not given'}
                    {r.received_at ? ` · arrived ${lk(r.received_at)}` : ''}
                    {r.request_amount ? ` · advance asked ${rs(r.request_amount)} by ${lk(r.request_deadline)}` : ' · no advance request'}
                  </p>
                  {r.note && <p className="text-xs text-navy-500 italic">{r.note}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.status === 'UNMATCHED' ? 'bg-amber-100 text-amber-800' : r.status === 'REFUND_DUE' ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-800'}`}>{r.status.replace('_', ' ').toLowerCase()}</span>
                  {r.inquiry_id && <Link to={`/inquiries/${r.inquiry_id}#eagreement`} className="text-xs font-semibold text-brand-500 hover:underline">Inquiry</Link>}
                  {canVerify && (r.created_by === me
                    ? <span className="text-xs text-navy-400" title="The person who recorded it can't verify it">recorded by you</span>
                    : <button type="button" onClick={() => open(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-navy-800 text-white"><ShieldCheck size={13} /> Check</button>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={!!check} onClose={() => setCheck(null)} title={`Check ${check ? rs(check.amount) : ''}`}>
        {check && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-navy-500">Open the bank statement or count the cash box. Verify only money that has <b>really arrived</b> in the account — never from a screenshot.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {([['VERIFIED', 'In the account', CheckCircle2], ['REJECTED', 'Not received', XCircle], ['DUPLICATE', 'Duplicate', Copy], ['UNMATCHED', 'Can’t match', Landmark], ['REFUND_DUE', 'Refund it', Undo2], ['REFUNDED', 'Refunded', Undo2]] as const)
                // only the moves the database allows from this state
                .filter(([d]) => (check.status === 'REFUND_DUE' ? d === 'REFUNDED' : d !== 'REFUNDED' && !(d === 'UNMATCHED' && check.status === 'UNMATCHED') && !(d === 'REFUND_DUE' && check.status === 'REPORTED')))
                .map(([d, label, Icon]) => (
                  <button key={d} type="button" onClick={() => setF({ ...f, decision: d })}
                          className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold border ${f.decision === d ? 'bg-navy-800 text-white border-navy-800' : 'bg-white border-navy-100 text-navy-700'}`}><Icon size={13} /> {label}</button>
                ))}
            </div>
            {f.decision === 'VERIFIED' && (
              <>
                <div><p className="label">Account it arrived in</p><Select value={f.account} onChange={(v) => setF({ ...f, account: v })} options={accounts.map((a) => ({ value: a.id, label: a.name }))} placeholder="Choose" /></div>
                <label className="block">When it arrived<input className="input mt-1" type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>
                {!check.request_id && check.status === 'UNMATCHED' && (
                  <div><p className="label">Match it to an advance request (optional)</p>
                    <Select value={f.request} onChange={(v) => setF({ ...f, request: v })} nullable placeholder="Leave unmatched"
                            options={requests.map((q) => ({ value: q.id, label: `${q.customer} · ${rs(q.amount)}`, sub: `${q.reference} · due ${lk(q.deadline)} · ${q.status.toLowerCase()}` }))} /></div>
                )}
              </>
            )}
            <label className="block">Note<input className="input mt-1" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={f.decision === 'VERIFIED' ? 'e.g. seen in BOC statement 18 Nov' : 'Why'} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCheck(null)}>Cancel</button>
              <button type="button" className="px-4 py-2 rounded-xl text-sm font-semibold bg-navy-800 text-white disabled:opacity-50"
                      disabled={busy || (f.decision === 'VERIFIED' && (!f.account || !f.at))} onClick={decide}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!rec} onClose={() => setRec(null)} title="Money without an advance request">
        {rec && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-navy-500">For a transfer that arrived before (or without) an advance request. It is recorded as <b>unmatched</b>: it never skips the e-Agreement and never confirms a booking by itself.</p>
            <label className="block">Amount (Rs)<input className="input mt-1" inputMode="numeric" value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} /></label>
            <div><p className="label">Account</p><Select value={rec.account} onChange={(v) => setRec({ ...rec, account: v })} options={accounts.map((a) => ({ value: a.id, label: a.name }))} placeholder="Choose" /></div>
            <label className="block">Bank reference<input className="input mt-1" value={rec.reference} onChange={(e) => setRec({ ...rec, reference: e.target.value })} /></label>
            <label className="block">When it arrived<input className="input mt-1" type="datetime-local" value={rec.at} onChange={(e) => setRec({ ...rec, at: e.target.value })} /></label>
            <label className="block">Note (who it might be from)<input className="input mt-1" value={rec.note} onChange={(e) => setRec({ ...rec, note: e.target.value })} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRec(null)}>Cancel</button>
              <button type="button" className="px-4 py-2 rounded-xl text-sm font-semibold bg-navy-800 text-white disabled:opacity-50" disabled={busy || !(Number(rec.amount) > 0) || !rec.account} onClick={recordUnsolicited}>Record</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
