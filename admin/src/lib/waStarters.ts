/* =====================================================================
   Ready-made WhatsApp templates for Ceylon Rent A Cars, in the order of a
   customer's journey (inquiry → booking → payment → pickup → rental →
   return → after return), plus documents, support and promotions.

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

export const STARTER_GROUPS: StarterGroup[] = [
  {
    title: 'First contact',
    items: [
      { title: 'Inquiry received', name: 'inquiry_received', when: 'Right after a customer sends an inquiry',
        body: 'Dear {{name}}, thank you for contacting Ceylon Rent A Cars. We have received your inquiry {{reference}} for the {{vehicle}} ({{dates}}). Our team is checking availability and will reply to you here shortly.' },
      { title: 'Welcome message', name: 'welcome_message', when: 'When you start talking with a new customer',
        body: 'Dear {{name}}, welcome to Ceylon Rent A Cars. This is our official WhatsApp number for your request {{reference}}. You can send your questions, documents and pickup details here, and our team will help you at every step.' },
    ],
  },
  {
    title: 'Booking',
    items: [
      { title: 'Booking confirmed', name: 'booking_confirmed', when: 'Booking successfully created',
        body: 'Dear {{name}}, your booking {{reference}} for the {{vehicle}} ({{dates}}) is confirmed. Thank you for choosing Ceylon Rent A Cars. Reply to this message if you have any questions.' },
      { title: 'Booking pending', name: 'booking_pending', when: 'Waiting for admin / owner approval',
        body: 'Dear {{name}}, your booking request {{reference}} for the {{vehicle}} ({{dates}}) has been received and is waiting for approval. We will confirm it with you here as soon as possible.' },
      { title: 'Booking approved', name: 'booking_approved', when: 'Admin approves the rental',
        body: 'Dear {{name}}, good news. Your booking {{reference}} for the {{vehicle}} ({{dates}}) has been approved. We will send your pickup details closer to the date.' },
      { title: 'Booking rejected', name: 'booking_rejected', when: 'Vehicle / request cannot be accepted',
        body: 'Dear {{name}}, we are sorry, but we cannot accept your booking request {{reference}} for the {{vehicle}}. Reason given by our team: {{reason}}. Reply to this message and we will help you find another option.' },
      { title: 'Booking cancelled', name: 'booking_cancelled', when: 'Booking cancelled by customer or admin',
        body: 'Dear {{name}}, your booking {{reference}} for the {{vehicle}} ({{dates}}) has been cancelled. If this was not expected, or you would like to book again, please reply to this message.' },
      { title: 'Booking modified', name: 'booking_modified', when: 'Dates, vehicle, location etc. changed',
        body: 'Dear {{name}}, your booking {{reference}} has been updated. New details: {{changes}}. Please reply to this message if anything is not correct.' },
    ],
  },
  {
    title: 'Vehicle availability',
    items: [
      { title: 'Vehicle unavailable', name: 'vehicle_unavailable', when: 'Selected vehicle becomes unavailable',
        body: 'Dear {{name}}, we are sorry to tell you that the {{vehicle}} is no longer available for {{dates}} (booking {{reference}}). Our team will suggest other vehicles for you shortly.' },
      { title: 'Alternative vehicles', name: 'vehicle_alternatives', when: 'Suggest replacement vehicles',
        body: 'Dear {{name}}, the {{vehicle}} is not available for {{dates}}. Please see the vehicles we can offer instead for request {{reference}} here: {{link}} and reply to this message with any questions.' },
      { title: 'Vehicle changed', name: 'vehicle_changed', when: 'Admin changes the assigned vehicle',
        body: 'Dear {{name}}, the vehicle for your booking {{reference}} has been changed to the {{vehicle}} for {{dates}}. Reply to this message if you have any questions about the change.' },
    ],
  },
  {
    title: 'Payment',
    items: [
      { title: 'Payment received', name: 'payment_received', when: 'Full or partial payment received',
        body: 'Dear {{name}}, we have received your payment of {{amount}} for booking {{reference}}. Thank you for choosing Ceylon Rent A Cars.' },
      { title: 'Payment pending', name: 'payment_pending', when: 'Customer still has an outstanding amount',
        body: 'Dear {{name}}, a payment of {{amount}} is still pending for your booking {{reference}}. Please reply to this message if you need our payment details.' },
      { title: 'Payment reminder', name: 'payment_reminder', when: 'Remind the customer before pickup',
        body: 'Dear {{name}}, this is a friendly reminder that {{amount}} is due for booking {{reference}} before your pickup on {{pickup_time}}. Reply to this message if you have any questions.' },
      { title: 'Balance due', name: 'balance_due', when: 'Remaining balance notification',
        body: 'Dear {{name}}, the remaining balance for booking {{reference}} is {{amount}}. Please settle it by {{due_date}}, and reply to this message if you need our payment details.' },
      { title: 'Security deposit received', name: 'deposit_received', when: 'Deposit confirmation',
        body: 'Dear {{name}}, we have received your security deposit of {{amount}} for booking {{reference}}. It will be refunded after the vehicle is returned and checked.' },
      { title: 'Security deposit refunded', name: 'deposit_refunded', when: 'Deposit refunded after the rental',
        body: 'Dear {{name}}, your security deposit of {{amount}} for booking {{reference}} has been refunded. Thank you for renting with Ceylon Rent A Cars.' },
      { title: 'Refund processed', name: 'refund_processed', when: 'Booking or payment refund processed',
        body: 'Dear {{name}}, a refund of {{amount}} for booking {{reference}} has been processed. Depending on your bank, it may take a few days to appear in your account.' },
    ],
  },
  {
    title: 'Pickup',
    items: [
      { title: 'Pickup reminder', name: 'pickup_reminder', when: '1 day or a few hours before pickup',
        body: 'Dear {{name}}, this is a reminder that your {{vehicle}} will be ready for pickup on {{pickup_time}} at {{pickup_location}} (booking {{reference}}). Reply to this message if anything changes.' },
      { title: 'Pickup location', name: 'pickup_location', when: 'Send location, map and contact details',
        body: 'Dear {{name}}, your pickup point for booking {{reference}} is {{pickup_location}}. Map: {{map_link}} . On arrival, please call or message us at +94 77 972 6761.' },
      { title: 'Vehicle ready', name: 'vehicle_ready', when: 'Vehicle is prepared and ready',
        body: 'Dear {{name}}, your {{vehicle}} is cleaned, checked and ready for pickup (booking {{reference}}). We look forward to seeing you.' },
      { title: 'Pickup delayed', name: 'pickup_delayed', when: 'Vehicle / pickup is delayed',
        body: 'Dear {{name}}, we are sorry, but the pickup for booking {{reference}} is delayed. The new pickup time is {{pickup_time}}. Thank you for your patience, and reply here if you have any questions.' },
      { title: 'Documents required', name: 'documents_required', when: 'NIC / passport / licence reminder',
        body: 'Dear {{name}}, please bring the following documents for booking {{reference}}: {{documents}}. You can also send clear photos of them here before pickup.' },
    ],
  },
  {
    title: 'Rental period',
    items: [
      { title: 'Rental started', name: 'rental_started', when: 'Customer has collected the vehicle',
        body: 'Dear {{name}}, your rental of the {{vehicle}} (booking {{reference}}) has started. Have a safe trip, and message us here any time if you need help.' },
      { title: 'Rental details', name: 'rental_details', when: 'Rental period, vehicle and contact details',
        body: 'Dear {{name}}, here are your rental details for booking {{reference}}. Vehicle: {{vehicle}}. Rental period: {{dates}}. For help at any time, call or message +94 77 972 6761.' },
      { title: 'Extension available', name: 'rental_extension_offer', when: 'Ask whether the customer wants an extension',
        body: 'Dear {{name}}, your rental of the {{vehicle}} (booking {{reference}}) ends on {{return_time}}. The vehicle is free for a few more days, so reply to this message if you would like to extend.' },
      { title: 'Extension approved', name: 'extension_approved', when: 'New return date confirmed',
        body: 'Dear {{name}}, your rental extension for booking {{reference}} is approved. Your new return time is {{return_time}}. Thank you for staying with us.' },
      { title: 'Extension rejected', name: 'extension_rejected', when: 'Extension cannot be accepted',
        body: 'Dear {{name}}, we are sorry, but we cannot extend booking {{reference}} because the vehicle is reserved after your rental. Please return it by {{return_time}} as planned.' },
      { title: 'Rental expiring soon', name: 'rental_expiring', when: 'Rental ends soon',
        body: 'Dear {{name}}, your rental of the {{vehicle}} (booking {{reference}}) ends on {{return_time}}. Reply to this message if you need any help with the return.' },
    ],
  },
  {
    title: 'Return',
    items: [
      { title: 'Return reminder', name: 'return_reminder', when: 'Upcoming return date / time',
        body: 'Dear {{name}}, a reminder that the {{vehicle}} (booking {{reference}}) is due back on {{return_time}}. Reply to this message if you would like to extend your rental.' },
      { title: 'Return location', name: 'return_location', when: 'Where to return the vehicle',
        body: 'Dear {{name}}, please return the vehicle for booking {{reference}} to {{return_location}}. Map: {{map_link}} . Call us at +94 77 972 6761 when you arrive.' },
      { title: 'Return overdue', name: 'return_overdue', when: 'Vehicle has not been returned',
        body: 'Dear {{name}}, the {{vehicle}} for booking {{reference}} was due back on {{return_time}} and has not been returned yet. Please contact us as soon as possible on +94 77 972 6761.' },
      { title: 'Vehicle returned', name: 'vehicle_returned', when: 'Confirm successful return',
        body: 'Dear {{name}}, we confirm that the {{vehicle}} for booking {{reference}} has been returned. Thank you for renting with Ceylon Rent A Cars.' },
      { title: 'Late fee notice', name: 'late_fee_notice', when: 'Notify about a late-return charge',
        body: 'Dear {{name}}, the vehicle for booking {{reference}} was returned late, so a late return fee of {{amount}} applies. Reply to this message if you have any questions about this charge.' },
    ],
  },
  {
    title: 'After return',
    items: [
      { title: 'Inspection completed', name: 'inspection_completed', when: 'Vehicle inspection finished',
        body: 'Dear {{name}}, the inspection of the {{vehicle}} for booking {{reference}} is complete. We will let you know here if anything needs your attention.' },
      { title: 'Additional charge', name: 'additional_charge', when: 'Damage / fuel / late etc. charge',
        body: 'Dear {{name}}, an additional charge of {{amount}} applies to booking {{reference}} for the following reason: {{reason}}. Reply to this message if you would like to discuss it.' },
      { title: 'No additional charges', name: 'no_additional_charges', when: 'Rental closed with nothing extra to pay',
        body: 'Dear {{name}}, your rental {{reference}} is now closed with no additional charges. Thank you for taking good care of the vehicle.' },
      { title: 'Feedback request', name: 'feedback_request', when: 'Ask the customer for a review / rating',
        body: 'Dear {{name}}, thank you for renting the {{vehicle}} with Ceylon Rent A Cars (booking {{reference}}). Please share your feedback here: {{link}} and reply to this message if you need anything.' },
      { title: 'Thank you', name: 'thank_you', when: 'General post-rental thank-you',
        body: 'Dear {{name}}, thank you for choosing Ceylon Rent A Cars for your trip (booking {{reference}}). We hope you enjoyed it, and we would be happy to help you again.' },
    ],
  },
  {
    title: 'Documents & verification',
    items: [
      { title: 'Verification required', name: 'verification_required', when: 'Need additional verification',
        body: 'Dear {{name}}, we need a little more information to verify booking {{reference}}: {{documents}}. Please send it here so we can confirm your rental.' },
      { title: 'Driving licence required', name: 'licence_required', when: 'Missing or expired licence',
        body: 'Dear {{name}}, we still need a valid driving licence for booking {{reference}}. Please send a clear photo of the front and back here. Visitors also need an International Driving Permit.' },
      { title: 'ID required', name: 'id_required', when: 'NIC / passport missing',
        body: 'Dear {{name}}, we still need a copy of your NIC or passport for booking {{reference}}. Please send a clear photo of it here.' },
      { title: 'Documents approved', name: 'documents_approved', when: 'Verification completed',
        body: 'Dear {{name}}, your documents for booking {{reference}} have been checked and approved. Thank you, everything is ready on our side.' },
      { title: 'Documents rejected', name: 'documents_rejected', when: 'Documents not acceptable',
        body: 'Dear {{name}}, we could not accept the documents sent for booking {{reference}}. Reason: {{reason}}. Please send new, clear photos here.' },
    ],
  },
  {
    title: 'Emergency & support',
    items: [
      { title: 'Contact support', name: 'contact_support', when: 'General assistance',
        body: 'Dear {{name}}, thank you for reaching out about booking {{reference}}. Our support team is available on +94 77 972 6761 and here on WhatsApp. How can we help you?' },
      { title: 'Vehicle issue follow-up', name: 'vehicle_issue_followup', when: 'Customer reported a problem',
        body: 'Dear {{name}}, we are following up on the issue you reported with the {{vehicle}} (booking {{reference}}). Is everything working properly now? Please reply and let us know.' },
      { title: 'Replacement vehicle arranged', name: 'replacement_vehicle', when: 'Replacement prepared',
        body: 'Dear {{name}}, we have arranged a replacement vehicle for booking {{reference}}: the {{vehicle}}. Our team will contact you shortly with the handover details.' },
      { title: 'Breakdown assistance', name: 'breakdown_assistance', when: 'Send roadside-assistance details',
        body: 'Dear {{name}}, for roadside assistance with booking {{reference}}, please call {{assistance_number}} or our office on +94 77 972 6761. Share your location here and stay with the vehicle in a safe place.' },
    ],
  },
  {
    title: 'Promotions',
    items: [
      { title: 'Returning customer offer', name: 'returning_customer_offer', when: 'Discount for a previous customer', category: 'MARKETING',
        body: 'Dear {{name}}, thank you for renting with us before. As a returning customer you get {{discount}} off your next rental with Ceylon Rent A Cars. Reply to this message to book.' },
      { title: 'Special promotion', name: 'special_promotion', when: 'Seasonal / promo campaign', category: 'MARKETING',
        body: 'Dear {{name}}, Ceylon Rent A Cars has a special offer for you: {{offer}}. It is valid until {{valid_until}}, so reply to this message to reserve your vehicle.' },
      { title: 'Discount code', name: 'discount_code', when: 'Send a coupon / promo code', category: 'MARKETING',
        body: 'Dear {{name}}, here is your discount code for Ceylon Rent A Cars: {{promo_code}}. Use it before {{valid_until}} by mentioning it when you book.' },
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
