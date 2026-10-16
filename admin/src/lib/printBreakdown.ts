import type { Booking, Owner, Vehicle } from '../types';
import { BdData, BdIncident, CATEGORY_LABEL, EXPENSE_LABEL, PARTY_LABEL, PAYMENT_LABEL, SOLUTION_LABEL, SOLUTION_STATUS_LABEL, STATUS_LABEL } from './breakdowns';
import { ledgerFor } from './breakdownLedger';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const rs = (n?: number) => `Rs ${Math.round(n ?? 0).toLocaleString('en-LK')}`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** Printable incident report (opens the browser's print dialog) */
export function printBreakdownReport(i: BdIncident, d: BdData, b?: Booking, vehicles: Vehicle[] = [], owners: Owner[] = []) {
  const car = (id?: string) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : '—'; };
  const owner = owners.find((o) => o.id === i.ownerId);
  const l = ledgerFor(i.id, d);
  const sols = d.solutions.filter((s) => s.incidentId === i.id);
  const exps = d.expenses.filter((e) => e.incidentId === i.id);
  const pays = d.payments.filter((p) => p.incidentId === i.id);
  const allocs = d.allocations.filter((a) => a.incidentId === i.id && !a.supersededAt);
  const events = d.events.filter((e) => e.incidentId === i.id).sort((a, c) => a.at.localeCompare(c.at));
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(i.ref)} — breakdown report</title><style>
    body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:28px} h1{font-size:20px;margin:0} h2{font-size:14px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
    table{border-collapse:collapse;width:100%} th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #eee;vertical-align:top} th{width:30%;color:#555;font-weight:600}
    .grid th{width:auto;background:#f6f6f6} .num{text-align:right} .muted{color:#777} .strike{text-decoration:line-through;color:#999}
    @media print{body{margin:12mm}}</style></head><body>
    <h1>Breakdown report · ${esc(i.ref)}</h1>
    <p class="muted">Ceylon Rent A Cars · printed ${esc(when(new Date().toISOString()))} · status ${esc(STATUS_LABEL[i.status])}</p>
    <h2>Incident</h2><table>
      ${row('Booking', b ? `${b.customerName} · ${b.customerPhone} · ${b.startDate} → ${b.endDate} · ${rs(b.totalAmount)}` : i.bookingId)}
      ${row('Vehicle', car(i.vehicleId))}${row('Owner', owner?.name ?? '—')}
      ${row('Broke down', `${when(i.occurredAt ?? i.reportedAt)}${i.location ? ` · ${i.location}` : ''}${i.lat !== undefined ? ` (${i.lat}, ${i.lng})` : ''}`)}
      ${row('Reported', `${when(i.reportedAt)} by ${i.reportedBy} · contact ${i.contactPhone ?? '—'}`)}
      ${row('Type', CATEGORY_LABEL[i.category])}${row('Description', i.description)}
      ${row('Mileage / fuel', `${i.mileage != null ? `${i.mileage.toLocaleString()} km` : '—'} · ${i.fuel ?? '—'}`)}
      ${row('Driveable / passengers', `${i.driveable} · ${i.passengersSafe} · urgency ${i.urgency}`)}
      ${row('Cause', i.causeStatus === 'pending' ? 'Pending assessment' : i.cause ?? 'Assessed')}
      ${row('Resolution', i.resolution ?? '—')}
    </table>
    <h2>Solutions</h2><table class="grid"><tr><th>Solution</th><th>Status</th><th>Provider</th><th>Details</th></tr>
      ${sols.map((s) => `<tr><td>${esc(SOLUTION_LABEL[s.kind])}<br><span class="muted">${esc(when(s.createdAt))}</span></td><td>${esc(SOLUTION_STATUS_LABEL[s.status])}${s.result ? `<br>${esc(s.result)}` : ''}</td>
        <td>${esc([s.providerName, s.providerCompany, s.providerPhone].filter(Boolean).join(' · ') || '—')}</td>
        <td>${esc([s.diagnosis && `Diagnosis: ${s.diagnosis}`, s.workDone && `Work: ${s.workDone}`, s.toVehicleId && `Replacement: ${car(s.toVehicleId)}`, s.partnerVehicle && `Partner: ${s.partnerVehicle} ${s.partnerReg ?? ''}`, s.garageName && `Garage: ${s.garageName}`, s.refundApproved !== undefined && `Refund ${rs(s.refundApproved)} (${s.refundStatus})`].filter(Boolean).join(' · ') || '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None</td></tr>'}
    </table>
    <h2>Expenses</h2><table class="grid"><tr><th>Expense</th><th>Vendor</th><th class="num">Qty × unit</th><th class="num">Amount</th></tr>
      ${exps.map((e) => `<tr class="${e.voidedAt ? 'strike' : ''}"><td>${esc(e.description)}<br><span class="muted">${esc(EXPENSE_LABEL[e.category])}</span></td><td>${esc(e.vendor ?? '—')}</td><td class="num">${e.quantity} × ${rs(e.unitCost)}</td><td class="num">${rs(e.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None</td></tr>'}
      <tr><th colspan="3">Total cost</th><th class="num">${rs(l.cost)}</th></tr></table>
    <h2>Responsibility</h2><table class="grid"><tr><th>Party</th><th class="num">Responsible for</th><th class="num">Put in</th><th class="num">Balance</th></tr>
      ${(['owner', 'customer', 'insurance'] as const).map((p) => `<tr><td>${PARTY_LABEL[p]}</td><td class="num">${rs(l.allocated[p])}</td><td class="num">${rs(l.contributed[p])}</td><td class="num">${l.outstanding[p] > 0.5 ? `owes ${rs(l.outstanding[p])}` : l.outstanding[p] < -0.5 ? `owed ${rs(-l.outstanding[p])}` : 'settled'}</td></tr>`).join('')}
      <tr><td>Company</td><td class="num">${rs(l.allocated.company + l.unallocated)}</td><td class="num">${rs(l.companyNet)}</td><td class="num">—</td></tr></table>
      ${allocs[0] ? `<p class="muted">Reason: ${esc(allocs[0].reason)} — ${esc(allocs[0].decidedBy)}, ${esc(when(allocs[0].decidedAt))}</p>` : '<p class="muted">Responsibility not decided yet.</p>'}
    <h2>Payments</h2><table class="grid"><tr><th>Date</th><th>Type</th><th>From → to</th><th class="num">Amount</th></tr>
      ${pays.map((p) => `<tr class="${p.status === 'reversed' ? 'strike' : ''}"><td>${esc(when(p.paidAt))}</td><td>${esc(PAYMENT_LABEL[p.kind])}${p.reference ? ` · ${esc(p.reference)}` : ''}</td><td>${esc(PARTY_LABEL[p.payer])} → ${esc(p.payee)}</td><td class="num">${rs(p.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None</td></tr>'}
    </table>
    <p><b>Financial status:</b> ${l.settled ? 'Settled' : `Outstanding — ${esc(l.blockers.join('; '))}`}</p>
    <h2>Timeline</h2><table class="grid">${events.map((e) => `<tr><td style="width:150px">${esc(when(e.at))}</td><td>${esc(e.text)} <span class="muted">— ${esc(e.by)}</span></td></tr>`).join('')}</table>
    <script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
