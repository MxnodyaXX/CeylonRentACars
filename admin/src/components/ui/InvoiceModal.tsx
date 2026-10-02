import { useStore } from '../../store/useStore';
import { resolveReferralFee } from '../../lib/referral';
import Modal from './Modal';

interface Props {
  bookingId: string | null;
  onClose: () => void;
}

export default function InvoiceModal({ bookingId, onClose }: Props) {
  const { bookings, vehicles, owners, commissions, handovers } = useStore();
  if (!bookingId) return null;

  const booking    = bookings.find((b) => b.id === bookingId);
  const vehicle    = vehicles.find((v) => v.id === booking?.vehicleId);
  const commission = commissions.find((c) => c.bookingId === bookingId);
  const owner      = owners.find((o) => o.id === commission?.ownerId);
  const delivery   = handovers.find((h) => h.bookingId === bookingId && h.type === 'delivery');
  const returnH    = handovers.find((h) => h.bookingId === bookingId && h.type === 'return');

  if (!booking || !vehicle) return null;

  const finalAmount   = returnH?.finalAmount ?? booking.totalAmount;
  const referralFee   = resolveReferralFee(booking.referralFeeType, booking.referralFeeValue, finalAmount);
  const ownerPayout   = Math.max(0, finalAmount - referralFee);
  const extraKm       = returnH?.extraKm ?? 0;
  const extraCharge   = returnH?.extraKmCharge ?? 0;
  const baseAmount    = vehicle.dailyRent * booking.totalDays;
  const invoiceNo     = `INV-${booking.id.slice(-6).toUpperCase()}`;
  const issueDate     = returnH
    ? new Date(returnH.dateTime).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' });
  const referralLabel = booking.referral && booking.referral !== 'Direct'
    ? booking.referral : null;

  const handlePrint = () => {
    const html = buildInvoiceHTML({
      invoiceNo, issueDate, booking, vehicle, owner, commission,
      delivery, returnH, baseAmount, extraKm, extraCharge, finalAmount,
      referralFee, ownerPayout, referralLabel,
    });
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
  };

  return (
    <Modal open={!!bookingId} onClose={onClose} title={`Invoice — ${invoiceNo}`} width="max-w-2xl">
      <div className="space-y-5">
        {/* Preview */}
        <div className="border border-navy-100 rounded-xl overflow-hidden bg-white">
          {/* Invoice header */}
          <div className="bg-navy-800 text-white px-6 py-5 flex justify-between items-start">
            <div>
              <p className="text-xl font-black tracking-tight">Ceylon Rent A Cars</p>
              <p className="text-xs text-navy-300 mt-0.5">Vehicle Rentals Across Sri Lanka</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold tracking-wide">INVOICE</p>
              <p className="text-xs text-navy-300">{invoiceNo}</p>
              <p className="text-xs text-navy-300 mt-1">{issueDate}</p>
            </div>
          </div>

          <div className="px-6 py-5 space-y-5">
            {/* Customer + Vehicle */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-2">Bill To</p>
                <p className="text-sm font-bold text-navy-800">{booking.customerName}</p>
                <p className="text-xs text-navy-500">{booking.customerPhone}</p>
                {booking.customerNIC && <p className="text-xs text-navy-400">NIC: {booking.customerNIC}</p>}
              </div>
              <div>
                <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-2">Vehicle</p>
                <p className="text-sm font-bold text-navy-800">{vehicle.brand} {vehicle.model}</p>
                <p className="text-xs text-navy-500">Reg: {vehicle.vehicleNumber}</p>
                <p className="text-xs text-navy-400">{vehicle.year} · {vehicle.fuelType ?? ''}</p>
              </div>
            </div>

            {/* Trip details */}
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-navy-50">
                  <th className="text-left px-3 py-2 text-navy-600 font-semibold rounded-l-lg">Description</th>
                  <th className="text-center px-3 py-2 text-navy-600 font-semibold">Qty / Rate</th>
                  <th className="text-right px-3 py-2 text-navy-600 font-semibold rounded-r-lg">Amount (Rs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                <tr>
                  <td className="px-3 py-2.5 text-navy-700">
                    Vehicle Rental
                    <span className="block text-[10px] text-navy-400">{booking.startDate} → {booking.endDate}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-navy-600">
                    {booking.totalDays}d × Rs {vehicle.dailyRent.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-navy-800">
                    {baseAmount.toLocaleString()}
                  </td>
                </tr>
                {delivery && returnH && (
                  <tr>
                    <td className="px-3 py-2.5 text-navy-500">
                      Included km
                      <span className="block text-[10px] text-navy-400">{vehicle.includedKmPerDay ?? 100} km/day × {booking.totalDays}d</span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-navy-400">
                      {(returnH.mileage - delivery.mileage).toLocaleString()} km driven
                    </td>
                    <td className="px-3 py-2.5 text-right text-navy-400">—</td>
                  </tr>
                )}
                {extraKm > 0 && (
                  <tr className="bg-amber-50/50">
                    <td className="px-3 py-2.5 text-amber-700">
                      Extra Km Charge
                      <span className="block text-[10px] text-amber-500">{extraKm.toLocaleString()} km beyond free allowance</span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-amber-600">
                      {extraKm.toLocaleString()} × Rs {vehicle.extraKmRate ?? 50}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-amber-700">
                      {extraCharge.toLocaleString()}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-navy-800 text-white">
                  <td colSpan={2} className="px-3 py-3 font-bold text-sm rounded-bl-lg">Total Amount</td>
                  <td className="px-3 py-3 text-right font-black text-sm rounded-br-lg">
                    Rs {finalAmount.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Payment split */}
            <div className="bg-navy-50/60 rounded-xl p-4">
              <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wide mb-3">Payment Distribution</p>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-navy-600">{owner?.name ?? 'Owner'} <span className="text-navy-400">(owner)</span></span>
                <span className="font-bold text-emerald-700">Rs {ownerPayout.toLocaleString()}</span>
              </div>
              {referralLabel && referralFee > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-navy-600">{referralLabel} <span className="text-navy-400">(referral)</span></span>
                  <span className="font-bold text-amber-700">Rs {referralFee.toLocaleString()}</span>
                </div>
              )}
            </div>

            <p className="text-[10px] text-navy-300 text-center">
              Thank you for choosing Ceylon Rent A Cars · ceylonrentacars.lk
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Close</button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 btn-primary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print / Save PDF
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Build full A4 HTML for print window ───────────────────────────────────────
function buildInvoiceHTML(p: {
  invoiceNo: string; issueDate: string;
  booking: any; vehicle: any; owner: any; commission: any;
  delivery: any; returnH: any;
  baseAmount: number; extraKm: number; extraCharge: number; finalAmount: number;
  referralFee: number; ownerPayout: number;
  referralLabel: string | null;
}) {
  const { invoiceNo, issueDate, booking, vehicle, owner, delivery, returnH,
    baseAmount, extraKm, extraCharge, finalAmount, referralFee,
    ownerPayout, referralLabel } = p;

  const extraRow = extraKm > 0 ? `
    <tr style="background:#fffbeb">
      <td style="padding:8px 12px;color:#b45309">
        Extra Km Charge<br>
        <small style="color:#d97706">${extraKm.toLocaleString()} km beyond free allowance</small>
      </td>
      <td style="padding:8px 12px;text-align:center;color:#b45309">${extraKm.toLocaleString()} × Rs ${vehicle.extraKmRate ?? 50}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700;color:#b45309">${extraCharge.toLocaleString()}</td>
    </tr>` : '';

  const kmRow = delivery && returnH ? `
    <tr>
      <td style="padding:8px 12px;color:#71717A">
        Included Km<br>
        <small style="color:#A1A1AA">${vehicle.includedKmPerDay ?? 100} km/day × ${booking.totalDays}d</small>
      </td>
      <td style="padding:8px 12px;text-align:center;color:#A1A1AA">${(returnH.mileage - delivery.mileage).toLocaleString()} km driven</td>
      <td style="padding:8px 12px;text-align:right;color:#A1A1AA">—</td>
    </tr>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${invoiceNo} — Ceylon Rent A Cars</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size:13px; color:#18181B; background:#FAFAFA; }
  @media print {
    body { background:white; }
    .no-print { display:none!important; }
    @page { margin:15mm 20mm; size:A4; }
  }
  .page { max-width:700px; margin:30px auto; background:white; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.10); }
  .header { background:#27272A; color:white; padding:28px 32px; display:flex; justify-content:space-between; align-items:flex-start; }
  .body { padding:28px 32px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { background:#F4F4F5; padding:8px 12px; text-align:left; color:#52525B; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
  th:last-child { text-align:right; }
  th:nth-child(2) { text-align:center; }
  td { border-bottom:1px solid #F4F4F5; vertical-align:top; }
  .tfoot-row td { background:#27272A; color:white; padding:10px 12px; font-weight:700; font-size:14px; }
  .tfoot-row td:last-child { text-align:right; }
  .split-box { background:#FAFAFA; border-radius:8px; padding:16px; margin-top:16px; }
  .split-row { display:flex; justify-content:space-between; margin-bottom:6px; font-size:12px; }
  .footer { text-align:center; color:#A1A1AA; font-size:11px; padding:20px 32px; border-top:1px solid #F4F4F5; }
  .print-btn { display:block; margin:20px auto; padding:10px 28px; background:#27272A; color:white; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div style="font-size:22px;font-weight:900;letter-spacing:-.5px">Ceylon Rent A Cars</div>
      <div style="font-size:11px;color:#93c5fd;margin-top:2px">Vehicle Rentals Across Sri Lanka</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:18px;font-weight:700;letter-spacing:1px">INVOICE</div>
      <div style="font-size:11px;color:#93c5fd">${invoiceNo}</div>
      <div style="font-size:11px;color:#93c5fd;margin-top:4px">${issueDate}</div>
    </div>
  </div>

  <div class="body">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px">
      <div>
        <div style="font-size:10px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Bill To</div>
        <div style="font-weight:700;font-size:14px;color:#18181B">${booking.customerName}</div>
        <div style="color:#71717A;margin-top:2px">${booking.customerPhone}</div>
        ${booking.customerNIC ? `<div style="color:#A1A1AA;font-size:11px">NIC: ${booking.customerNIC}</div>` : ''}
      </div>
      <div>
        <div style="font-size:10px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Vehicle</div>
        <div style="font-weight:700;font-size:14px;color:#18181B">${vehicle.brand} ${vehicle.model}</div>
        <div style="color:#71717A;margin-top:2px">Reg: ${vehicle.vehicleNumber}</div>
        <div style="color:#A1A1AA;font-size:11px">${vehicle.year}${vehicle.fuelType ? ' · ' + vehicle.fuelType : ''}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align:center">Qty / Rate</th>
          <th style="text-align:right">Amount (Rs)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:10px 12px;color:#3F3F46">
            Vehicle Rental<br>
            <small style="color:#A1A1AA">${booking.startDate} → ${booking.endDate}</small>
          </td>
          <td style="padding:10px 12px;text-align:center;color:#52525B">${booking.totalDays}d × Rs ${vehicle.dailyRent.toLocaleString()}</td>
          <td style="padding:10px 12px;text-align:right;font-weight:600;color:#18181B">${baseAmount.toLocaleString()}</td>
        </tr>
        ${kmRow}
        ${extraRow}
      </tbody>
      <tfoot>
        <tr class="tfoot-row">
          <td colspan="2" style="padding:12px;font-size:14px;font-weight:700">Total Amount</td>
          <td style="padding:12px;text-align:right;font-size:16px;font-weight:900">Rs ${finalAmount.toLocaleString()}</td>
        </tr>
      </tfoot>
    </table>

    <div class="split-box">
      <div style="font-size:10px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Payment Distribution</div>
      <div class="split-row">
        <span style="color:#52525B">${owner?.name ?? 'Owner'} <span style="color:#A1A1AA">(owner)</span></span>
        <span style="font-weight:700;color:#059669">Rs ${ownerPayout.toLocaleString()}</span>
      </div>
      ${referralLabel && referralFee > 0 ? `
      <div class="split-row">
        <span style="color:#52525B">${referralLabel} <span style="color:#A1A1AA">(referral)</span></span>
        <span style="font-weight:700;color:#d97706">Rs ${referralFee.toLocaleString()}</span>
      </div>` : ''}
    </div>
  </div>

  <div class="footer">Thank you for choosing Ceylon Rent A Cars · ceylonrentacars.lk</div>
</div>
<button class="no-print print-btn" onclick="window.print()">Print / Save as PDF</button>
</body>
</html>`;
}
