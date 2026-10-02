import { Booking, Vehicle, Driver } from '../types';
import { supabase, supabaseEnabled } from './supabase';
import { sendSms, smsTemplates } from './sms';
import { sendBookingConfirmationEmail } from '../utils/email';

// ── Shared Wikipedia image lookup (mirrors VehicleImage.tsx) ─────────────────

const WIKI_TITLES: Record<string, string> = {
  'toyota prius':           'Toyota Prius',
  'toyota axio':            'Toyota Corolla Axio',
  'toyota aqua':            'Toyota Aqua',
  'toyota hiace':           'Toyota HiAce',
  'toyota premio':          'Toyota Premio',
  'toyota vitz':            'Toyota Vitz',
  'toyota rush':            'Toyota Rush',
  'toyota rav4':            'Toyota RAV4',
  'suzuki wagonr':          'Suzuki Wagon R',
  'suzuki alto':            'Suzuki Alto',
  'suzuki swift':           'Suzuki Swift',
  'honda fit':              'Honda Fit',
  'honda jazz':             'Honda Jazz',
  'honda vezel':            'Honda HR-V',
  'honda grace':            'Honda Grace',
  'honda crv':              'Honda CR-V',
  'nissan dayz':            'Nissan Dayz',
  'nissan note':            'Nissan Note',
  'nissan x-trail':         'Nissan X-Trail',
  'mitsubishi lancer':      'Mitsubishi Lancer',
  'mitsubishi outlander':   'Mitsubishi Outlander',
  'mazda demio':            'Mazda Demio',
};

