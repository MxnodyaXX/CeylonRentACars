/* =====================================================================
   Customer invoice for a rental — built from the booking's own records (price, charges such as
   extra km, the payment log and the deposit), so it always matches the Payments tab. Opens an
   A4 print window (print or "Save as PDF").
   ===================================================================== */
import type { Booking, Vehicle } from '../types';
import { bookingNo, depositHeld, ledgerOf, priceBreakdown, rs } from './bookingRecord';
import { earlierKm } from './exchange';
import { tripKmProvider } from './tripKm';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const dayTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export const invoiceNo = (b: Booking) => bookingNo(b).replace(/^CRC-/, 'INV-');

export function invoiceHtml(b: Booking, vehicle?: Vehicle): string {
  const price = priceBreakdown(b, vehicle);
  const pickup = b.checklists?.pickup, ret = b.checklists?.return;
  // every car the customer drove (breakdown replacements, exchanges), not only the final one
  const trip = tripKmProvider.of?.(b);
  const driven = trip?.total ?? (pickup && ret ? ret.odometer - pickup.odometer + earlierKm(b) : undefined);
  const multi = trip && trip.legs.length > 1 ? trip : undefined;
  const included = (vehicle?.includedKmPerDay ?? 100) * (b.totalDays || 1);
  const payments = ledgerOf(b).filter((p) => p.kind === 'Payment' || p.kind === 'Advance' || p.kind === 'Refund');
  const held = depositHeld(b);

  const lineRows = price.lines.map((l) => `<tr><td>${esc(l.label.replace(/^Other — (Extra km)/, '$1'))}</td><td class="num${l.amount < 0 ? ' minus' : ''}">${l.amount < 0 ? '− ' + rs(-l.amount) : rs(l.amount)}</td></tr>`).join('');
  const payRows = payments.length
    ? payments.map((p) => `<tr><td>${day(p.at)}</td><td>${esc(p.kind)}</td><td>${esc(p.method)}${p.receiptNo ? ' · ' + esc(p.receiptNo) : ''}</td><td class="num${p.kind === 'Refund' ? ' minus' : ''}">${p.kind === 'Refund' ? '− ' : ''}${rs(p.amount)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No payments recorded</td></tr>';
  const deposit = b.depositType === 'cash'
    ? `<p class="muted">Security deposit: ${rs(b.depositAmount ?? 0)} received · ${rs(b.depositReturned ?? 0)} returned${b.depositDeduction ? ` · ${rs(b.depositDeduction)} kept${b.depositNotes ? ` (${esc(b.depositNotes)})` : ''}` : ''}${held > 0 ? ` · ${rs(held)} still held` : ''}</p>`
    : b.depositType ? `<p class="muted">Security deposit: ${esc(b.depositAssetDescription ?? b.depositType)}</p>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${invoiceNo(b)} — ${esc(b.customerName)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111114; font-size: 12.5px; margin: 0; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #E11D2A; padding-bottom: 12px; }
  h1 { font-size: 22px; margin: 0; } .brand { color: #E11D2A; font-weight: 800; letter-spacing: .04em; font-size: 12px; }
  .meta { text-align: right; } .meta b { font-size: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 16px 0; }
  .box { border: 1px solid #E4E4E7; border-radius: 10px; padding: 10px 12px; }
  .box h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #71717A; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font-size: 11px; color: #71717A; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #E4E4E7; padding: 6px 4px; }
  td { padding: 7px 4px; border-bottom: 1px solid #F4F4F5; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; } .minus { color: #B91C1C; } .muted { color: #71717A; }
  .totals { margin-left: auto; width: 300px; margin-top: 10px; }
  .totals td { border: none; padding: 4px; } .totals .big td { font-size: 15px; font-weight: 800; border-top: 2px solid #111114; padding-top: 8px; }
  .due { color: ${price.due > 0 ? '#B91C1C' : '#047857'}; }
  .foot { margin-top: 28px; font-size: 11px; color: #71717A; text-align: center; }
</style></head><body>
  <div class="top">
    <div><div class="brand">CEYLON RENT A CARS</div><h1>${ret?.recovery ? 'Statement of account' : 'Invoice'}</h1><div class="muted">ceylonrentacars.com · 071 733 3313</div></div>
    <div class="meta"><b>${invoiceNo(b)}</b><div>Booking ${bookingNo(b)}</div><div>Issued ${day(new Date().toISOString())}</div></div>
  </div>
  <div class="grid">
    <div class="box"><h3>Billed to</h3><b>${esc(b.customerName)}</b><div>${esc(b.customerPhone)}</div>${b.customerEmail ? `<div>${esc(b.customerEmail)}</div>` : ''}</div>
    <div class="box"><h3>Vehicle</h3><b>${vehicle ? esc(`${vehicle.brand} ${vehicle.model}`) : '—'}</b><div>${esc(vehicle?.vehicleNumber ?? '')}</div></div>
    <div class="box"><h3>Rental period</h3>
      <div>Out: ${pickup ? dayTime(pickup.at) : `${day(b.startDate)}${b.startTime ? ' ' + esc(b.startTime) : ''}`}${b.pickupLocation ? ` · ${esc(b.pickupLocation)}` : ''}</div>
      <div>In: ${ret ? dayTime(ret.at) : `${day(b.endDate)}${b.endTime ? ' ' + esc(b.endTime) : ''}`}${b.dropLocation ? ` · ${esc(b.dropLocation)}` : ''}</div>
      <div class="muted">${b.totalDays} day${b.totalDays === 1 ? '' : 's'}</div></div>
    <div class="box"><h3>Mileage</h3>
      ${multi ? `${multi.legs.map((l) => `<div>${esc(l.car)}: ${l.km != null ? `${l.km.toLocaleString()} km` : '<span class="muted">not recorded</span>'}${l.role === 'earlier' ? '' : ` <span class="muted">(${l.from?.toLocaleString() ?? '?'} → ${l.to?.toLocaleString() ?? '?'})</span>`}</div>`).join('')}
      <div>${multi.total != null ? `<b>${multi.total.toLocaleString()} km</b> driven in all` : `${multi.known.toLocaleString()} km recorded`} · ${included.toLocaleString()} km included</div>
      ${multi.total != null ? `<div>${Math.max(0, multi.total - included).toLocaleString()} extra km</div>` : ''}`
      : pickup && ret ? `<div>${pickup.odometer.toLocaleString()} → ${ret.odometer.toLocaleString()} km</div><div>${(driven ?? 0).toLocaleString()} km driven · ${included.toLocaleString()} km included</div>
      <div>${Math.max(0, (driven ?? 0) - included).toLocaleString()} extra km</div>` : '<div class="muted">Not recorded</div>'}
      <div class="muted">Fuel: ${esc(pickup?.fuel ?? '—')} out · ${esc(ret?.fuel ?? '—')} in</div></div>
  </div>

  ${ret?.recovery ? `<p class="box" style="border-color:#FCA5A5;background:#FEF2F2;color:#991B1B"><b>Vehicle recovered by the company</b> on ${dayTime(ret.at)} — ${esc(ret.recovery.reason.toLowerCase())}. The rental ended on that date; the balance below remains payable.</p>` : ''}
  <table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${lineRows}</tbody></table>
  <table class="totals">
    <tr><td>Total</td><td class="num">${rs(price.bill)}</td></tr>
    <tr><td>Paid</td><td class="num">${rs(price.paid)}</td></tr>
    <tr class="big"><td>Balance due</td><td class="num due">${price.due > 0 ? rs(price.due) : 'Paid in full'}</td></tr>
  </table>

  <h3 style="margin:22px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#71717A">Payments</h3>
  <table><thead><tr><th>Date</th><th>Type</th><th>Method / receipt</th><th class="num">Amount</th></tr></thead><tbody>${payRows}</tbody></table>
  ${deposit}
  <div class="foot">Thank you for renting with Ceylon Rent A Cars.</div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;
}

/** Opens the invoice in a print window (print or save as PDF) */
export function printInvoice(b: Booking, vehicle?: Vehicle) {
  const w = window.open('', '_blank', 'width=820,height=1100');
  if (!w) return false;
  w.document.write(invoiceHtml(b, vehicle));
  w.document.close();
  return true;
}
