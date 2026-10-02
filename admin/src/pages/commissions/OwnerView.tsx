import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import StatusBadge from '../../components/ui/StatusBadge';
import Select from '../../components/ui/Select';
import DateInput from '../../components/ui/DateInput';
import Modal from '../../components/ui/Modal';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  DollarSign, TrendingUp, Percent, Bell, Car, Send,
  Search, X, FileSpreadsheet, FileText, Eye,
  User, Phone, Mail, CreditCard, MapPin, Gauge, CalendarDays, Wallet, ArrowRightLeft,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { Booking, VehicleHandover } from '../../types';
import { bookingDiscount } from '../../lib/revenue';

const BAR_COLORS = ['#E11D2A', '#10B981', '#F59E0B', '#8B5CF6', '#111114', '#EC4899'];
type PeriodKey = 'all' | 'week' | 'month' | 'year' | 'custom';

/* ── Shared hooks / helpers ─────────────────────────────────────── */
function usePeriodRange(period: PeriodKey, dateFrom: string, dateTo: string) {
  return useMemo(() => {
    const now = new Date();
    const f = (d: Date) => format(d, 'yyyy-MM-dd');
    switch (period) {
      case 'week':   return { from: f(startOfWeek(now, { weekStartsOn: 1 })), to: f(endOfWeek(now, { weekStartsOn: 1 })) };
      case 'month':  return { from: f(startOfMonth(now)), to: f(endOfMonth(now)) };
      case 'year':   return { from: f(startOfYear(now)), to: f(endOfYear(now)) };
      case 'custom': return { from: dateFrom, to: dateTo };
      default:       return { from: '', to: '' };
    }
  }, [period, dateFrom, dateTo]);
}

