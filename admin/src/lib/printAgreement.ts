/* =====================================================================
   Printable rental agreement — booking, customer, vehicle, charges,
   policies and signature lines. The terms below are a starting template:
   review them (ideally with a lawyer) before relying on them.
   ===================================================================== */
import type { Booking, Vehicle } from '../types';
import { bookingNo, depositHeld, priceBreakdown } from './bookingRecord';
import { durationLabel } from './rentalPeriod';

const esc = (s?: string | number) => String(s ?? '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
const when = (d: string, t?: string) => `${new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${t ? `, ${t}` : ''}`;

export const DEFAULT_POLICIES = {
  allowedArea: 'Within Sri Lanka only. No off-road driving, racing, towing or carrying goods for hire.',
  fuelPolicy: 'Full to full — the vehicle is returned with the same fuel level it was handed over with, or the difference is charged.',
  lateReturnPolicy: 'Returns more than 2 hours late are charged as an extra day unless agreed in advance.',
};

export function printRentalAgreement(b: Booking, vehicle: Vehicle | undefined, staff: string) {
  const p = priceBreakdown(b, vehicle);
  const a = { ...DEFAULT_POLICIES, ...(b.agreement ?? {}) };
  const ci = b.customerInfo ?? {};
  const row = (k: string, v?: string | number) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`;
  const pickup = b.checklists?.pickup;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Rental agreement ${bookingNo(b)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111114;margin:0;padding:28px 34px;font-size:12px;line-height:1.45}
  h1{font-size:20px;margin:0} h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#52525B;margin:18px 0 6px;border-bottom:1px solid #E4E4E7;padding-bottom:4px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #E11D2A;padding-bottom:10px}
  .muted{color:#71717A} table{width:100%;border-collapse:collapse} td{padding:3px 0;vertical-align:top} td.k{color:#71717A;width:38%}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:24px} .money td{padding:4px 0;border-bottom:1px solid #F4F4F5} .money .tot td{font-weight:700;border-bottom:0}
  ol{padding-left:18px;margin:4px 0} li{margin:2px 0} .sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:34px}
  .line{border-top:1px solid #111114;padding-top:4px;margin-top:46px} img.sign{height:60px;display:block}
  @media print{body{padding:14mm 12mm}}
</style></head><body>
<div class="top">
  <div><h1>Vehicle Rental Agreement</h1><div class="muted">Ceylon Rent A Cars · 077 972 6761 · hello@ceylonrentacars.lk</div></div>
  <div style="text-align:right"><b>${bookingNo(b)}</b><div class="muted">Printed ${new Date().toLocaleDateString('en-GB')}</div></div>
</div>

<div class="cols">
  <div><h2>Customer (renter)</h2><table>
    ${row('Name', b.customerName)}${row('Phone', b.customerPhone)}${row('NIC / Passport', b.customerNIC || ci.passportNumber)}
    ${row('Nationality', ci.nationality)}${row('Address', ci.address)}
    ${row('Driving licence', [ci.licenceNumber, ci.licenceType].filter(Boolean).join(' · ') || undefined)}
    ${row('Licence expiry', ci.licenceExpiry)}${ci.licenceType === 'Foreign' ? row('International Driving Permit', ci.idp ? 'Yes' : 'NOT provided') : ''}
    ${row('Emergency contact', [ci.emergencyName, ci.emergencyPhone].filter(Boolean).join(' · ') || undefined)}
  </table></div>
  <div><h2>Vehicle & period</h2><table>
    ${row('Vehicle', vehicle ? `${vehicle.brand} ${vehicle.model}` : undefined)}${row('Registration', vehicle?.vehicleNumber)}
    ${row('Pickup', `${when(b.startDate, b.startTime)} — ${b.pickupLocation || '—'}`)}
    ${row('Return', `${when(b.endDate, b.endTime)} — ${b.dropLocation || b.pickupLocation || '—'}`)}
    ${row('Rental', `${durationLabel(b)}${b.rentalType && b.rentalType !== 'Daily' ? ` (${b.rentalType.toLowerCase()})` : ''}`)}
    ${row('Included km', `${((vehicle?.includedKmPerDay ?? 100) * (b.totalDays || 1)).toLocaleString()} km, then Rs ${(vehicle?.extraKmRate ?? 50).toLocaleString()} per extra km`)}
    ${pickup ? row('At handover', `${pickup.odometer.toLocaleString()} km · fuel ${pickup.fuel}${pickup.damage ? ` · ${pickup.damage}` : ''}`) : ''}
  </table></div>
</div>

<h2>Charges</h2>
<table class="money">
  ${p.lines.map((l) => `<tr><td>${esc(l.label)}</td><td style="text-align:right">${l.amount < 0 ? '−' : ''}${rs(Math.abs(l.amount))}</td></tr>`).join('')}
  <tr class="tot"><td>Total</td><td style="text-align:right">${rs(p.bill)}</td></tr>
  <tr><td>Paid so far</td><td style="text-align:right">${rs(p.paid)}</td></tr>
  <tr class="tot"><td>Balance due</td><td style="text-align:right">${rs(p.due)}</td></tr>
  ${b.depositType ? `<tr><td>Security deposit (${esc(b.depositType)})</td><td style="text-align:right">${b.depositType === 'cash' ? rs(depositHeld(b) || b.depositAmount || 0) : esc(b.depositAssetDescription)}</td></tr>` : ''}
  ${a.insuranceExcess ? `<tr><td>Insurance excess payable by the renter per claim</td><td style="text-align:right">${rs(a.insuranceExcess)}</td></tr>` : ''}
</table>

<h2>Conditions</h2>
<ol>
  <li><b>Use:</b> ${esc(a.allowedArea)}</li>
  <li><b>Fuel:</b> ${esc(a.fuelPolicy)}</li>
  <li><b>Late return:</b> ${esc(a.lateReturnPolicy)}</li>
  <li>Only the renter${b.driverId ? ' and the assigned driver' : ''} may drive the vehicle. The renter must hold a valid driving licence for the whole rental.</li>
  <li>The renter is responsible for traffic fines, tolls and parking charges during the rental, and for damage not covered by insurance (up to the excess above).</li>
  <li>Accidents, breakdowns or theft must be reported to Ceylon Rent A Cars and, where required, the police immediately.</li>
  <li>No smoking, pets or illegal goods in the vehicle. Excess cleaning may be charged.</li>
  <li>The security deposit is returned after the vehicle is checked on return, less any amounts due under this agreement.</li>
</ol>

<div class="sig">
  <div>${pickup?.signature ? `<img class="sign" src="${pickup.signature}" alt="">` : ''}<div class="line">Renter — ${esc(b.customerName)}<br><span class="muted">Date:</span></div></div>
  <div><div class="line">For Ceylon Rent A Cars — ${esc(staff)}<br><span class="muted">Date:</span></div></div>
</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=820,height=1100');
  if (w) { w.document.write(html); w.document.close(); }
}
