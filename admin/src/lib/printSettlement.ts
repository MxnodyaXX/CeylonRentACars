/* A month's payout statement for one owner — every line behind the figure. Opens an A4 print window. */
import type { Owner, OwnerSettlement } from '../types';
import { rs } from './bookingRecord';
import { periodLabel } from './settlements';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const money = (n: number) => (n < 0 ? `− ${rs(-n)}` : rs(n));

export function settlementHtml(s: OwnerSettlement, owner?: Owner): string {
  const section = (title: string, kinds: string[]) => {
    const ls = s.lines.filter((l) => kinds.includes(l.kind));
    if (!ls.length) return '';
    return `<h3>${title}</h3><table><thead><tr><th>Date</th><th>Item</th><th class="num">Amount</th></tr></thead><tbody>${
      ls.map((l) => `<tr><td>${day(l.date)}${l.carriedOver ? '<div class="muted">earlier month</div>' : ''}</td><td>${esc(l.label)}${l.detail ? `<div class="muted">${esc(l.detail)}</div>` : ''}</td><td class="num${l.amount < 0 ? ' minus' : ''}">${money(l.amount)}</td></tr>`).join('')
    }</tbody></table>`;
  };
  const no = `PAY-${s.period.replace('-', '')}-${(owner?.name ?? s.ownerId).split(' ')[0].toUpperCase()}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${no} — ${esc(owner?.name)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111114; font-size: 12.5px; margin: 0; }
  .top { display: flex; justify-content: space-between; border-bottom: 3px solid #E11D2A; padding-bottom: 12px; }
  h1 { font-size: 22px; margin: 0; } .brand { color: #E11D2A; font-weight: 800; letter-spacing: .04em; font-size: 12px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #71717A; margin: 18px 0 4px; }
  .meta { text-align: right; } .muted { color: #71717A; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: #71717A; border-bottom: 1px solid #E4E4E7; padding: 6px 4px; }
  td { padding: 6px 4px; border-bottom: 1px solid #F4F4F5; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; } .minus { color: #B91C1C; }
  .totals { margin-left: auto; width: 320px; margin-top: 14px; } .totals td { border: none; padding: 4px; }
  .totals .big td { font-size: 15px; font-weight: 800; border-top: 2px solid #111114; padding-top: 8px; }
  .box { border: 1px solid #E4E4E7; border-radius: 10px; padding: 10px 12px; margin-top: 16px; }
</style></head><body>
  <div class="top">
    <div><div class="brand">CEYLON RENT A CARS</div><h1>Owner payout statement</h1><div class="muted">${periodLabel(s.period)}</div></div>
    <div class="meta"><b>${no}</b><div>${esc(owner?.name)}</div><div class="muted">${esc(owner?.phone)}${owner?.accountNumber ? ` · ${esc([owner.bankName, owner.accountNumber].filter(Boolean).join(' '))}` : ''}</div></div>
  </div>
  <p class="muted">Rentals completed in ${periodLabel(s.period)} (and any earlier ones not paid yet). Customers pay the company; the company pays your share whether or not the customer has paid in full.</p>
  ${section('Your rentals', ['rental'])}
  ${section('Referral fees you earned', ['referral'])}
  ${section('Amounts you owe back', ['deduction'])}
  ${section('Expenses the company paid on your vehicles', ['expense'])}
  <table class="totals">
    <tr><td>Your share of rentals</td><td class="num">${rs(s.rentals)}</td></tr>
    ${s.referralFees ? `<tr><td>Referral fees</td><td class="num">${rs(s.referralFees)}</td></tr>` : ''}
    ${s.deductions ? `<tr><td>Owed back</td><td class="num minus">${money(s.deductions)}</td></tr>` : ''}
    ${s.expenses ? `<tr><td>Expenses on your vehicles</td><td class="num minus">− ${rs(s.expenses)}</td></tr>` : ''}
    <tr class="big"><td>${s.net >= 0 ? 'Paid to you' : 'You owe the company'}</td><td class="num">${rs(Math.abs(s.net))}</td></tr>
  </table>
  <div class="box">
    <div>Prepared by ${esc(s.preparedBy ?? '—')} on ${day(s.preparedAt)} · Approved by ${esc(s.approvedBy ?? '—')} on ${day(s.approvedAt)}</div>
    ${s.paidAt ? `<div>Paid ${day(s.paidAt)} by ${esc(s.payMethod)}${s.payRef ? ` · reference <b>${esc(s.payRef)}</b>` : ''} · recorded by ${esc(s.paidBy)}</div>` : '<div class="muted">Not paid yet</div>'}
    ${s.ownerConfirmedAt ? `<div>Confirmed received by the owner on ${day(s.ownerConfirmedAt)}${s.ownerNote ? ` — “${esc(s.ownerNote)}”` : ''}</div>` : ''}
  </div>
</body></html>`;
}

/** false when the browser blocked the window */
export function printSettlement(s: OwnerSettlement, owner?: Owner): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(settlementHtml(s, owner));
  w.document.close();
  setTimeout(() => w.print(), 300);
  return true;
}
