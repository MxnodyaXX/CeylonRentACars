import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import StatusBadge from '../../components/ui/StatusBadge';
import Select from '../../components/ui/Select';
import DateInput from '../../components/ui/DateInput';
import Modal from '../../components/ui/Modal';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, DollarSign, Users, Percent, Search, X, FileSpreadsheet, FileText, Maximize2, ChevronDown } from 'lucide-react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { bookingDiscount } from '../../lib/revenue';

export default function AdminView() {
  const { commissions, bookings, vehicles, owners } = useStore();

  // Net of discounts granted on the underlying bookings.
  const totalIncome      = commissions.reduce((s, c) => {
    const bk = bookings.find((b) => b.id === c.bookingId);
    return s + c.totalIncome - (bk ? bookingDiscount(bk) : 0);
  }, 0);
  const totalReferralFee = commissions.reduce((s, c) => s + (c.coordinatorFee ?? 0), 0);
  const totalOwnerPayout = commissions.reduce((s, c) => s + c.ownerPayout, 0);
  const pendingCount     = commissions.filter((c) => c.status === 'Pending').length;

  // ── Income by referral ────────────────────────────────────────────────────
  // Direct is split per owner (which owners get non-referred business); owner /
  // third-party referrals and marketing sources each get their own bar.
  const REFERRAL_SOURCES = ['WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Google', 'Word of Mouth'];
  const ownerNameById = (id: string) => owners.find((o) => o.id === id)?.name ?? 'Unknown';

  const directByOwner: Record<string, { count: number; total: number }> = {};
  const referralMap:   Record<string, { count: number; total: number }> = {};
  const sourceMap:     Record<string, { count: number; total: number }> = {};
  commissions.forEach((c) => {
    const ref = c.referral || 'Direct';
    const bucket =
      ref === 'Direct'                 ? (directByOwner[c.ownerId] ??= { count: 0, total: 0 })
      : REFERRAL_SOURCES.includes(ref) ? (sourceMap[ref]           ??= { count: 0, total: 0 })
      :                                  (referralMap[ref]          ??= { count: 0, total: 0 });
    bucket.count += 1;
    bucket.total += c.totalIncome;
  });

  const SOURCE_COLORS   = ['#10B981', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#71717A'];
  const OWNER_COLORS    = ['#E11D2A', '#111114', '#71717A', '#F04A55', '#A1A1AA', '#3F3F46'];
  const REFERRER_COLORS = ['#F59E0B', '#D97706', '#FB923C', '#EA580C', '#FBBF24', '#B45309'];

  // Direct = one bar of stacked owner segments (which owner got the walk-in).
  const directOwnerBars = Object.entries(directByOwner).map(([oid, d], i) => ({
    id: oid, key: `ow_${oid}`, name: ownerNameById(oid),
    color: OWNER_COLORS[i % OWNER_COLORS.length], total: d.total, count: d.count,
  }));
  const directTotal = directOwnerBars.reduce((s, b) => s + b.total, 0);
  const directCount = directOwnerBars.reduce((s, b) => s + b.count, 0);

  // Owner Referrals = one bar of stacked referrer segments (which owner referred it).
  const referrerBars = Object.entries(referralMap).map(([n, d], i) => ({
    id: n, key: `rf_${i}`, name: n,
    color: REFERRER_COLORS[i % REFERRER_COLORS.length], total: d.total, count: d.count,
  }));
  const referrerTotal = referrerBars.reduce((s, b) => s + b.total, 0);
  const referrerCount = referrerBars.reduce((s, b) => s + b.count, 0);

  // Marketing sources stay as one bar each.
  const sourceBars = Object.entries(sourceMap).map(([n, d], i) => ({
    name: n, color: SOURCE_COLORS[i % SOURCE_COLORS.length], total: d.total, count: d.count,
  }));
  const otherColorByName: Record<string, string> = Object.fromEntries(sourceBars.map((b) => [b.name, b.color]));

  // Detailed entries (each with its underlying bookings) for the expanded view.
  const directEntries = directOwnerBars.map((b) => ({
    key: `d:${b.id}`, name: b.name, color: b.color, total: b.total, count: b.count,
    rows: commissions.filter((c) => (c.referral || 'Direct') === 'Direct' && c.ownerId === b.id),
  }));
  const referrerEntries = referrerBars.map((b) => ({
    key: `r:${b.name}`, name: b.name, color: b.color, total: b.total, count: b.count,
    rows: commissions.filter((c) => c.referral === b.name),
  }));
  const sourceEntries = sourceBars.map((b) => ({
    key: `s:${b.name}`, name: b.name, color: b.color, total: b.total, count: b.count,
    rows: commissions.filter((c) => c.referral === b.name),
  }));

  // One chart row per x-category. Direct & Owner Referrals carry their stacked
  // segment keys; source rows carry a single "other" value (other keys zeroed).
  const zeroKeys = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, 0]));
  const ownerKeys = directOwnerBars.map((b) => b.key);
  const refKeys   = referrerBars.map((b) => b.key);

  const directRow: Record<string, string | number> = { name: 'Direct', other: 0, ...zeroKeys(refKeys) };
  directOwnerBars.forEach((b) => { directRow[b.key] = b.total; });
  const referralRow: Record<string, string | number> = { name: 'Owner Referrals', other: 0, ...zeroKeys(ownerKeys) };
  referrerBars.forEach((b) => { referralRow[b.key] = b.total; });

  const chartRows: Record<string, string | number>[] = [
    ...(directOwnerBars.length ? [directRow] : []),
    ...(referrerBars.length ? [referralRow] : []),
    ...sourceBars.map((b) => ({ name: b.name, other: b.total, ...zeroKeys(ownerKeys), ...zeroKeys(refKeys) })),
  ];

  // Hover Direct → total + each owner's slice; hover any other bar → that referral.
  const renderReferralTooltip = ({ active, label }: { active?: boolean; label?: string }) => {
    if (!active) return null;
    if (label === 'Direct') {
      return (
        <div className="bg-white rounded-xl shadow-card border border-navy-100 px-3 py-2 text-xs">
          <p className="font-bold text-navy-800">
            Direct · Rs {directTotal.toLocaleString()}
            <span className="font-normal text-navy-400"> · {directCount} booking{directCount !== 1 ? 's' : ''}</span>
          </p>
          <p className="font-normal text-navy-400 mb-1.5 text-[10px]">Income by the vehicle&apos;s owner (no referrer)</p>
          {directOwnerBars.filter((b) => b.total > 0).map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-5">
              <span className="flex items-center gap-1.5 text-navy-600">
                <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />{b.name}
              </span>
              <span className="font-semibold text-navy-800">Rs {b.total.toLocaleString()}</span>
            </div>
          ))}
        </div>
      );
    }
    if (label === 'Owner Referrals') {
      return (
        <div className="bg-white rounded-xl shadow-card border border-navy-100 px-3 py-2 text-xs">
          <p className="font-bold text-navy-800">
            Owner Referrals · Rs {referrerTotal.toLocaleString()}
            <span className="font-normal text-navy-400"> · {referrerCount} booking{referrerCount !== 1 ? 's' : ''}</span>
          </p>
          <p className="font-normal text-navy-400 mb-1.5 text-[10px]">Income owners referred onto other vehicles</p>
          {referrerBars.filter((b) => b.total > 0).map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-5">
              <span className="flex items-center gap-1.5 text-navy-600">
                <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />{b.name}
              </span>
              <span className="font-semibold text-navy-800">Rs {b.total.toLocaleString()}</span>
            </div>
          ))}
        </div>
      );
    }
    const sb = sourceBars.find((b) => b.name === label);
    if (!sb) return null;
    return (
      <div className="bg-white rounded-xl shadow-card border border-navy-100 px-3 py-2 text-xs">
        <p className="font-semibold text-navy-800">{sb.name}</p>
        <p className="text-navy-600 mt-0.5">Rs {sb.total.toLocaleString()} · {sb.count} booking{sb.count !== 1 ? 's' : ''}</p>
      </div>
    );
  };

  // ── Payout-table filters ────────────────────────────────────────────────
  const [fOwner, setFOwner]       = useState('');
  const [fVehicle, setFVehicle]   = useState('');
  const [fReferral, setFReferral] = useState('');
  const [fStatus, setFStatus]     = useState('');
  const [search, setSearch]       = useState('');
  const [period, setPeriod]       = useState<'all' | 'week' | 'month' | 'year' | 'custom'>('all');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [expanded, setExpanded]   = useState(false);
  const [openRows, setOpenRows]   = useState<Record<string, boolean>>({});
  const toggleRow = (k: string) => setOpenRows((m) => ({ ...m, [k]: !m[k] }));

  const referralOptions = Array.from(new Set(commissions.map((c) => c.referral || 'Direct'))).sort();
  const vehiclesInUse   = vehicles.filter((v) => commissions.some((c) => c.vehicleId === v.id));

  // The date a record is filtered on = its rental (booking) start date, else the record date.
  const recordDate = (c: typeof commissions[number]) =>
    bookings.find((b) => b.id === c.bookingId)?.startDate || c.createdAt.slice(0, 10);

  // Resolve the active [from, to] window (yyyy-MM-dd strings) from the period preset.
  const dateRange = useMemo<{ from: string; to: string }>(() => {
    const now = new Date();
    const f = (d: Date) => format(d, 'yyyy-MM-dd');
    switch (period) {
      case 'week':   return { from: f(startOfWeek(now, { weekStartsOn: 1 })), to: f(endOfWeek(now, { weekStartsOn: 1 })) };
      case 'month':  return { from: f(startOfMonth(now)), to: f(endOfMonth(now)) };
      case 'year':   return { from: f(startOfYear(now)),  to: f(endOfYear(now)) };
      case 'custom': return { from: dateFrom, to: dateTo };
      default:       return { from: '', to: '' };
    }
  }, [period, dateFrom, dateTo]);

  const filteredCommissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return commissions.filter((c) => {
      if (fOwner && c.ownerId !== fOwner) return false;
      if (fVehicle && c.vehicleId !== fVehicle) return false;
      if (fReferral && (c.referral || 'Direct') !== fReferral) return false;
      if (fStatus && c.status !== fStatus) return false;
      if (dateRange.from || dateRange.to) {
        const d = recordDate(c);
        if (dateRange.from && d < dateRange.from) return false;
        if (dateRange.to && d > dateRange.to) return false;
      }
      if (q) {
        const booking = bookings.find((b) => b.id === c.bookingId);
        const vehicle = vehicles.find((v) => v.id === c.vehicleId);
        const owner   = owners.find((o) => o.id === c.ownerId);
        const hay = [
          booking?.customerName, booking?.customerPhone,
          vehicle?.brand, vehicle?.model, vehicle?.vehicleNumber,
          owner?.name, c.referral,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [commissions, bookings, vehicles, owners, fOwner, fVehicle, fReferral, fStatus, search, dateRange]);

  const filtersActive = !!(fOwner || fVehicle || fReferral || fStatus || search.trim() || period !== 'all');
  const clearFilters  = () => { setFOwner(''); setFVehicle(''); setFReferral(''); setFStatus(''); setSearch(''); setPeriod('all'); setDateFrom(''); setDateTo(''); };
  const filteredTotal      = filteredCommissions.reduce((s, c) => s + c.totalIncome, 0);
  const filteredReferral   = filteredCommissions.reduce((s, c) => s + (c.coordinatorFee ?? 0), 0);
  const filteredOwnerTotal = filteredCommissions.reduce((s, c) => s + c.ownerPayout, 0);

  // ── Export (Excel/CSV + PDF) of the currently filtered records ──────────────
  const EXPORT_COLS = ['Customer', 'Period', 'Vehicle', 'Reg No', 'Owner', 'Referral', 'Total', 'Referral Fee', 'Owner Gets', 'Status'] as const;
  const exportRows = () =>
    filteredCommissions.map((c) => {
      const booking = bookings.find((b) => b.id === c.bookingId);
      const vehicle = vehicles.find((v) => v.id === c.vehicleId);
      const owner   = owners.find((o) => o.id === c.ownerId);
      return {
        Customer: booking?.customerName ?? '',
        Period: booking ? `${booking.startDate} to ${booking.endDate}` : '',
        Vehicle: vehicle ? `${vehicle.brand} ${vehicle.model}` : '',
        'Reg No': vehicle?.vehicleNumber ?? '',
        Owner: owner?.name ?? '',
        Referral: c.referral || 'Direct',
        Total: c.totalIncome,
        'Referral Fee': c.coordinatorFee ?? 0,
        'Owner Gets': c.ownerPayout,
        Status: c.status,
      } as Record<(typeof EXPORT_COLS)[number], string | number>;
    });

  const periodLabel: Record<typeof period, string> = { all: '', week: 'This Week', month: 'This Month', year: 'This Year', custom: 'Custom' };
  const filterSummary = () =>
    [
      (dateRange.from || dateRange.to) && `Period: ${periodLabel[period]}${dateRange.from || dateRange.to ? ` (${dateRange.from || '…'} → ${dateRange.to || '…'})` : ''}`,
      fOwner    && `Owner: ${owners.find((o) => o.id === fOwner)?.name ?? ''}`,
      fVehicle  && (() => { const v = vehicles.find((x) => x.id === fVehicle); return v ? `Vehicle: ${v.brand} ${v.model} (${v.vehicleNumber})` : ''; })(),
      fReferral && `Referral: ${fReferral}`,
      fStatus   && `Status: ${fStatus}`,
      search.trim() && `Search: "${search.trim()}"`,
    ].filter(Boolean).join('  ·  ') || 'All records';

  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportCSV = () => {
    const rows = exportRows();
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      EXPORT_COLS.join(','),
      ...rows.map((r) => EXPORT_COLS.map((h) => esc(r[h])).join(',')),
      esc('TOTALS') + ',,,,,,' + filteredTotal + ',' + filteredReferral + ',' + filteredOwnerTotal + ',',
    ];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payout-records-${stamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const rows = exportRows();
    const fmt = (n: number) => 'Rs ' + n.toLocaleString();
    const body = rows
      .map(
        (r) => `<tr>
          <td>${r.Customer}<br><small>${r.Period}</small></td>
          <td>${r.Vehicle}<br><small>${r['Reg No']}</small></td>
          <td>${r.Owner}</td>
          <td>${r.Referral}</td>
          <td class="num">${fmt(Number(r.Total))}</td>
          <td class="num">${Number(r['Referral Fee']) > 0 ? fmt(Number(r['Referral Fee'])) : '—'}</td>
          <td class="num">${fmt(Number(r['Owner Gets']))}</td>
          <td class="ctr"><span class="badge">${r.Status}</span></td>
        </tr>`
      )
      .join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payout Records — Ceylon Rent A Cars</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181B;padding:28px 32px}
  @media print{@page{margin:12mm;size:A4 landscape}}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #27272A;padding-bottom:12px;margin-bottom:6px}
  .brand{font-size:22px;font-weight:900;color:#27272A}
  .sub{font-size:11px;color:#71717A}
  h1{font-size:15px;color:#27272A;margin-top:14px}
  .meta{font-size:11px;color:#71717A;margin:4px 0 14px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#27272A;color:#fff;text-align:left;padding:7px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  th.num,td.num{text-align:right}
  th.ctr,td.ctr{text-align:center}
  td{padding:7px 9px;border-bottom:1px solid #E4E4E7;vertical-align:top}
  td small{color:#A1A1AA;font-size:9px}
  tr:nth-child(even) td{background:#FAFAFA}
  .badge{background:#F1F1F3;color:#52525B;border-radius:999px;padding:2px 8px;font-size:9px;font-weight:600}
  tfoot td{background:#27272A;color:#fff;font-weight:700;padding:9px;border:none}
  .footer{margin-top:16px;text-align:center;font-size:10px;color:#A1A1AA}
</style></head><body>
  <div class="head">
    <div><div class="brand">Ceylon Rent A Cars</div><div class="sub">Vehicle Rentals Across Sri Lanka</div></div>
    <div style="text-align:right"><div class="sub">Generated</div><div style="font-weight:700">${new Date().toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })}</div></div>
  </div>
  <h1>Payout Records</h1>
  <div class="meta">${filterSummary()} &nbsp;·&nbsp; ${rows.length} record${rows.length !== 1 ? 's' : ''}</div>
  <table>
    <thead><tr>
      <th>Booking</th><th>Vehicle</th><th>Owner</th><th>Referral</th>
      <th class="num">Total</th><th class="num">Referral Fee</th><th class="num">Owner Gets</th><th class="ctr">Status</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="8" style="text-align:center;padding:24px;color:#A1A1AA">No records.</td></tr>'}</tbody>
    <tfoot><tr>
      <td colspan="4">TOTALS · ${rows.length} record${rows.length !== 1 ? 's' : ''}</td>
      <td class="num">${fmt(filteredTotal)}</td>
      <td class="num">${fmt(filteredReferral)}</td>
      <td class="num">${fmt(filteredOwnerTotal)}</td>
      <td></td>
    </tr></tfoot>
  </table>
  <div class="footer">Ceylon Rent A Cars · ceylonrentacars.lk</div>
</body></html>`;
    const win = window.open('', '_blank', 'width=1100,height=720');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const ownerPayouts = owners.map((o) => {
    const ownerComms = commissions.filter((c) => c.ownerId === o.id);
    return {
      owner:   o,
      total:   ownerComms.reduce((s, c) => s + c.ownerPayout, 0),
      pending: ownerComms.filter((c) => c.status === 'Pending').reduce((s, c) => s + c.ownerPayout, 0),
      count:   ownerComms.length,
    };
  });

  // The bar chart, reused in the card and the expanded modal.
  const renderChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartRows} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
        <XAxis dataKey="name" interval={0} tick={{ fontSize: 10, fill: '#71717A' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
        <Tooltip cursor={{ fill: 'rgba(75,123,229,0.06)' }} content={renderReferralTooltip} />
        {directOwnerBars.map((b) => (
          <Bar key={b.key} dataKey={b.key} stackId="ref" fill={b.color} stroke="#fff" strokeWidth={1}
            isAnimationActive animationDuration={750} animationEasing="ease-out" />
        ))}
        {referrerBars.map((b) => (
          <Bar key={b.key} dataKey={b.key} stackId="ref" fill={b.color} stroke="#fff" strokeWidth={1}
            isAnimationActive animationDuration={750} animationEasing="ease-out" />
        ))}
        <Bar dataKey="other" stackId="ref" radius={[6, 6, 0, 0]}
          isAnimationActive animationDuration={750} animationEasing="ease-out" animationBegin={120}>
          {chartRows.map((r, i) => <Cell key={i} fill={otherColorByName[r.name as string] ?? '#D4D4D8'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );

  // A detail section: horizontal accordion cards that expand to show bookings.
  type Entry = { key: string; name: string; color: string; total: number; count: number; rows: typeof commissions };
  const renderDetailSection = (title: string, hint: string, entries: Entry[]) => {
    if (entries.length === 0) return null;
    return (
      <div>
        <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">{title}</p>
        <p className="text-[11px] text-navy-300 mb-2">{hint}</p>
        <div className="space-y-2">
          {entries.map((e, i) => {
            const isOpen = !!openRows[e.key];
            return (
              <div key={e.key} className="border border-navy-100 rounded-xl overflow-hidden anim-fade-up" style={{ animationDelay: `${i * 45}ms` }}>
                <button onClick={() => toggleRow(e.key)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-navy-50/60 transition-colors">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: e.color }} />
                  <span className="text-sm font-semibold text-navy-800 flex-1 text-left truncate">{e.name}</span>
                  <span className="text-xs text-navy-400 flex-shrink-0">{e.count} booking{e.count !== 1 ? 's' : ''}</span>
                  <span className="text-sm font-bold text-navy-800 w-28 text-right flex-shrink-0">Rs {e.total.toLocaleString()}</span>
                  <ChevronDown size={16} className={`text-navy-400 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                <div className={`acc-grid ${isOpen ? 'open' : ''}`}>
                  <div>
                    <div className={`border-t border-navy-50 bg-navy-50/30 px-4 py-3 overflow-x-auto transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
                      <table className="w-full min-w-[600px] text-xs">
                        <thead>
                          <tr className="text-navy-400">
                            <th className="text-left font-medium pb-2">Customer</th>
                            <th className="text-left font-medium pb-2">Vehicle</th>
                            <th className="text-left font-medium pb-2">Dates</th>
                            <th className="text-right font-medium pb-2">Total</th>
                            <th className="text-right font-medium pb-2">Ref. Fee</th>
                            <th className="text-right font-medium pb-2">Owner Gets</th>
                            <th className="text-center font-medium pb-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.rows.map((c) => {
                            const bk = bookings.find((b) => b.id === c.bookingId);
                            const v  = vehicles.find((vv) => vv.id === c.vehicleId);
                            return (
                              <tr key={c.id} className="border-t border-navy-100/60">
                                <td className="py-2 text-navy-800 font-medium">{bk?.customerName ?? '—'}</td>
                                <td className="py-2 text-navy-600">{v ? `${v.brand} ${v.model}` : '—'}<span className="text-navy-400"> · {v?.vehicleNumber ?? ''}</span></td>
                                <td className="py-2 text-navy-500">{bk?.startDate} → {bk?.endDate}</td>
                                <td className="py-2 text-right font-semibold text-navy-800">Rs {c.totalIncome.toLocaleString()}</td>
                                <td className="py-2 text-right text-amber-700">{(c.coordinatorFee ?? 0) > 0 ? `Rs ${(c.coordinatorFee ?? 0).toLocaleString()}` : '—'}</td>
                                <td className="py-2 text-right text-emerald-700 font-semibold">Rs {c.ownerPayout.toLocaleString()}</td>
                                <td className="py-2 text-center"><StatusBadge status={c.status} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Income',       value: `Rs ${totalIncome.toLocaleString()}`,      icon: DollarSign, color: 'bg-navy-700'    },
          { label: 'Referral Fees',      value: `Rs ${totalReferralFee.toLocaleString()}`, icon: Percent,    color: 'bg-amber-500'   },
          { label: 'Owner Payouts',      value: `Rs ${totalOwnerPayout.toLocaleString()}`, icon: Users,      color: 'bg-emerald-500' },
          { label: 'Pending Payouts',    value: pendingCount,                                    icon: TrendingUp, color: 'bg-navy-700'    },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${color}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className="text-xs text-navy-400 font-medium">{label}</p>
              <p className="text-xl font-bold text-navy-800">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Income by referral — Direct split per owner, then referrers & sources */}
        <div className="card">
          <div className="flex items-center justify-between mb-4 gap-3">
            <p className="section-title">Income by Referral</p>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-3 text-[10px] text-navy-400">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: OWNER_COLORS[0] }} /> Direct (by owner)</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: REFERRER_COLORS[0] }} /> Owner referral</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-navy-300" /> Source</span>
              </div>
              <button
                onClick={() => setExpanded(true)}
                title="Expand to full screen"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-navy-50 hover:text-navy-700 transition-colors flex-shrink-0"
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>
          {renderChart(210)}

          {/* Grouped breakdown */}
          <div className="space-y-3 mt-3">
            {directOwnerBars.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide">
                  Direct income · by vehicle owner · Rs {directTotal.toLocaleString()}
                </p>
                <p className="text-[10px] text-navy-300 mb-1.5">Walk-in hires on the owner&apos;s own vehicle (no referrer)</p>
                <div className="grid grid-cols-3 gap-2">
                  {directOwnerBars.map((b, i) => (
                    <div key={b.id} className="bg-navy-50/60 rounded-xl p-2 text-center anim-fade-up hover:bg-navy-50 transition-colors" style={{ animationDelay: `${i * 45}ms` }}>
                      <div className="w-3 h-3 rounded-full mx-auto mb-1" style={{ background: b.color }} />
                      <p className="text-xs font-medium text-navy-700 truncate">{b.name}</p>
                      <p className="text-xs text-navy-400">{b.count} booking{b.count !== 1 ? 's' : ''} · Rs {b.total.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {referrerBars.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide">
                  Owner Referrals · by referrer · Rs {referrerTotal.toLocaleString()}
                </p>
                <p className="text-[10px] text-navy-300 mb-1.5">Income an owner referred onto another owner&apos;s vehicle</p>
                <div className="grid grid-cols-3 gap-2">
                  {referrerBars.map((b, i) => (
                    <div key={b.id} className="bg-navy-50/60 rounded-xl p-2 text-center anim-fade-up hover:bg-navy-50 transition-colors" style={{ animationDelay: `${i * 45}ms` }}>
                      <div className="w-3 h-3 rounded-full mx-auto mb-1" style={{ background: b.color }} />
                      <p className="text-xs font-medium text-navy-700 truncate">{b.name}</p>
                      <p className="text-xs text-navy-400">{b.count} booking{b.count !== 1 ? 's' : ''} · Rs {b.total.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sourceBars.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide">Marketing Sources</p>
                <p className="text-[10px] text-navy-300 mb-1.5">Hires that came through a marketing channel</p>
                <div className="grid grid-cols-3 gap-2">
                  {sourceBars.map((b, i) => (
                    <div key={b.name} className="bg-navy-50/60 rounded-xl p-2 text-center anim-fade-up hover:bg-navy-50 transition-colors" style={{ animationDelay: `${i * 45}ms` }}>
                      <div className="w-3 h-3 rounded-full mx-auto mb-1" style={{ background: b.color }} />
                      <p className="text-xs font-medium text-navy-700 truncate">{b.name}</p>
                      <p className="text-xs text-navy-400">{b.count} booking{b.count !== 1 ? 's' : ''} · Rs {b.total.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Owner payouts */}
        <div className="card">
          <p className="section-title mb-4">Owner Payouts</p>
          <div className="space-y-3">
            {ownerPayouts.map(({ owner, total, pending, count }) => (
              <div key={owner.id} className="flex items-center gap-3 p-3 bg-navy-50/60 rounded-xl">
                <div className="w-9 h-9 rounded-xl bg-navy-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {owner.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-navy-800 truncate">{owner.name}</p>
                  <p className="text-xs text-navy-400">{count} bookings · {owner.commissionRate}% commission</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-navy-800">Rs {total.toLocaleString()}</p>
                  {pending > 0 && <p className="text-xs text-amber-600">Rs {pending.toLocaleString()} pending</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payout records table */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <p className="section-title">All Payout Records</p>
            <p className="text-xs text-navy-400 mt-0.5">
              {filteredCommissions.length} of {commissions.length} · Income Rs {filteredTotal.toLocaleString()} · Owner Rs {filteredOwnerTotal.toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={exportCSV}
              disabled={filteredCommissions.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl transition-colors"
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              onClick={exportPDF}
              disabled={filteredCommissions.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl transition-colors"
            >
              <FileText size={14} /> PDF
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 pointer-events-none" />
            <input
              className="input pl-10 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, vehicle, owner…"
            />
          </div>
          <div className="w-40">
            <Select value={fOwner} onChange={setFOwner} placeholder="All owners"
              options={owners.map((o) => ({ value: o.id, label: o.name }))} />
          </div>
          <div className="w-52">
            <Select value={fVehicle} onChange={setFVehicle} placeholder="All vehicles"
              options={vehiclesInUse.map((v) => ({ value: v.id, label: `${v.brand} ${v.model}`, sub: v.vehicleNumber }))} />
          </div>
          <div className="w-40">
            <Select value={fReferral} onChange={setFReferral} placeholder="All referrals"
              options={referralOptions.map((r) => ({ value: r, label: r }))} />
          </div>
          <div className="w-36">
            <Select value={fStatus} onChange={setFStatus} placeholder="All status"
              options={['Pending', 'Paid', 'Credit'].map((s) => ({ value: s, label: s }))} />
          </div>
          {filtersActive && (
            <button onClick={clearFilters} className="flex items-center gap-1.5 text-xs font-medium text-navy-500 hover:text-navy-800 bg-navy-50 hover:bg-navy-100 px-3.5 py-2.5 rounded-xl transition-colors flex-shrink-0">
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {/* Date / period filter */}
        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          <div className="flex bg-navy-50 rounded-xl p-0.5 gap-0.5">
            {([['all', 'All time'], ['week', 'This Week'], ['month', 'This Month'], ['year', 'This Year'], ['custom', 'Custom']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${
                  period === key ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'
                }`}
              >
                {label}
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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr>
                <th className="table-head text-left pb-3">Booking</th>
                <th className="table-head text-left pb-3">Vehicle</th>
                <th className="table-head text-left pb-3">Owner</th>
                <th className="table-head text-center pb-3">Referral</th>
                <th className="table-head text-right pb-3">Total</th>
                <th className="table-head text-right pb-3">Referral Fee</th>
                <th className="table-head text-right pb-3">Owner Gets</th>
                <th className="table-head text-right pb-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredCommissions.map((c) => {
                const booking = bookings.find((b) => b.id === c.bookingId);
                const vehicle = vehicles.find((v) => v.id === c.vehicleId);
                const owner   = owners.find((o) => o.id === c.ownerId);
                return (
                  <tr key={c.id} className="table-row">
                    <td className="py-3">
                      <p className="text-sm font-medium text-navy-800">{booking?.customerName ?? '—'}</p>
                      <p className="text-xs text-navy-400">{booking?.startDate} – {booking?.endDate}</p>
                    </td>
                    <td className="py-3">
                      <p className="text-sm text-navy-700">{vehicle?.brand} {vehicle?.model}</p>
                      <p className="text-xs text-navy-400">{vehicle?.vehicleNumber}</p>
                    </td>
                    <td className="py-3 text-sm text-navy-700">{owner?.name ?? '—'}</td>
                    <td className="py-3 text-center">
                      <span className="text-xs bg-navy-50 text-navy-600 px-2 py-0.5 rounded-full">{c.referral}</span>
                    </td>
                    <td className="py-3 text-right text-sm font-semibold text-navy-800">
                      Rs {c.totalIncome.toLocaleString()}
                    </td>
                    <td className="py-3 text-right">
                      {(c.coordinatorFee ?? 0) > 0 ? (
                        <>
                          <p className="text-sm font-semibold text-amber-700">Rs {(c.coordinatorFee ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-navy-400 truncate max-w-[90px] ml-auto">{c.referral}</p>
                        </>
                      ) : (
                        <span className="text-sm text-navy-300">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right text-sm font-semibold text-emerald-700">
                      Rs {c.ownerPayout.toLocaleString()}
                    </td>
                    <td className="py-3 text-right">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                );
              })}
              {filteredCommissions.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-navy-400 text-sm">
                  {commissions.length === 0 ? 'No payout records yet.' : 'No records match your filters.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Expanded full-screen detail view ── */}
      <Modal open={expanded} onClose={() => setExpanded(false)} title="Income by Referral — Detailed" width="max-w-[92vw]">
        <div className="space-y-6">
          <div className="bg-navy-50/40 rounded-2xl p-4">
            {renderChart(320)}
          </div>
          {renderDetailSection('Direct income · by vehicle owner', "Walk-in hires on the owner's own vehicle (no referrer)", directEntries)}
          {renderDetailSection('Owner Referrals · by referrer', "Income an owner referred onto another owner's vehicle", referrerEntries)}
          {renderDetailSection('Marketing Sources', 'Hires that came through a marketing channel', sourceEntries)}
        </div>
      </Modal>
    </>
  );
}
