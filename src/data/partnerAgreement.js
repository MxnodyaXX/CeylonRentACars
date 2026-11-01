/*
 * Vehicle partner agreement shown on "List your vehicle". The exact text the owner signed is
 * saved with their application (admin prints it from there), so editing this only affects
 * new applications — change VERSION whenever the wording changes.
 * This is a starting template: have it reviewed (ideally by a lawyer) before relying on it.
 */
export const AGREEMENT_VERSION = 'partner-v1-2026-11';

export const AGREEMENT_TITLE = 'Vehicle Partner Agreement';

export const AGREEMENT_SECTIONS = [
  ['The parties', [
    'This agreement is between Ceylon Rent A Cars ("the Company") and the vehicle owner named in this application ("the Owner").',
    'It applies to the vehicle in this application and to any other vehicle the Company later accepts from the Owner.',
  ]],
  ['Application and approval', [
    'Sending this application does not oblige the Company to list the vehicle. The Company may inspect the vehicle (in person, by video call, from photos and documents, or another way it chooses) and may accept or decline the application.',
    'The price in this application is the Owner\'s asking price. The rental price and the Company\'s commission are agreed between the Owner and the Company during the review and confirmed in writing when the vehicle is accepted.',
    'The agreement takes effect when the Company confirms the vehicle is accepted.',
  ]],
  ['The Owner confirms', [
    'The Owner is the registered owner of the vehicle, or has the registered owner\'s written permission to rent it out.',
    'The vehicle has a valid revenue licence, an insurance policy that covers rental use, and is roadworthy and serviced.',
    'Everything in this application and its documents is true and complete. The Owner will tell the Company straight away about any change (insurance, licence, ownership, finance, accidents or faults).',
  ]],
  ['Rentals', [
    'The Company finds customers, takes bookings, checks customers\' identity and driving licences, hands the vehicle over, receives it back and collects payment.',
    'The Company records the odometer, fuel level and condition of the vehicle at every handover and return.',
    'The Owner keeps the vehicle available for confirmed bookings. The Owner may block dates by telling the Company in advance; a booking already confirmed cannot be cancelled by the Owner.',
  ]],
  ['Payments to the Owner', [
    'For each completed rental the Owner receives the agreed rental income less the agreed commission and any agreed costs. The Company shows each rental, its income and the Owner\'s payout in the owner account.',
    'Payouts are made by bank transfer to the account the Owner gives the Company, on the schedule agreed at acceptance.',
    'Money a customer has not paid, or that is written off after a vehicle is recovered, is shared as agreed at acceptance.',
  ]],
  ['Maintenance, damage and breakdowns', [
    'The Owner pays for normal servicing, repairs from wear and tear, the revenue licence and insurance, unless agreed otherwise in writing.',
    'Damage caused during a rental is claimed from the customer and/or the insurance. The Company helps with the claim and keeps the records (photos, handover reports, police reports).',
    'If the vehicle breaks down during a rental, the Company may arrange repairs or a replacement vehicle for the customer, and will inform the Owner.',
  ]],
  ['Ending the agreement', [
    'Either party may end this agreement with 14 days\' written notice. A vehicle on a confirmed booking stays until that booking ends.',
    'The Company may stop listing a vehicle at once if the documents are not valid, the vehicle is unsafe, or information given was false.',
    'Payouts for completed rentals are settled after the agreement ends.',
  ]],
  ['Personal information', [
    'The Company keeps the Owner\'s details and documents securely and uses them only to review the application, run the partnership and meet legal requirements.',
  ]],
  ['General', [
    'This agreement is governed by the laws of Sri Lanka.',
    'Any change to this agreement must be agreed in writing by both parties.',
  ]],
];

/** The whole agreement as plain text (saved with the application) */
export const agreementText = () => [
  `${AGREEMENT_TITLE} (${AGREEMENT_VERSION})`,
  ...AGREEMENT_SECTIONS.map(([title, items], i) => `\n${i + 1}. ${title}\n${items.map((t, j) => `${i + 1}.${j + 1} ${t}`).join('\n')}`),
].join('\n');