function PeriodPills({ period, setPeriod, dateFrom, setDateFrom, dateTo, setDateTo, dateRange }: {
  period: PeriodKey; setPeriod: (v: PeriodKey) => void;
  dateFrom: string; setDateFrom: (v: string) => void;
  dateTo: string;   setDateTo:   (v: string) => void;
  dateRange: { from: string; to: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 mb-4">
      <div className="flex bg-navy-50 rounded-xl p-0.5 gap-0.5">
        {(['all', 'week', 'month', 'year', 'custom'] as const).map((key) => (
          <button key={key} onClick={() => setPeriod(key)}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${
              period === key ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'
            }`}>
            {key === 'all' ? 'All time' : key === 'week' ? 'This Week' : key === 'month' ? 'This Month' : key === 'year' ? 'This Year' : 'Custom'}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <DateInput value={dateFrom} onChange={setDateFrom} maxDate={dateTo || undefined} placeholder="From" className="w-36" />
          <span className="text-xs text-navy-400">to</span>
          <DateInput value={dateTo} onChange={setDateTo} minDate={dateFrom || undefined} placeholder="To" className="w-36" />
        </div>
      )}
      {period !== 'all' && period !== 'custom' && (
        <span className="text-xs text-navy-400">{dateRange.from} → {dateRange.to}</span>
      )}
    </div>
  );
}

/* ── Rent Detail popup ──────────────────────────────────────────── */
function RentDetailModal({ booking, handovers, onClose }: {
  booking: Booking | null;
  handovers: VehicleHandover[];
  onClose: () => void;
}) {
  const { vehicles, drivers } = useStore();
  if (!booking) return null;

  const vehicle  = vehicles.find((v) => v.id === booking.vehicleId);
  const driver   = booking.driverId ? drivers.find((d) => d.id === booking.driverId) : null;
  const delivery = handovers.find((h) => h.bookingId === booking.id && h.type === 'delivery');
  const ret      = handovers.find((h) => h.bookingId === booking.id && h.type === 'return');

  const startMileage = delivery?.mileage;
  const endMileage   = ret?.mileage;
  const kmDriven     = startMileage != null && endMileage != null ? endMileage - startMileage : null;
  const outstanding  = Math.max(0, booking.totalAmount - (booking.discount ?? 0) - booking.paidAmount);

  const Row = ({ icon, label, value, valueClass = '' }: { icon: React.ReactNode; label: string; value: React.ReactNode; valueClass?: string }) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-navy-50 last:border-0">
      <span className="text-navy-300 mt-0.5 flex-shrink-0">{icon}</span>
      <span className="text-xs text-navy-400 w-32 flex-shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm font-medium text-navy-800 flex-1 ${valueClass}`}>{value ?? <span className="text-navy-300">—</span>}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Rent Details" width="max-w-2xl">
      <div className="space-y-5">

        {/* Header strip */}
        <div className="flex items-center gap-4 p-4 bg-navy-50/60 rounded-2xl">
          <div className="w-12 h-12 rounded-xl bg-navy-700 flex items-center justify-center text-white flex-shrink-0">
            <Car size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-navy-800 truncate">
              {vehicle ? `${vehicle.brand} ${vehicle.model}` : '—'}
            </p>
            <p className="text-xs text-navy-400">{vehicle?.vehicleNumber} · {booking.startDate} to {booking.endDate} · {booking.totalDays} day{booking.totalDays !== 1 ? 's' : ''}</p>
          </div>
          <StatusBadge status={booking.status} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Customer */}
          <div>
            <p className="text-xs font-bold text-navy-500 uppercase tracking-wide mb-2">Customer</p>
            <div>
              <Row icon={<User size={14}/>}       label="Name"    value={booking.customerName} />
              <Row icon={<Phone size={14}/>}      label="Phone"   value={booking.customerPhone} />
              <Row icon={<Mail size={14}/>}       label="Email"   value={booking.customerEmail} />
              <Row icon={<CreditCard size={14}/>} label="NIC"     value={booking.customerNIC} />
            </div>
          </div>

          {/* Trip */}
          <div>
            <p className="text-xs font-bold text-navy-500 uppercase tracking-wide mb-2">Trip</p>
            <div>
              <Row icon={<CalendarDays size={14}/>} label="Start Date"  value={booking.startDate} />
              <Row icon={<CalendarDays size={14}/>} label="End Date"    value={booking.endDate} />
              <Row icon={<CalendarDays size={14}/>} label="Days"        value={`${booking.totalDays} day${booking.totalDays !== 1 ? 's' : ''}`} />
              <Row icon={<MapPin size={14}/>}       label="Pickup"      value={booking.pickupLocation} />
              <Row icon={<MapPin size={14}/>}       label="Drop-off"    value={booking.dropLocation} />
              {driver && <Row icon={<User size={14}/>} label="Driver" value={driver.name} />}
            </div>
          </div>

          {/* Mileage */}
          <div>
            <p className="text-xs font-bold text-navy-500 uppercase tracking-wide mb-2">Mileage</p>
            <div>
              <Row icon={<Gauge size={14}/>} label="Start Mileage" value={startMileage != null ? `${startMileage.toLocaleString()} km` : undefined} />
              <Row icon={<Gauge size={14}/>} label="End Mileage"   value={endMileage   != null ? `${endMileage.toLocaleString()} km`   : undefined} />
              <Row icon={<Gauge size={14}/>} label="Km Driven"     value={kmDriven     != null ? `${kmDriven.toLocaleString()} km`     : undefined} />
              {(ret?.extraKm ?? 0) > 0 && (
                <>
                  <Row icon={<Gauge size={14}/>}  label="Extra Km"       value={`${ret!.extraKm!.toLocaleString()} km`} />
                  <Row icon={<DollarSign size={14}/>} label="Extra Km Charge" value={`Rs ${(ret!.extraKmCharge ?? 0).toLocaleString()}`} valueClass="text-amber-700" />
                </>
              )}
              {delivery?.fuelLevel && <Row icon={<Gauge size={14}/>} label="Fuel (out)" value={delivery.fuelLevel} />}
              {ret?.fuelLevel && <Row icon={<Gauge size={14}/>} label="Fuel (in)" value={ret.fuelLevel} />}
            </div>
          </div>

          {/* Financials */}
          <div>
            <p className="text-xs font-bold text-navy-500 uppercase tracking-wide mb-2">Financials</p>
            <div>
              <Row icon={<Wallet size={14}/>}     label="Total Amount"  value={`Rs ${booking.totalAmount.toLocaleString()}`} />
              {ret?.finalAmount != null && ret.finalAmount !== booking.totalAmount && (
                <Row icon={<Wallet size={14}/>} label="Final Amount" value={`Rs ${ret.finalAmount.toLocaleString()}`} valueClass="font-bold" />
              )}
              <Row icon={<Wallet size={14}/>}     label="Advance Paid"  value={`Rs ${booking.paidAmount.toLocaleString()}`} valueClass="text-emerald-700" />
              <Row icon={<Wallet size={14}/>}     label="Outstanding"
                value={outstanding > 0 ? `Rs ${outstanding.toLocaleString()}` : 'Fully paid'}
                valueClass={outstanding > 0 ? 'text-amber-700' : 'text-emerald-600'} />
              {(booking.depositAmount ?? 0) > 0 && (
                <>
                  <Row icon={<Wallet size={14}/>} label="Deposit"         value={`Rs ${booking.depositAmount!.toLocaleString()}`} />
                  {(booking.depositReturned ?? 0) > 0 && <Row icon={<Wallet size={14}/>} label="Deposit Returned" value={`Rs ${booking.depositReturned!.toLocaleString()}`} valueClass="text-emerald-700" />}
                  {(booking.depositDeduction ?? 0) > 0 && <Row icon={<Wallet size={14}/>} label="Deposit Deducted" value={`Rs ${booking.depositDeduction!.toLocaleString()}`} valueClass="text-red-600" />}
                </>
              )}
              {(booking.referralFee ?? 0) > 0 && (
                <Row icon={<ArrowRightLeft size={14}/>} label="Referral Fee" value={`Rs ${booking.referralFee!.toLocaleString()} (${booking.referral})`} valueClass="text-amber-600" />
              )}
            </div>
          </div>
        </div>

        {/* Notes */}
        {booking.notes && (
          <div className="bg-navy-50/60 rounded-xl p-3">
            <p className="text-xs font-semibold text-navy-500 mb-1">Notes</p>
            <p className="text-sm text-navy-700">{booking.notes}</p>
          </div>
        )}
        {booking.depositNotes && (
          <div className="bg-amber-50/60 rounded-xl p-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">Deposit Notes</p>
            <p className="text-sm text-navy-700">{booking.depositNotes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Export helpers ─────────────────────────────────────────────── */
const stamp = () => new Date().toISOString().slice(0, 10);
const esc   = (v: string | number) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const fmtRs = (n: number) => 'Rs ' + n.toLocaleString();

const PDF_STYLE = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181B;padding:28px 32px}
  @media print{@page{margin:12mm;size:A4 landscape}}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #27272A;padding-bottom:12px;margin-bottom:6px}
  .brand{font-size:22px;font-weight:900;color:#27272A} .sub{font-size:11px;color:#71717A}
  h1{font-size:15px;color:#27272A;margin-top:14px} .meta{font-size:11px;color:#71717A;margin:4px 0 14px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#27272A;color:#fff;text-align:left;padding:7px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  th.num,td.num{text-align:right} th.ctr,td.ctr{text-align:center}
  td{padding:7px 9px;border-bottom:1px solid #E4E4E7;vertical-align:top} td small{color:#A1A1AA;font-size:9px}
  tr:nth-child(even) td{background:#FAFAFA}
  .badge{background:#F1F1F3;color:#52525B;border-radius:999px;padding:2px 8px;font-size:9px;font-weight:600}
  tfoot td{background:#27272A;color:#fff;font-weight:700;padding:9px;border:none}
  .footer{margin-top:16px;text-align:center;font-size:10px;color:#A1A1AA}
`;

function openPdf(html: string) {
  const win = window.open('', '_blank', 'width=1100,height=720');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function pdfShell(title: string, ownerName: string, count: number, thead: string, tbody: string, tfoot: string) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${PDF_STYLE}</style></head><body>
    <div class="head"><div><div class="brand">Ceylon Rent A Cars</div><div class="sub">Vehicle Rentals Across Sri Lanka</div></div>
    <div style="text-align:right"><div class="sub">Generated</div><div style="font-weight:700">${new Date().toLocaleDateString('en-LK',{day:'2-digit',month:'short',year:'numeric'})}</div></div></div>
    <h1>${title} — ${ownerName}</h1><div class="meta">${count} record${count !== 1 ? 's' : ''}</div>
    <table><thead>${thead}</thead><tbody>${tbody || `<tr><td colspan="8" style="text-align:center;padding:24px;color:#A1A1AA">No records.</td></tr>`}</tbody><tfoot>${tfoot}</tfoot></table>
    <div class="footer">Ceylon Rent A Cars · ceylonrentacars.lk</div></body></html>`;
}

/* ══════════════════════════════════════════════════════════════════ */
export default function OwnerView() {
  const { commissions, vehicles, bookings, owners, handovers, drivers, addNotification } = useStore();
  const { currentUser } = useAuthStore();
  const ownerId = currentUser?.ownerId ?? '';

  const [alertOpen,    setAlertOpen]    = useState(false);
  const [alertRemarks, setAlertRemarks] = useState('');
  const [detailBooking, setDetailBooking] = useState<Booking | null>(null);

  /* ── Scoped data ───────────────────────────────────────────────── */
  const myOwner      = owners.find((o) => o.id === ownerId);
  const myName       = myOwner?.name ?? '';
  const myVehicles   = vehicles.filter((v) => v.ownerId === ownerId);
  const myVehicleIds = useMemo(() => new Set(myVehicles.map((v) => v.id)), [myVehicles]);
  const myBookings   = useMemo(() => bookings.filter((b) => myVehicleIds.has(b.vehicleId)), [bookings, myVehicleIds]);
  const myCommissions  = commissions.filter((c) => c.ownerId === ownerId);
  const pendingPayouts = myCommissions.filter((c) => c.status === 'Pending');

  /* Income earned by referring OTHER owners' vehicles */
  const referralIncome = useMemo(
    () => commissions.filter((c) => c.referral === myName && c.ownerId !== ownerId),
    [commissions, myName, ownerId]
  );

  /* ── KPIs ──────────────────────────────────────────────────────── */
  // Net of any discount granted on the underlying booking.
  const totalRevenue     = myCommissions.reduce((s, c) => {
    const bk = bookings.find((b) => b.id === c.bookingId);
    return s + c.totalIncome - (bk ? bookingDiscount(bk) : 0);
  }, 0);
  const totalReferralFee = myCommissions.reduce((s, c) => s + (c.coordinatorFee ?? 0), 0);
  const totalEarnings    = myCommissions.reduce((s, c) => s + c.ownerPayout, 0);
  const pendingAmount    = pendingPayouts.reduce((s, c) => s + c.ownerPayout, 0);

  /* ── Revenue by vehicle chart ──────────────────────────────────── */
  const vehicleChart = myVehicles.map((v, i) => {
    const vComms = myCommissions.filter((c) => c.vehicleId === v.id);
    return {
      name:     `${v.brand} ${v.model}`,
      revenue:  vComms.reduce((s, c) => s + c.totalIncome, 0),
      payout:   vComms.reduce((s, c) => s + c.ownerPayout, 0),
      bookings: vComms.length,
      color:    BAR_COLORS[i % BAR_COLORS.length],
    };
  }).filter((d) => d.revenue > 0);

  /* ── Income by referral source chart ──────────────────────────── */
  const referralChartData = useMemo(() => {
    const map: Record<string, { revenue: number; count: number }> = {};
    myCommissions.forEach((c) => {
      const key = c.referral || 'Direct';
      if (!map[key]) map[key] = { revenue: 0, count: 0 };
      map[key].revenue += c.totalIncome;
      map[key].count   += 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([name, d], i) => ({ name, revenue: d.revenue, count: d.count, color: BAR_COLORS[i % BAR_COLORS.length] }));
  }, [myCommissions]);

  /* ── Rent history filters ──────────────────────────────────────── */
  const [rhSearch,   setRhSearch]   = useState('');
  const [rhStatus,   setRhStatus]   = useState('');
  const [rhPeriod,   setRhPeriod]   = useState<PeriodKey>('all');
  const [rhDateFrom, setRhDateFrom] = useState('');
  const [rhDateTo,   setRhDateTo]   = useState('');
  const rhDateRange = usePeriodRange(rhPeriod, rhDateFrom, rhDateTo);

  const filteredRentHistory = useMemo(() => {
    const q = rhSearch.trim().toLowerCase();
    return [...myBookings]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((b) => {
        if (rhStatus) {
          const comm = commissions.find((c) => c.bookingId === b.id);
          const cs   = comm?.status === 'Paid' ? 'Received' : (comm?.status ?? 'Pending');
          if (cs !== rhStatus) return false;
        }
        if (rhDateRange.from && b.startDate < rhDateRange.from) return false;
        if (rhDateRange.to   && b.startDate > rhDateRange.to)   return false;
        if (q) {
          const v = vehicles.find((vv) => vv.id === b.vehicleId);
          const hay = [b.customerName, b.customerPhone, v?.brand, v?.model, v?.vehicleNumber]
            .filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [myBookings, rhStatus, rhDateRange, rhSearch, vehicles, commissions]);

  const rhBillable         = filteredRentHistory.filter((b) => b.status !== 'Cancelled');
  const rhTotalAmount      = rhBillable.reduce((s, b) => s + b.totalAmount, 0);
  const rhTotalReferralFee = rhBillable.reduce((s, b) => s + (commissions.find((c) => c.bookingId === b.id)?.coordinatorFee ?? 0), 0);
  const rhTotalOwnerGets   = rhBillable.reduce((s, b) => s + (commissions.find((c) => c.bookingId === b.id)?.ownerPayout ?? 0), 0);
  const rhFiltersActive    = !!(rhSearch.trim() || rhStatus || rhPeriod !== 'all');
  const clearRhFilters     = () => { setRhSearch(''); setRhStatus(''); setRhPeriod('all'); setRhDateFrom(''); setRhDateTo(''); };

  /* ── Referral income filters ───────────────────────────────────── */
  const [riSearch,   setRiSearch]   = useState('');
  const [riStatus,   setRiStatus]   = useState('');
  const [riPeriod,   setRiPeriod]   = useState<PeriodKey>('all');
  const [riDateFrom, setRiDateFrom] = useState('');
  const [riDateTo,   setRiDateTo]   = useState('');
  const riDateRange = usePeriodRange(riPeriod, riDateFrom, riDateTo);

  const filteredReferralIncome = useMemo(() => {
    const q = riSearch.trim().toLowerCase();
    return [...referralIncome]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((c) => {
        const bk = bookings.find((b) => b.id === c.bookingId);
        if (riStatus && c.status !== riStatus) return false;
        const d = bk?.startDate ?? c.createdAt.slice(0, 10);
        if (riDateRange.from && d < riDateRange.from) return false;
        if (riDateRange.to   && d > riDateRange.to)   return false;
        if (q) {
          const v  = vehicles.find((vv) => vv.id === c.vehicleId);
          const ow = owners.find((o) => o.id === c.ownerId);
          const hay = [bk?.customerName, bk?.customerPhone, v?.brand, v?.model, v?.vehicleNumber, ow?.name]
            .filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [referralIncome, riStatus, riDateRange, riSearch, bookings, vehicles, owners]);

  const riTotalFee          = filteredReferralIncome.reduce((s, c) => s + (c.coordinatorFee ?? 0), 0);
  const riTotalIncome       = filteredReferralIncome.reduce((s, c) => s + c.totalIncome, 0);
  const riTotalOwnerPayout  = filteredReferralIncome.reduce((s, c) => s + c.ownerPayout, 0);
  const riFiltersActive     = !!(riSearch.trim() || riStatus || riPeriod !== 'all');
  const clearRiFilters  = () => { setRiSearch(''); setRiStatus(''); setRiPeriod('all'); setRiDateFrom(''); setRiDateTo(''); };

  /* ── CSV / PDF exports ─────────────────────────────────────────── */
  const exportRhCSV = () => {
    const cols = ['Booking', 'Phone', 'Vehicle', 'Reg No', 'Date Period', 'Referral', 'Total', 'Referral Fee', 'Owner Gets', 'Status'] as const;
    type Row = Record<(typeof cols)[number], string | number>;
    const rows: Row[] = filteredRentHistory.map((b) => {
      const v    = vehicles.find((vv) => vv.id === b.vehicleId);
      const comm = commissions.find((c) => c.bookingId === b.id);
      const cs   = comm?.status === 'Paid' ? 'Received' : (comm?.status ?? 'Pending');
      return { Booking: b.customerName, Phone: b.customerPhone, Vehicle: v ? `${v.brand} ${v.model}` : '', 'Reg No': v?.vehicleNumber ?? '', 'Date Period': `${b.startDate} to ${b.endDate}`, Referral: b.referral || comm?.referral || 'Direct', Total: b.totalAmount, 'Referral Fee': comm?.coordinatorFee ?? 0, 'Owner Gets': comm?.ownerPayout ?? 0, Status: cs };
    });
    const lines = [cols.join(','), ...rows.map((r) => cols.map((h) => esc(r[h])).join(','))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `rent-history-${stamp()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const exportRhPDF = () => {
    const body = filteredRentHistory.map((b) => {
      const v    = vehicles.find((vv) => vv.id === b.vehicleId);
      const comm = commissions.find((c) => c.bookingId === b.id);
      const cs   = comm?.status === 'Paid' ? 'Received' : (comm?.status ?? 'Pending');
      const ref  = b.referral || comm?.referral || 'Direct';
      return `<tr><td>${b.customerName}<br><small>${b.customerPhone}</small></td><td>${v ? `${v.brand} ${v.model}` : '—'}<br><small>${v?.vehicleNumber ?? ''}</small></td><td>${b.startDate}<br><small>to ${b.endDate} · ${b.totalDays}d</small></td><td>${ref}</td><td class="num">${fmtRs(b.totalAmount)}</td><td class="num">${(comm?.coordinatorFee ?? 0) > 0 ? fmtRs(comm!.coordinatorFee!) : '—'}</td><td class="num">${fmtRs(comm?.ownerPayout ?? 0)}</td><td class="ctr"><span class="badge">${cs}</span></td></tr>`;
    }).join('');
    const thead = '<tr><th>Booking</th><th>Vehicle</th><th>Date Period</th><th>Referral</th><th class="num">Total</th><th class="num">Referral Fee</th><th class="num">Owner Gets</th><th class="ctr">Status</th></tr>';
    const tfoot = `<tr><td colspan="4">TOTALS · ${filteredRentHistory.length} record${filteredRentHistory.length !== 1 ? 's' : ''}</td><td class="num">${fmtRs(rhTotalAmount)}</td><td class="num">${rhTotalReferralFee > 0 ? fmtRs(rhTotalReferralFee) : '—'}</td><td class="num">${fmtRs(rhTotalOwnerGets)}</td><td></td></tr>`;
    openPdf(pdfShell('Rent History', myName, filteredRentHistory.length, thead, body, tfoot));
  };

  const exportRiCSV = () => {
    const cols = ['Booking', 'Vehicle', 'Reg No', 'Date Period', 'Owner', 'Total', 'Referral Fee', 'Owner Gets', 'Status'] as const;
    type Row = Record<(typeof cols)[number], string | number>;
    const rows: Row[] = filteredReferralIncome.map((c) => {
      const bk = bookings.find((b) => b.id === c.bookingId);
      const v  = vehicles.find((vv) => vv.id === c.vehicleId);
      const ow = owners.find((o) => o.id === c.ownerId);
      return { Booking: bk?.customerName ?? '', Vehicle: v ? `${v.brand} ${v.model}` : '', 'Reg No': v?.vehicleNumber ?? '', 'Date Period': bk ? `${bk.startDate} to ${bk.endDate}` : '', Owner: ow?.name ?? '—', Total: c.totalIncome, 'Referral Fee': c.coordinatorFee ?? 0, 'Owner Gets': c.ownerPayout, Status: c.status };
    });
    const lines = [cols.join(','), ...rows.map((r) => cols.map((h) => esc(r[h])).join(','))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `referral-income-${stamp()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const exportRiPDF = () => {
    const body = filteredReferralIncome.map((c) => {
      const bk = bookings.find((b) => b.id === c.bookingId);
      const v  = vehicles.find((vv) => vv.id === c.vehicleId);
      const ow = owners.find((o) => o.id === c.ownerId);
      return `<tr><td>${bk?.customerName ?? '—'}<br><small>${bk?.customerPhone ?? ''}</small></td><td>${v ? `${v.brand} ${v.model}` : '—'}<br><small>${v?.vehicleNumber ?? ''}</small></td><td>${bk ? `${bk.startDate} to ${bk.endDate}` : '—'}</td><td>${ow?.name ?? '—'}</td><td class="num">${fmtRs(c.totalIncome)}</td><td class="num">${fmtRs(c.coordinatorFee ?? 0)}</td><td class="num">${fmtRs(c.ownerPayout)}</td><td class="ctr"><span class="badge">${c.status}</span></td></tr>`;
    }).join('');
    const thead = '<tr><th>Booking</th><th>Vehicle</th><th>Date Period</th><th>Owner</th><th class="num">Total</th><th class="num">Referral Fee</th><th class="num">Owner Gets</th><th class="ctr">Status</th></tr>';
    const tfoot = `<tr><td colspan="4">TOTALS · ${filteredReferralIncome.length} referral${filteredReferralIncome.length !== 1 ? 's' : ''}</td><td class="num">${fmtRs(riTotalIncome)}</td><td class="num">${fmtRs(riTotalFee)}</td><td class="num">${fmtRs(riTotalOwnerPayout)}</td><td></td></tr>`;
    openPdf(pdfShell('Referral Income', myName, filteredReferralIncome.length, thead, body, tfoot));
  };

  const confirmAlert = () => {
    addNotification({
      type:    'General',
      title:   'Payout Requested',
      message: `${currentUser?.name ?? 'Owner'} is requesting payout for Rs ${pendingAmount.toLocaleString()} pending earnings.${alertRemarks.trim() ? ` Remarks: ${alertRemarks.trim()}` : ''}`,
    });
    setAlertOpen(false);
    setAlertRemarks('');
  };

  /* ══════════ RENDER ═══════════════════════════════════════════════ */
  return (
    <>
      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Revenue',       value: `Rs ${totalRevenue.toLocaleString()}`,     icon: DollarSign, color: 'bg-navy-700'    },
          { label: 'Referral Fees Paid',  value: `Rs ${totalReferralFee.toLocaleString()}`, icon: Percent,    color: 'bg-amber-500'   },
          { label: 'Your Earnings',       value: `Rs ${totalEarnings.toLocaleString()}`,    icon: TrendingUp, color: 'bg-emerald-500' },
          { label: 'Pending Payout',      value: `Rs ${pendingAmount.toLocaleString()}`,    icon: Bell,       color: pendingAmount > 0 ? 'bg-amber-500' : 'bg-navy-300' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${color}`}><Icon size={18} /></div>
            <div>
              <p className="text-xs text-navy-400 font-medium">{label}</p>
              <p className="text-xl font-bold text-navy-800">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card">
          <p className="section-title mb-4">Revenue by Vehicle</p>
          {vehicleChart.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={vehicleChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717A' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                  <Tooltip formatter={(v: number, name: string) => [`Rs ${v.toLocaleString()}`, name === 'revenue' ? 'Total Revenue' : 'Your Payout']} contentStyle={{ borderRadius: 10, border: 'none', fontSize: 12 }} />
                  <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>{vehicleChart.map((d, i) => <Cell key={i} fill={d.color} />)}</Bar>
                  <Bar dataKey="payout"  radius={[6, 6, 0, 0]} fill="#10B981" opacity={0.6} />
                </BarChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {vehicleChart.map((d) => (
                  <div key={d.name} className="bg-navy-50/60 rounded-xl p-2.5 flex items-center gap-2">
                    <Car size={14} className="text-navy-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-navy-700 truncate">{d.name}</p>
                      <p className="text-xs text-navy-400">{d.bookings} rentals · Rs {d.payout.toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-navy-400 text-sm">No revenue data yet.</div>
          )}
        </div>

        <div className="card">
          <p className="section-title mb-4">Income by Referral Source</p>
          {referralChartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={referralChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717A' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                  <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`, 'Revenue']} contentStyle={{ borderRadius: 10, border: 'none', fontSize: 12 }} />
                  <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>{referralChartData.map((d, i) => <Cell key={i} fill={d.color} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {referralChartData.map((d) => (
                  <div key={d.name} className="bg-navy-50/60 rounded-xl p-2.5 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-navy-700 truncate">{d.name}</p>
                      <p className="text-xs text-navy-400">{d.count} booking{d.count !== 1 ? 's' : ''} · Rs {d.revenue.toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-navy-400 text-sm">No referral data yet.</div>
          )}
        </div>
      </div>

      {/* ── Pending Payouts ─────────────────────────────────────────── */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <p className="section-title">Pending Payouts</p>
          {pendingAmount > 0 && (
            <button onClick={() => setAlertOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors">
              <Bell size={13} /> Alert Admin
            </button>
          )}
        </div>
        {pendingPayouts.length > 0 ? (
          <>
            <div className="space-y-2">
              {pendingPayouts.map((c) => {
                const booking = bookings.find((b) => b.id === c.bookingId);
                const vehicle = vehicles.find((v) => v.id === c.vehicleId);
                return (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-amber-50/60 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-navy-800 truncate">{booking?.customerName ?? '—'}</p>
                      <p className="text-xs text-navy-400">{vehicle?.brand} {vehicle?.model} · {booking?.startDate}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-amber-700">Rs {c.ownerPayout.toLocaleString()}</p>
                      <StatusBadge status={c.status} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-navy-50 flex justify-between items-center">
              <p className="text-xs text-navy-400">Total pending</p>
              <p className="text-base font-bold text-amber-700">Rs {pendingAmount.toLocaleString()}</p>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center py-8 text-navy-400 text-sm">No pending payouts — all settled!</div>
        )}
      </div>

      {/* ── Rent History ────────────────────────────────────────────── */}
      <div className="card mb-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <p className="section-title">Rent History</p>
            <p className="text-xs text-navy-400 mt-0.5">
              {filteredRentHistory.length} of {myBookings.length} bookings
              {filteredRentHistory.some((b) => b.status === 'Cancelled') && <span className="text-navy-300"> (excl. cancelled)</span>}
              {' · '}Total Rs {rhTotalAmount.toLocaleString()}
              {' · '}Owner Gets Rs {rhTotalOwnerGets.toLocaleString()}
              {rhTotalReferralFee > 0 && <span className="text-amber-600"> · Referral Rs {rhTotalReferralFee.toLocaleString()}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={exportRhCSV} disabled={filteredRentHistory.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl transition-colors">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={exportRhPDF} disabled={filteredRentHistory.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl transition-colors">
              <FileText size={14} /> PDF
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 pointer-events-none" />
            <input className="input pl-10 text-sm" value={rhSearch} onChange={(e) => setRhSearch(e.target.value)} placeholder="Search customer, vehicle…" />
          </div>
          <div className="w-44">
            <Select value={rhStatus} onChange={setRhStatus} placeholder="All status"
              options={['Pending', 'Received', 'Credit'].map((s) => ({ value: s, label: s }))} />
          </div>
          {rhFiltersActive && (
            <button onClick={clearRhFilters} className="flex items-center gap-1.5 text-xs font-medium text-navy-500 hover:text-navy-800 bg-navy-50 hover:bg-navy-100 px-3.5 py-2.5 rounded-xl transition-colors flex-shrink-0">
              <X size={13} /> Clear
            </button>
          )}
        </div>
        <PeriodPills period={rhPeriod} setPeriod={setRhPeriod} dateFrom={rhDateFrom} setDateFrom={setRhDateFrom} dateTo={rhDateTo} setDateTo={setRhDateTo} dateRange={rhDateRange} />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead>
              <tr>
                <th className="table-head text-left pb-3">Booking</th>
                <th className="table-head text-left pb-3">Vehicle</th>
                <th className="table-head text-left pb-3">Date Period</th>
                <th className="table-head text-left pb-3">Referral</th>
                <th className="table-head text-right pb-3">Total</th>
                <th className="table-head text-right pb-3">Referral Fee</th>
                <th className="table-head text-right pb-3">Owner Gets</th>
                <th className="table-head text-right pb-3">Status</th>
                <th className="table-head text-center pb-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredRentHistory.map((b) => {
                const v    = vehicles.find((vv) => vv.id === b.vehicleId);
                const comm = commissions.find((c) => c.bookingId === b.id);
                const cs   = comm?.status === 'Paid' ? 'Received' : (comm?.status ?? 'Pending');
                const ref  = b.referral || comm?.referral || 'Direct';
                return (
                  <tr key={b.id} className="table-row">
                    <td className="py-3">
                      <p className="text-sm font-medium text-navy-800">{b.customerName}</p>
                      <p className="text-xs text-navy-400">{b.customerPhone}</p>
                    </td>
                    <td className="py-3">
                      <p className="text-sm text-navy-700">{v?.brand} {v?.model}</p>
                      <p className="text-xs text-navy-400">{v?.vehicleNumber}</p>
                    </td>
                    <td className="py-3">
                      <p className="text-sm text-navy-700">{b.startDate}</p>
                      <p className="text-xs text-navy-400">to {b.endDate} · {b.totalDays}d</p>
                    </td>
                    <td className="py-3">
                      <span className="text-xs bg-navy-50 text-navy-600 px-2 py-0.5 rounded-full">{ref}</span>
                    </td>
                    <td className="py-3 text-right text-sm font-semibold text-navy-800">Rs {b.totalAmount.toLocaleString()}</td>
                    <td className="py-3 text-right">
                      {(comm?.coordinatorFee ?? 0) > 0
                        ? <span className="text-sm font-semibold text-amber-700">Rs {comm!.coordinatorFee!.toLocaleString()}</span>
                        : <span className="text-sm text-navy-300">—</span>}
                    </td>
                    <td className="py-3 text-right text-sm font-semibold text-emerald-700">
                      Rs {(comm?.ownerPayout ?? 0).toLocaleString()}
                    </td>
                    <td className="py-3 text-right"><StatusBadge status={cs} /></td>
                    <td className="py-3 text-center">
                      <button
                        onClick={() => setDetailBooking(b)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto text-navy-400 hover:bg-navy-100 hover:text-navy-700 transition-colors"
                        title="View full details"
                      >
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredRentHistory.length === 0 && (
                <tr><td colSpan={9} className="text-center py-12 text-navy-400 text-sm">
                  {myBookings.length === 0 ? 'No rent history yet.' : 'No records match your filters.'}
                </td></tr>
              )}
            </tbody>
            {filteredRentHistory.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy-100">
                  <td colSpan={4} className="py-3 text-xs font-semibold text-navy-500 uppercase tracking-wide">Totals</td>
                  <td className="py-3 text-right text-sm font-bold text-navy-800">Rs {rhTotalAmount.toLocaleString()}</td>
                  <td className="py-3 text-right text-sm font-bold text-amber-700">{rhTotalReferralFee > 0 ? `Rs ${rhTotalReferralFee.toLocaleString()}` : '—'}</td>
                  <td className="py-3 text-right text-sm font-bold text-emerald-700">Rs {rhTotalOwnerGets.toLocaleString()}</td>
                  <td /><td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Referral Income (earned by referring others) ─────────────── */}
      <div className="card mb-6">
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <div>
            <p className="section-title">Referral Income</p>
            <p className="text-xs text-navy-400 mt-0.5">
              Income you earned by referring customers to other owners' vehicles
            </p>
          </div>
          <div className="flex items-center gap-3">
            {referralIncome.length > 0 && (
              <div className="text-right">
                <p className="text-xs text-navy-400">Total earned</p>
                <p className="text-lg font-bold text-emerald-700">Rs {referralIncome.reduce((s, c) => s + (c.coordinatorFee ?? 0), 0).toLocaleString()}</p>
              </div>
            )}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={exportRiCSV} disabled={filteredReferralIncome.length === 0}
                className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl transition-colors">
                <FileSpreadsheet size={14} /> Excel
              </button>
              <button onClick={exportRiPDF} disabled={filteredReferralIncome.length === 0}
                className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl transition-colors">
                <FileText size={14} /> PDF
              </button>
            </div>
          </div>
        </div>

        {referralIncome.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-navy-400">
            <ArrowRightLeft size={28} className="text-navy-200" />
            <p className="text-sm">No referral income yet.</p>
            <p className="text-xs text-navy-300">When you refer a customer to another owner&apos;s vehicle, your fee will appear here.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5 mt-4 mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 pointer-events-none" />
                <input className="input pl-10 text-sm" value={riSearch} onChange={(e) => setRiSearch(e.target.value)} placeholder="Search customer, vehicle, owner…" />
              </div>
              <div className="w-40">
                <Select value={riStatus} onChange={setRiStatus} placeholder="All status"
                  options={['Pending', 'Paid', 'Credit'].map((s) => ({ value: s, label: s }))} />
              </div>
              {riFiltersActive && (
                <button onClick={clearRiFilters} className="flex items-center gap-1.5 text-xs font-medium text-navy-500 hover:text-navy-800 bg-navy-50 hover:bg-navy-100 px-3.5 py-2.5 rounded-xl transition-colors flex-shrink-0">
                  <X size={13} /> Clear
                </button>
              )}
            </div>
            <PeriodPills period={riPeriod} setPeriod={setRiPeriod} dateFrom={riDateFrom} setDateFrom={setRiDateFrom} dateTo={riDateTo} setDateTo={setRiDateTo} dateRange={riDateRange} />

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th className="table-head text-left pb-3">Booking</th>
                    <th className="table-head text-left pb-3">Vehicle</th>
                    <th className="table-head text-left pb-3">Date Period</th>
                    <th className="table-head text-left pb-3">Owner</th>
                    <th className="table-head text-right pb-3">Total</th>
                    <th className="table-head text-right pb-3">Referral Fee</th>
                    <th className="table-head text-right pb-3">Owner Gets</th>
                    <th className="table-head text-right pb-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReferralIncome.map((c) => {
                    const bk = bookings.find((b) => b.id === c.bookingId);
                    const v  = vehicles.find((vv) => vv.id === c.vehicleId);
                    const ow = owners.find((o) => o.id === c.ownerId);
                    return (
                      <tr key={c.id} className="table-row">
                        <td className="py-3">
                          <p className="text-sm font-medium text-navy-800">{bk?.customerName ?? '—'}</p>
                          <p className="text-xs text-navy-400">{bk?.customerPhone}</p>
                        </td>
                        <td className="py-3">
                          <p className="text-sm text-navy-700">{v?.brand} {v?.model}</p>
                          <p className="text-xs text-navy-400">{v?.vehicleNumber}</p>
                        </td>
                        <td className="py-3">
                          <p className="text-sm text-navy-700">{bk?.startDate}</p>
                          <p className="text-xs text-navy-400">to {bk?.endDate}</p>
                        </td>
                        <td className="py-3">
                          <p className="text-sm text-navy-700">{ow?.name ?? '—'}</p>
                        </td>
                        <td className="py-3 text-right text-sm text-navy-600">Rs {c.totalIncome.toLocaleString()}</td>
                        <td className="py-3 text-right text-sm font-semibold text-emerald-700">Rs {(c.coordinatorFee ?? 0).toLocaleString()}</td>
                        <td className="py-3 text-right text-sm font-semibold text-navy-800">Rs {c.ownerPayout.toLocaleString()}</td>
                        <td className="py-3 text-right"><StatusBadge status={c.status} /></td>
                      </tr>
                    );
                  })}
                  {filteredReferralIncome.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-10 text-navy-400 text-sm">No records match your filters.</td></tr>
                  )}
                </tbody>
                {filteredReferralIncome.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-navy-100">
                      <td colSpan={4} className="py-3 text-xs font-semibold text-navy-500 uppercase tracking-wide">Totals</td>
                      <td className="py-3 text-right text-sm font-bold text-navy-800">Rs {riTotalIncome.toLocaleString()}</td>
                      <td className="py-3 text-right text-sm font-bold text-emerald-700">Rs {riTotalFee.toLocaleString()}</td>
                      <td className="py-3 text-right text-sm font-bold text-navy-800">Rs {riTotalOwnerPayout.toLocaleString()}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Rent Detail Modal ───────────────────────────────────────── */}
      <RentDetailModal booking={detailBooking} handovers={handovers} onClose={() => setDetailBooking(null)} />

      {/* ── Alert Admin Modal ───────────────────────────────────────── */}
      <Modal open={alertOpen} onClose={() => setAlertOpen(false)} title="Request Payout Alert">
        <div className="space-y-4">
          <div className="bg-amber-50 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-800">Pending Amount</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">Rs {pendingAmount.toLocaleString()}</p>
            <p className="text-xs text-amber-600 mt-1">{pendingPayouts.length} unpaid record{pendingPayouts.length !== 1 ? 's' : ''}</p>
          </div>
          <div>
            <p className="label">Remarks <span className="text-navy-400 font-normal">(optional)</span></p>
            <textarea className="input resize-none" rows={3} value={alertRemarks} onChange={(e) => setAlertRemarks(e.target.value)} placeholder="Add any notes or context for the admin…" autoFocus />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setAlertOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={confirmAlert} className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors">
              <Send size={14} /> Send Alert
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