async function resolveVehicleImage(vehicle: Vehicle): Promise<string | null> {
  if (vehicle.imageUrl) return vehicle.imageUrl;
  const key   = `${vehicle.brand} ${vehicle.model}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const title = WIKI_TITLES[key] ?? `${vehicle.brand} ${vehicle.model}`;
  try {
    const data = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    ).then((r) => r.json());
    const url: string | null = data.thumbnail?.source ?? null;
    return url ? url.replace(/\/\d+px-/, '/480px-') : null;
  } catch {
    return null;
  }
}

// ── Receipt HTML generator ────────────────────────────────────────────────────

function fmt(n: number | undefined) {
  return `Rs ${(n ?? 0).toLocaleString()}`;
}

function fmtDate(d: string) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-LK', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return d;
  }
}

function depositLabel(booking: Booking): string {
  if (!booking.depositType) return '';
  if (booking.depositType === 'cash') return `Cash — Rs ${(booking.depositAmount ?? 0).toLocaleString()}`;
  if (booking.depositType === 'vehicle') return `Vehicle — ${booking.depositAssetDescription ?? ''}`;
  return `Other — ${booking.depositAssetDescription ?? ''}`;
}

function generateHtml(
  booking: Booking,
  vehicle: Vehicle | undefined,
  driver: Driver | undefined,
  imgUrl: string | null,
): string {
  const ref   = `MRAC-${booking.id.slice(0, 8).toUpperCase()}`;
  const today = new Date().toLocaleDateString('en-LK', { year: 'numeric', month: 'long', day: 'numeric' });
  const balance = Math.max(0, (booking.totalAmount ?? 0) - (booking.paidAmount ?? 0));

  const vehicleImgHtml = imgUrl
    ? `<img src="${imgUrl}" alt="${vehicle?.brand ?? ''} ${vehicle?.model ?? ''}" style="width:220px;height:140px;object-fit:cover;border-radius:12px;border:1px solid #F4F4F5" />`
    : `<div style="width:220px;height:140px;border-radius:12px;background:linear-gradient(135deg,#F4F4F5,#ECECEF);display:flex;align-items:center;justify-content:center;border:1px solid #F4F4F5">
         <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
           <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h14l4 4v4a2 2 0 0 1-2 2h-2"/>
           <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
         </svg>
       </div>`;

  const vehicleSpecs = [
    vehicle?.year         && `${vehicle.year}`,
    vehicle?.color        && vehicle.color,
    vehicle?.fuelType     && vehicle.fuelType,
    vehicle?.transmission && vehicle.transmission,
    vehicle?.seats        && `${vehicle.seats} seats`,
  ].filter(Boolean).join(' · ');

  const depositRow = booking.depositType
    ? `<tr><td style="padding:10px 0;color:#52525B;border-top:1px solid #F4F4F5">Security Deposit</td><td style="padding:10px 0;text-align:right;color:#92400E;font-weight:600;border-top:1px solid #F4F4F5">${depositLabel(booking)}</td></tr>`
    : '';

  const driverRow = driver
    ? `<tr style="background:#FAFAFA"><td colspan="2" style="padding:10px 14px;font-size:12px;color:#111114"><strong>Assigned Driver:</strong> ${driver.name} · ${driver.phone ?? '—'}</td></tr>`
    : '';

  const notesRow = booking.notes
    ? `<tr><td colspan="2" style="padding:10px 0;font-size:12px;color:#52525B;border-top:1px solid #F4F4F5"><strong>Notes:</strong> ${booking.notes}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Booking Confirmation — ${ref}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#18181B;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:794px;margin:0 auto;padding:0}
  @media print{@page{size:A4 portrait;margin:10mm 15mm}body{margin:0}.page{width:100%;max-width:100%}}
</style>
</head>
<body>
<div class="page">

  <!-- ── Header ── -->
  <div style="background:linear-gradient(135deg,#111114 0%,#E11D2A 100%);color:#fff;padding:28px 40px 22px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:26px;font-weight:900;letter-spacing:3px">MRAC</div>
        <div style="font-size:11px;opacity:0.6;letter-spacing:2px;margin-top:3px">CAR RENTAL MANAGEMENT</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:16px;font-weight:700;opacity:0.9">Booking Confirmation</div>
        <div style="font-size:11px;opacity:0.6;margin-top:4px">${today}</div>
      </div>
    </div>
    <div style="margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.2);display:flex;gap:36px">
      <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;opacity:0.6">Reference</div><div style="font-size:14px;font-weight:700;margin-top:2px">${ref}</div></div>
      <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;opacity:0.6">Status</div><div style="font-size:14px;font-weight:700;margin-top:2px">✓ Confirmed</div></div>
      <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;opacity:0.6">Rental Period</div><div style="font-size:14px;font-weight:700;margin-top:2px">${booking.totalDays} day${booking.totalDays !== 1 ? 's' : ''}</div></div>
    </div>
  </div>

  <!-- ── Customer + Booking info ── -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid #F4F4F5">
    <div style="padding:22px 28px;border-right:1px solid #F4F4F5">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#A1A1AA;margin-bottom:12px">Customer Details</div>
      <table style="font-size:13px;width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#A1A1AA;width:80px">Name</td><td style="padding:4px 0;font-weight:600">${booking.customerName || '—'}</td></tr>
        <tr><td style="padding:4px 0;color:#A1A1AA">Phone</td><td style="padding:4px 0;font-weight:600">${booking.customerPhone || '—'}</td></tr>
        ${booking.customerEmail ? `<tr><td style="padding:4px 0;color:#A1A1AA">Email</td><td style="padding:4px 0;font-weight:600">${booking.customerEmail}</td></tr>` : ''}
        ${booking.customerNIC   ? `<tr><td style="padding:4px 0;color:#A1A1AA">NIC</td><td style="padding:4px 0;font-weight:600">${booking.customerNIC}</td></tr>` : ''}
      </table>
    </div>
    <div style="padding:22px 28px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#A1A1AA;margin-bottom:12px">Booking Details</div>
      <table style="font-size:13px;width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#A1A1AA;width:80px">Pick-up</td><td style="padding:4px 0;font-weight:600">${fmtDate(booking.startDate)}${booking.startTime ? ' · ' + booking.startTime : ''}</td></tr>
        <tr><td style="padding:4px 0;color:#A1A1AA">Return</td><td style="padding:4px 0;font-weight:600">${fmtDate(booking.endDate)}${booking.endTime ? ' · ' + booking.endTime : ''}</td></tr>
        ${booking.pickupLocation ? `<tr><td style="padding:4px 0;color:#A1A1AA">From</td><td style="padding:4px 0;font-weight:600">${booking.pickupLocation}</td></tr>` : ''}
        ${booking.dropLocation   ? `<tr><td style="padding:4px 0;color:#A1A1AA">To</td><td style="padding:4px 0;font-weight:600">${booking.dropLocation}</td></tr>` : ''}
      </table>
    </div>
  </div>

  <!-- ── Vehicle ── -->
  <div style="padding:22px 28px;border-bottom:1px solid #F4F4F5">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#A1A1AA;margin-bottom:14px">Vehicle</div>
    <div style="display:flex;align-items:flex-start;gap:22px">
      ${vehicleImgHtml}
      <div style="flex:1">
        <div style="font-size:20px;font-weight:800;color:#111114;margin-bottom:4px">${vehicle ? `${vehicle.brand} ${vehicle.model}` : '—'}</div>
        ${vehicle?.vehicleNumber ? `<div style="font-size:13px;font-weight:600;color:#E11D2A;margin-bottom:8px">${vehicle.vehicleNumber}</div>` : ''}
        ${vehicleSpecs ? `<div style="font-size:12px;color:#A1A1AA;margin-bottom:14px">${vehicleSpecs}</div>` : ''}
        <div style="display:inline-flex;align-items:center;gap:6px;background:#F4F4F5;border-radius:8px;padding:6px 12px">
          <span style="font-size:11px;color:#E11D2A;font-weight:600">Daily Rate</span>
          <span style="font-size:13px;font-weight:800;color:#111114">${fmt(vehicle?.dailyRent)} / day</span>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Payment summary ── -->
  <div style="padding:22px 28px;border-bottom:1px solid #F4F4F5">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#A1A1AA;margin-bottom:14px">Payment Summary</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr>
        <td style="padding:10px 0;color:#52525B">Base Rental &nbsp;<span style="color:#A1A1AA">(${fmt(vehicle?.dailyRent)} × ${booking.totalDays} day${booking.totalDays !== 1 ? 's' : ''})</span></td>
        <td style="padding:10px 0;text-align:right;font-weight:600;color:#111114">${fmt(booking.totalAmount)}</td>
      </tr>
      ${booking.discount ? `<tr><td style="padding:10px 0;color:#059669;border-top:1px solid #F4F4F5">Discount</td><td style="padding:10px 0;text-align:right;color:#059669;font-weight:600;border-top:1px solid #F4F4F5">− ${fmt(booking.discount)}</td></tr>` : ''}
      <tr>
        <td style="padding:10px 0;color:#52525B;border-top:1px solid #F4F4F5">Paid Amount</td>
        <td style="padding:10px 0;text-align:right;color:#059669;font-weight:700;border-top:1px solid #F4F4F5">${fmt(booking.paidAmount)}</td>
      </tr>
      ${depositRow}
      ${notesRow}
    </table>

    <!-- Total + balance -->
    <div style="display:flex;gap:12px;margin-top:16px">
      <div style="flex:1;background:#111114;border-radius:12px;padding:14px 18px;color:#fff">
        <div style="font-size:11px;opacity:0.65;margin-bottom:4px">Total Amount</div>
        <div style="font-size:20px;font-weight:900">${fmt(booking.totalAmount)}</div>
      </div>
      <div style="flex:1;background:${balance > 0 ? '#FFF7ED' : '#F0FDF4'};border:2px solid ${balance > 0 ? '#FED7AA' : '#BBF7D0'};border-radius:12px;padding:14px 18px">
        <div style="font-size:11px;color:${balance > 0 ? '#92400E' : '#065F46'};margin-bottom:4px">${balance > 0 ? 'Balance Due' : 'Fully Paid'}</div>
        <div style="font-size:20px;font-weight:900;color:${balance > 0 ? '#D97706' : '#059669'}">${balance > 0 ? fmt(balance) : '✓ Cleared'}</div>
      </div>
    </div>
  </div>

  <!-- ── Driver ── -->
  ${driver ? `
  <div style="padding:14px 28px;border-bottom:1px solid #F4F4F5;background:#FAFAFA;display:flex;align-items:center;gap:10px">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E11D2A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
    <span style="font-size:13px;color:#111114"><strong>Assigned Driver:</strong> ${driver.name}&nbsp;&nbsp;·&nbsp;&nbsp;${driver.phone ?? '—'}</span>
  </div>` : ''}

  <!-- ── Footer ── -->
  <div style="padding:20px 28px;background:#FAFAFA;border-top:1px solid #F4F4F5">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
      <div>
        <div style="font-size:11px;font-weight:700;color:#111114;margin-bottom:4px">Thank you for choosing MRAC Car Rental!</div>
        <div style="font-size:11px;color:#A1A1AA">Please keep this confirmation for your records. Present it at the time of vehicle pick-up.</div>
      </div>
      <div style="text-align:right;font-size:11px;color:#A1A1AA">
        <div>MRAC Car Rental Management</div>
        <div>Ref: ${ref}</div>
      </div>
    </div>
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;padding:10px 14px;font-size:11px;color:#92400E">
      <strong>Note:</strong> This is a booking confirmation and not a final invoice. The final bill will be calculated based on the actual usage, kilometres driven, and any additional charges at the time of vehicle return.
    </div>
  </div>

</div>
<script>window.onload = () => { window.focus(); window.print(); }</script>
</body>
</html>`;
}

// ── Receipt → PDF ─────────────────────────────────────────────────────────────

async function captureReceiptAsPdf(html: string): Promise<Blob | null> {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const parser = new DOMParser();
  const doc = parser.parseFromString(clean, 'text/html');

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;z-index:-1';

  const styleEl = doc.querySelector('style');
  if (styleEl) {
    const s = document.createElement('style');
    s.textContent = styleEl.textContent ?? '';
    host.appendChild(s);
  }

  const page = doc.querySelector('.page');
  if (page) host.appendChild(page.cloneNode(true));
  else host.innerHTML += doc.body.innerHTML;

  document.body.appendChild(host);
  await new Promise((r) => setTimeout(r, 900));

  try {
    const [{ default: h2c }, { default: jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);

    const target = (host.querySelector('.page') as HTMLElement) ?? host;
    const canvas = await h2c(target, {
      scale:           2,
      useCORS:         true,
      allowTaint:      true,
      backgroundColor: '#ffffff',
      logging:         false,
      width:           794,
      windowWidth:     794,
    });

    const imgData  = canvas.toDataURL('image/jpeg', 0.95);
    // A4 width = 210 mm; compute height proportionally
    const pdfW     = 210;
    const pdfH     = (canvas.height * pdfW) / canvas.width;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // If receipt overflows one A4 page, tile across multiple pages
    const pageH = 297;
    let remaining = pdfH;
    let yOffset   = 0;
    while (remaining > 0) {
      pdf.addImage(imgData, 'JPEG', 0, -yOffset, pdfW, pdfH);
      remaining -= pageH;
      yOffset   += pageH;
      if (remaining > 0) pdf.addPage();
    }

    return pdf.output('blob');
  } catch (e) {
    console.error('[receipt] PDF generation failed:', e);
    return null;
  } finally {
    document.body.removeChild(host);
  }
}

// ── Supabase Storage upload (PDF) ────────────────────────────────────────────
// Requires a public bucket named "receipts" in Supabase Storage.
// Dashboard → Storage → New bucket → name: receipts → Public: ON → Create.

async function uploadReceiptPdf(filename: string, blob: Blob): Promise<string | null> {
  if (!supabaseEnabled) return null;
  const path = filename;
  const { error } = await supabase.storage
    .from('receipts')
    .upload(path, blob, { upsert: true, cacheControl: '3600', contentType: 'application/pdf' });
  if (error) {
    console.warn('[receipt] PDF upload failed:', error.message);
    return null;
  }
  const { data } = supabase.storage.from('receipts').getPublicUrl(path);
  return data?.publicUrl ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Called at booking confirmation time: generates the PDF, uploads it, sends SMS + email. */
export async function sendBookingReceipt(
  booking: Booking,
  vehicle: Vehicle | undefined,
  driver?: Driver,
) {
  const imgUrl  = vehicle ? await resolveVehicleImage(vehicle) : null;
  const html    = generateHtml(booking, vehicle, driver, imgUrl);
  const ref     = `MRAC-${booking.id.slice(0, 8).toUpperCase()}`;
  const balance = Math.max(0, (booking.totalAmount ?? 0) - (booking.paidAmount ?? 0));

  // 1. Render receipt as a PDF and upload to Supabase Storage
  const pdfBlob    = await captureReceiptAsPdf(html);
  const receiptUrl = pdfBlob ? await uploadReceiptPdf(`${ref}.pdf`, pdfBlob) : null;

  // 2. Send email if the customer has an email address
  if (booking.customerEmail) {
    sendBookingConfirmationEmail({
      toEmail:     booking.customerEmail,
      toName:      booking.customerName,
      ref,
      vehicleName: vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Vehicle',
      vehicleReg:  vehicle?.vehicleNumber,
      startDate:   fmtDate(booking.startDate),
      endDate:     fmtDate(booking.endDate),
      totalDays:   booking.totalDays,
      totalAmount: booking.totalAmount ?? 0,
      paidAmount:  booking.paidAmount  ?? 0,
      balance,
      receiptUrl,
    }).catch((e) => console.error('[receipt] email failed:', e));
  }

  // 3. Send SMS with booking summary + receipt link
  const vehicleLabel = vehicle ? `${vehicle.brand} ${vehicle.model}` : 'your vehicle';
  const baseMsg = smsTemplates.bookingConfirmation(
    booking.customerName,
    vehicleLabel,
    booking.startDate,
    booking.endDate,
    booking.totalAmount ?? 0,
  );
  const smsBody = receiptUrl
    ? `${baseMsg}\n\nView your booking confirmation receipt:\n${receiptUrl}`
    : baseMsg;
  sendSms(booking.customerPhone, smsBody, {
    category:      'bookingConfirmation',
    role:          'customer',
    relatedId:     booking.id,
    transactional: true,
  }).catch((e) => console.error('[receipt] sms failed:', e));
}

/** Called by the Print button: opens the A4 print preview window only. No SMS/email. */
export async function printBookingConfirmation(
  booking: Booking,
  vehicle: Vehicle | undefined,
  driver?: Driver,
) {
  const imgUrl = vehicle ? await resolveVehicleImage(vehicle) : null;
  const html   = generateHtml(booking, vehicle, driver, imgUrl);
  const w = window.open('', '_blank', 'width=794,height=1123');
  if (w) { w.document.write(html); w.document.close(); }
}
