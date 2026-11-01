import { useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle, Flag, MessageCircle, Phone, PhoneOff } from 'lucide-react';
import Modal from '../ui/Modal';
import { toast } from '../../store/useToast';
import { updateApplication } from '../../lib/partnerApplications';
import {
  CALL_METHODS, CALL_RESULTS, SECTIONS, VERDICTS, emptyVerification, fill, flagged, unanswered,
  type Answer, type Question, type Verification, type Verdict,
} from '../../lib/partnerVerification';
import type { PartnerApplication } from '../../types';

/* The owner check call: Start (or log a call nobody answered) → one screen per section of
   questions, saved as you go → verdict and summary → Finish. Re-opening shows the answers. */

const chip = (on: boolean, tone: 'dark' | 'red' | 'green' = 'dark') =>
  `rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${on
    ? tone === 'red' ? 'bg-red-600 border-red-600 text-white' : tone === 'green' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-navy-800 border-navy-800 text-white'
    : 'bg-white border-navy-200 text-navy-700 hover:border-navy-400'}`;

function QuestionRow({ q, app, value, onChange }: { q: Question; app: PartnerApplication; value?: Answer; onChange: (v: Answer) => void }) {
  const v = value ?? { value: '' };
  const set = (val: string) => onChange({ ...v, value: val });
  const warn = !!(q.flag && v.value && q.flag(v.value));
  const opts = q.kind === 'yesno' ? ['Yes', 'No'] : q.options ?? [];
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${warn ? 'border-red-200 bg-red-50/50' : 'border-navy-100'}`}>
      <p className="text-sm font-semibold text-navy-800">{fill(q.q, app)}{q.required && <span className="text-brand-500"> *</span>}</p>
      {q.hint && <p className="text-xs text-navy-400 -mt-1">{fill(q.hint, app)}</p>}
      {(q.kind === 'yesno' || q.kind === 'choice') && (
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => (
            <button key={o} type="button" onClick={() => set(o)}
                    className={chip(v.value === o, v.value === o && q.flag?.(o) ? 'red' : v.value === o && q.kind === 'yesno' ? 'green' : 'dark')}>{o}</button>
          ))}
        </div>
      )}
      {q.kind === 'text' && <textarea className="input min-h-[44px]" rows={1} value={v.value} onChange={(e) => set(e.target.value)} />}
      {q.kind === 'date' && <input type="date" className="input max-w-[220px]" value={v.value} onChange={(e) => set(e.target.value)} />}
      {q.kind === 'number' && <input className="input max-w-[220px]" inputMode="numeric" placeholder="Rs" value={v.value} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} />}
      {q.detailsWhen?.includes(v.value) && (
        <input className="input" placeholder={q.detailsLabel ?? 'Details'} value={v.details ?? ''} onChange={(e) => onChange({ ...v, details: e.target.value })} />
      )}
      {warn && <p className="text-[11px] font-semibold text-red-600 flex items-center gap-1"><Flag size={11} /> Warning sign — it will be listed in the summary</p>}
    </div>
  );
}

export default function OwnerCall({ app, by, onChange, onClose }: {
  app: PartnerApplication; by: string; onChange: (a: PartnerApplication) => void; onClose: () => void;
}) {
  const saved = app.verification ?? emptyVerification();
  const [v, setV] = useState<Verification>(saved);
  // -1 = start screen; 0..n-1 = sections; n = summary
  const n = SECTIONS.length;
  const [at, setAt] = useState(saved.finishedAt ? n : saved.startedAt ? Math.min(saved.section ?? 0, n) : -1);
  const [method, setMethod] = useState<string>(saved.method ?? 'Normal call');
  const [result, setResult] = useState<string>('Connected');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [verdict, setVerdict] = useState<Verdict | ''>(saved.verdict ?? '');
  const [summary, setSummary] = useState(saved.summary ?? '');

  const save = async (next: Verification, history?: string) => {
    setBusy(true);
    try {
      const a = await updateApplication(app, { verification: next, ...(app.status === 'Pending' ? { status: 'Under review' as const } : {}) }, by, history);
      onChange(a); setV(next);
      return true;
    } catch (e) { toast.error('Not saved', (e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const logAttempt = async () => {
    const attempt = { at: new Date().toISOString(), by, method, result, note: note.trim() || undefined };
    if (result !== 'Connected') {
      if (await save({ ...v, attempts: [...v.attempts, attempt] }, `Called the owner (${method}): ${result.toLowerCase()}${attempt.note ? ` — ${attempt.note}` : ''}`)) {
        setNote(''); toast.info('Call logged', 'Try again later — it is kept in the history.');
      }
      return;
    }
    const next = { ...v, attempts: [...v.attempts, attempt], startedAt: v.startedAt ?? attempt.at, startedBy: v.startedBy ?? by, method, section: v.section ?? 0 };
    if (await save(next, v.startedAt ? undefined : `Owner check call started (${method})`)) setAt(next.section ?? 0);
  };

  const go = async (to: number) => {
    setErr('');
    if (to > at && at >= 0 && at < n) {
      const left = unanswered(v, SECTIONS[at]);
      if (left.length) { setErr(`Answer: ${left.map((q) => fill(q.q, app).replace(/\?.*$/, '?')).join(' · ')}`); return; }
    }
    if (await save({ ...v, section: Math.min(to, n) })) setAt(to);
  };

  const setAnswer = (id: string, a: Answer) => setV((x) => ({ ...x, answers: { ...x.answers, [id]: a } }));

  const finish = async () => {
    const left = unanswered(v);
    if (left.length) { setErr(`${left.length} required question(s) still unanswered — go back to them.`); return; }
    if (!verdict) { setErr('Choose the verdict.'); return; }
    const flags = flagged(v);
    const next: Verification = { ...v, verdict, summary: summary.trim() || undefined, finishedAt: v.finishedAt ?? new Date().toISOString(), finishedBy: v.finishedBy ?? by };
    if (await save(next, `Owner check call ${v.finishedAt ? 'updated' : 'finished'}: ${verdict}${flags.length ? ` — ${flags.length} warning sign(s)` : ''}${summary.trim() ? `. ${summary.trim()}` : ''}`)) {
      toast.success('Owner check call saved', verdict);
      onClose();
    }
  };

  const flags = flagged(v);
  const pct = at < 0 ? 0 : Math.round((Math.min(at, n) / n) * 100);

  return (
    <Modal open onClose={onClose} title={`Owner check call — ${app.name}`} width="max-w-3xl" maxHeight="max-h-[94vh]">
      <div className="space-y-4">
        {/* who to call, always visible */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-navy-50/70 px-3 py-2 text-sm">
          <span className="text-navy-700"><b>{app.name}</b> · {app.brand} {app.model} ({app.vehicleNumber})</span>
          <a href={`tel:+${app.phone}`} className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1 ml-auto"><Phone size={13} /> Call +{app.phone}</a>
          <a href={`https://wa.me/${app.phone}`} target="_blank" rel="noreferrer" className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1"><MessageCircle size={13} /> WhatsApp</a>
        </div>

        {at >= 0 && (
          <div>
            <div className="flex justify-between text-[11px] font-semibold text-navy-400 mb-1">
              <span>{at < n ? `${at + 1} of ${n} — ${SECTIONS[at].title}` : 'Summary'}</span><span>{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-navy-100 overflow-hidden"><div className="h-full bg-brand-500 transition-all duration-500" style={{ width: `${pct}%` }} /></div>
            <div className="flex flex-wrap gap-1 mt-2">
              {SECTIONS.map((s, i) => (
                <button key={s.id} type="button" disabled={busy} onClick={() => go(i)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${i === at ? 'bg-navy-800 text-white' : unanswered(v, s).length ? 'bg-white text-navy-500 ring-1 ring-inset ring-navy-200' : 'bg-emerald-50 text-emerald-700'}`}>
                  {unanswered(v, s).length || i === at ? '' : '✓ '}{s.title}</button>
              ))}
              <button type="button" disabled={busy} onClick={() => go(n)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${at === n ? 'bg-navy-800 text-white' : 'bg-white text-navy-500 ring-1 ring-inset ring-navy-200'}`}>Summary</button>
            </div>
          </div>
        )}

        {at === -1 && (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Before a stranger's car joins the fleet we talk to the owner. We become responsible for the car and for our customers' safety —
              go through every question, and note anything that doesn't feel right.
            </div>
            {v.attempts.length > 0 && (
              <ul className="text-xs text-navy-500 space-y-0.5">
                {v.attempts.map((t, i) => <li key={i}><PhoneOff size={11} className="inline mr-1" />{new Date(t.at).toLocaleString('en-GB')} · {t.method} · {t.result}{t.note ? ` — ${t.note}` : ''} · {t.by}</li>)}
              </ul>
            )}
            <div>
              <p className="label">How</p>
              <div className="flex flex-wrap gap-1.5">{CALL_METHODS.map((m) => <button key={m} type="button" className={chip(method === m)} onClick={() => setMethod(m)}>{m}</button>)}</div>
            </div>
            <div>
              <p className="label">Did the owner answer?</p>
              <div className="flex flex-wrap gap-1.5">{CALL_RESULTS.map((r) => <button key={r} type="button" className={chip(result === r, r === 'Connected' ? 'green' : 'dark')} onClick={() => setResult(r)}>{r}</button>)}</div>
            </div>
            {result !== 'Connected' && <input className="input" placeholder="Note (optional), e.g. asked to call after 6pm" value={note} onChange={(e) => setNote(e.target.value)} />}
            <button type="button" className="btn-primary flex items-center gap-1.5" disabled={busy} onClick={logAttempt}>
              {result === 'Connected' ? <><Phone size={15} /> Start the call</> : <><PhoneOff size={15} /> Log this call</>}
            </button>
          </div>
        )}

        {at >= 0 && at < n && (
          <div className="space-y-2.5">
            <p className="text-sm text-navy-500">{SECTIONS[at].intro}</p>
            {SECTIONS[at].questions.map((q) => (
              <QuestionRow key={q.id} q={q} app={app} value={v.answers[q.id]} onChange={(a) => setAnswer(q.id, a)} />
            ))}
          </div>
        )}

        {at === n && (
          <div className="space-y-3">
            {flags.length > 0 ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-bold text-red-700 flex items-center gap-1.5 mb-1"><AlertTriangle size={15} /> Warning signs ({flags.length})</p>
                <ul className="text-sm text-red-800 space-y-0.5 list-disc pl-5">
                  {flags.map((q) => <li key={q.id}>{fill(q.q, app)} — <b>{v.answers[q.id].value}</b>{v.answers[q.id].details ? ` (${v.answers[q.id].details})` : ''}</li>)}
                </ul>
              </div>
            ) : unanswered(v).length === 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-1.5"><CheckCircle size={15} /> No warning signs in the answers.</div>
            )}
            {unanswered(v).length > 0 && <p className="text-sm text-amber-700">{unanswered(v).length} required question(s) not answered yet.</p>}
            <div>
              <p className="label">Verdict</p>
              <div className="flex flex-wrap gap-1.5">
                {VERDICTS.map((x) => <button key={x} type="button" className={chip(verdict === x, x.startsWith('Not') ? 'red' : x === VERDICTS[0] ? 'green' : 'dark')} onClick={() => setVerdict(x)}>{x}</button>)}
              </div>
            </div>
            <textarea className="input min-h-[80px]" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Your overall impression — anything the person approving should know" />
          </div>
        )}

        {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p>}

        {at >= 0 && (
          <div className="flex gap-2 pt-1">
            {at > 0 && <button type="button" className="btn-secondary flex items-center gap-1" disabled={busy} onClick={() => go(at - 1)}><ArrowLeft size={14} /> Back</button>}
            {at < n
              ? <button type="button" className="btn-primary flex items-center gap-1 ml-auto" disabled={busy} onClick={() => go(at + 1)}>{busy ? 'Saving…' : <>Next: {at + 1 < n ? SECTIONS[at + 1].title : 'Summary'} <ArrowRight size={14} /></>}</button>
              : <button type="button" className="btn-primary flex items-center gap-1 ml-auto" disabled={busy} onClick={finish}><CheckCircle size={14} /> {v.finishedAt ? 'Save changes' : 'Finish the call'}</button>}
          </div>
        )}
        {at >= 0 && at < n && <p className="text-[11px] text-navy-400 text-right -mt-2">Answers are saved at every step — if the call drops, open it again to carry on.</p>}
      </div>
    </Modal>
  );
}
