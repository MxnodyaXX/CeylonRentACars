import { useEffect, useState } from 'react';
import { Clock, CalendarClock, Trash2, Send } from 'lucide-react';
import DateInput from './DateInput';
import { toast } from '../../store/useToast';
import { useAuthStore } from '../../store/useAuthStore';
import { CHANNELS, OUTCOMES, FollowUp, addFollowUp, deleteFollowUp } from '../../lib/inquiryFollowups';
import { prettyDate } from '../../lib/inquiryReview';

export const TONE: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  grey: 'bg-navy-50 text-navy-500 border-navy-100',
};
export const toneOf = (outcome: string) => TONE[OUTCOMES.find((o) => o.value === outcome)?.tone ?? 'grey'];

const fmtDateTime = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Record each contact with the customer (channel, outcome, what they said, next follow-up)
 * and show the history as a timeline.
 */
export function ContactLog({
  inquiryId, followUps, available, presetChannel, onAdded, onDeleted,
}: {
  inquiryId: string;
  followUps: FollowUp[];
  available: boolean;                       // false until website.sql has created the table
  presetChannel?: string;                   // set when a contact button / template was used
  onAdded: (f: FollowUp) => void;
  onDeleted: (id: string) => void;
}) {
  const staff = useAuthStore((s) => s.currentUser?.name) ?? 'Ceylon Rent A Cars';
  const [channel, setChannel] = useState<string>('Call');
  const [outcome, setOutcome] = useState('');
  const [response, setResponse] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (presetChannel) setChannel(presetChannel); }, [presetChannel]);

  const save = async () => {
    if (!outcome) { toast.error('Choose an outcome', 'How did the contact go?'); return; }
    setSaving(true);
    try {
      const f = await addFollowUp({ inquiryId, channel, outcome, response: response.trim(), nextFollowUp: next || undefined, staff });
      onAdded(f);
      setOutcome(''); setResponse(''); setNext('');
      toast.success('Contact recorded', next ? `Follow up on ${prettyDate(next)}.` : 'Saved to this inquiry.');
    } catch (e) {
      toast.error('Could not save', (e as { message?: string })?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (f: FollowUp) => {
    if (!confirm('Delete this contact record?')) return;
    try { await deleteFollowUp(f.id); onDeleted(f.id); }
    catch (e) { toast.error('Could not delete', (e as { message?: string })?.message ?? String(e)); }
  };

  return (
    <div className="space-y-4">
      {available ? (
        <div className="space-y-3">
          <div>
            <p className="text-[11px] text-navy-400 mb-1">How did you contact them?</p>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => (
                <button key={c} type="button" onClick={() => setChannel(c)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${channel === c ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-500 border-navy-100 hover:bg-navy-50'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] text-navy-400 mb-1">Outcome *</p>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => (
                <button key={o.value} type="button" onClick={() => setOutcome(o.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${outcome === o.value ? `${TONE[o.tone]} ring-2 ring-offset-1 ring-brand-500/40` : 'bg-white text-navy-500 border-navy-100 hover:bg-navy-50'}`}>
                  {o.value}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] text-navy-400 mb-1">Customer's response / requirements</p>
            <textarea className="input resize-none" rows={3} value={response} onChange={(e) => setResponse(e.target.value)}
                      placeholder="e.g. Wants a child seat, flight lands 6:40 AM, asked for a discount for 10 days…" />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <p className="text-[11px] text-navy-400 mb-1">Next follow-up (optional)</p>
              <DateInput value={next} onChange={setNext} />
            </div>
            <button type="button" onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5 disabled:opacity-60">
              <Send size={14} /> {saving ? 'Saving…' : 'Save contact'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Run <code>admin/supabase/website.sql</code> in Supabase to enable the contact log.
        </p>
      )}

      <div>
        <p className="label mb-2">History {followUps.length > 0 && <span className="normal-case text-navy-300">({followUps.length})</span>}</p>
        {followUps.length === 0 ? (
          <p className="text-xs text-navy-400 bg-navy-50/60 rounded-xl px-3 py-3">Not contacted yet.</p>
        ) : (
          <ol className="relative border-l-2 border-navy-100 ml-2 space-y-3">
            {followUps.map((f) => (
              <li key={f.id} className="ml-4">
                <span className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-brand-500 ring-4 ring-white" />
                <div className="rounded-xl border border-navy-100 bg-white p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-navy-800">{f.channel}</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${toneOf(f.outcome)}`}>{f.outcome}</span>
                    <span className="ml-auto text-[11px] text-navy-400 flex items-center gap-1"><Clock size={11} />{fmtDateTime(f.createdAt)}</span>
                    <button type="button" onClick={() => remove(f)} title="Delete" className="text-navy-300 hover:text-red-600"><Trash2 size={13} /></button>
                  </div>
                  {f.response && <p className="text-sm text-navy-700 mt-1.5 whitespace-pre-line">{f.response}</p>}
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-navy-400">
                    {f.staff && <span>by {f.staff}</span>}
                    {f.nextFollowUp && <span className="flex items-center gap-1 text-amber-700 font-semibold"><CalendarClock size={11} /> Follow up {prettyDate(f.nextFollowUp)}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
