import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import StatusBadge from '../components/ui/StatusBadge';
import {
  CreditCard, Users, Clock, CheckCircle2, Search, ChevronDown,
  Wallet, Building2, UserRound, HandCoins, AlertTriangle, MessageSquare, Phone,
} from 'lucide-react';
import { creditRecords, type CreditRecord } from '../lib/credit';
import type { Booking } from '../types';
import { sendSms, smsTemplates } from '../lib/sms';
import { openWhatsApp, buildCreditReminderMsg } from '../lib/whatsapp';
import { toast } from '../store/useToast';

type RespFilter = 'all' | 'self' | 'owner' | 'company';
type StatusFilter = 'outstanding' | 'settled' | 'all';

const RESP_LABEL: Record<string, string> = { self: 'Vehicle owner', owner: 'Referring owner', company: 'Company' };
const money = (n: number) => `Rs ${n.toLocaleString()}`;

export default function CreditManagement() {
  const { bookings, vehicles, owners, settleCredit } = useStore();
  const { isAdmin } = useAuthStore();

  const [search, setSearch] = useState('');
  const [resp, setResp] = useState<RespFilter>('all');
  const [statusF, setStatusF] = useState<StatusFilter>('outstanding');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [reminderSent, setReminderSent] = useState<Record<string, 'sms' | 'whatsapp' | null>>({});

  const flashSent = (key: string, channel: 'sms' | 'whatsapp') => {
    setReminderSent((s) => ({ ...s, [key]: channel }));
    setTimeout(() => setReminderSent((s) => ({ ...s, [key]: null })), 3000);
  };

  const sendSmsReminder = async (key: string, phone: string, name: string, amount: number, count: number) => {
    await sendSms(phone, smsTemplates.creditReminder(name, amount, count), { category: 'creditReminder', role: 'customer' });
    flashSent(key, 'sms');
    toast.success('SMS sent', `Reminder sent to ${name}.`);
  };

  const sendWhatsAppReminder = (key: string, phone: string, name: string, amount: number, count: number) => {
    openWhatsApp(phone, buildCreditReminderMsg(name, amount, count));
    flashSent(key, 'whatsapp');
  };

  const records = useMemo(() => creditRecords(bookings), [bookings]);

  const vLabel = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.brand} ${v.model} · ${v.vehicleNumber}` : '—';
  };
  const ownerOf = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return owners.find((o) => o.id === v?.ownerId)?.name ?? '—';
  };
  const custKey = (b: Booking) => b.customerId || b.customerPhone;

  // KPI totals (outstanding only)
  const outstanding = records.filter((r) => !r.settled);
  const totalOutstanding = outstanding.reduce((s, r) => s + r.amount, 0);
  const totalSettled = records.filter((r) => r.settled).reduce((s, r) => s + r.amount, 0);
  const customersWithCredit = new Set(outstanding.map((r) => custKey(r.booking))).size;
  const byResp = { self: 0, owner: 0, company: 0 } as Record<string, number>;
  outstanding.forEach((r) => { byResp[r.booking.creditResponsibility ?? 'self'] += r.amount; });

  // Filter records
  const q = search.trim().toLowerCase();
  const filtered = records.filter((r) => {
    if (statusF === 'outstanding' && r.settled) return false;
    if (statusF === 'settled' && !r.settled) return false;
    if (resp !== 'all' && (r.booking.creditResponsibility ?? 'self') !== resp) return false;
    if (q) {
      const hay = `${r.booking.customerName} ${r.booking.customerPhone} ${vLabel(r.booking.vehicleId)} ${ownerOf(r.booking.vehicleId)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Group filtered records by customer
  const groups = useMemo(() => {
    const map: Record<string, { name: string; phone: string; records: CreditRecord[]; outstanding: number }> = {};
    filtered.forEach((r) => {
      const key = custKey(r.booking);
      const g = (map[key] ??= { name: r.booking.customerName, phone: r.booking.customerPhone, records: [], outstanding: 0 });
      g.records.push(r);
      if (!r.settled) g.outstanding += r.amount;
    });
    return Object.entries(map)
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.outstanding - a.outstanding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  if (!isAdmin()) {
    return (
      <div>
        <Header title="Credit Management" subtitle="Outstanding customer credit" />
        <div className="card text-center py-16">
          <AlertTriangle size={40} className="text-navy-200 mx-auto mb-3" />
          <p className="text-navy-500 text-sm">This page is available to administrators only.</p>
        </div>
      </div>
    );
  }

  const kpis = [
    { label: 'Total Credit To Be Received', value: money(totalOutstanding), icon: CreditCard, color: 'bg-amber-500', note: `${outstanding.length} pending booking${outstanding.length !== 1 ? 's' : ''}` },
    { label: 'Customers With Credit', value: String(customersWithCredit), icon: Users, color: 'bg-navy-700', note: 'have an outstanding balance' },
    { label: 'Collected', value: money(totalSettled), icon: CheckCircle2, color: 'bg-emerald-500', note: 'credit already settled' },
    { label: 'Pending Bookings', value: String(outstanding.length), icon: Clock, color: 'bg-navy-700', note: 'awaiting payment' },
  ];

  return (
    <div>
      <Header title="Credit Management" subtitle="Track and settle outstanding customer credit" />

      {totalOutstanding > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center text-white flex-shrink-0"><Wallet size={18} /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">{money(totalOutstanding)} in customer credit to be received</p>
            <p className="text-xs text-amber-700 mt-0.5">The company is not responsible for credit payments — owners must collect from their customers.</p>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map(({ label, value, icon: Icon, color, note }) => (
          <div key={label} className="card flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${color}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-navy-400 font-medium">{label}</p>
              <p className="text-xl font-bold text-navy-800">{value}</p>
              <p className="text-[10px] text-navy-300 mt-0.5 truncate">{note}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Responsibility breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {([['self', UserRound, 'bg-navy-100 text-navy-700'], ['owner', HandCoins, 'bg-amber-100 text-amber-700'], ['company', Building2, 'bg-blue-100 text-blue-700']] as const).map(([key, Icon, cls]) => (
          <div key={key} className="card flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cls}`}><Icon size={16} /></div>
            <div className="flex-1">
              <p className="text-xs text-navy-400">{RESP_LABEL[key]} liable</p>
              <p className="text-base font-bold text-navy-800">{money(byResp[key])}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Records grouped by customer */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <p className="section-title">Credit by Customer</p>
            <p className="text-xs text-navy-400 mt-0.5">{groups.length} customer{groups.length !== 1 ? 's' : ''} · {filtered.length} record{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-full sm:w-56">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 pointer-events-none" />
              <input className="input pl-10 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, vehicle…" />
            </div>
            <div className="flex bg-navy-50 rounded-xl p-0.5 gap-0.5">
              {(['outstanding', 'settled', 'all'] as const).map((s) => (
                <button key={s} onClick={() => setStatusF(s)}
                  className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold capitalize transition-all ${statusF === s ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="flex bg-navy-50 rounded-xl p-0.5 gap-0.5">
              {(['all', 'self', 'owner', 'company'] as const).map((r) => (
                <button key={r} onClick={() => setResp(r)}
                  className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${resp === r ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}>
                  {r === 'all' ? 'All' : RESP_LABEL[r].split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="text-center py-16 text-navy-400 text-sm">
            <CreditCard size={40} className="text-navy-200 mx-auto mb-3" />
            No credit records match your filters.
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((g, i) => {
              const isOpen = !!open[g.key];
              return (
                <div key={g.key} className="border border-navy-100 rounded-xl overflow-hidden anim-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                  <button onClick={() => setOpen((m) => ({ ...m, [g.key]: !m[g.key] }))} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-navy-50/60 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-navy-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {g.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-semibold text-navy-800 truncate">{g.name}</p>
                      <p className="text-xs text-navy-400">{g.phone} · {g.records.length} record{g.records.length !== 1 ? 's' : ''}</p>
                    </div>
                    {g.outstanding > 0
                      ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-lg flex-shrink-0"><Clock size={12} /> {money(g.outstanding)}</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg flex-shrink-0"><CheckCircle2 size={12} /> Settled</span>}

                    {/* Reminder buttons — only for customers with an outstanding balance */}
                    {g.outstanding > 0 && (
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {reminderSent[g.key] === 'sms' ? (
                          <span className="text-[10px] text-emerald-600 font-semibold px-2">SMS sent ✓</span>
                        ) : (
                          <button
                            onClick={() => sendSmsReminder(g.key, g.phone, g.name, g.outstanding, g.records.filter((r) => !r.settled).length)}
                            className="p-1.5 rounded-lg text-navy-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                            title="Send SMS reminder"
                          >
                            <Phone size={15} />
                          </button>
                        )}
                        {reminderSent[g.key] === 'whatsapp' ? (
                          <span className="text-[10px] text-emerald-600 font-semibold px-2">WhatsApp ✓</span>
                        ) : (
                          <button
                            onClick={() => sendWhatsAppReminder(g.key, g.phone, g.name, g.outstanding, g.records.filter((r) => !r.settled).length)}
                            className="p-1.5 rounded-lg text-navy-400 hover:bg-green-50 hover:text-green-600 transition-colors"
                            title="Send WhatsApp reminder"
                          >
                            <MessageSquare size={15} />
                          </button>
                        )}
                      </div>
                    )}

                    <ChevronDown size={16} className={`text-navy-400 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isOpen && (
                    <div className="border-t border-navy-50 bg-navy-50/30 px-4 py-3 overflow-x-auto">
                      <table className="w-full min-w-[640px] text-xs">
                        <thead>
                          <tr className="text-navy-400">
                            <th className="text-left font-medium pb-2">Vehicle</th>
                            <th className="text-left font-medium pb-2">Owner</th>
                            <th className="text-left font-medium pb-2">Dates</th>
                            <th className="text-center font-medium pb-2">Liability</th>
                            <th className="text-right font-medium pb-2">Credit</th>
                            <th className="text-center font-medium pb-2">Status</th>
                            <th className="text-right font-medium pb-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.records.map((r) => (
                            <tr key={r.booking.id} className="border-t border-navy-100/60">
                              <td className="py-2 text-navy-700">{vLabel(r.booking.vehicleId)}</td>
                              <td className="py-2 text-navy-600">{ownerOf(r.booking.vehicleId)}</td>
                              <td className="py-2 text-navy-500">{r.booking.startDate} → {r.booking.endDate}</td>
                              <td className="py-2 text-center">
                                <span className="text-[10px] bg-navy-50 text-navy-600 px-2 py-0.5 rounded-full">{RESP_LABEL[r.booking.creditResponsibility ?? 'self']}</span>
                              </td>
                              <td className="py-2 text-right font-semibold text-amber-700">{money(r.amount)}</td>
                              <td className="py-2 text-center"><StatusBadge status={r.settled ? 'Paid' : 'Pending'} /></td>
                              <td className="py-2 text-right">
                                {r.settled
                                  ? <span className="text-[11px] text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Collected</span>
                                  : <button onClick={() => settleCredit(r.booking.id)} className="text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded-lg transition-colors">Mark Collected</button>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
