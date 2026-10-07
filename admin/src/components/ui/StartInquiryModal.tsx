import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhoneCall, MessageCircle, Phone, MoreHorizontal, CheckCircle2, PhoneOff, PhoneMissed, Clock, XCircle } from 'lucide-react';
import Modal from './Modal';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import { addFollowUp, intlDigits, FollowUp } from '../../lib/inquiryFollowups';
import { CONTACT_METHODS, CONTACT_STATUSES, advance, emptyConsultation } from '../../lib/consultation';
import type { Inquiry } from '../../types';

const METHOD_ICON = { 'WhatsApp call': PhoneCall, 'Normal call': Phone, 'WhatsApp chat': MessageCircle, Other: MoreHorizontal } as const;
const STATUS_ICON = { Connected: CheckCircle2, 'No answer': PhoneMissed, Busy: PhoneOff, 'Call back requested': Clock, 'Wrong number': XCircle } as const;

/**
 * "Start inquiry": record who contacted the customer, how, which attempt, and whether they
 * got through. Connected → the Inquiry Consultation workspace opens.
 */
export default function StartInquiryModal({ inquiry, open, onClose, onLogged }: {
  inquiry: Inquiry; open: boolean; onClose: () => void; onLogged?: (f: FollowUp) => void;
}) {
  const navigate = useNavigate();
  const patchInquiry = useStore((s) => s.patchInquiry);
  const staff = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const [method, setMethod] = useState<string>('WhatsApp call');
  const [status, setStatus] = useState<string>('Connected');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const attempt = (inquiry.consultation?.attempts.length ?? 0) + 1;
  const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

  const save = async () => {
    setBusy(true);
    const c = inquiry.consultation ?? emptyConsultation(staff);
    const consultation = { ...c, attempts: [...c.attempts, { at: new Date().toISOString(), by: staff, method, status, note: note.trim() || undefined }] };
    const connected = status === 'Connected';
    const stage = connected ? advance(inquiry.stage, 'CONSULTATION')
      : status === 'Wrong number' ? 'NO_RESPONSE' : advance(inquiry.stage, 'CONTACTING');
    patchInquiry(inquiry.id, { consultation, stage });
    // also in the contact log, so response time and lead temperature keep working
    try {
      const f = await addFollowUp({
        inquiryId: inquiry.id, channel: method.startsWith('WhatsApp') ? 'WhatsApp' : method === 'Normal call' ? 'Call' : 'In person',
        outcome: status, response: `${ord(attempt)} attempt · ${method}${note.trim() ? ` — ${note.trim()}` : ''}`, staff,
      });
      onLogged?.(f);
    } catch { /* contact log is optional */ }
    setBusy(false);
    setNote('');
    onClose();
    if (connected) navigate(`/inquiries/${inquiry.id}/consultation`);
    else toast.info(`${ord(attempt)} attempt logged`, status === 'Call back requested' ? 'Set a reminder to call back.' : 'Try again later or send a WhatsApp message.');
  };

  const chip = (on: boolean) => `flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold text-left transition-colors ${on ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-navy-100 text-navy-700 hover:bg-navy-50'}`;

  return (
    <Modal open={open} onClose={onClose} title="Start inquiry">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-navy-50/70 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-navy-800 truncate">{inquiry.customerName}</p>
            <p className="text-xs text-navy-500">{inquiry.customerPhone} · {inquiry.requestedVehicle}</p>
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wide text-navy-500 bg-white rounded-full px-2.5 py-1 border border-navy-100">{ord(attempt)} attempt</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <a href={`https://wa.me/${intlDigits(inquiry.customerPhone)}`} target="_blank" rel="noreferrer" onClick={() => setMethod('WhatsApp chat')}
             className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"><MessageCircle size={15} /> Open WhatsApp</a>
          <a href={`tel:+${intlDigits(inquiry.customerPhone)}`} onClick={() => setMethod('Normal call')}
             className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold bg-navy-700 text-white hover:bg-navy-600"><Phone size={15} /> Call now</a>
        </div>

        <div>
          <p className="label">Contact method</p>
          <div className="grid grid-cols-2 gap-2">
            {CONTACT_METHODS.map((m) => { const I = METHOD_ICON[m]; return (
              <button key={m} type="button" onClick={() => setMethod(m)} className={chip(method === m)}><I size={16} /> {m}</button>
            ); })}
          </div>
        </div>

        <div>
          <p className="label">Contact status</p>
          <div className="grid grid-cols-2 gap-2">
            {CONTACT_STATUSES.map((s) => { const I = STATUS_ICON[s]; return (
              <button key={s} type="button" onClick={() => setStatus(s)} className={chip(status === s)}><I size={16} /> {s}</button>
            ); })}
          </div>
        </div>

        <div>
          <p className="label">Note (optional)</p>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={status === 'Call back requested' ? 'e.g. call back after 6 PM' : 'Anything worth remembering'} />
        </div>

        <p className="text-[11px] text-navy-400">Started by <b>{staff}</b> · {new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
            {status === 'Connected' ? 'Connected — open consultation' : 'Log attempt'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
