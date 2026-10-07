/* =====================================================================
   Ready-made WhatsApp templates for Ceylon Rent A Cars, in the order of a
   customer's journey (inquiry → booking → payment → pickup → rental →
   return → after return), plus documents, support and promotions.

   One house style for every message:
     Dear {{name}},
     <one or two short sentences>
     *Label:* value          ← key details, one per line, bold labels
     <what happens next / what to do>
     Kind regards,
     Ceylon Rent A Cars
   WhatsApp shows *text* as bold. Line breaks are allowed in a template body.

   Every body follows Meta's rules (checked again in WhatsAppTemplates.tsx):
   - never starts or ends with a variable, no two variables side by side
   - enough words per variable
   - Utility = about this customer's booking (cheap, approved fast);
     Marketing = offers and promotions only.
   Green variables (name, vehicle, dates, reference) fill in from the inquiry;
   the others are typed by staff when sending.
   ===================================================================== */

export interface Starter {
  title: string;
  name: string;            // Meta template name — keep stable once submitted
  when: string;            // when staff should send it
  body: string;
  category?: 'UTILITY' | 'MARKETING';   // default UTILITY
}

export interface StarterGroup { title: string; items: Starter[] }

const SIGN = 'Kind regards,\nCeylon Rent A Cars';
const HELP = 'For help at any time, reply to this message or call us on +94 77 972 6761.';

/** Builds a message in the house style: paragraphs separated by a blank line, then the sign-off */
const msg = (...paragraphs: string[]) => ['Dear {{name}},', ...paragraphs, SIGN].join('\n\n');
/** Key details block: one "*Label:* value" per line */
const details = (...rows: [string, string][]) => rows.map(([k, v]) => `*${k}:* ${v}`).join('\n');

