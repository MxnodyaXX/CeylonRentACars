import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, MessageCircle, ArrowLeft, ExternalLink, AlertTriangle, PlayCircle, X, FileText } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import WhatsAppChat from '../components/ui/WhatsAppChat';
import { useStore } from '../store/useStore';
import {
  WaChat, WaMessage, loadChats, loadMessages, subscribeMessages, unreadByPhone, upsertMessage, waPhone, whatsappDemo, whatsappEnabled,
} from '../lib/whatsappInbox';
import { setDemo } from '../lib/whatsappDemo';
import { parseRequest } from '../lib/inquiryFollowups';

const when = (d: string) => {
  const t = new Date(d);
  return t.toDateString() === new Date().toDateString()
    ? t.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
    : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const preview = (m: WaMessage) =>
  m.body?.replace(/\*/g, '') || (m.mediaId ? (m.kind === 'image' ? '📷 Photo' : `📎 ${m.mediaName ?? 'File'}`) : m.kind);

/** WhatsApp inbox: every customer conversation, matched to its inquiry by phone number */
export default function Messages() {
  const inquiries = useStore((s) => s.inquiries);
  const [params, setParams] = useSearchParams();
  const [msgs, setMsgs] = useState<WaMessage[]>([]);
  const [chats, setChats] = useState<WaChat[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const active = params.get('phone') ?? '';
  const isAdmin = useAuthStore((s) => s.isAdmin)();

  useEffect(() => {
    if (!whatsappEnabled) return;
    const refreshChats = () => loadChats().then(setChats).catch(() => {});
    loadMessages().then(setMsgs).catch((e) => setError(e.message));
    refreshChats();
    const off = subscribeMessages((m) => { setMsgs((l) => upsertMessage(l, m)); refreshChats(); });
    const onRead = () => refreshChats();
    window.addEventListener('wa:read', onRead);
    return () => { off(); window.removeEventListener('wa:read', onRead); };
  }, []);

  // Latest inquiry per customer phone
  const inquiryFor = useMemo(() => {
    const m = new Map<string, (typeof inquiries)[number]>();
    [...inquiries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach((i) => { if (i.customerPhone) m.set(waPhone(i.customerPhone), i); });
    return m;
  }, [inquiries]);

  const unread = useMemo(() => unreadByPhone(msgs, chats), [msgs, chats]);

  const conversations = useMemo(() => {
    const last = new Map<string, WaMessage>();
    msgs.forEach((m) => last.set(m.phone, m));
    const q = query.trim().toLowerCase();
    return [...last.values()]
      .map((m) => {
        const inq = inquiryFor.get(m.phone);
        const name = inq?.customerName ?? chats.find((c) => c.phone === m.phone)?.name ?? `+${m.phone}`;
        return { phone: m.phone, name, last: m, inquiry: inq, unread: unread.get(m.phone) ?? 0 };
      })
      .filter((c) => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q))
      .sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt));
  }, [msgs, chats, inquiryFor, unread, query]);

  const current = conversations.find((c) => c.phone === active);
  const inq = current?.inquiry ?? inquiryFor.get(active);
  const context: Record<string, string> = inq ? {
    name: inq.customerName.trim().split(' ')[0],
    vehicle: inq.requestedVehicle.replace(/\s*\(.*\)$/, ''),
    dates: inq.startDate && inq.endDate ? `${inq.startDate} to ${inq.endDate}` : '',
    reference: parseRequest(inq.notes).reference ?? 'your inquiry',
  } : { name: current?.name ?? '' };

  if (!whatsappEnabled) {
    return (
      <div>
        <Header title="Messages" subtitle="WhatsApp conversations with customers" />
        <div className="card !p-6 border border-amber-200 bg-amber-50 text-sm text-amber-800 flex gap-3">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">WhatsApp inbox isn't switched on yet.</p>
            <p>Follow <code>admin/supabase/WHATSAPP.md</code> and the <Link to="/whatsapp-setup" className="font-semibold underline">Connect WhatsApp</Link> page (Meta setup, run <code>whatsapp.sql</code>, deploy the functions),
              then add <code>VITE_WHATSAPP_ENABLED=true</code> to <code>admin/.env.local</code> and restart the admin.</p>
            <button type="button" onClick={() => setDemo(true)}
                    className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
              <PlayCircle size={16} /> Try the demo (sample chats — nothing is sent)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Messages" subtitle="WhatsApp conversations with customers" />
      {isAdmin && (
        <div className="flex justify-end -mt-2 mb-3">
          <Link to="/whatsapp-templates" className="btn-secondary !py-1.5 text-xs flex items-center gap-1.5"><FileText size={14} /> Message templates</Link>
        </div>
      )}
      {whatsappDemo && (
        <div className="card !p-3 mb-3 flex items-center gap-3 text-sm bg-sky-50 border border-sky-200 text-sky-800">
          <PlayCircle size={18} className="flex-shrink-0" />
          <p className="flex-1"><b>Demo mode</b> — sample conversations; nothing is sent to anyone. Try replying: ticks turn blue and the customer answers. Also visible on each inquiry.</p>
          <button type="button" onClick={() => setDemo(false)} className="btn-secondary !py-1.5 text-xs flex items-center gap-1"><X size={13} /> Exit demo</button>
        </div>
      )}
      {error && <p className="card !p-3 mb-3 text-sm text-red-700 bg-red-50">Run <code>admin/supabase/whatsapp.sql</code> in Supabase — {error}</p>}

      <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
        {/* Conversation list */}
        <section className={`card !p-0 overflow-hidden ${active ? 'hidden lg:block' : ''}`}>
          <div className="p-3 border-b border-navy-100">
            <div className="flex items-center gap-2 bg-navy-50 rounded-xl px-3 py-2">
              <Search size={15} className="text-navy-400" />
              <input className="bg-transparent outline-none text-sm flex-1" placeholder="Search name or number" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <ul className="max-h-[70vh] overflow-y-auto divide-y divide-navy-50">
            {conversations.length === 0 && <li className="p-6 text-center text-sm text-navy-400">No conversations yet. Messages appear here as customers write to your WhatsApp number.</li>}
            {conversations.map((c) => (
              <li key={c.phone}>
                <button type="button" onClick={() => setParams({ phone: c.phone })}
                        className={`w-full text-left flex items-center gap-3 px-3 py-3 hover:bg-navy-50 ${c.phone === active ? 'bg-navy-50' : ''}`}>
                  <span className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                    {c.name.replace('+', '').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <b className="text-sm text-navy-800 truncate">{c.name}</b>
                      <span className={`text-[11px] flex-shrink-0 ${c.unread ? 'text-emerald-600 font-bold' : 'text-navy-400'}`}>{when(c.last.createdAt)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs text-navy-500 truncate">{c.last.direction === 'out' ? 'You: ' : ''}{preview(c.last)}</span>
                      {c.unread > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">{c.unread}</span>}
                    </span>
                    {c.inquiry && <span className="block text-[10px] text-navy-400 truncate mt-0.5">Inquiry · {c.inquiry.requestedVehicle} · {c.inquiry.status}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Open chat */}
        <section className={`card !p-3 ${active ? '' : 'hidden lg:block'}`}>
          {active ? (
            <>
              <div className="flex items-center gap-3 mb-3">
                <button type="button" className="lg:hidden p-1.5 rounded-lg hover:bg-navy-50" onClick={() => setParams({})} aria-label="Back"><ArrowLeft size={18} /></button>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-navy-800 truncate">{current?.name ?? `+${active}`}</p>
                  <p className="text-xs text-navy-400">+{active}</p>
                </div>
                {inq && (
                  <Link to={`/inquiries/${inq.id}`} className="btn-secondary !py-1.5 text-xs flex items-center gap-1">
                    Open inquiry <ExternalLink size={12} />
                  </Link>
                )}
              </div>
              <WhatsAppChat phone={active} context={context} height="h-[64vh]" />
            </>
          ) : (
            <div className="h-[60vh] flex flex-col items-center justify-center text-navy-400">
              <MessageCircle size={36} className="text-emerald-600 mb-2" />
              <p className="text-sm">Choose a conversation</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
