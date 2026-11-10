import { useEffect, useState } from 'react';
import { CheckCircle2, FileText, Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import { rs } from '../../lib/bookingRecord';
import { STATUS_INFO, payoutDate, periodLabel, useSettlements } from '../../lib/settlements';
import { printSettlement } from '../../lib/printSettlement';

/** The owner's monthly payout statements: what was paid, every line behind it, and "Confirm received" */
export default function OwnerStatements() {
  const ownerId = useAuthStore((s) => s.currentUser?.ownerId);
  const owner = useStore((s) => s.owners.find((o) => o.id === ownerId));
  const { list, loaded, payoutDay, refresh, confirm } = useSettlements();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { refresh(); }, [refresh]);

  // the database only gives owners their own paid statements
  const mine = list.filter((s) => s.ownerId === ownerId && ['paid', 'confirmed'].includes(s.status));
  const next = payoutDate(new Date().toISOString().slice(0, 7), payoutDay);

  const received = async (id: string) => {
    const note = prompt('Anything to add? (optional — e.g. "Received in full")') ?? undefined;
    setBusy(id);
    try { await confirm(id, note?.trim() || undefined); toast.success('Thank you', 'The company sees that you received it.'); }
    catch (e) { toast.error('Not saved', (e as Error).message); }
    setBusy(null);
  };

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <p className="section-title">Monthly payout statements</p>
        <span className="text-xs text-navy-400">Payouts are made on day {payoutDay} of each month for the rentals completed the month before{next > new Date() ? ` · next: ${next.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : ''}</span>
      </div>
      <p className="text-xs text-navy-400 mb-4">Customers pay the company; the company pays your share each month — whether or not the customer has paid in full. Each statement lists every rental, referral fee, amount owed back and expense behind the figure.</p>
      {!loaded && <p className="text-sm text-navy-400"><Loader2 size={14} className="inline animate-spin mr-1.5" />Loading…</p>}
      {loaded && mine.length === 0 && <p className="text-sm text-navy-400">No payouts yet — your first statement appears here once it is paid.</p>}
      <div className="space-y-2">
        {mine.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-navy-50/60 px-4 py-3">
            <div className="flex-1 min-w-[12rem]">
              <p className="text-sm font-semibold text-navy-800">{periodLabel(s.period)} · {rs(s.net)}</p>
              <p className="text-xs text-navy-400">
                {s.lines.filter((l) => l.kind === 'rental').length} rentals · paid {s.paidAt ? new Date(s.paidAt).toLocaleDateString('en-GB') : '—'} by {s.payMethod}{s.payRef ? ` · ref ${s.payRef}` : ''}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_INFO[s.status].cls}`}>{s.status === 'paid' ? 'Paid — please confirm' : STATUS_INFO[s.status].label}</span>
            <button type="button" onClick={() => { if (!printSettlement(s, owner)) toast.error('Statement not opened', 'Allow pop-ups for this site.'); }}
                    className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1"><FileText size={13} /> Statement</button>
            {s.status === 'paid' && (
              <button type="button" disabled={busy === s.id} onClick={() => received(s.id)}
                      className="btn-primary !py-1.5 text-xs inline-flex items-center gap-1 disabled:opacity-50"><CheckCircle2 size={13} /> Confirm received</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