export const STARTER_GROUPS: StarterGroup[] = [
  {
    title: 'First contact',
    items: [
      { title: 'Inquiry received', name: 'inquiry_received', when: 'Right after a customer sends an inquiry',
        body: msg(
          'Thank you for contacting Ceylon Rent A Cars. We have received your inquiry.',
          details(['Reference', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Dates', '{{dates}}']),
          'Our team is checking availability and will get back to you here shortly.') },
      { title: 'Welcome message', name: 'welcome_message', when: 'When you start talking with a new customer',
        body: msg(
          'Welcome to Ceylon Rent A Cars, and thank you for choosing us for your trip.',
          'This is our official WhatsApp number for your request *{{reference}}*. You can send us your questions, documents and pickup details here at any time.',
          'We look forward to helping you.') },
    ],
  },
  {
    title: 'Booking',
    items: [
      { title: 'Booking confirmed', name: 'booking_confirmed', when: 'Booking successfully created',
        body: msg(
          'Your booking with Ceylon Rent A Cars is confirmed.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Dates', '{{dates}}']),
          'We will send your pickup details closer to the date. Please reply to this message if you have any questions.') },
      { title: 'Booking pending', name: 'booking_pending', when: 'Waiting for admin / owner approval',
        body: msg(
          'Thank you for your booking request. It has been received and is now waiting for approval.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Dates', '{{dates}}']),
          'We will confirm your booking here as soon as possible.') },
      { title: 'Booking approved', name: 'booking_approved', when: 'Admin approves the rental',
        body: msg(
          'Good news! Your booking has been approved.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Dates', '{{dates}}']),
          'We will send your pickup details closer to the date.') },
      { title: 'Booking rejected', name: 'booking_rejected', when: 'Vehicle / request cannot be accepted',
        body: msg(
          'We are sorry, but we are unable to accept your booking request.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Reason', '{{reason}}']),
          'Please reply to this message and we will be happy to help you find another option.') },
      { title: 'Booking cancelled', name: 'booking_cancelled', when: 'Booking cancelled by customer or admin',
        body: msg(
          'This message confirms that your booking has been cancelled.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Dates', '{{dates}}']),
          'If this was not expected, or you would like to book again, please reply to this message.') },
      { title: 'Booking modified', name: 'booking_modified', when: 'Dates, vehicle, location etc. changed',
        body: msg(
          'Your booking has been updated.',
          details(['Booking', '{{reference}}'], ['Changes', '{{changes}}']),
          'Please check the new details and reply to this message if anything is not correct.') },
    ],
  },
  {
    title: 'Vehicle availability',
    items: [
      { title: 'Vehicle unavailable', name: 'vehicle_unavailable', when: 'Selected vehicle becomes unavailable',
        body: msg(
          'We are sorry to inform you that the vehicle you selected is no longer available for your dates.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Dates', '{{dates}}']),
          'Our team will send you suitable alternatives shortly.') },
      { title: 'Alternative vehicles', name: 'vehicle_alternatives', when: 'Suggest replacement vehicles',
        body: msg(
          'We are sorry, but the vehicle you requested is not available for your dates.',
          details(['Request', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Dates', '{{dates}}']),
          'We have selected some alternative vehicles for you. You can view them and choose one here:\n{{link}}',
          'If you have any questions, simply reply to this message.') },
      { title: 'Vehicle changed', name: 'vehicle_changed', when: 'Admin changes the assigned vehicle',
        body: msg(
          'The vehicle for your booking has been changed.',
          details(['Booking', '{{reference}}'], ['New vehicle', '{{vehicle}}'], ['Dates', '{{dates}}']),
          'Please reply to this message if you have any questions about this change.') },
    ],
  },
  {
    title: 'Payment',
    items: [
      { title: 'Payment received', name: 'payment_received', when: 'Full or partial payment received',
        body: msg(
          'Thank you. We have received your payment.',
          details(['Booking', '{{reference}}'], ['Amount received', '{{amount}}']),
          'Please keep this message for your records.') },
      { title: 'Payment pending', name: 'payment_pending', when: 'Customer still has an outstanding amount',
        body: msg(
          'A payment is still pending for your booking.',
          details(['Booking', '{{reference}}'], ['Amount pending', '{{amount}}']),
          'Please reply to this message if you would like our payment details.') },
      { title: 'Payment reminder', name: 'payment_reminder', when: 'Remind the customer before pickup',
        body: msg(
          'This is a friendly reminder about the payment for your upcoming rental.',
          details(['Booking', '{{reference}}'], ['Amount due', '{{amount}}'], ['Pickup', '{{pickup_time}}']),
          'Please complete the payment before your pickup. Reply to this message if you need any help.') },
      { title: 'Balance due', name: 'balance_due', when: 'Remaining balance notification',
        body: msg(
          'Here is the remaining balance for your booking.',
          details(['Booking', '{{reference}}'], ['Balance due', '{{amount}}'], ['Due by', '{{due_date}}']),
          'Please reply to this message if you would like our payment details.') },
      { title: 'Security deposit received', name: 'deposit_received', when: 'Deposit confirmation',
        body: msg(
          'Thank you. We have received your security deposit.',
          details(['Booking', '{{reference}}'], ['Deposit', '{{amount}}']),
          'Your deposit will be refunded after the vehicle has been returned and checked.') },
      { title: 'Security deposit refunded', name: 'deposit_refunded', when: 'Deposit refunded after the rental',
        body: msg(
          'Your security deposit has been refunded.',
          details(['Booking', '{{reference}}'], ['Amount refunded', '{{amount}}']),
          'Thank you for renting with Ceylon Rent A Cars.') },
      { title: 'Refund processed', name: 'refund_processed', when: 'Booking or payment refund processed',
        body: msg(
          'Your refund has been processed.',
          details(['Booking', '{{reference}}'], ['Refund amount', '{{amount}}']),
          'Depending on your bank, it may take a few working days to appear in your account.') },
    ],
  },
  {
    title: 'Pickup',
    items: [
      { title: 'Pickup reminder', name: 'pickup_reminder', when: '1 day or a few hours before pickup',
        body: msg(
          'This is a reminder about your upcoming vehicle pickup.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Pickup time', '{{pickup_time}}'], ['Pickup location', '{{pickup_location}}']),
          'Please bring your driving licence and ID. Reply to this message if anything changes.') },
      { title: 'Pickup location', name: 'pickup_location', when: 'Send location, map and contact details',
        body: msg(
          'Here are the pickup details for your booking.',
          details(['Booking', '{{reference}}'], ['Location', '{{pickup_location}}'], ['Map', '{{map_link}}']),
          'When you arrive, please message us here or call +94 77 972 6761.') },
      { title: 'Vehicle ready', name: 'vehicle_ready', when: 'Vehicle is prepared and ready',
        body: msg(
          'Your vehicle has been cleaned, checked and is ready for pickup.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}']),
          'We look forward to seeing you.') },
      { title: 'Pickup delayed', name: 'pickup_delayed', when: 'Vehicle / pickup is delayed',
        body: msg(
          'We are sorry, but your vehicle pickup has been delayed.',
          details(['Booking', '{{reference}}'], ['New pickup time', '{{pickup_time}}']),
          'Thank you for your patience. Please reply to this message if this time does not suit you.') },
      { title: 'Documents required', name: 'documents_required', when: 'NIC / passport / licence reminder',
        body: msg(
          'Please remember to bring the following documents when you collect your vehicle.',
          details(['Booking', '{{reference}}'], ['Documents', '{{documents}}']),
          'To save time at pickup, you can also send clear photos of them here.') },
    ],
  },
  {
    title: 'Rental period',
    items: [
      { title: 'Rental started', name: 'rental_started', when: 'Customer has collected the vehicle',
        body: msg(
          'Your rental has started. We wish you a safe and pleasant trip.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}']),
          HELP) },
      { title: 'Rental details', name: 'rental_details', when: 'Rental period, vehicle and contact details',
        body: msg(
          'Here are the details of your rental.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Rental period', '{{dates}}']),
          HELP) },
      { title: 'Extension available', name: 'rental_extension_offer', when: 'Ask whether the customer wants an extension',
        body: msg(
          'Your rental ends soon, and the vehicle is available for a few more days if you would like to extend.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Current return', '{{return_time}}']),
          'Simply reply to this message if you would like to extend your rental.') },
      { title: 'Extension approved', name: 'extension_approved', when: 'New return date confirmed',
        body: msg(
          'Your rental extension has been approved.',
          details(['Booking', '{{reference}}'], ['New return time', '{{return_time}}']),
          'Thank you for continuing your trip with us.') },
      { title: 'Extension rejected', name: 'extension_rejected', when: 'Extension cannot be accepted',
        body: msg(
          'We are sorry, but we are unable to extend your rental, as the vehicle is reserved after your booking.',
          details(['Booking', '{{reference}}'], ['Return time', '{{return_time}}']),
          'Please return the vehicle at the time above. Reply to this message if you need any help.') },
      { title: 'Rental expiring soon', name: 'rental_expiring', when: 'Rental ends soon',
        body: msg(
          'This is a reminder that your rental ends soon.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Return time', '{{return_time}}']),
          'Reply to this message if you need any help with the return.') },
    ],
  },
  {
    title: 'Return',
    items: [
      { title: 'Return reminder', name: 'return_reminder', when: 'Upcoming return date / time',
        body: msg(
          'This is a reminder about the return of your rental vehicle.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Return time', '{{return_time}}']),
          'If you would like to extend your rental, please reply to this message.') },
      { title: 'Return location', name: 'return_location', when: 'Where to return the vehicle',
        body: msg(
          'Here are the return details for your vehicle.',
          details(['Booking', '{{reference}}'], ['Return location', '{{return_location}}'], ['Map', '{{map_link}}']),
          'When you arrive, please message us here or call +94 77 972 6761.') },
      { title: 'Return overdue', name: 'return_overdue', when: 'Vehicle has not been returned',
        body: msg(
          'Our records show that your rental vehicle has not been returned yet.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}'], ['Was due', '{{return_time}}']),
          'Please contact us as soon as possible on +94 77 972 6761. Late return charges may apply.') },
      { title: 'Vehicle returned', name: 'vehicle_returned', when: 'Confirm successful return',
        body: msg(
          'We confirm that your rental vehicle has been returned. Thank you.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}']),
          'We will let you know once the final inspection is complete.') },
      { title: 'Late fee notice', name: 'late_fee_notice', when: 'Notify about a late-return charge',
        body: msg(
          'Your rental vehicle was returned after the agreed time, so a late return fee applies.',
          details(['Booking', '{{reference}}'], ['Late fee', '{{amount}}']),
          'Please reply to this message if you have any questions about this charge.') },
    ],
  },
  {
    title: 'After return',
    items: [
      { title: 'Inspection completed', name: 'inspection_completed', when: 'Vehicle inspection finished',
        body: msg(
          'The inspection of your returned vehicle is complete.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}']),
          'We will contact you here if anything needs your attention.') },
      { title: 'Additional charge', name: 'additional_charge', when: 'Damage / fuel / late etc. charge',
        body: msg(
          'An additional charge applies to your rental.',
          details(['Booking', '{{reference}}'], ['Amount', '{{amount}}'], ['Reason', '{{reason}}']),
          'Please reply to this message if you would like to discuss this charge.') },
      { title: 'No additional charges', name: 'no_additional_charges', when: 'Rental closed with nothing extra to pay',
        body: msg(
          'Your rental is now closed with no additional charges.',
          details(['Booking', '{{reference}}']),
          'Thank you for taking good care of the vehicle.') },
      { title: 'Feedback request', name: 'feedback_request', when: 'Ask the customer for a review / rating',
        body: msg(
          'Thank you for renting the {{vehicle}} with Ceylon Rent A Cars. We hope you enjoyed your trip.',
          'We would really appreciate your feedback on booking *{{reference}}*. It only takes a minute:\n{{link}}',
          'Thank you for helping us improve.') },
      { title: 'Thank you', name: 'thank_you', when: 'General post-rental thank-you',
        body: msg(
          'Thank you for choosing Ceylon Rent A Cars for your trip (booking *{{reference}}*).',
          'We hope you had a wonderful time, and we would be happy to help you again on your next visit.') },
    ],
  },
  {
    title: 'Documents & verification',
    items: [
      { title: 'Verification required', name: 'verification_required', when: 'Need additional verification',
        body: msg(
          'We need a little more information to verify your booking.',
          details(['Booking', '{{reference}}'], ['Required', '{{documents}}']),
          'Please send it here so we can confirm your rental.') },
      { title: 'Driving licence required', name: 'licence_required', when: 'Missing or expired licence',
        body: msg(
          'We still need a valid driving licence for your booking *{{reference}}*.',
          'Please send a clear photo of the front and back of your licence here. Visitors to Sri Lanka also need an International Driving Permit.') },
      { title: 'ID required', name: 'id_required', when: 'NIC / passport missing',
        body: msg(
          'We still need a copy of your NIC or passport for your booking *{{reference}}*.',
          'Please send a clear photo of it here.') },
      { title: 'Documents approved', name: 'documents_approved', when: 'Verification completed',
        body: msg(
          'Your documents have been checked and approved.',
          details(['Booking', '{{reference}}']),
          'Thank you. Everything is ready on our side.') },
      { title: 'Documents rejected', name: 'documents_rejected', when: 'Documents not acceptable',
        body: msg(
          'Unfortunately, we could not accept the documents you sent.',
          details(['Booking', '{{reference}}'], ['Reason', '{{reason}}']),
          'Please send new, clear photos here.') },
    ],
  },
  {
    title: 'Emergency & support',
    items: [
      { title: 'Contact support', name: 'contact_support', when: 'General assistance',
        body: msg(
          'Thank you for contacting us about your booking *{{reference}}*.',
          'Our support team is available on +94 77 972 6761 and here on WhatsApp. Please tell us how we can help.') },
      { title: 'Vehicle issue follow-up', name: 'vehicle_issue_followup', when: 'Customer reported a problem',
        body: msg(
          'We are following up on the issue you reported with your rental vehicle.',
          details(['Booking', '{{reference}}'], ['Vehicle', '{{vehicle}}']),
          'Is everything working properly now? Please reply and let us know.') },
      { title: 'Replacement vehicle arranged', name: 'replacement_vehicle', when: 'Replacement prepared',
        body: msg(
          'We have arranged a replacement vehicle for you.',
          details(['Booking', '{{reference}}'], ['Replacement vehicle', '{{vehicle}}']),
          'Our team will contact you shortly with the handover details.') },
      { title: 'Breakdown assistance', name: 'breakdown_assistance', when: 'Send roadside-assistance details',
        body: msg(
          'We are sorry for the trouble. Here is how to get roadside assistance.',
          details(['Booking', '{{reference}}'], ['Assistance', '{{assistance_number}}'], ['Our office', '+94 77 972 6761']),
          'Please share your location here and wait with the vehicle in a safe place.') },
    ],
  },
  {
    title: 'Promotions',
    items: [
      { title: 'Returning customer offer', name: 'returning_customer_offer', when: 'Discount for a previous customer', category: 'MARKETING',
        body: msg(
          'Thank you for renting with Ceylon Rent A Cars before.',
          'As a returning customer, you get *{{discount}}* off your next rental with us.',
          'Simply reply to this message to book.') },
      { title: 'Special promotion', name: 'special_promotion', when: 'Seasonal / promo campaign', category: 'MARKETING',
        body: msg(
          'We have a special offer for you.',
          details(['Offer', '{{offer}}'], ['Valid until', '{{valid_until}}']),
          'Reply to this message to reserve your vehicle.') },
      { title: 'Discount code', name: 'discount_code', when: 'Send a coupon / promo code', category: 'MARKETING',
        body: msg(
          'Here is your discount code for Ceylon Rent A Cars.',
          details(['Code', '{{promo_code}}'], ['Valid until', '{{valid_until}}']),
          'Simply mention this code when you book.') },
    ],
  },
];

/** Example values Meta sees when reviewing (and the preview shows) */
export const STARTER_SAMPLES: Record<string, string> = {
  name: 'Manodya', vehicle: 'Toyota Raize', dates: '8 Oct 2026 - 9 Oct 2026', reference: 'CRC-5D453B',
  pickup_time: '8 Oct, 9:00 AM', pickup_location: 'Bandaranaike Airport', return_time: '9 Oct, 6:00 PM',
  return_location: 'our Colombo office', amount: 'LKR 25,000', due_date: '7 Oct 2026', link: 'https://ceylon-rent-a-cars.vercel.app',
  map_link: 'https://maps.google.com/?q=7.18,79.88', reason: 'the vehicle is booked for those dates',
  changes: 'return date moved to 10 Oct 2026', documents: 'driving licence and passport',
  assistance_number: '+94 77 972 6761', discount: '10%', offer: '15% off weekly rentals',
  valid_until: '31 Dec 2026', promo_code: 'CEYLON10',
};
