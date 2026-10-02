import { Booking, Vehicle } from '../types';

/** Build a polite credit-reminder WhatsApp message for a customer. */
export function buildCreditReminderMsg(
  customerName: string,
  totalOutstanding: number,
  bookingCount: number,
): string {
  const lines = (parts: Array<string | false | null | undefined>): string =>
    parts.filter(Boolean).join('\n');

  return lines([
    `Hello ${customerName},`,
    ``,
    `This is a gentle reminder from *${BRAND}* regarding your outstanding balance.`,
    ``,
    `*Outstanding Amount:* ${rs(totalOutstanding)}`,
    `*Booking(s):* ${bookingCount} record${bookingCount !== 1 ? 's' : ''}`,
    ``,
    `We kindly request you to settle your account at your earliest convenience.`,
    `If you have any questions or need to discuss a payment arrangement, please don't hesitate to reach out.`,
    ``,
    `Thank you for your understanding. 🙏`,
    `— ${BRAND}`,
  ]);
}

const BRAND = 'MRAC Rent A Car';
const rs = (n: number) => `Rs ${n.toLocaleString()}`;

/** Normalise a phone number to the international format expected by wa.me (no +). */
export function toWhatsAppPhone(raw: string): string {
  const d = raw.replace(/[^0-9]/g, '');
  if (d.startsWith('0') && d.length === 10) return '94' + d.slice(1);
  return d;
}

/** Open WhatsApp with a pre-filled message in a new tab. */
export function openWhatsApp(phone: string, message: string): void {
  window.open(`https://wa.me/${toWhatsAppPhone(phone)}?text=${encodeURIComponent(message)}`, '_blank');
}

/**
 * Build a WhatsApp message for a booking that matches its current status.
 * Returns a multi-line string ready for `encodeURIComponent`.
 */
export function buildBookingWhatsAppMsg(
  booking: Booking,
  vehicle: Vehicle | undefined,
): string {
  const name = booking.customerName;
  const vLabel = vehicle
    ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})`
    : 'your vehicle';
  const balance = booking.totalAmount - (booking.discount ?? 0) - booking.paidAmount;

  const lines = (parts: Array<string | false | null | undefined>): string =>
    parts.filter(Boolean).join('\n');

  switch (booking.status) {
    case 'Confirmed':
      return lines([
        `Hello ${name},`,
        ``,
        `✅ Your booking has been *confirmed* with ${BRAND}.`,
        ``,
        `*Vehicle:* ${vLabel}`,
        `*Period:* ${booking.startDate} → ${booking.endDate} (${booking.totalDays} days)`,
        `*Total:* ${rs(booking.totalAmount)}`,
        `*Paid:* ${rs(booking.paidAmount)}`,
        balance > 0 && `*Balance due:* ${rs(balance)}`,
        booking.pickupLocation && `*Pickup:* ${booking.pickupLocation}`,
        booking.dropLocation   && `*Drop-off:* ${booking.dropLocation}`,
        ``,
        `Please be ready at the pickup location on your booking date. Contact us anytime for assistance.`,
        ``,
        `Thank you for choosing ${BRAND}! 🚗`,
      ]);

    case 'Ongoing':
      return lines([
        `Hello ${name},`,
        ``,
        `🚗 Your rental with ${BRAND} is currently *active*.`,
        ``,
        `*Vehicle:* ${vLabel}`,
        `*Trip started:* ${booking.startDate}`,
        `*Return due:* ${booking.endDate}`,
        balance > 0 && `*Balance due:* ${rs(balance)}`,
        booking.dropLocation && `*Drop-off point:* ${booking.dropLocation}`,
        ``,
        `Please ensure the vehicle is returned by the due date to avoid additional charges. Contact us anytime for assistance.`,
        ``,
        `Drive safe! — ${BRAND}`,
      ]);

    case 'Completed':
      return lines([
        `Hello ${name},`,
        ``,
        `🎉 Your rental with ${BRAND} has been *successfully completed*.`,
        ``,
        `*Vehicle:* ${vLabel}`,
        `*Period:* ${booking.startDate} → ${booking.endDate} (${booking.totalDays} days)`,
        `*Total:* ${rs(booking.totalAmount)}`,
        balance <= 0
          ? `*Payment:* Fully settled ✓`
          : `*Balance settled:* ${rs(booking.paidAmount)}`,
        booking.depositAmount && booking.depositReturned
          ? `*Deposit returned:* ${rs(booking.depositReturned)}`
          : undefined,
        ``,
        `We hope you enjoyed your experience. Thank you for choosing ${BRAND} — we look forward to serving you again! 🙏`,
      ]);

    case 'Cancelled':
      return lines([
        `Hello ${name},`,
        ``,
        `❌ Your booking with ${BRAND} has been *cancelled*.`,
        ``,
        `*Vehicle:* ${vLabel}`,
        `*Period:* ${booking.startDate} → ${booking.endDate}`,
        ``,
        `If you have any questions or would like to make a new booking, please do not hesitate to contact us.`,
        ``,
        `Thank you — ${BRAND}`,
      ]);
  }
}
