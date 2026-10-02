import emailjs from '@emailjs/browser';

const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID  ?? '';
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID ?? '';
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY  ?? '';

// ── Booking Confirmation Email ────────────────────────────────────────────────

export interface BookingConfirmationEmailParams {
  toEmail: string;
  toName: string;
  ref: string;
  vehicleName: string;
  vehicleReg?: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  receiptUrl: string | null;
}

export async function sendBookingConfirmationEmail(p: BookingConfirmationEmailParams): Promise<void> {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    console.warn('[EmailJS] Credentials not configured — skipping booking confirmation email.');
    return;
  }
  if (!p.toEmail) return;
  await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
    to_email:     p.toEmail,
    to_name:      p.toName,
    subject:      `Booking Confirmed — ${p.ref} | MRAC Rent A Car`,
    html_content: buildBookingConfirmationHtml(p),
  }, PUBLIC_KEY);
}

const rs = (n: number) => `Rs ${n.toLocaleString()}`;

function buildBookingConfirmationHtml(p: BookingConfirmationEmailParams): string {
  const receiptSection = p.receiptUrl
    ? `<tr><td style="padding:0 32px 28px;text-align:center">
        <p style="margin:0 0 14px;font-size:10px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:.06em">Booking Confirmation Receipt</p>
        <a href="${p.receiptUrl}" target="_blank"
           style="display:inline-block;background:#111114;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 36px;border-radius:10px;letter-spacing:.5px">
          &#x1F4C4;&nbsp; View Full Receipt (PDF)
        </a>
        <p style="margin:10px 0 0;font-size:11px;color:#A1A1AA">Tap to open, view and save your booking confirmation as a PDF document.</p>
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;width:100%">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#111114 0%,#E11D2A 100%);padding:28px 32px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:3px">MRAC</div>
            <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:3px;letter-spacing:2px">CAR RENTAL MANAGEMENT</div>
          </td>
          <td align="right">
            <div style="font-size:13px;font-weight:700;color:#fff">BOOKING CONFIRMED</div>
            <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:3px">${p.ref}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Greeting -->
  <tr>
    <td style="padding:28px 32px 16px">
      <p style="margin:0;font-size:15px;color:#18181B">Dear <strong>${p.toName}</strong>,</p>
      <p style="margin:8px 0 0;font-size:13px;color:#71717A;line-height:1.6">
        Your booking with <strong>MRAC Rent A Car</strong> has been confirmed. Here is a summary of your reservation.
      </p>
    </td>
  </tr>

  <!-- Booking Summary -->
  <tr>
    <td style="padding:0 32px 20px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;border-radius:12px;overflow:hidden">
        <tr><td style="padding:12px 16px 8px;font-size:10px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:.06em" colspan="2">Booking Details</td></tr>
        <tr>
          <td style="padding:6px 16px;font-size:12px;color:#71717A;width:40%">Reference</td>
          <td style="padding:6px 16px;font-size:12px;font-weight:700;color:#111114">${p.ref}</td>
        </tr>
        <tr>
          <td style="padding:6px 16px;font-size:12px;color:#71717A">Vehicle</td>
          <td style="padding:6px 16px;font-size:12px;font-weight:600;color:#18181B">${p.vehicleName}${p.vehicleReg ? ` · ${p.vehicleReg}` : ''}</td>
        </tr>
        <tr>
          <td style="padding:6px 16px;font-size:12px;color:#71717A">Pick-up</td>
          <td style="padding:6px 16px;font-size:12px;font-weight:600;color:#18181B">${p.startDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 16px;font-size:12px;color:#71717A">Return</td>
          <td style="padding:6px 16px;font-size:12px;font-weight:600;color:#18181B">${p.endDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 16px 12px;font-size:12px;color:#71717A">Duration</td>
          <td style="padding:6px 16px 12px;font-size:12px;font-weight:600;color:#18181B">${p.totalDays} day${p.totalDays !== 1 ? 's' : ''}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Payment summary -->
  <tr>
    <td style="padding:0 32px 20px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;font-size:13px">
        <tr style="background:#FAFAFA">
          <th style="padding:10px 16px;text-align:left;font-size:10px;color:#71717A;font-weight:600;text-transform:uppercase">Payment</th>
          <th style="padding:10px 16px;text-align:right;font-size:10px;color:#71717A;font-weight:600;text-transform:uppercase">Amount</th>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:#3F3F46;border-top:1px solid #F4F4F5">Total Rental</td>
          <td style="padding:10px 16px;text-align:right;font-weight:600;color:#18181B;border-top:1px solid #F4F4F5">${rs(p.totalAmount)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:#059669;border-top:1px solid #F4F4F5">Paid Amount</td>
          <td style="padding:10px 16px;text-align:right;font-weight:700;color:#059669;border-top:1px solid #F4F4F5">${rs(p.paidAmount)}</td>
        </tr>
        <tr style="background:${p.balance > 0 ? '#fffbeb' : '#f0fdf4'}">
          <td style="padding:12px 16px;font-weight:700;color:${p.balance > 0 ? '#92400e' : '#065f46'};border-top:1px solid #F4F4F5">
            ${p.balance > 0 ? 'Balance Due' : '✓ Fully Paid'}
          </td>
          <td style="padding:12px 16px;text-align:right;font-weight:900;color:${p.balance > 0 ? '#d97706' : '#059669'};border-top:1px solid #F4F4F5">
            ${p.balance > 0 ? rs(p.balance) : 'Cleared'}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Receipt image -->
  ${receiptSection}

  <!-- Footer -->
  <tr>
    <td style="padding:20px 32px 28px;border-top:1px solid #F4F4F5;text-align:center">
      <p style="margin:0;font-size:12px;color:#A1A1AA">Thank you for choosing <strong>MRAC Rent A Car</strong></p>
      <p style="margin:6px 0 0;font-size:11px;color:#D4D4D8">Please present this email at vehicle pick-up. Contact us if you have any questions.</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export interface RentalSummaryParams {
  toEmail: string;
  toName: string;
  invoiceNo: string;
  vehicleName: string;
  vehicleReg: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  dailyRate: number;
  baseAmount: number;
  extraKm: number;
  extraKmRate: number;
  extraCharge: number;
  finalAmount: number;
  advancePaid: number;
  balanceCollected: number;
  ownerName: string;
  ownerPayout: number;
  referralLabel?: string | null;
  referralFee: number;
}

export async function sendRentalSummary(p: RentalSummaryParams): Promise<void> {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    console.warn('[EmailJS] Credentials not set — skipping email. Add VITE_EMAILJS_* to .env.local');
    return;
  }
  if (!p.toEmail) return;

  await emailjs.send(
    SERVICE_ID,
    TEMPLATE_ID,
    {
      to_email:     p.toEmail,
      to_name:      p.toName,
      subject:      `Your Ceylon Rent A Cars Rental Summary — ${p.invoiceNo}`,
      html_content: buildHTML(p),
    },
    PUBLIC_KEY,
  );
}

function fmt(n: number) {
  return `Rs ${n.toLocaleString()}`;
}

function buildHTML(p: RentalSummaryParams): string {
  const extraRow = p.extraKm > 0 ? `
    <tr>
      <td style="padding:10px 16px;color:#b45309;background:#fffbeb">
        Extra Km Charge
        <div style="font-size:11px;color:#d97706;margin-top:2px">${p.extraKm.toLocaleString()} km × Rs ${p.extraKmRate}</div>
      </td>
      <td style="padding:10px 16px;text-align:right;font-weight:700;color:#b45309;background:#fffbeb">
        + ${fmt(p.extraCharge)}
      </td>
    </tr>` : `
    <tr>
      <td style="padding:10px 16px;color:#059669" colspan="2">
        ✓ Within included km — no extra charge
      </td>
    </tr>`;

  const advanceRow = p.advancePaid > 0 ? `
    <tr>
      <td style="padding:10px 16px;color:#6b7280">Advance Paid at Booking</td>
      <td style="padding:10px 16px;text-align:right;font-weight:600;color:#059669">− ${fmt(p.advancePaid)}</td>
    </tr>
    <tr style="background:#f0fdf4">
      <td style="padding:10px 16px;font-weight:700;color:#065f46">Balance Collected</td>
      <td style="padding:10px 16px;text-align:right;font-weight:700;color:#065f46">= ${fmt(p.balanceCollected)}</td>
    </tr>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rental Summary</title>
</head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;padding:32px 16px">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;width:100%">

    <!-- Header -->
    <tr>
      <td style="background:#27272A;padding:28px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.5px">Ceylon Rent A Cars</div>
              <div style="font-size:11px;color:#93c5fd;margin-top:3px">Vehicle Rentals Across Sri Lanka</div>
            </td>
            <td align="right">
              <div style="font-size:13px;font-weight:700;color:#ffffff;letter-spacing:1px">RENTAL SUMMARY</div>
              <div style="font-size:11px;color:#93c5fd;margin-top:3px">${p.invoiceNo}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Greeting -->
    <tr>
      <td style="padding:28px 32px 0">
        <p style="margin:0;font-size:15px;color:#18181B">Dear <strong>${p.toName}</strong>,</p>
        <p style="margin:8px 0 0;font-size:13px;color:#71717A;line-height:1.6">
          Thank you for choosing Ceylon Rent A Cars. Here is the complete summary of your recent rental.
        </p>
      </td>
    </tr>

    <!-- Vehicle + Trip -->
    <tr>
      <td style="padding:20px 32px 0">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;border-radius:12px;overflow:hidden">
          <tr>
            <td style="padding:12px 16px 8px;font-size:10px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:.06em" colspan="2">
              Trip Details
            </td>
          </tr>
          <tr>
            <td style="padding:4px 16px 4px;font-size:12px;color:#71717A;width:40%">Vehicle</td>
            <td style="padding:4px 16px 4px;font-size:12px;font-weight:600;color:#18181B">${p.vehicleName} · ${p.vehicleReg}</td>
          </tr>
          <tr>
            <td style="padding:4px 16px 4px;font-size:12px;color:#71717A">Rental Period</td>
            <td style="padding:4px 16px 4px;font-size:12px;font-weight:600;color:#18181B">${p.startDate} → ${p.endDate}</td>
          </tr>
          <tr>
            <td style="padding:4px 16px 12px;font-size:12px;color:#71717A">Duration</td>
            <td style="padding:4px 16px 12px;font-size:12px;font-weight:600;color:#18181B">${p.totalDays} day${p.totalDays !== 1 ? 's' : ''}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Amount Breakdown -->
    <tr>
      <td style="padding:20px 32px 0">
        <p style="margin:0 0 10px;font-size:10px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:.06em">Amount Breakdown</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;font-size:13px">
          <tr style="background:#FAFAFA">
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#71717A;font-weight:600">Description</th>
            <th style="padding:10px 16px;text-align:right;font-size:11px;color:#71717A;font-weight:600">Amount</th>
          </tr>
          <tr>
            <td style="padding:10px 16px;color:#3F3F46;border-top:1px solid #F4F4F5">
              Vehicle Rental
              <div style="font-size:11px;color:#A1A1AA;margin-top:2px">${p.totalDays}d × Rs ${p.dailyRate.toLocaleString()}</div>
            </td>
            <td style="padding:10px 16px;text-align:right;font-weight:600;color:#18181B;border-top:1px solid #F4F4F5">${fmt(p.baseAmount)}</td>
          </tr>
          ${extraRow}
          <tr style="background:#27272A">
            <td style="padding:12px 16px;font-weight:700;color:#ffffff;font-size:14px">Final Total</td>
            <td style="padding:12px 16px;text-align:right;font-weight:900;color:#ffffff;font-size:16px">${fmt(p.finalAmount)}</td>
          </tr>
          ${advanceRow}
        </table>
      </td>
    </tr>

    <!-- Payment Split -->
    <tr>
      <td style="padding:20px 32px 0">
        <p style="margin:0 0 10px;font-size:10px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:.06em">Payment Distribution</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;font-size:13px">
          <tr>
            <td style="padding:10px 16px;color:#3F3F46">
              ${p.ownerName}
              <div style="font-size:11px;color:#A1A1AA">Owner share</div>
            </td>
            <td style="padding:10px 16px;text-align:right;font-weight:700;color:#059669">${fmt(p.ownerPayout)}</td>
          </tr>
          ${p.referralLabel && p.referralFee > 0 ? `
          <tr style="border-top:1px solid #F4F4F5">
            <td style="padding:10px 16px;color:#3F3F46">
              ${p.referralLabel}
              <div style="font-size:11px;color:#A1A1AA">Referral fee</div>
            </td>
            <td style="padding:10px 16px;text-align:right;font-weight:700;color:#d97706">${fmt(p.referralFee)}</td>
          </tr>` : ''}
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding:28px 32px;text-align:center">
        <p style="margin:0;font-size:12px;color:#A1A1AA">
          Thank you for choosing <strong>Ceylon Rent A Cars</strong> · ceylonrentacars.lk
        </p>
        <p style="margin:6px 0 0;font-size:11px;color:#D4D4D8">
          This is an automated rental summary. Please contact us if you have any questions.
        </p>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
}
