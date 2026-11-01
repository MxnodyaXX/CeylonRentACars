/* =====================================================================
   Printable partner agreement for an application from "List your vehicle":
   the exact text the owner accepted on the website, their signature, the
   vehicle and — once approved — the agreed price and commission.
   ===================================================================== */
import type { PartnerApplication } from '../types';

const esc = (s?: string | number) => String(s ?? '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const rs = (n?: number) => (n ? `Rs ${Math.round(n).toLocaleString('en-LK')}` : '—');
const day = (d?: string) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

/** "1. Title" lines become headings, "1.2 text" lines numbered clauses; the first line is the title */
function agreementHtml(text: string) {
  return text.split('\n').slice(1).filter((l) => l.trim()).map((l) => (
    /^\d+\.\s/.test(l) ? `<h3>${esc(l)}</h3>` : `<p>${esc(l)}</p>`
  )).join('');
}

export function printPartnerAgreement(a: PartnerApplication, staff: string) {
  const row = (k: string, v?: string | number) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`;
  const approved = a.status === 'Approved';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Partner agreement ${esc(a.id)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111114;margin:0;padding:28px 34px;font-size:12px;line-height:1.5}
  h1{font-size:20px;margin:0} h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#52525B;margin:18px 0 6px;border-bottom:1px solid #E4E4E7;padding-bottom:4px}
  h3{font-size:12.5px;margin:12px 0 2px} p{margin:2px 0}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #E11D2A;padding-bottom:10px}
  .muted{color:#71717A} table{width:100%;border-collapse:collapse} td{padding:3px 0;vertical-align:top} td.k{color:#71717A;width:40%}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:24px} .terms{columns:1}
  .sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px;page-break-inside:avoid}
  .line{border-top:1px solid #111114;padding-top:4px;margin-top:8px} img.sign{height:70px;display:block}
  .box{border:1px solid #E4E4E7;border-radius:6px;padding:8px 10px;margin-top:6px}
  @media print{body{padding:14mm 12mm}}
</style></head><body>
<div class="top">
  <div><h1>Vehicle Partner Agreement</h1><div class="muted">Ceylon Rent A Cars · 077 972 6761 · hello@ceylonrentacars.lk</div></div>
  <div style="text-align:right"><b>${esc(a.id)}</b><div class="muted">Version ${esc(a.agreement?.version)} · printed ${new Date().toLocaleDateString('en-GB')}</div></div>
</div>

<div class="cols">
  <div><h2>Owner</h2><table>
    ${row('Name', a.name)}${row('NIC', a.nic)}${row('Phone', `+${a.phone}`)}${row('Email', a.email)}
    ${row('Address', [a.address, a.city].filter(Boolean).join(', '))}
  </table></div>
  <div><h2>Vehicle</h2><table>
    ${row('Vehicle', `${a.brand} ${a.model}${a.year ? ` (${a.year})` : ''}`)}${row('Registration', a.vehicleNumber)}
    ${row('Transmission / fuel', [a.transmission, a.fuelType].filter(Boolean).join(' · ') || undefined)}${row('Seats', a.seats)}
    ${row('Mileage at application', a.mileage ? `${a.mileage.toLocaleString()} km` : undefined)}
  </table></div>
</div>

<h2>Price and commission</h2>
<table>
  ${row('Owner\'s asking price', [a.askingDaily && `${rs(a.askingDaily)} a day`, a.askingMonthly && `${rs(a.askingMonthly)} a month`].filter(Boolean).join(' · ') || undefined)}
  ${approved ? row('Agreed rental price', [a.agreedDaily && `${rs(a.agreedDaily)} a day`, a.agreedMonthly && `${rs(a.agreedMonthly)} a month`].filter(Boolean).join(' · ') || undefined) : ''}
  ${approved ? row('Company commission', a.commissionRate != null ? `${a.commissionRate}% of the rental income` : undefined) : ''}
  ${approved ? row('Accepted on', day(a.decidedAt)) : row('Status', `${a.status} — price and commission are agreed at acceptance`)}
</table>

<h2>Terms</h2>
<div class="terms">${agreementHtml(a.agreement?.text ?? '')}</div>

<div class="sig">
  <div>${a.agreement?.signature ? `<img class="sign" src="${a.agreement.signature}" alt="">` : '<div style="height:70px"></div>'}
    <div class="line">Owner — ${esc(a.agreement?.name || a.name)}<br><span class="muted">Signed online on ${day(a.agreement?.acceptedAt)} from +${esc(a.phone)} (verified by SMS code)</span></div></div>
  <div><div style="height:70px"></div><div class="line">For Ceylon Rent A Cars — ${esc(staff)}<br><span class="muted">Date:</span></div></div>
</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=820,height=1100');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
